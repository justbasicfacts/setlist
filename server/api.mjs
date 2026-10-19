/**
 * The backend.
 *
 *   node --env-file-if-exists=.env server/api.mjs
 *
 * Cities come from OpenStreetMap's Nominatim, so any city in the world can be picked.
 * Gigs come from Ticketmaster: by city name first, then by a radius around the
 * coordinates, which is what finds them in places the city filter does not cover.
 * Songs come from Deezer. Nothing is exported or saved; the page is a list.
 */

import { createServer } from 'node:http';
import { extraEvents } from './sources.mjs';
import { readFileSync, writeFileSync } from 'node:fs';

/* Hosts set PORT; locally API_PORT keeps it out of the way of other tools. */
const PORT = Number(process.env.PORT ?? process.env.API_PORT ?? 5181);
const ORIGIN = process.env.SITE_ORIGIN ?? 'http://localhost:5180';
const TM_KEY = process.env.TICKETMASTER_API_KEY ?? '';
const LASTFM_KEY = process.env.LASTFM_API_KEY ?? '';
const DEEZER = 'https://api.deezer.com';
const PHOTON = 'https://photon.komoot.io';
const NOMINATIM = 'https://nominatim.openstreetmap.org';
const UA = 'whosplaying/0.1 (local dev)';

const LINEUP_FILE = new URL('.lineup-cache.json', import.meta.url).pathname;
const YT_FILE = new URL('.youtube-cache.json', import.meta.url).pathname;
const ARTIST_FILE = new URL('.artist-cache.json', import.meta.url).pathname;

const readJson = (path, fallback) => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
};

const writeJson = (path, value) => {
  try {
    writeFileSync(path, JSON.stringify(value), { mode: 0o600 });
  } catch {
    /* a cache that cannot be written is not worth failing a request over */
  }
};

/* --------------------------------------------------------------------- week --- */

const pad = (value) => String(value).padStart(2, '0');
const iso = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const weekRange = (week) => {
  const today = new Date();
  const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  if (week === 'next') monday.setDate(monday.getDate() + 7);

  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);

  const label =
    monday.getMonth() === sunday.getMonth()
      ? `${monday.getDate()}-${sunday.getDate()} ${MONTHS[sunday.getMonth()]}`
      : `${monday.getDate()} ${MONTHS[monday.getMonth()]} - ${sunday.getDate()} ${MONTHS[sunday.getMonth()]}`;

  return { start: iso(monday), end: iso(sunday), label, week };
};

const weekHeading = (week) => (week === 'next' ? 'next week' : 'this week');

/* ------------------------------------------------------------------- cities --- */

/**
 * Any city worth searching, from a free text query.
 *
 * Photon is OpenStreetMap's autocomplete geocoder: it matches prefixes properly, which
 * a plain place search does not ("Istan" otherwise returns a hamlet in Andalusia).
 * Only real settlements are kept, and a prefix match outranks the rest.
 */
const cityCache = new Map();

const fromPhoton = async (query) => {
  const params = new URLSearchParams({ q: query, limit: '12', lang: 'en' });
  const response = await fetch(`${PHOTON}/api/?${params.toString()}`, {
    headers: { 'user-agent': UA, accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Photon ${response.status}`);
  return response.json();
};

/** Slower, but it does not rate limit the way Photon does. */
const fromNominatim = async (query) => {
  const params = new URLSearchParams({ q: query, format: 'jsonv2', addressdetails: '1', limit: '10', 'accept-language': 'en' });
  const response = await fetch(`${NOMINATIM}/search?${params.toString()}`, {
    headers: { 'user-agent': UA, accept: 'application/json' },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`Nominatim ${response.status}`);
  const hits = await response.json();
  return {
    features: hits
      .map((hit) => ({
        properties: {
          name: hit.address?.city ?? hit.address?.town ?? hit.address?.village ?? hit.name,
          countrycode: hit.address?.country_code,
          country: hit.address?.country,
          state: hit.address?.state,
          osm_value: hit.address?.city ? 'city' : hit.address?.town ? 'town' : 'village',
        },
        geometry: { coordinates: [Number(hit.lon), Number(hit.lat)] },
      }))
      .filter((feature) => feature.properties.name),
  };
};

const findCities = async (query) => {
  const key = query.trim().toLowerCase();
  if (cityCache.has(key)) return cityCache.get(key);

  let body;
  try {
    body = await fromPhoton(query);
  } catch {
    body = await fromNominatim(query);
  }

  const rank = { city: 3, municipality: 2, town: 2, village: 1 };
  const fold = (value) => String(value ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  const wanted = fold(query.trim());

  const seen = new Set();
  const cities = [];
  for (const feature of body.features ?? []) {
    const p = feature.properties ?? {};
    const kind = p.osm_value ?? p.type;
    if (!(kind in rank)) continue;

    const country = (p.countrycode ?? '').toUpperCase();
    const name = p.name ?? p.city ?? '';
    const key = `${fold(name)}|${country}`;
    if (!name || !country || seen.has(key)) continue;
    seen.add(key);

    const [lon, lat] = feature.geometry?.coordinates ?? [];
    cities.push({
      name,
      country,
      countryName: p.country ?? '',
      region: p.state ?? '',
      lat: Number(lat),
      lon: Number(lon),
      importance: rank[kind] + (fold(name).startsWith(wanted) ? 10 : 0),
    });
  }

  cities.sort((left, right) => right.importance - left.importance);
  const cleaned = cities.map(({ importance, ...city }) => city);
  cityCache.set(key, cleaned);
  return cleaned;
};

/* ------------------------------------------------------------------- events --- */

/**
 * Ticketmaster for a place.
 *
 * Two shapes are tried, because one is not enough: the city name works where the
 * venue records have it, and a radius around the pin works where they do not.
 */
const ticketmaster = async (city, week) => {
  if (!TM_KEY) return [];

  const { start, end } = weekRange(week);
  const base = {
    apikey: TM_KEY,
    classificationName: 'music',
    /* Ticketmaster wants the trailing Z; without it the window is ignored outright. */
    startDateTime: `${start}T00:00:00Z`,
    endDateTime: `${end}T23:59:59Z`,
    size: '50',
    sort: 'date,asc',
  };

  const shapes = [
    { city: city.name, ...(city.country ? { countryCode: city.country } : {}) },
    { latlong: `${city.lat},${city.lon}`, radius: '40', unit: 'km' },
  ];

  for (const shape of shapes) {
    try {
      const params = new URLSearchParams({ ...base, ...shape });
      const response = await fetch(`https://app.ticketmaster.com/discovery/v2/events.json?${params.toString()}`, {
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) continue;
      const body = await response.json();
      const events = body._embedded?.events ?? [];
      if (events.length > 0) return events;
    } catch {
      /* try the next shape */
    }
  }
  return [];
};

const fold = (value) => String(value ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();

/** Kilometres between two points. */
const distanceKm = (aLat, aLon, bLat, bLon) => {
  const rad = (degrees) => (degrees * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLon = rad(bLon - aLon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
};

/**
 * Duplicate names, one level deep: "Ahmed Ali" and "Ahmed Ali ve Dadaşlar" are the same
 * booking listed twice, so only the longer, fuller name is kept.
 */
const mergeNames = (names) => {
  const cleaned = [...new Set(names.map((name) => name.trim()).filter(Boolean))];
  return cleaned.filter(
    (name) => !cleaned.some((other) => other !== name && fold(other).includes(fold(name)) && fold(other) !== fold(name)),
  );
};

const fromTicketmaster = (raw, origin) =>
  raw.map((event) => {
    const attractions = (event._embedded?.attractions ?? []).map((entry) => entry.name?.trim()).filter(Boolean);
    const headline = event.name?.split(' - ')[0]?.trim();
    const date = event.dates?.start?.localDate ?? '';
    const venue = event._embedded?.venues?.[0];
    const venueName = venue?.name?.trim() || '';
    const venueCity = venue?.city?.name?.trim() || '';

    const venueLat = Number(venue?.location?.latitude ?? NaN);
    const venueLon = Number(venue?.location?.longitude ?? NaN);
    const away =
      Number.isFinite(venueLat) && Number.isFinite(venueLon)
        ? distanceKm(origin.lat, origin.lon, venueLat, venueLon)
        : null;

    return {
      date,
      day: date ? new Date(`${date}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short' }) : '',
      venue: venue?.name?.trim() || 'Venue to be announced',
      district: venue?.city?.name ?? '',
      time: event.dates?.start?.localTime?.slice(0, 5) ?? '',
      /* Only billed performers. Event titles are often the venue or a party series. */
      artists: mergeNames(attractions),
      sameCity: !!venueCity && fold(venueCity) === fold(origin.cityName || origin.name),
      away,
      source: 'Ticketmaster',
    };
  });

const artistsIn = (events) => [...new Set(events.flatMap((event) => event.artists))];

/* -------------------------------------------------------------------- songs --- */

/* --------------------------------------------------------------- last.fm --- */

/** Why Last.fm gave nothing, so the page can say it instead of shrugging. */
let lastFmError = '';

/** Last.fm's events for a place: the fallback where Ticketmaster has no listings. */
const lastFmEvents = async (city, week) => {
  if (!LASTFM_KEY) return [];

  const { start, end } = weekRange(week);
  /* No date parameters here: geo.getEvents does not take them, so the week is filtered below. */
  const params = new URLSearchParams({
    method: 'geo.getEvents',
    location: city.name,
    api_key: LASTFM_KEY,
    format: 'json',
    limit: '100',
  });

  try {
    const response = await fetch(`https://ws.audioscrobbler.com/2.0/?${params.toString()}`, {
      signal: AbortSignal.timeout(15_000),
    });
    const body = await response.json();
    if (!response.ok || body.error) {
      lastFmError = String(body.message ?? `HTTP ${response.status}`);
      return [];
    }
    lastFmError = '';

    const list = body.events?.event ?? [];
    const events = Array.isArray(list) ? list : [list];
    const inWeek = events.filter((event) => {
      const day = event.startDate ? new Date(Number(event.startDate) * 1000).toISOString().slice(0, 10) : '';
      return day >= start && day <= end;
    });

    return inWeek.map((event) => {
      const date = event.startDate ? new Date(Number(event.startDate) * 1000) : null;
      const artists = (event.artists?.artist ?? [])
        .map((entry) => (typeof entry === 'string' ? entry : entry?.name))
        .filter(Boolean);

      return {
        date: date ? date.toISOString().slice(0, 10) : '',
        day: date ? date.toLocaleDateString('en-GB', { weekday: 'short' }) : '',
        venue: event.venue?.name?.trim() || 'Venue to be announced',
        district: event.venue?.location?.city ?? '',
        time: '',
        artists: mergeNames(artists),
        sameCity: true,
        away: null,
        source: 'Last.fm',
      };
    });
  } catch {
    return [];
  }
};

const artistCache = readJson(ARTIST_FILE, {});

/** The most popular track Deezer has for an artist, kept forever once found. */
const songFor = async (artist) => {
  const key = artist.trim().toLowerCase();
  if (Object.prototype.hasOwnProperty.call(artistCache, key)) return artistCache[key];

  let found = null;
  try {
    const response = await fetch(`${DEEZER}/search?q=${encodeURIComponent(artist)}&limit=50`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (response.ok) {
      const body = await response.json();
      const matches = (body.data ?? []).filter((item) => {
        const name = (item.artist?.name ?? '').trim().toLowerCase();
        return name === key || name.includes(key) || key.includes(name);
      });
      matches.sort((left, right) => (right.rank ?? 0) - (left.rank ?? 0));
      const best = matches[0];
      if (best) found = { title: best.title, album: best.album?.title ?? null, preview: best.preview ?? null };
    }
  } catch {
    /* no song: the gig still shows */
  }

  artistCache[key] = found;
  return found;
};

/* ------------------------------------------------------------------ youtube --- */

const youtubeCache = readJson(YT_FILE, {});

/**
 * The first video id YouTube returns for a search.
 *
 * There is no key here, so this reads the results page the same way a browser does.
 * Only ids are taken, never anything else, and each query is remembered.
 */
const youtubeId = async (query) => {
  const key = query.trim().toLowerCase();
  if (Object.prototype.hasOwnProperty.call(youtubeCache, key)) return youtubeCache[key];

  let id = null;
  try {
    const params = new URLSearchParams({ search_query: query, sp: 'EgIQAQ%3D%3D' });
    const response = await fetch(`https://www.youtube.com/results?${params.toString()}`, {
      headers: {
        'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'accept-language': 'en',
      },
      signal: AbortSignal.timeout(12_000),
    });
    const html = await response.text();
    id = /"videoId":"([A-Za-z0-9_-]{11})"/.exec(html)?.[1] ?? null;
  } catch {
    /* no id: the page offers a plain search link instead */
  }

  youtubeCache[key] = id;
  writeJson(YT_FILE, youtubeCache);
  return id;
};

/* ------------------------------------------------------------------- lineup --- */

const lineups = new Map(Object.entries(readJson(LINEUP_FILE, {})));

const buildLineup = async (city, week) => {
  const key = `${city.lat},${city.lon}|${weekRange(week).start}`;
  const cached = lineups.get(key);
  /* Never serve a cached invented lineup, even if an older build wrote one. */
  if (cached && cached.rows?.[0]?.source !== 'invented') return { ...cached, cached: true };
  if (cached) lineups.delete(key);

  /* Anything whose venue is more than 30 km away is not "in town". */
  /*
   * Local means provable: either the venue is in the chosen city, or it is within 30 km
   * of the pin. A listing with neither is not shown, however it was found.
   */
  const { start, end } = weekRange(week);

  let raw = await ticketmaster(city, week);
  let fallback = [];
  if (raw.length === 0) {
    /* Nothing from Ticketmaster: try the city's own configured page, then Last.fm. */
    fallback = await extraEvents(city, week, weekRange(week));
    if (fallback.length === 0) fallback = await lastFmEvents(city, week);
  }

  const all = (raw.length > 0 ? fromTicketmaster(raw, city) : fallback)
    .filter((event) => event.artists.length > 0)
    /* The week is enforced here as well as in the query: a stray month cannot leak in. */
    .filter((event) => !!event.date && event.date >= start && event.date <= end)
    /* Distance wins when it is known; the city name is only a fallback. */
    .filter((event) => (event.away !== null ? event.away <= 30 : event.sameCity));

  /* Listings without a venue cannot be distance-checked, so they only stay as filler. */
  const withVenue = all.filter((event) => event.venue !== 'Venue to be announced');
  const events = withVenue.length >= 8 ? withVenue : all;

  /* And the same artist should appear once, however the bill is spelled. */
  const uniqueArtists = mergeNames(events.flatMap((event) => event.artists));
  for (const event of events) {
    event.artists = uniqueArtists.filter((name) => event.artists.some((own) => fold(own) === fold(name)));
  }

  const songs = {};
  for (const artist of artistsIn(events)) songs[artist] = await songFor(artist);

  const rows = events.map((event) => ({
    ...event,
    songs: event.artists.map((artist) => ({ artist, ...(songs[artist] ?? { title: null }) })),
  }));

  const result = {
    /* Say why a city is empty, rather than leaving a blank page. */
    note:
      rows.length === 0
        ? 'Ticketmaster has no listings for this country yet. Its coverage stops short of places like Hungary and Latvia, and no other source is wired in.'
        : undefined,
    city: { name: city.name, country: city.country, countryName: city.countryName, lat: city.lat, lon: city.lon },
    week,
    ...weekRange(week),
    heading: weekHeading(week),
    events: rows.length,
    rows,
    empty: rows.length === 0 || undefined,
  };

  if (rows.length > 0) {
    lineups.set(key, result);
    writeJson(LINEUP_FILE, Object.fromEntries(lineups));
    writeJson(ARTIST_FILE, artistCache);
  }
  return result;
};

/* --------------------------------------------------------------------- http --- */

const ORIGINS = ORIGIN.split(',').map((value) => value.trim()).filter(Boolean);

const json = (response, status, body, request) => {
  const origin = request?.headers?.origin ?? '';
  const allowed = ORIGINS.includes('*') || ORIGINS.includes(origin) ? origin || ORIGINS[0] : ORIGINS[0];

  response.writeHead(status, {
    'content-type': 'application/json',
    'access-control-allow-origin': allowed,
    'vary': 'origin',
    'cache-control': 'no-store',
  });
  response.end(JSON.stringify(body));
};

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://localhost:${PORT}`);

  try {
    if (url.pathname === '/api/cities') {
      const query = (url.searchParams.get('q') ?? '').trim();
      if (query.length < 2) return json(response, 200, { cities: [] }, request);
      return json(response, 200, { cities: await findCities(query) }, request);
    }

    if (url.pathname === '/api/reverse') {
      const lat = Number(url.searchParams.get('lat'));
      const lon = Number(url.searchParams.get('lon'));
      if (Number.isNaN(lat) || Number.isNaN(lon)) {
        return json(response, 400, { error: 'lat and lon are required' }, request);
      }

      try {
        /* Photon's reverse route is not answering, so this uses Nominatim, at zoom 10
           which is city level rather than a single building. */
        const params = new URLSearchParams({
          lat: String(lat),
          lon: String(lon),
          format: 'jsonv2',
          zoom: '10',
          'accept-language': 'en',
        });
        const upstream = await fetch(`${NOMINATIM}/reverse?${params.toString()}`, {
          headers: { 'user-agent': UA, accept: 'application/json' },
          signal: AbortSignal.timeout(10_000),
        });
        const body = await upstream.json();
        const p = body.address ?? {};
        const name = p.city ?? p.town ?? p.village ?? p.municipality ?? p.county ?? null;
        const country = (p.country_code ?? '').toUpperCase();
        const countryName = p.country ?? '';

        return json(
          response,
          200,
          {
            city: name && country ? { name, country, countryName, region: p.state ?? '', lat, lon } : null,
          },
          request,
        );
      } catch {
        return json(response, 200, { city: null }, request);
      }
    }

    if (url.pathname === '/api/lineup') {
      const name = url.searchParams.get('city') ?? '';
      const lat = Number(url.searchParams.get('lat'));
      const lon = Number(url.searchParams.get('lon'));
      const week = url.searchParams.get('week') === 'next' ? 'next' : 'this';
      if (!name || Number.isNaN(lat) || Number.isNaN(lon)) {
        return json(response, 400, { error: 'city, lat and lon are required' }, request);
      }

      const city = {
        name,
        lat,
        lon,
        country: url.searchParams.get('country') ?? '',
        countryName: url.searchParams.get('countryName') ?? '',
      };
      return json(response, 200, await buildLineup(city, week), request);
    }

    if (url.pathname === '/api/youtube') {
      const query = (url.searchParams.get('q') ?? '').trim();
      if (!query) return json(response, 400, { error: 'q is required' }, request);
      const id = await youtubeId(query);
      return json(response, 200, { id, url: id ? `https://www.youtube.com/watch?v=${id}` : null }, request);
    }

    if (url.pathname === '/api/setup') {
      return json(response, 200, { ticketmaster: !!TM_KEY, songs: 'deezer', cities: 'photon' }, request);
    }

    json(response, 404, { error: 'nothing here' }, request);
  } catch (failure) {
    json(response, failure.code ?? 500, { error: failure.message ?? String(failure) }, request);
  }
});

server.listen(PORT, () => {
  console.log(`api on http://localhost:${PORT}${TM_KEY ? '' : ' (TICKETMASTER_API_KEY is not set)'}`);
});

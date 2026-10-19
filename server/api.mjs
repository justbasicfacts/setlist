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
import { readFileSync, writeFileSync } from 'node:fs';

const PORT = Number(process.env.API_PORT ?? 5181);
const ORIGIN = process.env.SITE_ORIGIN ?? 'http://localhost:5180';
const TM_KEY = process.env.TICKETMASTER_API_KEY ?? '';
const DEEZER = 'https://api.deezer.com';
const PHOTON = 'https://photon.komoot.io';
const NOMINATIM = 'https://nominatim.openstreetmap.org';
const UA = 'whosplaying/0.1 (local dev)';

const LINEUP_FILE = new URL('.lineup-cache.json', import.meta.url).pathname;
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
    localStartDateTime: `${start}T00:00:00`,
    localEndDateTime: `${end}T23:59:59`,
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

const fromTicketmaster = (raw) =>
  raw.map((event) => {
    const attractions = (event._embedded?.attractions ?? []).map((entry) => entry.name?.trim()).filter(Boolean);
    const headline = event.name?.split(' - ')[0]?.trim();
    const date = event.dates?.start?.localDate ?? '';
    const venue = event._embedded?.venues?.[0];

    return {
      date,
      day: date ? new Date(`${date}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short' }) : '',
      venue: venue?.name?.trim() || 'Venue to be announced',
      district: venue?.city?.name ?? '',
      time: event.dates?.start?.localTime?.slice(0, 5) ?? '',
      artists: attractions.length > 0 ? attractions : headline ? [headline] : [],
      source: 'Ticketmaster',
    };
  });

const artistsIn = (events) => [...new Set(events.flatMap((event) => event.artists))];

/* -------------------------------------------------------------------- songs --- */

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

/* ------------------------------------------------------------------- lineup --- */

const lineups = new Map(Object.entries(readJson(LINEUP_FILE, {})));

const buildLineup = async (city, week) => {
  const key = `${city.lat},${city.lon}|${weekRange(week).start}`;
  const cached = lineups.get(key);
  if (cached) return { ...cached, cached: true };

  const events = fromTicketmaster(await ticketmaster(city, week));

  const songs = {};
  for (const artist of artistsIn(events)) songs[artist] = await songFor(artist);

  const rows = events.map((event) => ({
    ...event,
    songs: event.artists.map((artist) => ({ artist, ...(songs[artist] ?? { title: null }) })),
  }));

  const result = {
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

const json = (response, status, body) => {
  response.writeHead(status, {
    'content-type': 'application/json',
    'access-control-allow-origin': ORIGIN,
    'cache-control': 'no-store',
  });
  response.end(JSON.stringify(body));
};

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://localhost:${PORT}`);

  try {
    if (url.pathname === '/api/cities') {
      const query = (url.searchParams.get('q') ?? '').trim();
      if (query.length < 2) return json(response, 200, { cities: [] });
      return json(response, 200, { cities: await findCities(query) });
    }

    if (url.pathname === '/api/lineup') {
      const name = url.searchParams.get('city') ?? '';
      const lat = Number(url.searchParams.get('lat'));
      const lon = Number(url.searchParams.get('lon'));
      const week = url.searchParams.get('week') === 'next' ? 'next' : 'this';
      if (!name || Number.isNaN(lat) || Number.isNaN(lon)) {
        return json(response, 400, { error: 'city, lat and lon are required' });
      }

      const city = {
        name,
        lat,
        lon,
        country: url.searchParams.get('country') ?? '',
        countryName: url.searchParams.get('countryName') ?? '',
      };
      return json(response, 200, await buildLineup(city, week));
    }

    if (url.pathname === '/api/setup') {
      return json(response, 200, { ticketmaster: !!TM_KEY, songs: 'deezer', cities: 'nominatim' });
    }

    json(response, 404, { error: 'nothing here' });
  } catch (failure) {
    json(response, failure.code ?? 500, { error: failure.message ?? String(failure) });
  }
});

server.listen(PORT, () => {
  console.log(`api on http://localhost:${PORT}${TM_KEY ? '' : ' (TICKETMASTER_API_KEY is not set)'}`);
});

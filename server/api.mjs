/**
 * The backend: who is playing that city that week, and one track each.
 *
 *   node --env-file-if-exists=.env server/api.mjs
 *
 * No accounts, no approval, no music API key. Lineups come from Ticketmaster (key in
 * .env), tracks and previews from Deezer's public API, which has no daily allowance to
 * spend. Spotify is linked to, not called: its API needs either a person's approval
 * (playlists) or an app quota we already exhausted once.
 *
 * Endpoints
 *   GET /api/lineup?city=Berlin&week=this
 *   GET /api/setup
 */

import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';

const PORT = Number(process.env.API_PORT ?? 5181);
const ORIGIN = process.env.SITE_ORIGIN ?? 'http://localhost:5180';
const TM_KEY = process.env.TICKETMASTER_API_KEY ?? '';
const DEEZER = process.env.DEEZER_API_BASE ?? 'https://api.deezer.com';

export const CITIES = ['Berlin', 'London', 'Amsterdam', 'Dublin'];
const COUNTRY = { berlin: 'DE', london: 'GB', amsterdam: 'NL', dublin: 'IE' };

const LINEUP_FILE = new URL('.lineup-cache.json', import.meta.url).pathname;
const ARTIST_FILE = new URL('.artist-cache.json', import.meta.url).pathname;

/* -------------------------------------------------------------------- files --- */

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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* --------------------------------------------------------------------- week --- */

const pad = (value) => String(value).padStart(2, '0');
const iso = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Monday to Sunday, local, for this week or the next. */
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

export const weekHeading = (week) => (week === 'next' ? 'next week' : 'this week');

/* ------------------------------------------------------------------- events --- */

/** Music events in that city, that week, in date order. */
export const fetchEvents = async (city, week) => {
  if (!TM_KEY) throw Object.assign(new Error('TICKETMASTER_API_KEY is not set'), { code: 500 });

  const { start, end } = weekRange(week);
  const params = new URLSearchParams({
    apikey: TM_KEY,
    city,
    classificationName: 'music',
    localStartDateTime: `${start}T00:00:00`,
    localEndDateTime: `${end}T23:59:59`,
    size: '40',
    sort: 'date,asc',
  });
  const country = COUNTRY[city.trim().toLowerCase()];
  if (country) params.set('countryCode', country);

  const response = await fetch(`https://app.ticketmaster.com/discovery/v2/events.json?${params.toString()}`, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw Object.assign(new Error(`Ticketmaster answered ${response.status}`), { code: 502 });
  const body = await response.json();

  return (body._embedded?.events ?? []).map((event) => {
    const attractions = (event._embedded?.attractions ?? [])
      .map((entry) => entry.name?.trim())
      .filter(Boolean);
    const headline = event.name?.split(' - ')[0]?.trim();
    const artists = attractions.length > 0 ? attractions : headline ? [headline] : [];
    const date = event.dates?.start?.localDate;

    return {
      date,
      day: date ? new Date(`${date}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short' }) : '',
      venue: event._embedded?.venues?.[0]?.name?.trim() || 'TBA',
      artists,
    };
  });
};

/** Every artist once, in gig order. */
export const artistsIn = (events) => [...new Set(events.flatMap((event) => event.artists))];

/* ------------------------------------------------------------------- tracks --- */

/** One lookup per artist, kept forever: touring artists turn up week after week. */
const artistCache = readJson(ARTIST_FILE, {});

const spotifySearch = (artist, title) =>
  `https://open.spotify.com/search/${encodeURIComponent(`${artist} ${title}`)}`;

/**
 * The best track Deezer has for an artist.
 *
 * Deezer's search is fuzzy and ignores the artist: filter, so the query is the plain
 * name and a result is kept only when the credited artist agrees with it. Of those,
 * the most popular track wins rather than whichever came back first.
 */
const trackFor = async (artist) => {
  const key = artist.trim().toLowerCase();
  if (Object.prototype.hasOwnProperty.call(artistCache, key)) return artistCache[key];

  let found = null;

  try {
    const response = await fetch(`${DEEZER}/search?q=${encodeURIComponent(artist)}&limit=50`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`Deezer answered ${response.status}`);
    const body = await response.json();

    const matches = (body.data ?? []).filter((item) => {
      const name = (item.artist?.name ?? '').trim().toLowerCase();
      return name === key || name.includes(key) || key.includes(name);
    });
    matches.sort((left, right) => (right.rank ?? 0) - (left.rank ?? 0));

    const best = matches[0];
    if (best?.preview) {
      found = {
        id: String(best.id),
        title: best.title,
        artist,
        album: best.album?.title ?? null,
        artwork: best.album?.cover_medium ?? best.album?.cover ?? null,
        preview: best.preview,
        url: best.link,
        spotify: spotifySearch(artist, best.title),
      };
    }
  } catch {
    /* no track: the lineup still stands */
  }

  artistCache[key] = found;
  return found;
};

/* ------------------------------------------------------------------- lineup --- */

const lineups = new Map(Object.entries(readJson(LINEUP_FILE, {})));

/** The week's lineup with one track each. Cached per city and week start. */
export const lineup = async (city, week) => {
  const key = `${city.toLowerCase()}|${weekRange(week).start}`;
  if (lineups.has(key)) return { ...lineups.get(key), cached: true };

  const events = await fetchEvents(city, week);
  const artists = artistsIn(events);

  const tracks = [];
  if (artists.length > 0) {
    const queue = [...artists];
    const worker = async () => {
      while (queue.length > 0) {
        const artist = queue.shift();
        if (!artist) return;
        const track = await trackFor(artist);
        if (track) tracks.push(track);
      }
    };
    await Promise.all(Array.from({ length: 3 }, worker));
    tracks.sort((left, right) => artists.indexOf(left.artist) - artists.indexOf(right.artist));
  }

  const result = {
    city,
    week,
    ...weekRange(week),
    heading: weekHeading(week),
    events: events.length,
    eventsList: events,
    tracks,
    empty: events.length === 0 || undefined,
  };

  lineups.set(key, result);
  writeJson(LINEUP_FILE, Object.fromEntries(lineups));
  writeJson(ARTIST_FILE, artistCache);
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
    if (url.pathname === '/api/setup') {
      return json(response, 200, { ticketmaster: !!TM_KEY, tracks: 'deezer', cities: CITIES });
    }

    if (url.pathname === '/api/lineup') {
      const city = url.searchParams.get('city') ?? 'Berlin';
      const week = url.searchParams.get('week') === 'next' ? 'next' : 'this';
      if (!CITIES.includes(city)) return json(response, 400, { error: `unknown city ${city}` });
      return json(response, 200, await lineup(city, week));
    }

    if (url.pathname === '/api/playlist.m3u') {
      const city = url.searchParams.get('city') ?? 'Berlin';
      const week = url.searchParams.get('week') === 'next' ? 'next' : 'this';
      if (!CITIES.includes(city)) return json(response, 400, { error: `unknown city ${city}` });

      const data = await lineup(city, week);
      const lines = ['#EXTM3U', `#PLAYLIST:${city}, ${weekHeading(week)}, ${data.label}`];
      for (const track of data.tracks) {
        lines.push(`#EXTINF:-1,${track.artist} - ${track.title}`, track.preview);
      }

      response.writeHead(200, {
        'content-type': 'audio/x-mpegurl; charset=utf-8',
        'content-disposition': `attachment; filename="${city.toLowerCase()}-${week}.m3u"`,
        'access-control-allow-origin': ORIGIN,
      });
      return response.end(`${lines.join('\n')}\n`);
    }

    json(response, 404, { error: 'nothing here' });
  } catch (failure) {
    json(response, failure.code ?? 500, { error: failure.message ?? String(failure) });
  }
});

server.listen(PORT, async () => {
  console.log(`api on http://localhost:${PORT}${TM_KEY ? '' : ' (TICKETMASTER_API_KEY is not set)'}`);

  /* Fill this week's lineups before anyone asks. Artists already known cost nothing. */
  setTimeout(async () => {
    for (const city of CITIES) {
      try {
        const data = await lineup(city, 'this');
        console.log(`  warm: ${city} this -> ${data.tracks.length}/${data.events} tracks`);
      } catch (failure) {
        console.log(`  warm: ${city} this -> ${failure.message}`);
      }
      await sleep(400);
    }
  }, 400);
});

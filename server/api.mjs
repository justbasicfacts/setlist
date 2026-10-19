/**
 * The backend: who is playing that city that week, and one track each.
 *
 *   node --env-file-if-exists=.env server/api.mjs
 *
 * No authorisation and no accounts anywhere. Spotify will not let an app create a
 * playlist without a person approving it once (the app token gets 403 on any playlist
 * write), so this does not try: it reads the public catalogue, which an app token is
 * allowed to do, and the page plays the tracks itself.
 *
 * Endpoints
 *   GET /api/lineup?city=Berlin&week=this   the week's artists and one track each
 *   GET /api/setup                          what the server has configured
 */

import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';

const PORT = Number(process.env.API_PORT ?? 5181);
const ORIGIN = process.env.SITE_ORIGIN ?? 'http://localhost:5180';
const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID ?? '';
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET ?? '';
const TM_KEY = process.env.TICKETMASTER_API_KEY ?? '';
const SPOTIFY = process.env.SPOTIFY_API_BASE ?? 'https://api.spotify.com/v1';
const ACCOUNTS = process.env.SPOTIFY_ACCOUNTS_BASE ?? 'https://accounts.spotify.com';

export const CITIES = ['Berlin', 'London', 'Amsterdam', 'Dublin'];
const COUNTRY = { berlin: 'DE', london: 'GB', amsterdam: 'NL', dublin: 'IE' };

/* -------------------------------------------------------------------- week --- */

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

/* ------------------------------------------------------------------ events --- */

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

/* ------------------------------------------------------------------- files --- */

function readJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
}

/* ----------------------------------------------------------------- spotify --- */

let appToken = { token: '', expires: 0 };

/** An app token: the catalogue, and nothing that belongs to a person. */
const appAccessToken = async () => {
  if (appToken.token && appToken.expires > Date.now() + 60_000) return appToken.token;
  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw Object.assign(new Error('SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET are not set'), { code: 500 });
  }

  const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  const response = await fetch(`${ACCOUNTS}/api/token`, {
    method: 'POST',
    headers: { authorization: `Basic ${basic}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  const body = await response.json();
  if (!response.ok) throw Object.assign(new Error(body.error_description ?? `token ${response.status}`), { code: 502 });

  appToken = { token: body.access_token, expires: Date.now() + body.expires_in * 1000 };
  return appToken.token;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Spotify rate limits by app, and a burst of searches earns 429s. Wait for as long as
 * it asks, then try again rather than losing the artist.
 */
const search = async (token, path) => {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(`${SPOTIFY}${path}`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });

    if (response.status === 429) {
      const after = Number(response.headers.get('retry-after') ?? '0');
      /*
       * A short pause is a hiccup and worth waiting out. A long one means the app's
       * quota is spent, and sitting on it would hang the request for minutes, so give
       * up at once and let the caller show what it has.
       */
      if (!after || after > 10) {
        throw Object.assign(new Error('Spotify quota is spent for now'), { code: 429, quota: true });
      }
      await sleep(after * 1000);
      continue;
    }
    if (!response.ok) {
      throw Object.assign(new Error(`Spotify ${path} answered ${response.status}`), { code: response.status });
    }
    return response.json();
  }
  throw Object.assign(new Error('Spotify kept rate limiting the search'), { code: 429, quota: true });
};

/**
 * One track per artist.
 *
 * The search is a text search, not an artist lookup, so a result is kept only when
 * the credited artist agrees with the name we asked for. "Egg" otherwise returns a
 * completely different band called Egg.
 */
const trackFor = async (token, artist) => {
  const params = new URLSearchParams({ q: `artist:"${artist}"`, type: 'track', limit: '5' });
  const body = await search(token, `/search?${params.toString()}`);
  const wanted = artist.trim().toLowerCase();

  for (const item of body.tracks?.items ?? []) {
    if (!item?.uri) continue;
    const credits = (item.artists ?? []).map((entry) => entry.name?.trim().toLowerCase()).filter(Boolean);
    const agrees = credits.some((name) => name === wanted || name.includes(wanted) || wanted.includes(name));
    if (!agrees) continue;

    return {
      id: item.id,
      title: item.name,
      artist,
      url: item.external_urls?.spotify ?? `https://open.spotify.com/track/${item.id}`,
      embed: `https://open.spotify.com/embed/track/${item.id}`,
      album: item.album?.name ?? null,
      artwork: item.album?.images?.[0]?.url ?? null,
    };
  }
  return null;
};

/* ------------------------------------------------------------------- lineup --- */

/**
 * The lineup for a city and week never changes once made, so it is kept on disk: a
 * restart should not cost a visitor a ten second wait.
 */
const CACHE_FILE = new URL('.lineup-cache.json', import.meta.url).pathname;
const cache = new Map(Object.entries(readJson(CACHE_FILE, {})));

const persist = () => {
  try {
    writeFileSync(CACHE_FILE, JSON.stringify(Object.fromEntries(cache), null, 0), { mode: 0o600 });
  } catch {
    /* a cache that cannot be written is not worth failing a request over */
  }
};

/** The week's lineup with one track each. Cached per city and week start. */
export const lineup = async (city, week) => {
  const key = `${city.toLowerCase()}|${weekRange(week).start}`;
  const hit = cache.get(key);
  if (hit) return { ...hit, cached: true };

  const token = await appAccessToken();
  const events = await fetchEvents(city, week);
  const artists = artistsIn(events);

  if (artists.length === 0) {
    const empty = { city, week, ...weekRange(week), heading: weekHeading(week), tracks: [], events: 0, empty: true };
    cache.set(key, empty);
    return empty;
  }

  /* Two at a time: enough to be quick, few enough that Spotify does not push back. */
  const tracks = [];
  const queue = [...artists];
  let limited = false;

  const worker = async () => {
    while (queue.length > 0 && !limited) {
      const artist = queue.shift();
      if (!artist) return;
      try {
        const track = await trackFor(token, artist);
        if (track) tracks.push(track);
      } catch (failure) {
        if (failure.quota) limited = true;
      }
    }
  };
  await Promise.all(Array.from({ length: 2 }, worker));

  /* Keep gig order rather than the order the workers happened to finish in. */
  tracks.sort((left, right) => artists.indexOf(left.artist) - artists.indexOf(right.artist));

  const result = {
    city,
    week,
    ...weekRange(week),
    heading: weekHeading(week),
    events: events.length,
    tracks,
    eventsList: events,
    /* True when Spotify's quota cut the run short: the list is partial, not empty. */
    limited: limited || undefined,
  };
  /* Only remember a run that actually found something: a rate-limited pass is not an answer. */
  /* A run cut short by quota is not the finished answer, so it is not kept. */
  if (!result.limited && (tracks.length > 0 || events.length === 0)) {
    cache.set(key, result);
    persist();
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
    if (url.pathname === '/api/setup') {
      return json(response, 200, {
        ticketmaster: !!TM_KEY,
        spotify: !!(CLIENT_ID && CLIENT_SECRET),
        cities: CITIES,
      });
    }

    if (url.pathname === '/api/lineup') {
      const city = url.searchParams.get('city') ?? 'Berlin';
      const week = url.searchParams.get('week') === 'next' ? 'next' : 'this';
      if (!CITIES.includes(city)) return json(response, 400, { error: `unknown city ${city}` });
      return json(response, 200, await lineup(city, week));
    }

    if (url.pathname === '/api/lineup/all') {
      const week = url.searchParams.get('week') === 'next' ? 'next' : 'this';
      const all = [];
      for (const city of CITIES) {
        try {
          all.push(await lineup(city, week));
        } catch (failure) {
          all.push({ city, week, error: failure.message });
        }
      }
      return json(response, 200, { week, cities: all });
    }

    json(response, 404, { error: 'nothing here' });
  } catch (failure) {
    json(response, failure.code ?? 500, { error: failure.message ?? String(failure) });
  }
});

server.listen(PORT, () => {
  console.log(`api on http://localhost:${PORT}`);
  if (!TM_KEY) console.log('TICKETMASTER_API_KEY is not set');
  if (!CLIENT_ID || !CLIENT_SECRET) console.log('SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET are not set');

  /* Fill the weeks before anyone asks, so the first visit is instant. */
  if (!TM_KEY || !CLIENT_ID || !CLIENT_SECRET) return;
  /* Only this week, and only once: Spotify's app quota is a daily allowance. */
  setTimeout(async () => {
    for (const city of CITIES) {
      try {
        const data = await lineup(city, 'this');
        console.log(`  warm: ${city} this -> ${data.tracks.length} tracks${data.limited ? ' (quota)' : ''}`);
      } catch (failure) {
        console.log(`  warm: ${city} this -> ${failure.message}`);
      }
      await sleep(600);
    }
  }, 400);
});

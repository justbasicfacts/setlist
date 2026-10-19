/**
 * The whole backend: one Spotify authorisation, and the playlists themselves.
 *
 *   node --env-file-if-exists=.env server/token.mjs
 *
 * Why the authorisation exists at all: creating a playlist needs a token that
 * represents an account. The client id and secret alone produce an app token, and
 * Spotify answers that token with 403 on any playlist write. So the site owner
 * approves once at /auth, the refresh token is stored here (mode 600, gitignored),
 * and every playlist afterwards is made without anyone logging in.
 *
 * Endpoints
 *   GET /auth                     approve once
 *   GET /callback                 where Spotify returns
 *   GET /api/playlist?city&week   the city-week playlist, created if it is missing
 *   GET /api/setup                is it authorised yet
 */

import { createServer } from 'node:http';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes, createHash } from 'node:crypto';

const PORT = Number(process.env.API_PORT ?? 5181);
const ORIGIN = process.env.SITE_ORIGIN ?? 'http://localhost:5180';
const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID ?? '';
const TM_KEY = process.env.TICKETMASTER_API_KEY ?? '';
const REDIRECT = process.env.SPOTIFY_REDIRECT ?? `http://localhost:${PORT}/callback`;
const SCOPES = 'playlist-modify-public user-read-private';
const SPOTIFY = process.env.SPOTIFY_API_BASE ?? 'https://api.spotify.com/v1';
const ACCOUNTS = process.env.SPOTIFY_ACCOUNTS_BASE ?? 'https://accounts.spotify.com';

const STORE = new URL('.spotify.json', import.meta.url).pathname;
const PLAYLISTS = new URL('.playlists.json', import.meta.url).pathname;

export const CITIES = ['Berlin', 'London', 'Lisbon'];
const COUNTRY = { berlin: 'DE', london: 'GB', lisbon: 'PT' };

/* ------------------------------------------------------------------ files --- */

const readJson = (path, fallback) => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
};

const writeJson = (path, value) => writeFileSync(path, JSON.stringify(value, null, 1), { mode: 0o600 });

/* -------------------------------------------------------------------- week --- */

const pad = (value) => String(value).padStart(2, '0');
const iso = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Monday to Sunday, local time, for this week or the next one. */
export const weekRange = (week) => {
  const today = new Date();
  const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  if (week === 'next') monday.setDate(monday.getDate() + 7);

  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);

  const sameMonth = monday.getMonth() === sunday.getMonth();
  const label = sameMonth
    ? `${monday.getDate()}-${sunday.getDate()} ${MONTHS[sunday.getMonth()]}`
    : `${monday.getDate()} ${MONTHS[monday.getMonth()]} - ${sunday.getDate()} ${MONTHS[sunday.getMonth()]}`;

  return { start: iso(monday), end: iso(sunday), label, week };
};

export const weekHeading = (week) => (week === 'next' ? 'next week' : 'this week');

/* ------------------------------------------------------------------ events --- */

/** Music in that city, that week, one line per show. */
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

  const response = await fetch(`https://app.ticketmaster.com/discovery/v2/events.json?${params.toString()}`);
  if (!response.ok) throw Object.assign(new Error(`Ticketmaster answered ${response.status}`), { code: 502 });
  const body = await response.json();
  const raw = body._embedded?.events ?? [];

  return raw.map((event) => {
    const attractions = (event._embedded?.attractions ?? [])
      .map((entry) => entry.name?.trim())
      .filter(Boolean);
    const headline = event.name?.split(' - ')[0]?.trim();
    const artists = attractions.length > 0 ? attractions : headline ? [headline] : [];

    return {
      day: new Date(event.dates?.start?.localDate ?? Date.now()).toLocaleDateString('en-GB', { weekday: 'short' }),
      venue: event._embedded?.venues?.[0]?.name?.trim() || 'TBA',
      artists,
    };
  });
};

/** Every artist once, in gig order. */
export const artistsIn = (events) => [...new Set(events.flatMap((event) => event.artists))];

/* ----------------------------------------------------------------- spotify --- */

let tokenCache = { token: '', expires: 0, userId: '', displayName: '' };

const tokenRequest = async (body) => {
  const response = await fetch(`${ACCOUNTS}/api/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, ...body }).toString(),
  });
  const json = await response.json();
  if (!response.ok) throw new Error(json.error_description || `token ${response.status}`);
  return json;
};

/** An access token for the authorised account, refreshed silently. */
export const accessToken = async () => {
  if (tokenCache.token && tokenCache.expires > Date.now() + 60_000) return tokenCache;

  if (process.env.STUB_TOKEN) {
    tokenCache = { token: process.env.STUB_TOKEN, expires: Date.now() + 3600_000, userId: 'stub', displayName: 'stub' };
    return tokenCache;
  }

  const stored = readJson(STORE, null);
  if (!stored?.refresh_token) throw Object.assign(new Error('not authorised'), { code: 401 });

  const token = await tokenRequest({ grant_type: 'refresh_token', refresh_token: stored.refresh_token });
  if (token.refresh_token && token.refresh_token !== stored.refresh_token) {
    writeJson(STORE, { refresh_token: token.refresh_token });
  }

  const me = await spotify(token.access_token, '/me');
  tokenCache = {
    token: token.access_token,
    expires: Date.now() + token.expires_in * 1000,
    userId: me.id,
    displayName: me.display_name ?? 'you',
  };
  return tokenCache;
};

const spotify = async (token, path, init) => {
  const response = await fetch(`${SPOTIFY}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) {
    const body = await response.text();
    throw Object.assign(new Error(`Spotify ${path} answered ${response.status}: ${body.slice(0, 120)}`), {
      code: response.status,
    });
  }
  return response.json();
};

/** One track per artist, in gig order. */
const tracksFor = async (token, artists) => {
  const tracks = [];
  for (const artist of artists) {
    try {
      const params = new URLSearchParams({ q: `artist:"${artist}"`, type: 'track', limit: '1' });
      const body = await spotify(token, `/search?${params.toString()}`);
      const item = body.tracks?.items?.[0];
      if (!item?.uri) continue;

      const wanted = artist.trim().toLowerCase();
      const credits = (item.artists ?? []).map((entry) => entry.name?.trim().toLowerCase()).filter(Boolean);
      const agrees = credits.some((name) => name === wanted || name.includes(wanted) || wanted.includes(name));
      if (!agrees) continue;

      tracks.push({
        title: item.name,
        artist,
        uri: item.uri,
        url: item.external_urls?.spotify ?? null,
      });
    } catch {
      /* one awkward artist should not cost the whole playlist */
    }
  }
  return tracks;
};

/* --------------------------------------------------------------- playlists --- */

const playlistKey = (city, week) => `${city.trim().toLowerCase()}|${weekRange(week).start}`;

/**
 * The playlist for a city and week: reused when Spotify still has it, created once
 * otherwise. The record is kept on the server, so every visitor gets the same one.
 */
export const ensurePlaylist = async (city, week) => {
  const token = await accessToken();
  const range = weekRange(week);
  const key = playlistKey(city, week);
  const store = readJson(PLAYLISTS, {});
  const known = store[key];

  if (known?.id) {
    try {
      await spotify(token.token, `/playlists/${known.id}`);
      return { ...known, tracks: known.tracks ?? [], created: false };
    } catch {
      /* deleted, or no longer ours: fall through and make a fresh one */
    }
  }

  const events = await fetchEvents(city, week);
  const artists = artistsIn(events);
  if (artists.length === 0) {
    return { id: null, url: null, name: null, tracks: [], created: false, empty: true, label: range.label };
  }

  const tracks = await tracksFor(token.token, artists);
  const name = `${city} · ${weekHeading(week)} · ${range.label}`;
  const description = `Whoever is playing in ${city} ${weekHeading(week)}. Generated, not curated.`;

  const created = await spotify(token.token, `/users/${encodeURIComponent(token.userId)}/playlists`, {
    method: 'POST',
    body: JSON.stringify({ name, description, public: true }),
  });

  const uris = tracks.map((track) => track.uri);
  for (let index = 0; index < uris.length; index += 100) {
    await spotify(token.token, `/playlists/${created.id}/tracks`, {
      method: 'POST',
      body: JSON.stringify({ uris: uris.slice(index, index + 100) }),
    });
  }

  const record = {
    id: created.id,
    url: created.external_urls?.spotify ?? `https://open.spotify.com/playlist/${created.id}`,
    name,
    tracks,
    made: new Date().toISOString(),
  };
  writeJson(PLAYLISTS, { ...store, [key]: record });
  return { ...record, created: true, label: range.label };
};

/* ------------------------------------------------------------------- http --- */

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
    if (url.pathname === '/auth') {
      if (!CLIENT_ID) return json(response, 501, { error: 'SPOTIFY_CLIENT_ID is not set' });
      const verifier = randomBytes(48).toString('base64url');
      writeJson(new URL('.verifier.json', import.meta.url).pathname, { verifier });
      const params = new URLSearchParams({
        client_id: CLIENT_ID,
        response_type: 'code',
        redirect_uri: REDIRECT,
        scope: SCOPES,
        code_challenge_method: 'S256',
        code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      });
      response.writeHead(302, { location: `${ACCOUNTS}/authorize?${params.toString()}` });
      return response.end();
    }

    if (url.pathname === '/callback') {
      const code = url.searchParams.get('code');
      const denied = url.searchParams.get('error');
      if (denied) return json(response, 400, { error: denied });
      if (!code) return json(response, 400, { error: 'no code' });

      const { verifier } = readJson(new URL('.verifier.json', import.meta.url).pathname, {});
      if (!verifier) return json(response, 400, { error: 'no verifier, start again at /auth' });

      const token = await tokenRequest({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT,
        code_verifier: verifier,
      });
      writeJson(STORE, { refresh_token: token.refresh_token });
      tokenCache = { token: '', expires: 0, userId: '', displayName: '' };
      return json(response, 200, { ok: true, message: 'Authorised. Playlists are made automatically now.' });
    }

    if (url.pathname === '/api/setup') {
      return json(response, 200, { authorised: existsSync(STORE), clientId: !!CLIENT_ID, ticketmaster: !!TM_KEY });
    }

    if (url.pathname === '/api/playlist') {
      const city = url.searchParams.get('city') ?? 'Berlin';
      const week = url.searchParams.get('week') === 'next' ? 'next' : 'this';
      if (!CITIES.includes(city)) return json(response, 400, { error: `unknown city ${city}` });

      const range = weekRange(week);
      const entry = await ensurePlaylist(city, week);
      return json(response, 200, {
        city,
        week,
        label: range.label,
        heading: weekHeading(week),
        ...entry,
        embed: entry.id ? `https://open.spotify.com/embed/playlist/${entry.id}` : null,
      });
    }

    if (url.pathname === '/api/cities') return json(response, 200, { cities: CITIES });

    json(response, 404, { error: 'nothing here' });
  } catch (failure) {
    const code = failure.code ?? 500;
    json(response, code, { error: failure.message ?? String(failure) });
  }
});

server.listen(PORT, async () => {
  console.log(`api on http://localhost:${PORT}`);
  console.log(CLIENT_ID ? `authorise once at http://localhost:${PORT}/auth` : 'SPOTIFY_CLIENT_ID is not set');

  /* Make the week's playlists before anyone asks, so the first visit is instant. */
  if (!existsSync(STORE) || !TM_KEY) return;
  setTimeout(async () => {
    for (const city of CITIES) {
      for (const week of ['this', 'next']) {
        try {
          const made = await ensurePlaylist(city, week);
          console.log(`  warm: ${city} ${week} -> ${made.created ? 'created' : 'exists'} ${made.id ?? ''}`);
        } catch (failure) {
          console.log(`  warm: ${city} ${week} -> ${failure.message}`);
        }
      }
    }
  }, 500);
});

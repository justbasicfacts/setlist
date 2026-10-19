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
import { randomBytes, createHash } from 'node:crypto';

const PORT = Number(process.env.API_PORT ?? 5181);
const ORIGIN = process.env.SITE_ORIGIN ?? 'http://localhost:5180';
const TM_KEY = process.env.TICKETMASTER_API_KEY ?? '';
const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID ?? '';
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET ?? '';
const DEEZER = process.env.DEEZER_API_BASE ?? 'https://api.deezer.com';

export const CITIES = ['Berlin', 'London', 'Amsterdam', 'Dublin'];
const COUNTRY = { berlin: 'DE', london: 'GB', amsterdam: 'NL', dublin: 'IE' };

const SPOTIFY = process.env.SPOTIFY_API_BASE ?? 'https://api.spotify.com/v1';
const ACCOUNTS = process.env.SPOTIFY_ACCOUNTS_BASE ?? 'https://accounts.spotify.com';
/* Spotify requires HTTPS except for loopback IPs, and rejects "localhost" by name. */
const REDIRECT = process.env.SPOTIFY_REDIRECT ?? `http://127.0.0.1:${PORT}/callback`;
const SCOPES = 'playlist-modify-public user-read-private';

const AUTH_FILE = new URL('.spotify.json', import.meta.url).pathname;
const VERIFIER_FILE = new URL('.verifier.json', import.meta.url).pathname;
const SPOTIFY_FILE = new URL('.spotify-playlists.json', import.meta.url).pathname;

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

/* ------------------------------------------------------------------ spotify --- */

let userToken = { token: '', expires: 0, id: '', name: '' };

const authorised = () => {
  try {
    return !!JSON.parse(readFileSync(AUTH_FILE, 'utf8')).refresh_token;
  } catch {
    return false;
  }
};

const accountRequest = async (body, { basic = true } = {}) => {
  const headers = { 'content-type': 'application/x-www-form-urlencoded' };
  /* PKCE exchanges carry the verifier, not the secret; mixing the two is rejected. */
  if (basic) headers.authorization = `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`;

  const response = await fetch(`${ACCOUNTS}/api/token`, {
    method: 'POST',
    headers,
    body: new URLSearchParams(body).toString(),
    signal: AbortSignal.timeout(15_000),
  });
  const json = await response.json();
  if (!response.ok) {
    const reason = json.error_description ?? json.error ?? `token ${response.status}`;
    console.log(`  token request failed: ${response.status} ${reason}`);
    throw new Error(reason);
  }
  return json;
};

/** A token for the authorised account, refreshed silently. */
const accountToken = async () => {
  if (userToken.token && userToken.expires > Date.now() + 60_000) return userToken;
  const stored = readJson(AUTH_FILE, {});
  if (!stored.refresh_token) throw Object.assign(new Error('not connected'), { code: 401 });

  const token = await accountRequest({ grant_type: 'refresh_token', refresh_token: stored.refresh_token });
  if (token.refresh_token && token.refresh_token !== stored.refresh_token) {
    writeJson(AUTH_FILE, { refresh_token: token.refresh_token });
  }
  const me = await spotifyWrite(token.access_token, '/me');
  userToken = { token: token.access_token, expires: Date.now() + token.expires_in * 1000, id: me.id, name: me.display_name ?? 'you' };
  return userToken;
};

const spotifyWrite = async (token, path, init) => {
  const response = await fetch(`${SPOTIFY}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw Object.assign(new Error(`Spotify ${path} answered ${response.status}: ${detail.slice(0, 100)}`), {
      code: response.status,
    });
  }
  return response.json();
};

/** Spotify track uris for the lineup, in gig order. */
const spotifyUris = async (token, artists) => {
  const uris = [];
  for (const artist of artists) {
    try {
      const params = new URLSearchParams({ q: `artist:"${artist}"`, type: 'track', limit: '3' });
      const body = await spotifyWrite(token, `/search?${params.toString()}`);
      const wanted = artist.trim().toLowerCase();

      for (const item of body.tracks?.items ?? []) {
        const credits = (item.artists ?? []).map((entry) => entry.name?.trim().toLowerCase()).filter(Boolean);
        const agrees = credits.some((name) => name === wanted || name.includes(wanted) || wanted.includes(name));
        if (agrees && item.uri) {
          uris.push(item.uri);
          break;
        }
      }
    } catch (failure) {
      if (failure.code === 429) throw failure;
      /* one awkward artist is not the whole playlist */
    }
  }
  return uris;
};

const spotifyPlaylists = readJson(SPOTIFY_FILE, {});

/**
 * The playlist in the authorised account: reused when Spotify still has it, created
 * once otherwise. Kept per city and week, so selecting a city again writes nothing.
 */
const ensureSpotifyPlaylist = async (city, week, data) => {
  if (!authorised()) return null;

  const key = `${city.toLowerCase()}|${data.start}`;
  const known = spotifyPlaylists[key];

  try {
    const { token } = await accountToken();

    if (known?.id) {
      try {
        await spotifyWrite(token, `/playlists/${known.id}`);
        return { ...known, reused: true };
      } catch {
        /* deleted, or not ours any more */
      }
    }

    const artists = artistsIn(data.eventsList ?? []);
    const uris = await spotifyUris(token, artists);
    if (uris.length === 0) return known ?? null;

    const created = await spotifyWrite(token, `/users/${encodeURIComponent(userToken.id)}/playlists`, {
      method: 'POST',
      body: JSON.stringify({
        name: `${city} · ${weekHeading(week)} · ${data.label}`,
        description: `Whoever is playing in ${city} ${weekHeading(week)}. Generated, not curated.`,
        public: true,
      }),
    });

    await spotifyWrite(token, `/playlists/${created.id}/tracks`, {
      method: 'POST',
      body: JSON.stringify({ uris: uris.slice(0, 100) }),
    });

    const record = {
      id: created.id,
      url: created.external_urls?.spotify ?? `https://open.spotify.com/playlist/${created.id}`,
      embed: `https://open.spotify.com/embed/playlist/${created.id}`,
      count: uris.length,
    };
    spotifyPlaylists[key] = record;
    writeJson(SPOTIFY_FILE, spotifyPlaylists);
    return { ...record, reused: false };
  } catch {
    return known ?? null;
  }
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

const html = (body) =>
  `<!doctype html><meta charset="utf-8"><title>Who's Playing?</title>` +
  `<body style="font:16px/1.6 system-ui;background:#0f0f0f;color:#f2f2ee;padding:48px;max-width:640px">${body}</body>`;

const send = (response, status, body) => {
  response.writeHead(status, { 'content-type': 'text/html; charset=utf-8' });
  response.end(body);
};

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
      console.log('  auth: sending the browser to Spotify');
      const verifier = randomBytes(48).toString('base64url');
      writeJson(VERIFIER_FILE, { verifier });
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

      const { verifier } = readJson(VERIFIER_FILE, {});
      if (!verifier) return json(response, 400, { error: 'the login expired, start again at /auth' });

      console.log('  callback: exchanging the code');

      let token;
      try {
        token = await accountRequest(
          {
            grant_type: 'authorization_code',
            client_id: CLIENT_ID,
            code,
            redirect_uri: REDIRECT,
            code_verifier: verifier,
          },
          { basic: false },
        );
      } catch (failure) {
        return send(response, 400, html(`<h2>Spotify refused the login</h2><p>${failure.message}</p><p>Start again at <a href="/auth">/auth</a>.</p>`));
      }

      if (!token.refresh_token) {
        return send(response, 400, html('<h2>Spotify sent no refresh token</h2><p>Try again at <a href="/auth">/auth</a>.</p>'));
      }

      writeJson(AUTH_FILE, { refresh_token: token.refresh_token });
      userToken = { token: '', expires: 0, id: '', name: '' };
      console.log('  callback: connected');
      return send(response, 200, html('<h2>Connected.</h2><p>Playlists are made in this account from now on. <a href="http://localhost:5180">Back to the site</a>.</p>'));
    }

    if (url.pathname === '/api/status') {
      let name = null;
      if (authorised()) {
        try {
          name = (await accountToken()).name;
        } catch {
          name = null;
        }
      }
      return json(response, 200, { connected: authorised(), name, clientId: !!CLIENT_ID });
    }

    if (url.pathname === '/api/setup') {
      return json(response, 200, { ticketmaster: !!TM_KEY, tracks: 'deezer', spotify: authorised(), cities: CITIES });
    }

    if (url.pathname === '/api/city') {
      const city = url.searchParams.get('city') ?? 'Berlin';
      if (!CITIES.includes(city)) return json(response, 400, { error: `unknown city ${city}` });

      /* Both weeks at once: choosing a city should hand back the whole thing. */
      const [thisWeek, nextWeek] = await Promise.all([lineup(city, 'this'), lineup(city, 'next')]);

      /* And both playlists, in the authorised account, made on demand and then reused. */
      const [thisSpotify, nextSpotify] = await Promise.all([
        ensureSpotifyPlaylist(city, 'this', thisWeek),
        ensureSpotifyPlaylist(city, 'next', nextWeek),
      ]);

      return json(response, 200, {
        city,
        this: { ...thisWeek, spotify: thisSpotify },
        next: { ...nextWeek, spotify: nextSpotify },
        connected: authorised(),
      });
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
      for (const week of ['this', 'next']) {
        try {
          const data = await lineup(city, week);
          console.log(`  warm: ${city} ${week} -> ${data.tracks.length}/${data.events} tracks`);
        } catch (failure) {
          console.log(`  warm: ${city} ${week} -> ${failure.message}`);
        }
        await sleep(300);
      }
    }
  }, 400);
});

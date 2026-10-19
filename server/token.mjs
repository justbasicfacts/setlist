/**
 * The Spotify token, kept on the server.
 *
 * The site owner authorises once (/auth), the refresh token is stored next to this
 * file, and from then on /api/token hands the page a fresh access token. That is what
 * makes playlist creation automatic: a visitor never logs in, never clicks Connect,
 * and the playlist is made for the city and week they opened.
 *
 *   node server/token.mjs          # serves :5181
 *   open http://localhost:5181/auth  (once)
 */

import { createServer } from 'node:http';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes, createHash } from 'node:crypto';

const PORT = 5181;
const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID ?? '';
const REDIRECT = `http://localhost:${PORT}/callback`;
const SCOPES = 'playlist-modify-public user-read-private';
const STORE = new URL('.token.json', import.meta.url).pathname;
const VERIFIER = new URL('.verifier.json', import.meta.url).pathname;

let cached = { token: '', expires: 0 };

const readJson = (path) => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
};

const writeJson = (path, value) => writeFileSync(path, JSON.stringify(value), { mode: 0o600 });

const send = (response, status, body, type = 'application/json') => {
  response.writeHead(status, {
    'content-type': type,
    'access-control-allow-origin': 'http://localhost:5180',
  });
  response.end(typeof body === 'string' ? body : JSON.stringify(body));
};

const base64url = (buffer) =>
  buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const tokenRequest = async (body) => {
  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, ...body }).toString(),
  });
  const json = await response.json();
  if (!response.ok) throw new Error(json.error_description || `token ${response.status}`);
  return json;
};

/** A fresh access token from the stored refresh token, plus whose account it is. */
const accessToken = async () => {
  if (cached.token && cached.expires > Date.now() + 30_000) return cached;

  const stored = readJson(STORE);
  if (!stored?.refresh_token) throw Object.assign(new Error('not authorised'), { code: 401 });

  const token = await tokenRequest({ grant_type: 'refresh_token', refresh_token: stored.refresh_token });
  if (token.refresh_token) writeJson(STORE, { refresh_token: token.refresh_token });

  const me = await fetch('https://api.spotify.com/v1/me', {
    headers: { authorization: `Bearer ${token.access_token}` },
  }).then((response) => response.json());

  cached = { token: token.access_token, expires: Date.now() + token.expires_in * 1000, userId: me.id, displayName: me.display_name };
  return cached;
};

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://localhost:${PORT}`);

  if (url.pathname === '/auth') {
    if (!CLIENT_ID) return send(response, 501, { error: 'SPOTIFY_CLIENT_ID is not set' });
    const verifier = base64url(randomBytes(48));
    writeJson(VERIFIER, { verifier });
    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      response_type: 'code',
      redirect_uri: REDIRECT,
      scope: SCOPES,
      code_challenge_method: 'S256',
      code_challenge: base64url(createHash('sha256').update(verifier).digest()),
    });
    response.writeHead(302, { location: `https://accounts.spotify.com/authorize?${params.toString()}` });
    return response.end();
  }

  if (url.pathname === '/callback') {
    const code = url.searchParams.get('code');
    const error = url.searchParams.get('error');
    if (error) return send(response, 400, { error }, 'text/html');
    if (!code) return send(response, 400, { error: 'no code' });

    const { verifier } = readJson(VERIFIER) ?? {};
    if (!verifier) return send(response, 400, { error: 'no verifier, start again at /auth' });

    try {
      const token = await tokenRequest({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT,
        code_verifier: verifier,
      });
      writeJson(STORE, { refresh_token: token.refresh_token });
      cached = { token: '', expires: 0 };
      return send(
        response,
        200,
        '<h2>Authorised.</h2><p>Close this tab and reload the site: playlists are now created automatically.</p>',
        'text/html',
      );
    } catch (failure) {
      return send(response, 400, { error: String(failure) });
    }
  }

  if (url.pathname === '/api/token') {
    try {
      const current = await accessToken();
      return send(response, 200, {
        access_token: current.token,
        user_id: current.userId,
        display_name: current.displayName,
      });
    } catch (failure) {
      return send(response, failure.code === 401 ? 401 : 502, {
        error: failure.code === 401 ? 'not authorised: open /auth once' : String(failure),
      });
    }
  }

  send(response, 404, { error: 'nothing here' });
});

server.listen(PORT, () => {
  console.log(`spotify token server on http://localhost:${PORT}`);
  console.log(CLIENT_ID ? 'authorise once at /auth' : 'SPOTIFY_CLIENT_ID is not set');
});

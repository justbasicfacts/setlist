import { defineConfig, loadEnv, type Plugin } from 'vite';

/**
 * Spotify needs a client secret, and a client secret must never reach the browser.
 * The token endpoint is proxied by the dev server instead: the browser asks this
 * route, this route holds the credentials and talks to Spotify. Only the Ticketmaster
 * key and a "credentials present" flag are exposed to the app.
 *
 * For production the same idea needs a real backend; a static build cannot hold a
 * secret, and the app falls back to its built-in titles when the route is missing.
 */
const spotifyToken = (id: string, secret: string): Plugin => ({
  name: 'spotify-token',
  configureServer(server) {
    server.middlewares.use('/api/spotify-token', (_request, response) => {
      const send = (status: number, body: unknown) => {
        response.statusCode = status;
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify(body));
      };

      if (!id || !secret) {
        send(501, { error: 'SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET are not set' });
        return;
      }

      void fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
          authorization: `Basic ${btoa(`${id}:${secret}`)}`,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ grant_type: 'client_credentials' }).toString(),
      })
        .then(async (upstream) => send(upstream.status, await upstream.json()))
        .catch((error: Error) => send(502, { error: error.message }));
    });
  },
});

export default defineConfig(({ mode }) => {
  /* `''` loads every variable, not only the VITE_ prefixed ones. */
  const env = loadEnv(mode, '.', '');
  const ticketmaster = env.TICKETMASTER_API_KEY || env.VITE_TICKETMASTER_KEY || '';
  const spotifyId = env.SPOTIFY_CLIENT_ID || env.VITE_SPOTIFY_CLIENT_ID || '';
  const spotifySecret = env.SPOTIFY_CLIENT_SECRET || '';

  return {
    server: { port: 5180, host: true },
    define: {
      __TICKETMASTER_KEY__: JSON.stringify(ticketmaster),
      __SPOTIFY_READY__: JSON.stringify(Boolean(spotifyId && spotifySecret)),
    },
    plugins: [spotifyToken(spotifyId, spotifySecret)],
  };
});

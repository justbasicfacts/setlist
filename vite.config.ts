import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  /* `''` loads every variable, not only the VITE_ prefixed ones. */
  const env = loadEnv(mode, '.', '');

  return {
    server: {
      port: 5180,
      host: true,
      /* The Spotify refresh token must not live in the browser: the server owns it. */
      proxy: {
        '/api': 'http://localhost:5181',
        '/auth': 'http://localhost:5181',
        '/callback': 'http://localhost:5181',
      },
    },
    define: {
      __TICKETMASTER_KEY__: JSON.stringify(env.TICKETMASTER_API_KEY || env.VITE_TICKETMASTER_KEY || ''),
      /*
       * Only the client id reaches the browser. Creating a playlist needs the visitor's
       * own authorisation (PKCE), so the client secret is no longer used at all.
       */
      __SPOTIFY_CLIENT_ID__: JSON.stringify(env.SPOTIFY_CLIENT_ID || env.VITE_SPOTIFY_CLIENT_ID || ''),
    },
  };
});

import { defineConfig } from 'vite';

/* Its own port, so it can run next to the other local projects. */
export default defineConfig({
  server: { port: 5180, host: true },
});

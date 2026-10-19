import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/* Its own port, so it can run next to the other local projects. */
export default defineConfig({
  plugins: [react()],
  server: { port: 5180, host: true },
});

/**
 * One command: the site and the token server together.
 *   pnpm dev
 * Ctrl-C stops both.
 */
import { spawn } from 'node:child_process';

const start = (label, command, args) => {
  const child = spawn(command, args, { stdio: 'inherit', env: process.env });
  child.on('exit', (code) => {
    if (code) {
      console.error(`${label} exited with ${code}`);
      process.exit(code);
    }
  });
  return child;
};

const api = start('api', process.execPath, ['--env-file-if-exists=.env', 'server/token.mjs']);
const site = start('site', 'npx', ['vite']);

const stop = () => {
  api.kill('SIGTERM');
  site.kill('SIGTERM');
  process.exit(0);
};

process.on('SIGINT', stop);
process.on('SIGTERM', stop);

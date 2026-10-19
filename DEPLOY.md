# Hosting it for free

Two pieces, because GitHub Pages can only serve files:

- the site (static, built by Vite) goes on GitHub Pages
- the API (needs the Ticketmaster key, so it cannot be in the browser) goes on a free Node host

## 1. The API, on Render

Render's free web service runs this repository as it is, no rewrite.

1. render.com, New, Web Service, connect the GitHub repo.
2. Build command: `pnpm install --frozen-lockfile`
3. Start command: `node server/api.mjs`
4. Environment variables:
   - `TICKETMASTER_API_KEY` = your key
   - `SITE_ORIGIN` = `https://<your-user>.github.io,http://localhost:5180`
     (comma separated; the first one is the fallback)
5. Deploy, then note the URL, something like `https://whosplaying-api.onrender.com`.

Free instances sleep after fifteen minutes without traffic, so the first request after
a quiet spell takes half a minute. Everything after that is instant.

## 2. The site, on GitHub Pages

1. Push this repository to GitHub.
2. Settings, Pages: Source = **GitHub Actions**.
3. Settings, Secrets and variables, Actions, **Variables**: add
   `API_BASE` = `https://whosplaying-api.onrender.com` (no trailing slash).
4. Push to `main`. `.github/workflows/pages.yml` builds the site with
   `VITE_BASE=/<repo>/` and that API address, and publishes it.

The site lands at `https://<your-user>.github.io/<repo>/`.

## Local development

Unchanged, and unaffected by the above:

    pnpm dev      # site on :5180, API on :5181

`VITE_API_BASE` is empty locally, so the site talks to its own origin through the dev
proxy. `VITE_BASE` defaults to `/`.

## If you would rather have no cold starts

Cloudflare Workers has no sleep and a generous free tier, but the API needs porting from
Node's `http` to a Worker `fetch` handler: the routing, the caches and the JSON responses
carry over, the `createServer` part does not. Worth doing if the site gets shared around.

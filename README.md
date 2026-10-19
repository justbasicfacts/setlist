# Who's Playing?

Pick a city and a week. The playlist is generated from whoever is playing there: one
track per artist, in gig order. No design system, no decisions, no research.

```
pnpm install
pnpm dev        # http://localhost:5180
pnpm build
```

## Lineups

With `VITE_TICKETMASTER_KEY` set (copy `.env.example` to `.env`, get a free key at
https://developer.ticketmaster.com), gigs come from the Discovery API, filtered by
city and the dates of the chosen week. Without a key, or when the API has nothing
listed or fails, the app falls back to a seeded sample pool and says so.

The key is a query parameter, so it is public in the browser bundle. Fine for a demo
on the default quota (5,000 calls a day, 5 per second); put a proxy in front of it
before this goes anywhere real.

The song titles are a made-up catalogue keyed by artist, not Spotify data.

# Extra sources

Ticketmaster does not cover every country. For the cities it misses, the server can read
a local listings page that publishes schema.org event data (JSON-LD), which most sites
add for search engines.

Add a city to `server/sources.json`:

```json
{
  "budapest": { "url": "https://example.hu/program", "label": "Example Budapest" }
}
```

- the key is the city name, lower case, without accents
- `url` is the listing page for that city (not a single event)
- `label` is what the page footer calls the source

Then that city is served from the page instead of coming back empty. Results are held
**in memory only**, for six hours, and dropped when the process restarts: nothing is
written to disk.

The parser looks for `application/ld+json` blocks with `@type` containing `Event`, and
reads `name`, `startDate`, `location.name` and `performer`. A site that ships event data
only through JavaScript, without JSON-LD, cannot be read this way.

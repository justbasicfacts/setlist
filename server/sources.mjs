/**
 * Extra event sources, for cities Ticketmaster does not cover.
 *
 * Each city can be pointed at a page that publishes schema.org event data (JSON-LD),
 * which most listing sites do for search engines. Nothing is stored on disk: results
 * live in a Map for a few hours and are dropped when the process restarts.
 *
 *   sources.json   { "budapest": { "url": "https://example.hu/program", "label": "Example" } }
 */

import { readFileSync } from 'node:fs';

const SOURCES_FILE = new URL('./sources.json', import.meta.url).pathname;
const TTL_MS = 6 * 60 * 60 * 1000;

/** city slug + week start -> { at, events } */
const memory = new Map();

const readSources = () => {
  try {
    return JSON.parse(readFileSync(SOURCES_FILE, 'utf8'));
  } catch {
    return {};
  }
};

/** Lower case, no accents. Written with explicit ranges: property escapes are not
    available in every Node the host might run. */
const fold = (value) =>
  String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f\u1ab0-\u1aff\u1dc0-\u1dff]/g, '')
    .replace(/[āáàâäãå]/g, 'a')
    .replace(/[ēéèêë]/g, 'e')
    .replace(/[īíìîï]/g, 'i')
    .replace(/[ōóòôöõ]/g, 'o')
    .replace(/[ūúùûü]/g, 'u')
    .toLowerCase()
    .trim();

const asArray = (value) => (Array.isArray(value) ? value : value ? [value] : []);

/** Every JSON-LD block on the page, whichever shape it was written in. */
const jsonLdBlocks = (html) => {
  const blocks = [];
  const pattern = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(pattern)) {
    try {
      const parsed = JSON.parse(match[1].trim());
      if (Array.isArray(parsed)) blocks.push(...parsed);
      else if (parsed['@graph']) blocks.push(...asArray(parsed['@graph']));
      else blocks.push(parsed);
    } catch {
      /* one broken block should not lose the page */
    }
  }
  return blocks;
};

const isEvent = (node) => {
  const types = asArray(node?.['@type']).map(String);
  return types.some((type) => /Event/i.test(type));
};

const performerNames = (event) => {
  const performers = asArray(event.performer ?? event.performers);
  const names = performers
    .map((entry) => (typeof entry === 'string' ? entry : entry?.name))
    .filter(Boolean);
  if (names.length > 0) return names;

  /* Some sites only give a title: "Artist at Venue". */
  const title = String(event.name ?? '');
  const at = title.split(/\s+(?:at|@|·|–|-)\s+/i)[0]?.trim();
  return at ? [at] : [];
};

/**
 * Events for a city and week from its configured page.
 *
 * @param {{name: string, country: string}} city
 * @param {string} week  'this' | 'next'
 * @param {{start: string, end: string}} range
 */

export const extraEvents = async (city, week, range) => {
  const slug = fold(city.name);
  const key = `${slug}|${range.start}`;

  const source = readSources()[slug];
  if (!source?.url) return [];

  const hit = memory.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.events;
  if (hit) memory.delete(key);

  try {
    const response = await fetch(source.url, {
      headers: {
        'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'accept-language': 'en',
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return [];
    const html = await response.text();

    const events = jsonLdBlocks(html)
      .filter(isEvent)
      .map((event) => {
        const startDate = String(event.startDate ?? '').slice(0, 10);
        const date = startDate ? new Date(`${startDate}T12:00:00`) : null;
        const location = event.location?.name ?? event.location?.address?.name ?? '';

        return {
          date: startDate,
          day: date ? date.toLocaleDateString('en-GB', { weekday: 'short' }) : '',
          venue: String(location).trim() || 'Venue to be announced',
          district: '',
          time: String(event.startDate ?? '').slice(11, 16),
          artists: performerNames(event),
          away: 0,
          sameCity: true,
          source: source.label ?? new URL(source.url).host,
        };
      })
      .filter((event) => event.date >= range.start && event.date <= range.end && event.artists.length > 0);

    memory.set(key, { at: Date.now(), events });
    return events;
  } catch {
    return [];
  }
};

/** Kept for tests and for a future "refresh" action. */
export const forgetExtras = () => memory.clear();

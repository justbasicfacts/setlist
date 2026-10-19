/**
 * The pretend gig guide.
 *
 * Two things matter here. The lineups are sample data, and they are chosen from a
 * pool by city *and* by week, so "next week" is a different week with different
 * people in town rather than the same list with a new heading. The playlist is then
 * derived from that: one track per artist playing, and nothing typed by hand.
 */

export type Week = 'this' | 'next';

export type Event = {
  city: string;
  day: string;
  venue: string;
  artists: string[];
  note?: string;
};

export type Track = {
  artist: string;
  title: string;
  event: Event;
};

/* A made-up catalogue: artist -> the one song we would put on the playlist. */
const CATALOGUE: Record<string, string> = {
  'Lera Lynn': 'What Is This Body?',
  Egg: 'Germs',
  Turnstile: 'Mystery',
  Megadeth: 'Sweating Bullets',
  'Massive Attack': 'Teardrop',
  Radiohead: 'Weird Fishes / Arpeggi',
  'RÜFÜS DU SOL': 'Innerbloom',
  'Tame Impala': 'The Less I Know The Better',
  'M83': 'Midnight City',
  'Caroline Polachek': 'So Hot You\'re Hurting My Feelings',
  'Big Thief': 'Vampire Empire',
  'Fontaines D.C.': 'Starburster',
  'Little Simz': 'Mood Swings',
  'Ezra Collective': 'Victory Dance',
  'Bicep': 'Glue',
  'Overmono': 'So U Kno',
  'Nala Sinephro': 'Space 1',
  'Sault': 'Wildfires',
  'Sampha': 'Spirit 2.0',
  'James Blake': 'Retrograde',
  'Moderat': 'A New Error',
  'Kelly Lee Owens': 'Th Ruth',
  'Arooj Aftab': 'Mohabbat',
  'Sprints': 'Literary Mind',
};

/* The pool per city. A week takes a slice of it, so the guide moves. */
const POOL: Record<string, Event[]> = {
  berlin: [
    { city: 'Berlin', day: 'Thu', venue: 'Kantine am Berghain', artists: ['Lera Lynn', 'Egg'] },
    { city: 'Berlin', day: 'Fri', venue: 'Astra', artists: ['Fontaines D.C.', 'Sprints'] },
    { city: 'Berlin', day: 'Fri', venue: 'OHM', artists: ['Bicep', 'Overmono'], note: 'bring earplugs' },
    { city: 'Berlin', day: 'Sat', venue: 'Columbiahalle', artists: ['Little Simz'] },
    { city: 'Berlin', day: 'Sat', venue: 'Silent Green', artists: ['Nala Sinephro', 'Arooj Aftab'] },
    { city: 'Berlin', day: 'Sun', venue: 'Kesselhaus', artists: ['Moderat', 'Kelly Lee Owens'] },
  ],
  london: [
    { city: 'London', day: 'Wed', venue: 'Village Underground', artists: ['Ezra Collective'] },
    { city: 'London', day: 'Thu', venue: 'Earth', artists: ['Sampha', 'James Blake'] },
    { city: 'London', day: 'Fri', venue: 'The Dome', artists: ['Turnstile'] },
    { city: 'London', day: 'Sat', venue: 'O2 Academy Brixton', artists: ['Big Thief', 'Caroline Polachek'] },
    { city: 'London', day: 'Sun', venue: 'Colour Factory', artists: ['Sault', 'Nala Sinephro'] },
  ],
  lisbon: [
    { city: 'Lisbon', day: 'Thu', venue: 'Musicbox', artists: ['M83'] },
    { city: 'Lisbon', day: 'Fri', venue: 'Lux Frágil', artists: ['Overmono', 'Bicep'] },
    { city: 'Lisbon', day: 'Sat', venue: 'Coliseu', artists: ['Massive Attack'] },
    { city: 'Lisbon', day: 'Sun', venue: 'Casa Capitão', artists: ['Tame Impala', 'Arooj Aftab'] },
  ],
};

const capitalise = (value: string): string => value.charAt(0).toUpperCase() + value.slice(1);

/** Display names; the pool is keyed by the lowercase form. */
export const CITIES = Object.keys(POOL).map(capitalise);

const startOfWeek = (now: Date): Date => {
  const date = new Date(now);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  date.setHours(0, 0, 0, 0);
  return date;
};

const shortDate = (date: Date): string =>
  date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

export const weekRange = (week: Week, now = new Date()): { start: Date; end: Date; label: string } => {
  const start = startOfWeek(now);
  if (week === 'next') start.setDate(start.getDate() + 7);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { start, end, label: `${shortDate(start)} - ${shortDate(end)}` };
};

export const weekHeading = (week: Week): string => (week === 'next' ? 'next week' : 'this week');

const weekIndex = (week: Week, now = new Date()): number =>
  Math.floor(weekRange(week, now).start.getTime() / (7 * 24 * 60 * 60 * 1000));

/** Deterministic: the same city and week always produce the same three or four gigs. */
export const eventsFor = (city: string, week: Week, now = new Date()): Event[] => {
  const pool = POOL[city.trim().toLowerCase()];
  if (!pool) return [];
  const seed = weekIndex(week, now) + city.trim().length;
  const count = Math.min(pool.length, 3 + (seed % 2));
  return Array.from({ length: count }, (_, index) => pool[(seed + index) % pool.length]);
};

/** One track per artist playing that week, in the order the gigs happen. */
export const playlistFor = (city: string, week: Week, now = new Date()): Track[] => {
  const seen = new Set<string>();
  const tracks: Track[] = [];

  for (const event of eventsFor(city, week, now)) {
    for (const artist of event.artists) {
      if (seen.has(artist)) continue;
      seen.add(artist);
      tracks.push({
        artist,
        title: CATALOGUE[artist] ?? 'Untitled banger (we checked, it is fine)',
        event,
      });
    }
  }

  return tracks;
};

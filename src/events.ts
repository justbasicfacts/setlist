/**
 * Where the gigs come from.
 *
 * With a Ticketmaster key in the environment, a week's events in a city are fetched
 * from the Discovery API; without one, a seeded sample pool stands in, so the app
 * works before anybody has signed up for anything. Either way the playlist is derived
 * the same way: one track per artist playing, in gig order.
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

export type Source = 'ticketmaster' | 'sample';

const KEY = (import.meta.env.VITE_TICKETMASTER_KEY as string | undefined)?.trim() ?? '';

export const hasKey = KEY.length > 0;

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
  Bicep: 'Glue',
  Overmono: 'So U Kno',
  'Nala Sinephro': 'Space 1',
  Sault: 'Wildfires',
  Sampha: 'Spirit 2.0',
  'James Blake': 'Retrograde',
  Moderat: 'A New Error',
  'Kelly Lee Owens': 'Th Ruth',
  'Arooj Aftab': 'Mohabbat',
  Sprints: 'Literary Mind',
};

/* The sample pool per city, used when there is no key or the request fails. */
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

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const dayOf = (isoDate: string): string | null => {
  const date = new Date(`${isoDate}T12:00:00`);
  return Number.isNaN(date.getTime()) ? null : DAYS[date.getDay()] ?? null;
};

/** The seeded fallback: the same city and week always give the same three or four gigs. */
export const sampleEvents = (city: string, week: Week, now = new Date()): Event[] => {
  const pool = POOL[city.trim().toLowerCase()];
  if (!pool) return [];
  const seed = weekIndex(week, now) + city.trim().length;
  const count = Math.min(pool.length, 3 + (seed % 2));
  return Array.from({ length: count }, (_, index) => pool[(seed + index) % pool.length]);
};

/* ------------------------------------------------------- Ticketmaster --- */

type TmEvent = {
  name?: string;
  dates?: { start?: { localDate?: string } };
  _embedded?: {
    venues?: { name?: string }[];
    attractions?: { name?: string }[];
  };
};

const toEvent = (raw: TmEvent, city: string): Event | null => {
  const date = raw.dates?.start?.localDate;
  const day = date ? dayOf(date) : null;
  if (!day) return null;

  const attractions = (raw._embedded?.attractions ?? [])
    .map((attraction) => attraction.name?.trim())
    .filter((name): name is string => !!name);
  const headline = raw.name?.trim();
  /* A club night has no attraction, so the event name is the act. */
  const artists = attractions.length > 0 ? attractions : headline ? [headline] : [];
  if (artists.length === 0) return null;

  return {
    city,
    day,
    venue: raw._embedded?.venues?.[0]?.name?.trim() || 'Venue to confirm',
    artists,
    note: attractions.length > 0 && headline ? headline : undefined,
  };
};

/**
 * A local calendar day. `toISOString()` would convert to UTC first, which turns
 * Monday 00:00 in Berlin into Sunday 22:00 and sends the wrong week to the API.
 */
const isoDay = (date: Date): string => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
};

/**
 * The week's gigs in a city. Falls back to the sample pool when there is no key,
 * when the request fails, or when the city has nothing listed: a playlist page with
 * an empty state on a first visit is a worse demo than an honest sample.
 */
export const fetchEvents = async (
  city: string,
  week: Week,
): Promise<{ events: Event[]; source: Source; problem?: string }> => {
  if (!hasKey) return { events: sampleEvents(city, week), source: 'sample' };

  const { start, end } = weekRange(week);
  const params = new URLSearchParams({
    apikey: KEY,
    city: city.trim(),
    /* Local to the venue, which is what "that week in that city" means. */
    localStartDateTime: `${isoDay(start)}T00:00:00`,
    localEndDateTime: `${isoDay(end)}T23:59:59`,
    size: '40',
    sort: 'date,asc',
  });

  try {
    const response = await fetch(
      `https://app.ticketmaster.com/discovery/v2/events.json?${params.toString()}`,
    );
    if (!response.ok) throw new Error(`Ticketmaster answered ${response.status}`);

    const body = (await response.json()) as { _embedded?: { events?: TmEvent[] } };
    const events = (body._embedded?.events ?? [])
      .map((raw) => toEvent(raw, city))
      .filter((event): event is Event => !!event)
      .slice(0, 8);

    if (events.length === 0) {
      return {
        events: sampleEvents(city, week),
        source: 'sample',
        problem: `Ticketmaster had nothing listed for ${city} that week, so these are samples.`,
      };
    }

    return { events, source: 'ticketmaster' };
  } catch (error) {
    return {
      events: sampleEvents(city, week),
      source: 'sample',
      problem: error instanceof Error ? error.message : 'The request failed',
    };
  }
};

/* ------------------------------------------------------------ playlist --- */

/** One track per artist playing, in gig order, with the gig as the reason. */
export const playlistFrom = (events: Event[]): Track[] => {
  const seen = new Set<string>();
  const tracks: Track[] = [];

  for (const event of events) {
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

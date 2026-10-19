/**
 * Where the gigs and the songs come from.
 *
 * Gigs: the Ticketmaster Discovery API, for one city and one local week. Songs: one
 * per artist playing, looked up on Spotify. Both need credentials; both fall back
 * honestly, so the page works before anyone signs up for anything and says which
 * source it used.
 *
 * The Spotify lookup goes through `/api/spotify-token`, a route the dev server owns,
 * because a client secret must never be in a browser bundle.
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
  url?: string;
  fromSpotify: boolean;
  event: Event;
};

export type Source = 'ticketmaster' | 'sample';

const KEY = typeof __TICKETMASTER_KEY__ === 'string' ? __TICKETMASTER_KEY__.trim() : '';
export const hasKey = KEY.length > 0;

/* Titles to fall back on when Spotify cannot be asked. One per artist we seed. */
const CATALOGUE: Record<string, string> = {
  'Lera Lynn': 'What Is This Body?',
  Yaeji: 'Raingurl',
  Turnstile: 'Mystery',
  Megadeth: 'Sweating Bullets',
  'Massive Attack': 'Teardrop',
  Radiohead: 'Weird Fishes / Arpeggi',
  'RÜFÜS DU SOL': 'Innerbloom',
  'Tame Impala': 'The Less I Know The Better',
  'M83': 'Midnight City',
  'Caroline Polachek': "So Hot You're Hurting My Feelings",
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
    { city: 'Berlin', day: 'Thu', venue: 'Kantine am Berghain', artists: ['Lera Lynn', 'Yaeji'] },
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

/* Berlin exists in more than one country, and the city filter alone does not care. */
const COUNTRY: Record<string, string> = { berlin: 'DE', london: 'GB', lisbon: 'PT' };

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

  /* Plenty of real listings are announced before the room is, and show it. */
  const venue = raw._embedded?.venues?.[0]?.name?.trim() || 'TBA';
  const redundant = headline
    ? artists.some((name) => name.trim().toLowerCase() === headline.toLowerCase())
    : true;

  return {
    city,
    day,
    venue,
    artists,
    note: attractions.length > 0 && headline && !redundant ? headline : undefined,
  };
};

/**
 * A local calendar day. `toISOString()` would convert to UTC first, which turns
 * Monday 00:00 in Berlin into Sunday 22:00 and asks for the wrong week.
 */
const isoDay = (date: Date): string => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
};

export const fetchEvents = async (
  city: string,
  week: Week,
): Promise<{ events: Event[]; source: Source; problem?: string }> => {
  if (!hasKey) return { events: sampleEvents(city, week), source: 'sample' };

  const { start, end } = weekRange(week);
  const country = COUNTRY[city.trim().toLowerCase()];
  const params = new URLSearchParams({
    apikey: KEY,
    city: city.trim(),
    /* Music only: the city feed happily returns stand-up comedy and car shows. */
    classificationName: 'music',
    /* Local to the venue, which is what "that week in that city" means. */
    localStartDateTime: `${isoDay(start)}T00:00:00`,
    localEndDateTime: `${isoDay(end)}T23:59:59`,
    size: '40',
    sort: 'date,asc',
  });
  if (country) params.set('countryCode', country);

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

/** Every artist on the week's list, once, in gig order. */
export const artistsIn = (events: Event[]): string[] => {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const event of events) {
    for (const artist of event.artists) {
      if (seen.has(artist)) continue;
      seen.add(artist);
      names.push(artist);
    }
  }
  return names;
};

/** The standing-in title for an artist, when Spotify will not answer. */
export const fallbackTitle = (artist: string): string =>
  CATALOGUE[artist] ?? 'Untitled banger (we checked, it is fine)';

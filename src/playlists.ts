/**
 * Playlists, one per city per week, kept in the browser.
 *
 * The whole model is three fields: which city, which of the two weeks, and the
 * tracks. A city with no playlist for that week has nothing stored, and the screen
 * offers to create it, which is the only thing that ever creates one.
 */

import type { Track } from './spotify';

export type Week = 'this' | 'next';

export type Playlist = {
  city: string;
  week: Week;
  tracks: Track[];
};

const KEY = 'setlist:playlists:v2';

export const loadPlaylists = (): Playlist[] => {
  const raw = localStorage.getItem(KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Playlist[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export const savePlaylists = (playlists: Playlist[]): void => {
  localStorage.setItem(KEY, JSON.stringify(playlists));
};

/** Cities are matched and stored without regard to case or stray spaces. */
export const cleanCity = (city: string): string =>
  city
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\b[a-z]/g, (letter) => letter.toUpperCase());

export const sameCity = (a: string, b: string): boolean =>
  cleanCity(a).localeCompare(cleanCity(b), undefined, { sensitivity: 'base' }) === 0;

export const findPlaylist = (
  playlists: Playlist[],
  city: string,
  week: Week,
): Playlist | undefined =>
  playlists.find((playlist) => playlist.week === week && sameCity(playlist.city, city));

/** Distinct cities that already have a playlist, in the order they were added. */
export const knownCities = (playlists: Playlist[]): string[] => {
  const seen: string[] = [];
  for (const playlist of playlists) {
    if (!seen.some((city) => sameCity(city, playlist.city))) seen.push(playlist.city);
  }
  return seen;
};

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const startOfWeek = (now: Date): Date => {
  const date = new Date(now);
  const offset = (date.getDay() + 6) % 7; /* Monday is 0 */
  date.setDate(date.getDate() - offset);
  date.setHours(0, 0, 0, 0);
  return date;
};

const shortDate = (date: Date): string =>
  date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

/** The twelve-day window a week covers, and a label like "19 Oct – 25 Oct". */
export const weekRange = (week: Week, now = new Date()): { start: Date; end: Date; label: string } => {
  const start = startOfWeek(now);
  if (week === 'next') start.setDate(start.getDate() + 7);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { start, end, label: `${shortDate(start)} – ${shortDate(end)}` };
};

export const weekHeading = (week: Week): string => (week === 'next' ? 'Next week' : 'This week');

export { WEEKDAYS };

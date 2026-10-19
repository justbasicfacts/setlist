/**
 * Events and their setlists, kept in the browser.
 *
 * Two sample events ship with the app so it has something to open on first run, and
 * the screen says so. Everything the visitor creates stays in localStorage: there is
 * no backend yet, which is the one thing this first version does not have.
 */

import type { Track } from './spotify';

export type EventItem = {
  id: string;
  name: string;
  /** ISO date, yyyy-mm-dd. */
  date: string;
  venue: string;
  /** Short code a guest would type to reach this event. */
  code: string;
  tracks: Track[];
};

const KEY = 'setlist:events:v1';

export const newCode = (): string =>
  Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');

export const sampleEvents = (): EventItem[] => [
  {
    id: 'sample-rooftop',
    name: 'Rooftop listening session',
    date: nextWeekday(5),
    venue: 'Kreuzberg, Berlin',
    code: 'SAMP',
    tracks: [
      { id: 's1', title: 'Teardrop', artist: 'Massive Attack', addedBy: 'Anıl' },
      { id: 's2', title: 'Innerbloom', artist: 'RÜFÜS DU SOL', addedBy: 'Anıl' },
      { id: 's3', title: 'Weird Fishes / Arpeggi', artist: 'Radiohead', addedBy: 'Guest' },
    ],
  },
  {
    id: 'sample-studio',
    name: 'Studio night',
    date: nextWeekday(2),
    venue: 'Neukölln, Berlin',
    code: 'STDO',
    tracks: [{ id: 's4', title: 'Midnight City', artist: 'M83', addedBy: 'Guest' }],
  },
];

/** The next given weekday (0 = Sunday), formatted as yyyy-mm-dd. */
function nextWeekday(target: number): string {
  const date = new Date();
  const delta = (target - date.getDay() + 7) % 7 || 7;
  date.setDate(date.getDate() + delta);
  return date.toISOString().slice(0, 10);
}

export const loadEvents = (): EventItem[] => {
  const raw = localStorage.getItem(KEY);
  if (!raw) return sampleEvents();
  try {
    const parsed = JSON.parse(raw) as EventItem[];
    return Array.isArray(parsed) ? parsed : sampleEvents();
  } catch {
    return sampleEvents();
  }
};

export const saveEvents = (events: EventItem[]): void => {
  localStorage.setItem(KEY, JSON.stringify(events));
};

export const formatDate = (iso: string): string => {
  const date = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
};

export const createEvent = (name: string, date: string, venue: string): EventItem => ({
  id: `event-${Date.now()}`,
  name: name.trim(),
  date,
  venue: venue.trim(),
  code: newCode(),
  tracks: [],
});

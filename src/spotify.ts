/**
 * Spotify playlists, created on the visitor's behalf.
 *
 * A playlist has to be created inside an account, so somebody has to authorise the
 * site once. That happens on the server (server/token.mjs), which keeps the refresh
 * token; the page only ever sees a short-lived access token, so the client secret and
 * the long-lived credential never reach the browser.
 */

export type MadePlaylist = { id: string; url: string; count: number };

const CLIENT_ID = typeof __SPOTIFY_CLIENT_ID__ === 'string' ? __SPOTIFY_CLIENT_ID__.trim() : '';
const PLAYLISTS_KEY = 'whosplaying:playlists';

export const spotifyReady = CLIENT_ID.length > 0;

/* ---------------------------------------------------------------- session --- */

export type Session = { accessToken: string; userId: string; displayName: string };

/**
 * The refresh token lives on the server, so a visitor never logs in. If nobody has
 * authorised yet the server answers 401 and the page offers the one-time link.
 */
export const activeSession = async (): Promise<Session | null> => {
  if (!spotifyReady) return null;
  try {
    const response = await fetch('/api/token');
    if (!response.ok) return null;
    const body = (await response.json()) as {
      access_token: string;
      user_id: string;
      display_name?: string;
    };
    return {
      accessToken: body.access_token,
      userId: body.user_id,
      displayName: body.display_name ?? 'you',
    };
  } catch {
    return null;
  }
};

export const authoriseUrl = '/auth';

/* -------------------------------------------------------------------- api --- */

async function api<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`https://api.spotify.com/v1${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!response.ok) throw new Error(`Spotify ${path} answered ${response.status}`);
  return (await response.json()) as T;
}

/* ------------------------------------------------------------- playlists --- */

const loadMade = (): Record<string, MadePlaylist> => {
  try {
    return JSON.parse(localStorage.getItem(PLAYLISTS_KEY) ?? '{}') as Record<string, MadePlaylist>;
  } catch {
    return {};
  }
};

const saveMade = (value: Record<string, MadePlaylist>): void => {
  localStorage.setItem(PLAYLISTS_KEY, JSON.stringify(value));
};

export const madePlaylist = (key: string): MadePlaylist | undefined => loadMade()[key];

/**
 * The playlist for a key, reused when it still exists.
 *
 * "Do not create it again" is checked against Spotify, not just the local record: a
 * playlist deleted in the app would otherwise be linked to forever.
 */
export const ensurePlaylist = async (
  session: Session,
  key: string,
  name: string,
  description: string,
  trackUris: string[],
): Promise<{ playlist: MadePlaylist; reused: boolean }> => {
  const known = madePlaylist(key);

  if (known) {
    try {
      await api(session.accessToken, `/playlists/${known.id}`);
      return { playlist: known, reused: true };
    } catch {
      /* gone, or no longer ours: fall through and make a new one */
    }
  }

  const created = await api<{ id: string; external_urls?: { spotify?: string } }>(
    session.accessToken,
    `/users/${encodeURIComponent(session.userId)}/playlists`,
    {
      method: 'POST',
      body: JSON.stringify({ name, description, public: true }),
    },
  );

  if (trackUris.length > 0) {
    await api(session.accessToken, `/playlists/${created.id}/tracks`, {
      method: 'POST',
      body: JSON.stringify({ uris: trackUris.slice(0, 100) }),
    });
  }

  const playlist: MadePlaylist = {
    id: created.id,
    url: created.external_urls?.spotify ?? `https://open.spotify.com/playlist/${created.id}`,
    count: trackUris.length,
  };

  saveMade({ ...loadMade(), [key]: playlist });
  return { playlist, reused: false };
};

/** One track per artist, looked up as the visitor. */
export type FoundTrack = { title: string; artist: string; uri?: string; url?: string };

export const findTrack = async (
  token: string,
  artist: string,
  fallback: string,
): Promise<FoundTrack> => {
  try {
    const params = new URLSearchParams({ q: `artist:"${artist}"`, type: 'track', limit: '1' });
    const body = await api<{
      tracks?: {
        items?: {
          name?: string;
          uri?: string;
          artists?: { name?: string }[];
          external_urls?: { spotify?: string };
        }[];
      };
    }>(token, `/search?${params.toString()}`);

    const item = body.tracks?.items?.[0];
    if (!item?.name || !item.uri) return { title: fallback, artist };

    /* A search is not an artist match: keep it only when the credit agrees. */
    const wanted = artist.trim().toLowerCase();
    const credited = (item.artists ?? [])
      .map((entry) => entry.name?.trim().toLowerCase())
      .filter((entry): entry is string => !!entry);
    const agrees = credited.some(
      (name) => name === wanted || name.includes(wanted) || wanted.includes(name),
    );
    if (!agrees) return { title: fallback, artist };

    return { title: item.name, artist, uri: item.uri, url: item.external_urls?.spotify };
  } catch {
    return { title: fallback, artist };
  }
};

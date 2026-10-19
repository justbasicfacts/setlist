/**
 * Spotify, as the visitor.
 *
 * A playlist has to be created inside somebody's account, which a client secret cannot
 * do: client credentials have no user. So this is the authorisation code flow with
 * PKCE, entirely in the browser, and no secret anywhere near it.
 *
 * Scopes: create and fill playlists, and read the profile so we know whose account it
 * is. Nothing is read from the account's listening history.
 */

export type Session = {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  userId: string;
  displayName: string;
};

export type MadePlaylist = { id: string; url: string; count: number };

const CLIENT_ID = typeof __SPOTIFY_CLIENT_ID__ === 'string' ? __SPOTIFY_CLIENT_ID__.trim() : '';
const SCOPES = 'playlist-modify-public user-read-private';
const VERIFIER_KEY = 'whosplaying:pkce';
const SESSION_KEY = 'whosplaying:session';
const PLAYLISTS_KEY = 'whosplaying:playlists';

export const spotifyReady = CLIENT_ID.length > 0;

export const redirectUri = (): string =>
  `${window.location.origin}${window.location.pathname.replace(/index\.html$/, '')}`;

const base64url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

const random = (length: number): string => {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
};

const challenge = async (verifier: string): Promise<string> =>
  base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));

/* ---------------------------------------------------------------- session --- */

export const currentSession = (): Session | null => {
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
};

const saveSession = (session: Session): void => {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
};

export const signOut = (): void => {
  localStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(VERIFIER_KEY);
};

export const connect = async (): Promise<void> => {
  if (!CLIENT_ID) return;
  const verifier = random(64);
  localStorage.setItem(VERIFIER_KEY, verifier);
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: redirectUri(),
    scope: SCOPES,
    code_challenge_method: 'S256',
    code_challenge: await challenge(verifier),
  });
  window.location.assign(`https://accounts.spotify.com/authorize?${params.toString()}`);
};

const tokenRequest = async (body: Record<string, string>) => {
  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, ...body }).toString(),
  });
  if (!response.ok) throw new Error(`Spotify token ${response.status}`);
  return (await response.json()) as { access_token: string; refresh_token?: string; expires_in: number };
};

/** Called on load: finishes a redirect, or returns the stored session. */
export const finishConnect = async (): Promise<Session | null> => {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const error = params.get('error');

  if (error) {
    window.history.replaceState({}, '', redirectUri());
    throw new Error(`Spotify said no: ${error}`);
  }
  if (!code) return currentSession();

  const verifier = localStorage.getItem(VERIFIER_KEY);
  if (!verifier) throw new Error('The Spotify login expired before it finished. Try again.');

  const token = await tokenRequest({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri(),
    code_verifier: verifier,
  });
  const me = await api<{ id: string; display_name?: string }>(token.access_token, '/me');

  const session: Session = {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: Date.now() + token.expires_in * 1000,
    userId: me.id,
    displayName: me.display_name ?? 'you',
  };
  saveSession(session);
  localStorage.removeItem(VERIFIER_KEY);
  window.history.replaceState({}, '', redirectUri());
  return session;
};

const refresh = async (session: Session): Promise<Session | null> => {
  if (!session.refreshToken) return null;
  try {
    const token = await tokenRequest({ grant_type: 'refresh_token', refresh_token: session.refreshToken });
    const next: Session = {
      ...session,
      accessToken: token.access_token,
      refreshToken: token.refresh_token ?? session.refreshToken,
      expiresAt: Date.now() + token.expires_in * 1000,
    };
    saveSession(next);
    return next;
  } catch {
    signOut();
    return null;
  }
};

/** A token that is good for the next few minutes. */
export const activeSession = async (): Promise<Session | null> => {
  const session = currentSession();
  if (!session) return null;
  if (session.expiresAt > Date.now() + 30_000) return session;
  return refresh(session);
};

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

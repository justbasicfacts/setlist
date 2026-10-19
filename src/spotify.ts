/**
 * Spotify: authorisation code with PKCE, and the two calls the app needs.
 *
 * No secret is involved, which is what makes a browser-only connection possible:
 * the app hashes a random verifier, Spotify returns a code, and the code is swapped
 * for a token using the verifier. The client id comes from the environment
 * (`VITE_SPOTIFY_CLIENT_ID`); until one is set the app runs in demo mode with sample
 * tracks, so the rest of it works today.
 *
 * Scopes are read-only on purpose: the setlist lives in the app, and the connection
 * brings in what the visitor already listens to.
 */

export type Track = {
  id: string;
  title: string;
  artist: string;
  art?: string;
  url?: string;
  /** Who put it on the setlist, filled in by the app. */
  addedBy?: string;
};

export type Session = {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  displayName: string;
  image?: string;
  demo?: boolean;
};

const CLIENT_ID = (import.meta.env.VITE_SPOTIFY_CLIENT_ID as string | undefined)?.trim();
const SCOPES = 'user-read-private user-top-read';
const VERIFIER_KEY = 'setlist:pkce';
const SESSION_KEY = 'setlist:spotify';

export const spotifyConfigured = Boolean(CLIENT_ID);

/** Where Spotify sends the visitor back to; must be registered in the app settings. */
export const redirectUri = (): string =>
  `${window.location.origin}${window.location.pathname.replace(/index\.html$/, '')}`;

const base64url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

const randomString = (length: number): string => {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
};

const challengeFor = async (verifier: string): Promise<string> =>
  base64url(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)),
    ),
  );

/* ---------------------------------------------------------------- session --- */

export const loadSession = (): Session | null => {
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    const session = JSON.parse(raw) as Session;
    if (!session.demo && session.expiresAt < Date.now() + 30_000) {
      void refresh(session);
    }
    return session;
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

/* ------------------------------------------------------------------ login --- */

export const beginLogin = async (): Promise<void> => {
  if (!CLIENT_ID) return;
  const verifier = randomString(64);
  localStorage.setItem(VERIFIER_KEY, verifier);
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: redirectUri(),
    scope: SCOPES,
    code_challenge_method: 'S256',
    code_challenge: await challengeFor(verifier),
    state: randomString(12),
  });
  window.location.assign(`https://accounts.spotify.com/authorize?${params.toString()}`);
};

const tokenRequest = async (body: Record<string, string>) => {
  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID ?? '', ...body }).toString(),
  });
  if (!response.ok) throw new Error(`Spotify token request failed (${response.status})`);
  return (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };
};

const profile = async (accessToken: string) => {
  const response = await fetch('https://api.spotify.com/v1/me', {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error(`Spotify profile request failed (${response.status})`);
  return (await response.json()) as {
    display_name?: string;
    images?: { url: string }[];
  };
};

/** Called on load: completes a redirect, or returns nothing to do. */
export const completeLogin = async (): Promise<Session | null> => {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const error = params.get('error');
  if (error) {
    window.history.replaceState({}, '', redirectUri());
    throw new Error(`Spotify said no: ${error}`);
  }
  if (!code) return loadSession();

  const verifier = localStorage.getItem(VERIFIER_KEY);
  if (!verifier) return null;

  const token = await tokenRequest({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri(),
    code_verifier: verifier,
  });
  const me = await profile(token.access_token);
  const session: Session = {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: Date.now() + token.expires_in * 1000,
    displayName: me.display_name ?? 'Spotify listener',
    image: me.images?.[0]?.url,
  };

  saveSession(session);
  localStorage.removeItem(VERIFIER_KEY);
  window.history.replaceState({}, '', redirectUri());
  return session;
};

export const refresh = async (session: Session): Promise<Session | null> => {
  if (!session.refreshToken || session.demo) return session;
  try {
    const token = await tokenRequest({
      grant_type: 'refresh_token',
      refresh_token: session.refreshToken,
    });
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

/* ------------------------------------------------------------------ reads --- */

type SpotifyTrack = {
  id: string;
  name: string;
  artists: { name: string }[];
  album?: { images?: { url: string }[] };
  external_urls?: { spotify?: string };
};

const toTrack = (track: SpotifyTrack): Track => ({
  id: track.id,
  title: track.name,
  artist: track.artists.map((artist) => artist.name).join(', '),
  art: track.album?.images?.at(-1)?.url,
  url: track.external_urls?.spotify,
});

/** The visitor's most played tracks over the last few months. */
export const topTracks = async (session: Session): Promise<Track[]> => {
  if (session.demo) return demoTracks;
  const active = session.expiresAt < Date.now() + 30_000 ? await refresh(session) : session;
  if (!active) throw new Error('The Spotify session expired. Connect again.');

  const response = await fetch(
    'https://api.spotify.com/v1/me/top/tracks?limit=12&time_range=medium_term',
    { headers: { authorization: `Bearer ${active.accessToken}` } },
  );
  if (!response.ok) throw new Error(`Spotify top tracks failed (${response.status})`);
  const body = (await response.json()) as { items: SpotifyTrack[] };
  return body.items.map(toTrack);
};

/**
 * Sample tracks for demo mode. They are clearly sample data: the app says so in the
 * panel, and nothing here claims to be the visitor's listening.
 */
export const demoTracks: Track[] = [
  { id: 'demo-1', title: 'Teardrop', artist: 'Massive Attack' },
  { id: 'demo-2', title: 'Everything In Its Right Place', artist: 'Radiohead' },
  { id: 'demo-3', title: 'Midnight City', artist: 'M83' },
  { id: 'demo-4', title: 'The Less I Know The Better', artist: 'Tame Impala' },
  { id: 'demo-5', title: 'Weird Fishes / Arpeggi', artist: 'Radiohead' },
  { id: 'demo-6', title: 'Innerbloom', artist: 'RÜFÜS DU SOL' },
];

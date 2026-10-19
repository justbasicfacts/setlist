import { useEffect, useState } from 'react';
import { Alert, Container, Stack } from '@justbasicfacts/lit-ui-react';

import { CityBar } from './components/CityBar';
import { PlaylistView } from './components/PlaylistView';
import { TopBar } from './components/TopBar';
import {
  cleanCity,
  findPlaylist,
  loadPlaylists,
  sameCity,
  savePlaylists,
  type Playlist,
  type Week,
} from './playlists';
import {
  beginLogin,
  completeLogin,
  loadSession,
  signOut,
  spotifyConfigured,
  type Session,
  type Track,
} from './spotify';
import { applyMode, storedMode, type Mode } from './theme';

export function App() {
  const [mode, setMode] = useState<Mode>(storedMode);
  const [session, setSession] = useState<Session | null>(() => loadSession());
  const [playlists, setPlaylists] = useState<Playlist[]>(() => loadPlaylists());
  const [city, setCity] = useState('');
  const [week, setWeek] = useState<Week>('this');
  const [problem, setProblem] = useState('');

  useEffect(() => {
    applyMode(mode);
  }, [mode]);

  useEffect(() => {
    savePlaylists(playlists);
  }, [playlists]);

  /* Finishing a Spotify redirect, if the URL carries a code. */
  useEffect(() => {
    completeLogin()
      .then((result) => {
        if (result) setSession(result);
      })
      .catch((error: Error) => setProblem(error.message));
  }, []);

  const playlist = city.trim() ? findPlaylist(playlists, city, week) : undefined;

  /** Created on the go: the first thing that exists for this city and week. */
  const create = () => {
    const name = cleanCity(city);
    if (!name) return;
    if (findPlaylist(playlists, name, week)) return;
    setPlaylists((current) => [...current, { city: name, week, tracks: [] }]);
    setCity(name);
  };

  const change = (mutate: (playlist: Playlist) => Playlist) => {
    setPlaylists((current) =>
      current.map((entry) =>
        entry.week === week && sameCity(entry.city, city) ? mutate(entry) : entry,
      ),
    );
  };

  const add = (track: Track) => {
    change((entry) =>
      entry.tracks.some((item) => item.id === track.id)
        ? entry
        : { ...entry, tracks: [...entry.tracks, track] },
    );
  };

  const remove = (trackId: string) => {
    change((entry) => ({ ...entry, tracks: entry.tracks.filter((item) => item.id !== trackId) }));
  };

  const connect = () => {
    void beginLogin().catch((error: Error) => setProblem(error.message));
  };

  return (
    <>
      <TopBar
        mode={mode}
        session={session}
        onToggleMode={() => setMode(mode === 'dark' ? 'light' : 'dark')}
        onSpotify={() => {
          if (spotifyConfigured) connect();
        }}
      />

      <main>
        <Container maxWidth="md" className="page">
          <Stack spacing={3}>
            {problem ? (
              <Alert severity="error" title="Something went wrong">
                {problem}
              </Alert>
            ) : null}

            <CityBar
              city={city}
              week={week}
              playlists={playlists}
              onCity={setCity}
              onWeek={setWeek}
            />

            <PlaylistView
              city={city}
              week={week}
              playlist={playlist}
              session={session}
              onCreate={create}
              onAdd={add}
              onRemove={remove}
              onConnect={connect}
              onDemo={() =>
                setSession({
                  accessToken: 'demo',
                  expiresAt: Date.now() + 60 * 60 * 1000,
                  displayName: 'Sample listener',
                  demo: true,
                })
              }
              onDisconnect={() => {
                signOut();
                setSession(null);
              }}
            />
          </Stack>
        </Container>
      </main>
    </>
  );
}

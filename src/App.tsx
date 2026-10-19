import { useEffect, useState } from 'react';
import { Alert, Container, Stack } from '@justbasicfacts/lit-ui-react';

import { EventList } from './components/EventList';
import { EventView } from './components/EventView';
import { TopBar } from './components/TopBar';
import { loadEvents, saveEvents, type EventItem } from './data';
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
  const [events, setEvents] = useState<EventItem[]>(() => loadEvents());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [problem, setProblem] = useState('');

  useEffect(() => {
    applyMode(mode);
  }, [mode]);

  useEffect(() => {
    saveEvents(events);
  }, [events]);

  /* Finishing a Spotify redirect, if the URL carries a code. */
  useEffect(() => {
    completeLogin()
      .then((result) => {
        if (result) setSession(result);
      })
      .catch((error: Error) => setProblem(error.message));
  }, []);

  const active = events.find((event) => event.id === activeId) ?? null;

  const updateEvent = (id: string, change: (event: EventItem) => EventItem) => {
    setEvents((current) => current.map((event) => (event.id === id ? change(event) : event)));
  };

  const addTrack = (id: string, track: Track) => {
    updateEvent(id, (event) =>
      event.tracks.some((item) => item.id === track.id)
        ? event
        : { ...event, tracks: [...event.tracks, track] },
    );
  };

  const removeTrack = (id: string, trackId: string) => {
    updateEvent(id, (event) => ({
      ...event,
      tracks: event.tracks.filter((item) => item.id !== trackId),
    }));
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
          else setActiveId(events[0]?.id ?? null);
        }}
      />

      <main>
        <Container maxWidth="lg" className="page">
          <Stack spacing={3}>
            {problem ? (
              <Alert severity="error" title="Something went wrong">
                {problem}
              </Alert>
            ) : null}

            {active ? (
              <EventView
                event={active}
                session={session}
                onBack={() => setActiveId(null)}
                onAdd={(track) => addTrack(active.id, track)}
                onRemove={(trackId) => removeTrack(active.id, trackId)}
                onConnect={connect}
                onDemo={() => {
                  setSession({
                    accessToken: 'demo',
                    expiresAt: Date.now() + 60 * 60 * 1000,
                    displayName: 'Demo listener',
                    demo: true,
                  });
                  setProblem('');
                }}
                onDisconnect={() => {
                  signOut();
                  setSession(null);
                }}
              />
            ) : (
              <EventList
                events={events}
                onCreate={(event) => {
                  setEvents((current) => [event, ...current]);
                  setActiveId(event.id);
                }}
                onOpen={setActiveId}
              />
            )}
          </Stack>
        </Container>
      </main>
    </>
  );
}

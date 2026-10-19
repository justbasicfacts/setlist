import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  Group,
  IconButton,
  Input,
  List,
  ListItem,
  Stack,
  Typography,
} from '@justbasicfacts/lit-ui-react';
import { formatDate, type EventItem } from '../data';
import { IconClose } from '../icons';
import { redirectUri, spotifyConfigured, topTracks, type Session, type Track } from '../spotify';

type Props = {
  event: EventItem;
  session: Session | null;
  onBack: () => void;
  onAdd: (track: Track) => void;
  onRemove: (trackId: string) => void;
  onConnect: () => void;
  onDemo: () => void;
  onDisconnect: () => void;
};

const valueOf = (event: Event): string =>
  (event as CustomEvent<{ value?: string }>).detail?.value ??
  (event.target as HTMLInputElement).value ??
  '';

/** One event: its setlist, the two ways to add to it, and the Spotify connection. */
export function EventView({
  event,
  session,
  onBack,
  onAdd,
  onRemove,
  onConnect,
  onDemo,
  onDisconnect,
}: Props) {
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [copied, setCopied] = useState(false);
  const [suggestions, setSuggestions] = useState<Track[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [problem, setProblem] = useState('');

  useEffect(() => {
    if (!session) {
      setSuggestions(null);
      return;
    }
    let live = true;
    setLoading(true);
    setProblem('');
    topTracks(session)
      .then((tracks) => {
        if (live) setSuggestions(tracks);
      })
      .catch((error: Error) => {
        if (live) setProblem(error.message);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [session]);

  const addManual = () => {
    if (!title.trim()) return;
    onAdd({
      id: `manual-${Date.now()}`,
      title: title.trim(),
      artist: artist.trim() || 'Unknown artist',
      addedBy: session?.displayName ?? 'You',
    });
    setTitle('');
    setArtist('');
  };

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(event.code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const inSet = (track: Track) => event.tracks.some((item) => item.id === track.id);

  return (
    <Stack spacing={3}>
      <Group spacing={1} align="center">
        <Button size="sm" variant="ghost" onClick={onBack}>
          ← All events
        </Button>
      </Group>

      <Card>
        <CardContent>
          <Stack spacing={1.5}>
            <Group spacing={1} align="center" wrap>
              <Typography variant="overline" color="text.secondary" component="p">
                {formatDate(event.date)}
              </Typography>
              <Chip label={event.venue} variant="outlined" nowrap />
            </Group>
            <Typography variant="h3" component="h1">
              {event.name}
            </Typography>
            <Group spacing={1.5} align="center" wrap>
              <Typography variant="body2" color="text.secondary" component="p">
                Share code
              </Typography>
              <Chip label={event.code} variant="filled" color="primary" nowrap />
              <Button size="sm" variant="outline" onClick={copyCode}>
                {copied ? 'Copied' : 'Copy'}
              </Button>
              <Typography variant="caption" color="text.secondary" component="p">
                {event.tracks.length} {event.tracks.length === 1 ? 'track' : 'tracks'} so far
              </Typography>
            </Group>
          </Stack>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Stack spacing={2}>
            <Typography variant="h5" component="h2">
              The setlist
            </Typography>

            {event.tracks.length === 0 ? (
              <Typography variant="body2" color="text.secondary" component="p">
                Nothing on it yet. Add the first track below, or pull one in from Spotify.
              </Typography>
            ) : (
              <List>
                {event.tracks.map((track, index) => (
                  <ListItem key={track.id} divider>
                    <span className="row-index">{index + 1}</span>
                    <span className="row-main">
                      <Typography variant="subtitle2" component="p">
                        {track.title}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" component="p">
                        {track.artist}
                        {track.addedBy ? ` · added by ${track.addedBy}` : ''}
                      </Typography>
                    </span>
                    <IconButton
                      slot="secondary-action"
                      label={`Remove ${track.title}`}
                      onClick={() => onRemove(track.id)}
                    >
                      <IconClose />
                    </IconButton>
                  </ListItem>
                ))}
              </List>
            )}

            <Divider></Divider>

            <Typography variant="subtitle2" component="p">
              Add a track
            </Typography>
            <Group spacing={1} align="flex-end" wrap>
              <div className="field">
                <Input
                  label="Title"
                  placeholder="Song title"
                  value={title}
                  onInput={(event: Event) => setTitle(valueOf(event))}
                />
              </div>
              <div className="field">
                <Input
                  label="Artist"
                  placeholder="Who plays it"
                  value={artist}
                  onInput={(event: Event) => setArtist(valueOf(event))}
                />
              </div>
              <Button size="sm" onClick={addManual} disabled={!title.trim()}>
                Add
              </Button>
            </Group>
          </Stack>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Stack spacing={2}>
            <Group spacing={1} justify="space-between" align="center" wrap>
              <Typography variant="h5" component="h2">
                From Spotify
              </Typography>
              {session ? (
                <Button size="sm" variant="ghost" onClick={onDisconnect}>
                  Disconnect
                </Button>
              ) : null}
            </Group>

            {!spotifyConfigured && !session ? (
              <Stack spacing={1.5}>
                <Alert severity="warning" title="Spotify is not configured yet">
                  Set VITE_SPOTIFY_CLIENT_ID in a .env file and register this redirect URI in
                  the Spotify dashboard: {redirectUri()}
                </Alert>
                <Typography variant="body2" color="text.secondary" component="p">
                  Until then you can try the connection with sample tracks, so the rest of
                  the app works.
                </Typography>
                <Group spacing={1}>
                  <Button size="sm" variant="outline" onClick={onDemo}>
                    Use demo connection
                  </Button>
                </Group>
              </Stack>
            ) : session ? (
              <Stack spacing={1.5}>
                <Group spacing={1} align="center" wrap>
                  <Typography variant="body2" component="p">
                    Reading your top tracks
                  </Typography>
                  <Chip
                    label={session.demo ? 'sample tracks' : session.displayName}
                    variant="outlined"
                    color={session.demo ? 'warning' : 'success'}
                    nowrap
                  />
                </Group>

                {problem ? (
                  <Alert severity="error" title="Spotify did not answer">
                    {problem}
                  </Alert>
                ) : null}
                {loading ? (
                  <Typography variant="body2" color="text.secondary" component="p">
                    Loading your tracks…
                  </Typography>
                ) : null}

                {suggestions && suggestions.length > 0 ? (
                  <List dense>
                    {suggestions.map((track) => (
                      <ListItem key={track.id} divider>
                        <span className="row-main">
                          <Typography variant="subtitle2" component="p">
                            {track.title}
                          </Typography>
                          <Typography variant="caption" color="text.secondary" component="p">
                            {track.artist}
                          </Typography>
                        </span>
                        <Button
                          slot="secondary-action"
                          size="sm"
                          variant={inSet(track) ? 'ghost' : 'outline'}
                          disabled={inSet(track)}
                          onClick={() => onAdd({ ...track, addedBy: session.displayName })}
                        >
                          {inSet(track) ? 'On the setlist' : 'Add'}
                        </Button>
                      </ListItem>
                    ))}
                  </List>
                ) : null}
              </Stack>
            ) : (
              <Stack spacing={1.5}>
                <Typography variant="body2" color="text.secondary" component="p">
                  Connect once and the app can read the tracks you play most, so adding to a
                  setlist starts from what you already like.
                </Typography>
                <Group spacing={1}>
                  <Button size="sm" onClick={onConnect}>
                    Connect Spotify
                  </Button>
                  <Button size="sm" variant="outline" onClick={onDemo}>
                    Use demo connection
                  </Button>
                </Group>
              </Stack>
            )}
          </Stack>
        </CardContent>
      </Card>
    </Stack>
  );
}

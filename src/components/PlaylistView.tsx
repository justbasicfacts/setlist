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
import { IconClose } from '../icons';
import { weekHeading, weekRange, type Playlist, type Week } from '../playlists';
import { redirectUri, spotifyConfigured, topTracks, type Session, type Track } from '../spotify';

type Props = {
  city: string;
  week: Week;
  playlist?: Playlist;
  session: Session | null;
  onCreate: () => void;
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

/**
 * The playlist for one city and one week: the tracks, the form that adds one, and
 * the Spotify connection that suggests some. A city with nothing stored gets a
 * create button instead of an empty list.
 */
export function PlaylistView({
  city,
  week,
  playlist,
  session,
  onCreate,
  onAdd,
  onRemove,
  onConnect,
  onDemo,
  onDisconnect,
}: Props) {
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
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

  const inPlaylist = (track: Track) => !!playlist?.tracks.some((item) => item.id === track.id);

  if (!city.trim()) {
    return (
      <Card>
        <CardContent>
          <Stack spacing={1}>
            <Typography variant="h5" component="h2">
              Pick a city
            </Typography>
            <Typography variant="body1" color="text.secondary" component="p">
              Type a city above and its playlist for this week shows up here. A city with no
              playlist yet gets a create button.
            </Typography>
          </Stack>
        </CardContent>
      </Card>
    );
  }

  return (
    <Stack spacing={3}>
      <Card>
        <CardContent>
          <Stack spacing={2}>
            <Group spacing={1} justify="space-between" align="center" wrap>
              <div>
                <Typography variant="overline" color="text.secondary" component="p">
                  {weekHeading(week)} · {weekRange(week).label}
                </Typography>
                <Typography variant="h3" component="h1">
                  {playlist?.city ?? city.trim()}
                </Typography>
              </div>
              {playlist ? (
                <Chip
                  label={`${playlist.tracks.length} ${playlist.tracks.length === 1 ? 'track' : 'tracks'}`}
                  variant="outlined"
                  nowrap
                />
              ) : null}
            </Group>

            {!playlist ? (
              <Stack spacing={1.5}>
                <Typography variant="body1" color="text.secondary" component="p">
                  No playlist for {city.trim()} {weekHeading(week).toLowerCase()} yet. Create one
                  and start adding tracks.
                </Typography>
                <Group spacing={1}>
                  <Button size="sm" onClick={onCreate}>
                    Create playlist
                  </Button>
                </Group>
              </Stack>
            ) : playlist.tracks.length === 0 ? (
              <Typography variant="body2" color="text.secondary" component="p">
                Empty so far. Add the first track below, or pull one in from Spotify.
              </Typography>
            ) : (
              <List>
                {playlist.tracks.map((track, index) => (
                  <ListItem key={track.id} divider>
                    <span className="row-index">{index + 1}</span>
                    <span className="row-main">
                      <Typography variant="subtitle2" component="p">
                        {track.title}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" component="p">
                        {track.artist}
                        {track.addedBy ? ` · ${track.addedBy}` : ''}
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

            {playlist ? (
              <>
                <Divider></Divider>
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
              </>
            ) : null}
          </Stack>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Stack spacing={2}>
            <Group spacing={1} justify="space-between" align="center" wrap>
              <Group spacing={1} align="center" wrap>
                <Typography variant="h5" component="h2">
                  From Spotify
                </Typography>
                {session ? (
                  <Chip
                    label={session.demo ? 'sample tracks' : session.displayName}
                    variant="outlined"
                    color={session.demo ? 'warning' : 'success'}
                    nowrap
                  />
                ) : null}
              </Group>
              {session ? (
                <Button size="sm" variant="ghost" onClick={onDisconnect}>
                  Disconnect
                </Button>
              ) : null}
            </Group>

            {!spotifyConfigured && !session ? (
              <Stack spacing={1.5}>
                <Alert severity="warning" title="Spotify is not configured yet">
                  Set VITE_SPOTIFY_CLIENT_ID in .env and register this redirect URI in the
                  Spotify dashboard: {redirectUri()}
                </Alert>
                <Group spacing={1}>
                  <Button size="sm" variant="outline" onClick={onDemo}>
                    Use sample tracks
                  </Button>
                </Group>
              </Stack>
            ) : session ? (
              <Stack spacing={1.5}>
                {problem ? (
                  <Alert severity="error" title="Spotify did not answer">
                    {problem}
                  </Alert>
                ) : null}
                {loading ? (
                  <Typography variant="body2" color="text.secondary" component="p">
                    Loading…
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
                          variant={inPlaylist(track) ? 'ghost' : 'outline'}
                          disabled={!playlist || inPlaylist(track)}
                          onClick={() => onAdd({ ...track, addedBy: session.displayName })}
                        >
                          {inPlaylist(track) ? 'Added' : 'Add'}
                        </Button>
                      </ListItem>
                    ))}
                  </List>
                ) : null}
                {!playlist ? (
                  <Typography variant="caption" color="text.secondary" component="p">
                    Create the playlist first, then tracks can be added to it.
                  </Typography>
                ) : null}
              </Stack>
            ) : (
              <Stack spacing={1.5}>
                <Typography variant="body2" color="text.secondary" component="p">
                  Connect Spotify to pull in the tracks you play most.
                </Typography>
                <Group spacing={1}>
                  <Button size="sm" onClick={onConnect}>
                    Connect Spotify
                  </Button>
                  <Button size="sm" variant="outline" onClick={onDemo}>
                    Use sample tracks
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

import {
  AppBar,
  Avatar,
  Button,
  Chip,
  Container,
  Group,
  IconButton,
  Toolbar,
  Typography,
} from '@justbasicfacts/lit-ui-react';
import { IconMoon, IconSun } from '../icons';
import type { Mode } from '../theme';
import { spotifyConfigured, type Session } from '../spotify';

type Props = {
  mode: Mode;
  session: Session | null;
  onToggleMode: () => void;
  onSpotify: () => void;
};

/** Brand, the Spotify state, and the mode switch, in the library's app bar. */
export function TopBar({ mode, session, onToggleMode, onSpotify }: Props) {
  return (
    <AppBar position="sticky" color="background.default" elevation={0} className="topbar">
      <Toolbar>
        <Container maxWidth="lg" className="topbar-inner">
          <Group spacing={1.5} align="center">
            <Avatar initials="SL" size={36} variant="rounded" color="primary" />
            <div>
              <Typography variant="subtitle2" component="p">
                Setlist
              </Typography>
              <Typography
                variant="caption"
                color="text.secondary"
                component="p"
                className="brand-sub"
              >
                city playlists, week by week
              </Typography>
            </div>
          </Group>

          <Group spacing={1} align="center">
            {session ? (
              <Chip
                label={session.demo ? 'Demo connection' : session.displayName}
                variant="outlined"
                color={session.demo ? 'warning' : 'success'}
                nowrap
              />
            ) : (
              <Button size="sm" variant="outline" onClick={onSpotify}>
                {spotifyConfigured ? 'Connect Spotify' : 'Spotify setup'}
              </Button>
            )}
            <IconButton
              label={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              onClick={onToggleMode}
            >
              {mode === 'dark' ? <IconSun /> : <IconMoon />}
            </IconButton>
          </Group>
        </Container>
      </Toolbar>
    </AppBar>
  );
}

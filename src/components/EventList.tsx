import { useState } from 'react';
import {
  Alert,
  Button,
  Card,
  CardContent,
  Chip,
  Group,
  Input,
  SimpleGrid,
  Stack,
  Typography,
} from '@justbasicfacts/lit-ui-react';
import { createEvent, formatDate, type EventItem } from '../data';

type Props = {
  events: EventItem[];
  onCreate: (event: EventItem) => void;
  onOpen: (id: string) => void;
};

const valueOf = (event: Event): string =>
  (event as CustomEvent<{ value?: string }>).detail?.value ??
  (event.target as HTMLInputElement).value ??
  '';

/** Every event, and the form that makes a new one. */
export function EventList({ events, onCreate, onOpen }: Props) {
  const [name, setName] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [venue, setVenue] = useState('');

  const create = () => {
    if (!name.trim()) return;
    onCreate(createEvent(name, date, venue || 'Venue to confirm'));
    setName('');
    setVenue('');
  };

  return (
    <Stack spacing={3}>
      <Stack spacing={1}>
        <Typography variant="h3" component="h1">
          Your events
        </Typography>
        <Typography variant="body1" color="text.secondary" component="p">
          Each event keeps its own setlist. Bring in what you have been listening to, and
          the people coming bring theirs.
        </Typography>
      </Stack>

      <Alert severity="info" title="Sample data" color="primary">
        Two sample events are here so the app has something to open. What you create stays
        in this browser.
      </Alert>

      {/* The form sits above the grid, so a row of events is not stretched to the
          height of a form. */}
      <Card>
        <CardContent>
          <Stack spacing={2}>
            <Typography variant="h6" component="h2">
              New event
            </Typography>
            <Group spacing={1.5} align="flex-end" wrap>
              <div className="field">
                <Input
                  label="Name"
                  placeholder="Birthday, studio night, a long drive"
                  value={name}
                  onInput={(event: Event) => setName(valueOf(event))}
                />
              </div>
              <div className="field">
                <Input
                  label="Venue"
                  placeholder="Where it happens"
                  value={venue}
                  onInput={(event: Event) => setVenue(valueOf(event))}
                />
              </div>
              <div className="field">
                <Input
                  label="Date"
                  type="date"
                  value={date}
                  onInput={(event: Event) => setDate(valueOf(event))}
                />
              </div>
              <Button size="sm" onClick={create} disabled={!name.trim()}>
                Create event
              </Button>
            </Group>
          </Stack>
        </CardContent>
      </Card>

      <SimpleGrid cols={0} minColWidth="300px" spacing={2}>
        {events.map((event) => (
          <Card key={event.id}>
            <CardContent>
              <Stack spacing={1.5}>
                <Group spacing={1} justify="space-between" wrap>
                  <Typography variant="overline" color="text.secondary" component="p">
                    {formatDate(event.date)}
                  </Typography>
                  <Chip label={event.code} variant="outlined" color="secondary" nowrap />
                </Group>
                <Typography variant="h5" component="h2">
                  {event.name}
                </Typography>
                <Typography variant="body2" color="text.secondary" component="p">
                  {event.venue}
                </Typography>
                <Group spacing={1} justify="space-between" align="center">
                  <Typography variant="caption" color="text.secondary" component="p">
                    {event.tracks.length} {event.tracks.length === 1 ? 'track' : 'tracks'}
                  </Typography>
                  <Button size="sm" onClick={() => onOpen(event.id)}>
                    Open
                  </Button>
                </Group>
              </Stack>
            </CardContent>
          </Card>
        ))}
      </SimpleGrid>
    </Stack>
  );
}

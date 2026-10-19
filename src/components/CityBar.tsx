import { Button, Chip, Group, Input, Stack, Typography } from '@justbasicfacts/lit-ui-react';
import { knownCities, weekHeading, weekRange, type Playlist, type Week } from '../playlists';

type Props = {
  city: string;
  week: Week;
  playlists: Playlist[];
  onCity: (city: string) => void;
  onWeek: (week: Week) => void;
};

const valueOf = (event: Event): string =>
  (event as CustomEvent<{ value?: string }>).detail?.value ??
  (event.target as HTMLInputElement).value ??
  '';

/** Which city, and which of the two weeks. The only two choices on the page. */
export function CityBar({ city, week, playlists, onCity, onWeek }: Props) {
  const cities = knownCities(playlists);

  return (
    <Stack spacing={2}>
      <div className="city-row">
        <div className="city-field">
          <Input
            label="City"
            placeholder="Type a city, or pick one below"
            value={city}
            onInput={(event: Event) => onCity(valueOf(event))}
          />
        </div>
        <div className="week-toggle" role="group" aria-label="Which week">
          {(['this', 'next'] as Week[]).map((option) => (
            <Button
              key={option}
              size="sm"
              variant={week === option ? 'primary' : 'outline'}
              text-transform="none"
              onClick={() => onWeek(option)}
            >
              {weekHeading(option)}
            </Button>
          ))}
        </div>
        <Typography variant="caption" color="text.secondary" component="p" className="week-label">
          {weekRange(week).label}
        </Typography>
      </div>

      {cities.length > 0 ? (
        <Group spacing={1} align="center" wrap>
          <Typography variant="caption" color="text.secondary" component="p">
            Cities with a playlist
          </Typography>
          {cities.map((known) => (
            <Chip
              key={known}
              label={known}
              variant={known === city ? 'filled' : 'outlined'}
              color={known === city ? 'primary' : 'default'}
              clickable
              nowrap
              onClick={() => onCity(known)}
            />
          ))}
        </Group>
      ) : null}
    </Stack>
  );
}

import './styles.css';

/**
 * Pick any city in the world, pick a week, read the list.
 *
 * Each row is a gig: day, date and time, venue, who is playing, and one song by each
 * of them. No players, no exports, no accounts.
 */

type City = { name: string; country: string; countryName: string; region: string; lat: number; lon: number };
type Song = { artist: string; title: string | null; album?: string | null };
type Gig = {
  date: string;
  day: string;
  time: string;
  venue: string;
  district: string;
  artists: string[];
  songs: Song[];
  source: string;
};
type Lineup = {
  city: City;
  week: 'this' | 'next';
  label: string;
  heading: string;
  events: number;
  rows: Gig[];
  empty?: boolean;
};

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('No #app to render into');

const state: {
  query: string;
  cities: City[];
  open: boolean;
  city: City | null;
  week: 'this' | 'next';
  lineup: Lineup | null;
  status: 'idle' | 'loading' | 'ok' | 'error';
  message: string;
} = {
  query: '',
  cities: [],
  open: false,
  city: null,
  week: 'this',
  lineup: null,
  status: 'idle',
  message: '',
};

const escape = (value: string): string =>
  value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] as string);

const label = (city: City): string => `${city.name}${city.region ? `, ${city.region}` : ''} · ${city.countryName || city.country}`;

/** "Mon 19 Oct", from the date Ticketmaster gives and the weekday it computed. */
const when = (gig: Gig): string => {
  if (!gig.date) return gig.day;
  const date = new Date(`${gig.date}T12:00:00`);
  const pretty = Number.isNaN(date.getTime())
    ? gig.date
    : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  return `${gig.day} ${pretty}${gig.time ? ` · ${gig.time}` : ''}`;
};

let search = 0;
const findCities = async (query: string): Promise<void> => {
  const token = ++search;
  if (query.trim().length < 2) {
    state.cities = [];
    render();
    return;
  }
  try {
    const response = await fetch(`/api/cities?q=${encodeURIComponent(query.trim())}`);
    const body = (await response.json()) as { cities: City[] };
    if (token !== search) return;
    state.cities = body.cities ?? [];
    state.open = true;
  } catch {
    if (token !== search) return;
    state.cities = [];
  }
  render();
};

let run = 0;
const load = async (): Promise<void> => {
  if (!state.city) return;
  const token = ++run;
  state.status = 'loading';
  state.message = '';
  render();

  const params = new URLSearchParams({
    city: state.city.name,
    country: state.city.country,
    countryName: state.city.countryName ?? '',
    lat: String(state.city.lat),
    lon: String(state.city.lon),
    week: state.week,
  });

  try {
    const response = await fetch(`/api/lineup?${params.toString()}`);
    const body = (await response.json()) as Lineup & { error?: string };
    if (token !== run) return;
    if (!response.ok) throw new Error(body.error ?? `the server answered ${response.status}`);

    state.lineup = body;
    state.status = 'ok';
    state.open = false;
  } catch (error) {
    if (token !== run) return;
    state.status = 'error';
    state.message = error instanceof Error ? error.message : String(error);
  }
  render();
};

const pick = (city: City): void => {
  state.city = city;
  state.query = '';
  state.cities = [];
  state.open = false;
  state.lineup = null;
  void load();
};

const render = (): void => {
  const lineup = state.lineup;
  const heading = lineup?.heading ?? (state.week === 'next' ? 'next week' : 'this week');
  const cityName = state.city?.name ?? 'anywhere';
  const songs = lineup?.rows.flatMap((gig) => gig.songs).filter((song) => song.title) ?? [];

  app.innerHTML = `
    <header class="bar">
      <div class="brand"><span class="badge">WP</span><span class="name">Who's Playing?</span></div>
      <p class="tag">Every gig in town this week, and one song from everyone on the bill.</p>
    </header>

    <main>
      <section class="controls" aria-label="City and week">
        <div class="search">
          <label class="field">
            <span>City</span>
            <input
              id="q"
              type="search"
              autocomplete="off"
              placeholder="Any city in the world"
              value="${escape(state.query)}"
              aria-expanded="${state.open}"
            />
          </label>
          ${
            state.open && state.cities.length === 0 && state.query.trim().length >= 2
              ? `<p class="suggest empty-suggest">No city found for &ldquo;${escape(state.query.trim())}&rdquo;.</p>`
              : ''
          }
          ${
            state.open && state.cities.length > 0
              ? `<ul class="suggest" role="listbox">
                   ${state.cities
                     .map(
                       (city) => `<li role="option"><button type="button" data-city="${escape(`${city.name}|${city.countryName}|${city.region}|${city.lat}|${city.lon}`)}">${escape(label(city))}</button></li>`,
                     )
                     .join('')}
                 </ul>`
              : ''
          }
        </div>
        <div class="weeks" role="group" aria-label="Which week">
          <button type="button" data-week="this" class="${state.week === 'this' ? 'on' : ''}">This week</button>
          <button type="button" data-week="next" class="${state.week === 'next' ? 'on' : ''}">Next week</button>
        </div>
        <span class="dates">${escape(lineup?.label ?? '')}</span>
      </section>

      <section class="hero">
        <h1>${escape(cityName)},<br /><em>${escape(heading)}</em></h1>
        <p class="count">${
          state.status === 'loading'
            ? 'Looking for gigs&hellip;'
            : lineup && !lineup.empty
              ? `<b>${lineup.events}</b> gigs &middot; <b>${new Set(lineup.rows.flatMap((gig) => gig.artists)).size}</b> artists &middot; <b>${songs.length}</b> songs`
              : state.city
                ? 'Nothing on that week'
                : 'Search for a city to begin'
        }</p>
        ${state.message ? `<p class="problem">${escape(state.message)}</p>` : ''}
      </section>

      <section class="panel single">
        ${
          state.status === 'loading'
            ? `<p class="empty">Checking the listings&hellip;</p>`
            : lineup?.empty
              ? `<p class="empty">No gigs in ${escape(lineup.city.name)} ${escape(lineup.heading)}.<br /><span>Try the other week, or another city.</span></p>`
              : lineup && lineup.rows.length > 0
                ? `<ol class="gigs">
                     ${lineup.rows
                       .map(
                         (gig) => `
                       <li class="gig">
                         <div class="gig-head">
                           <span class="when">${escape(when(gig))}</span>
                           <span class="where">${escape(gig.venue)}${gig.district && gig.district !== lineup.city.name ? `, ${escape(gig.district)}` : ''}</span>
                         </div>
                         <p class="who">${gig.artists.map((artist) => escape(artist)).join(' + ')}</p>
                         <ul class="songs">
                           ${gig.songs
                             .map(
                               (song) => `<li><span class="artist">${escape(song.artist)}</span>${song.title ? ` &mdash; <span class="song">${escape(song.title)}</span>` : ' <span class="song none">no song found</span>'}</li>`,
                             )
                             .join('')}
                         </ul>
                       </li>`,
                       )
                       .join('')}
                   </ol>
                   <p class="fineprint">Gigs from ${escape(lineup.rows[0]?.source ?? 'Ticketmaster')}. Songs from Deezer.</p>`
                : `<p class="empty">Nothing to show yet.<br /><span>Search for a city above.</span></p>`
        }
      </section>
    </main>
  `;

  const input = app.querySelector<HTMLInputElement>('#q');
  input?.addEventListener('input', (event) => {
    state.query = (event.target as HTMLInputElement).value;
    void findCities(state.query);
  });
  input?.addEventListener('keydown', (event) => {
    if ((event as KeyboardEvent).key === 'Enter' && state.cities.length > 0) {
      event.preventDefault();
      const first = state.cities[0];
      pick(first);
    }
  });
  input?.addEventListener('focus', () => {
    if (state.cities.length > 0) {
      state.open = true;
      render();
    }
  });

  app.querySelectorAll<HTMLButtonElement>('[data-city]').forEach((button) => {
    button.addEventListener('click', () => {
      const [name, countryName, region, lat, lon] = (button.dataset.city ?? '').split('|');
      const city = state.cities.find((entry) => entry.name === name && String(entry.lat) === lat);
      pick(
        city ?? {
          name,
          countryName,
          region,
          lat: Number(lat),
          lon: Number(lon),
          country: '',
        },
      );
    });
  });

  app.querySelectorAll<HTMLButtonElement>('button[data-week]').forEach((button) => {
    button.addEventListener('click', () => {
      state.week = button.dataset.week === 'next' ? 'next' : 'this';
      void load();
    });
  });
};

void (async () => {
  const response = await fetch('/api/cities?q=Berlin').catch(() => null);
  if (response?.ok) {
    const body = (await response.json()) as { cities: City[] };
    const berlin = body.cities?.[0];
    if (berlin) {
      pick(berlin);
      return;
    }
  }
  render();
})();

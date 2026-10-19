import './styles.css';

/**
 * Pick any city in the world, pick a week, read the list.
 *
 * Each row is a gig: day, date and time, venue, who is playing, and one song by each
 * of them. No players, no exports, no accounts.
 */

type City = { name: string; country: string; countryName: string; region: string; lat: number; lon: number };
type Song = { artist: string; title: string | null; album?: string | null; preview?: string | null };
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
    renderSuggest();
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
  /* Only the dropdown is redrawn: re-rendering the page would take the caret with it. */
  renderSuggest();
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

const renderSuggest = (): void => {
  const host = app.querySelector<HTMLDivElement>('#suggest');
  if (!host) return;

  if (!state.open) {
    host.innerHTML = '';
    return;
  }

  if (state.cities.length === 0) {
    host.innerHTML =
      state.query.trim().length >= 2
        ? `<p class="suggest empty-suggest">No city found for &ldquo;${escape(state.query.trim())}&rdquo;.</p>`
        : '';
    return;
  }

  host.innerHTML = `<ul class="suggest" role="listbox">
    ${state.cities
      .map(
        (city, index) =>
          `<li role="option"><button type="button" data-index="${index}">${escape(label(city))}</button></li>`,
      )
      .join('')}
  </ul>`;

  host.querySelectorAll<HTMLButtonElement>('button[data-index]').forEach((button) => {
    button.addEventListener('click', () => {
      const city = state.cities[Number(button.dataset.index ?? '0')];
      if (city) pick(city);
    });
  });
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
      <p class="wordmark">who's playing?</p>
      <p class="tag">Every gig in town this week, with one song from everyone on the bill.</p>
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
              aria-expanded="${state.open}"
            />
          </label>
          <div id="suggest"></div>
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

      <div class="nowbar" id="nowbar" hidden>
        <span class="nowlabel" id="nowlabel"></span>
        <audio id="audio" controls preload="metadata"></audio>
      </div>

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
                         <div class="when">${escape(when(gig))}</div>
                         <div class="body">
                           <p class="who">${gig.artists.map((artist) => escape(artist)).join(' + ')}</p>
                           <p class="where">${escape(gig.venue)}${gig.district && gig.district !== lineup.city.name ? ` &middot; ${escape(gig.district)}` : ''}</p>
                         <ul class="songs">
                           ${gig.songs
                             .map(
                               (song) => `<li class="${song.preview ? 'playable' : ''}" data-artist="${escape(song.artist)}" data-title="${escape(song.title ?? '')}"><span class="play" aria-hidden="true">${song.preview ? '\u25B6' : ''}</span><span class="artist">${escape(song.artist)}</span>${song.title ? `<span class="dash">&mdash;</span><span class="song">${escape(song.title)}</span>` : '<span class="song none">no song found</span>'}</li>`,
                             )
                             .join('')}
                           </ul>
                         </div>
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
      renderSuggest();
    }
  });

  renderSuggest();

  const allSongs = (lineup?.rows ?? []).flatMap((gig) => gig.songs);

  app.querySelectorAll<HTMLLIElement>('.songs li.playable').forEach((row) => {
    row.addEventListener('click', () => {
      const artist = row.dataset.artist ?? '';
      const title = row.dataset.title ?? '';
      const chosen = allSongs.find((song) => song.artist === artist && (song.title ?? '') === title && song.preview);
      if (!chosen?.preview) return;

      const audio = app.querySelector<HTMLAudioElement>('#audio');
      const bar = app.querySelector<HTMLElement>('#nowbar');
      const labelEl = app.querySelector<HTMLElement>('#nowlabel');
      if (audio) {
        audio.src = chosen.preview;
        audio.load();
        void audio.play().catch(() => {
          /* the controls are right there if the browser wants a press */
        });
      }
      if (bar) bar.hidden = false;
      if (labelEl) labelEl.textContent = `${chosen.artist} \u2014 ${chosen.title ?? ''}`;
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
  const berlin: City = { name: 'Berlin', country: 'DE', countryName: 'Germany', region: 'Berlin', lat: 52.5170365, lon: 13.3888599 };
  const response = await fetch('/api/cities?q=Berlin').catch(() => null);
  if (response?.ok) {
    const body = (await response.json()) as { cities: City[] };
    pick(body.cities?.[0] ?? berlin);
    return;
  }
  pick(berlin);
})();

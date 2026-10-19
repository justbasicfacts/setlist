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

/** Where the API lives. Empty in development, the deployed URL in production. */
const API = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '');

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
    const response = await fetch(`${API}/api/cities?q=${encodeURIComponent(query.trim())}`);
    if (!response.ok) throw new Error('no search');
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
    const response = await fetch(`${API}/api/lineup?${params.toString()}`);
    const raw = await response.text();
    let body: Lineup & { error?: string };
    try {
      body = JSON.parse(raw) as Lineup & { error?: string };
    } catch {
      throw new Error('The API is not answering yet. Deploy the backend and set VITE_API_BASE.');
    }
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
  try {
    localStorage.setItem('whosplaying:city', JSON.stringify(city));
  } catch {
    /* private mode: the choice just does not survive the visit */
  }
  state.city = city;
  state.query = '';
  state.cities = [];
  state.open = false;
  state.lineup = null;
  void load();
};

/* --------------------------------------------------------------- player --- */

let queue: Song[] = [];
let position = -1;

let frame: HTMLIFrameElement | null = null;

/** The frame, with the API channel open so it reports when a video ends. */
const showVideo = (id: string | null, searchUrl: string): void => {
  const host = app.querySelector<HTMLElement>('#yt');
  if (!host) return;

  if (!id) {
    host.innerHTML = `<p class="noembed">No video found. <a href="${searchUrl}" target="_blank" rel="noopener">Search YouTube</a>.</p>`;
    frame = null;
    return;
  }

  host.innerHTML = '';
  const element = document.createElement('iframe');
  element.title = 'YouTube player';
  element.width = '100%';
  element.height = '152';
  element.allow = 'autoplay; encrypted-media; picture-in-picture';
  element.setAttribute('allowfullscreen', '');
  element.src = `https://www.youtube.com/embed/${id}?enablejsapi=1&autoplay=1&rel=0&origin=${encodeURIComponent(window.location.origin)}`;
  host.append(element);
  frame = element;

  /* Ask the player to report state changes; this is what the JS api does internally. */
  element.addEventListener('load', () => {
    element.contentWindow?.postMessage(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }), '*');
  });
};

/* playerState 0 means the video ended. */
window.addEventListener('message', (event: MessageEvent) => {
  if (!String(event.origin).includes('youtube.com')) return;
  try {
    const data = JSON.parse(String(event.data)) as { info?: { playerState?: number } };
    if (data?.info?.playerState === 0) void playAt(position + 1);
  } catch {
    /* not a player message */
  }
});

const stopPlaying = (): void => {
  const host = app.querySelector<HTMLElement>('#yt');
  if (host) host.innerHTML = '';
  frame = null;
  const bar = app.querySelector<HTMLElement>('#nowbar');
  if (bar) bar.hidden = true;
  app.querySelectorAll<HTMLLIElement>('.songs li').forEach((row) => row.classList.remove('playing'));
};

const playAt = async (index: number): Promise<void> => {
  const tracks = (state.lineup?.rows ?? []).flatMap((gig) => gig.songs).filter((song): song is Song & { title: string } => !!song.title);
  if (index < 0 || index >= tracks.length) return;

  queue = tracks;
  position = index;
  const song = tracks[index];

  const bar = app.querySelector<HTMLElement>('#nowbar');
  const labelEl = app.querySelector<HTMLElement>('#nowlabel');
  if (bar) bar.hidden = false;
  if (labelEl) labelEl.textContent = `${song.artist} \u2014 ${song.title}`;

  const term = encodeURIComponent(`${song.artist} ${song.title}`);
  const services = app.querySelector<HTMLElement>('#services');
  if (services) {
    services.innerHTML = [
      ['YouTube', `https://www.youtube.com/results?search_query=${term}`],
      ['Spotify', `https://open.spotify.com/search/${term}`],
      ['Apple Music', `https://music.apple.com/search?term=${term}`],
      ['Deezer', `https://www.deezer.com/search/${term}`],
      ['Bandcamp', `https://bandcamp.com/search?q=${term}`],
    ]
      .map(([name, href]) => `<a href="${href}" target="_blank" rel="noopener">${name}</a>`)
      .join('');
  }

  app.querySelectorAll<HTMLLIElement>('.songs li').forEach((row) => row.classList.remove('playing'));
  app.querySelectorAll<HTMLLIElement>('.songs li.playable')[index]?.classList.add('playing');

  try {
    const response = await fetch(`${API}/api/youtube?q=${term}`);
    const body = (await response.json()) as { id: string | null };
    showVideo(body.id, `https://www.youtube.com/results?search_query=${term}`);
  } catch {
    showVideo(null, `https://www.youtube.com/results?search_query=${term}`);
  }
};

const render = (): void => {
  const lineup = state.lineup;
  const heading = lineup?.heading ?? (state.week === 'next' ? 'next week' : 'this week');
  const cityName = state.city?.name ?? 'anywhere';
  const songs = lineup?.rows.flatMap((gig) => gig.songs).filter((song) => song.title) ?? [];

  app.innerHTML = `
    <div class="marquee" aria-hidden="true">
      <div class="marquee-track">
        ${Array.from({ length: 2 })
          .map(
            () =>
              `<span>who's playing?</span><span>&#9733;</span><span>every gig in town this week</span><span>&#9733;</span><span>one song each</span><span>&#9733;</span><span>zero research</span><span>&#9733;</span><span>lineups change on mondays</span><span>&#9733;</span>`,
          )
          .join('')}
      </div>
    </div>

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
        ${state.lineup?.rows.length ? `<button type="button" class="playall" id="playall">&#9654; play all</button>` : ''}
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
        <nav class="services" id="services" aria-label="Play this song elsewhere"></nav>
        <button type="button" class="closebar" id="closebar" aria-label="Close player">&times;</button>
        <button type="button" class="nextsong" id="nextsong">next &#9654;</button>
        <button type="button" class="collapsebar" id="collapsebar" aria-label="Collapse player">&#9662;</button>
        <div id="yt"></div>
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
                               (song) => `<li class="${song.title ? 'playable' : ''}" data-artist="${escape(song.artist)}" data-title="${escape(song.title ?? '')}"><span class="play" aria-hidden="true">${song.title ? '\u25B6' : ''}</span><span class="artist">${escape(song.artist)}</span>${song.title ? `<span class="dash">&mdash;</span><span class="song">${escape(song.title)}</span>` : '<span class="song none">no song found</span>'}</li>`,
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

  const tracks = (lineup?.rows ?? []).flatMap((gig) => gig.songs).filter((song) => !!song.title);

  app.querySelectorAll<HTMLLIElement>('.songs li.playable').forEach((row) => {
    row.addEventListener('click', () => {
      const index = tracks.findIndex(
        (song) => song.artist === (row.dataset.artist ?? '') && (song.title ?? '') === (row.dataset.title ?? ''),
      );
      if (index >= 0) void playAt(index);
    });
  });

  app.querySelector<HTMLButtonElement>('#playall')?.addEventListener('click', () => void playAt(0));
  app.querySelector<HTMLButtonElement>('#closebar')?.addEventListener('click', () => stopPlaying());
  app.querySelector<HTMLButtonElement>('#nextsong')?.addEventListener('click', () => void playAt(position + 1));
  app.querySelector<HTMLButtonElement>('#collapsebar')?.addEventListener('click', (event) => {
    const bar = app.querySelector<HTMLElement>('#nowbar');
    if (!bar) return;
    const collapsed = bar.classList.toggle('collapsed');
    (event.currentTarget as HTMLElement).textContent = collapsed ? '\u25B4' : '\u25BE';
  });

  app.querySelectorAll<HTMLButtonElement>('button[data-week]').forEach((button) => {
    button.addEventListener('click', () => {
      state.week = button.dataset.week === 'next' ? 'next' : 'this';
      void load();
    });
  });
};

/** The browser's own position, turned into a city by the server. */
const askForLocation = async (): Promise<City | null> => {
  if (!('geolocation' in navigator)) return null;

  const position = await new Promise<GeolocationPosition | null>((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (found) => resolve(found),
      () => resolve(null),
      { timeout: 8000, maximumAge: 300_000, enableHighAccuracy: false },
    );
  });
  if (!position) return null;

  try {
    const response = await fetch(
      `${API}/api/reverse?lat=${position.coords.latitude}&lon=${position.coords.longitude}`,
    );
    if (!response.ok) return null;
    const body = (await response.json()) as { city: City | null };
    return body.city ?? null;
  } catch {
    return null;
  }
};

void (async () => {
  /* A city chosen before wins: no prompt, no surprise change of place. */
  try {
    const saved = localStorage.getItem('whosplaying:city');
    if (saved) {
      const city = JSON.parse(saved) as City;
      if (city?.name && Number.isFinite(city.lat) && Number.isFinite(city.lon)) {
        pick(city);
        return;
      }
    }
  } catch {
    /* unreadable storage: fall through to asking */
  }

  /* Nothing chosen yet, so ask: the browser decides whether to show the prompt. */
  const located = await askForLocation();
  if (located) {
    pick(located);
    return;
  }

  const berlin: City = { name: 'Berlin', country: 'DE', countryName: 'Germany', region: 'Berlin', lat: 52.5170365, lon: 13.3888599 };
  const response = await fetch(`${API}/api/cities?q=Berlin`).catch(() => null);
  if (response?.ok) {
    const body = (await response.json()) as { cities: City[] };
    pick(body.cities?.[0] ?? berlin);
    return;
  }
  pick(berlin);
})();

import './styles.css';

/**
 * City, week, and the week's music, playing in the page.
 *
 * Nothing to sign into and nothing to authorise: the server reads the lineups and one
 * track per artist, and this page plays the preview inline. The list stays a list,
 * every row swaps the same player.
 */

const CITIES = ['Berlin', 'London', 'Amsterdam', 'Dublin'];

type Track = {
  id: string;
  title: string;
  artist: string;
  album?: string | null;
  artwork?: string | null;
  preview: string;
  url: string;
  spotify: string;
};

type Lineup = {
  city: string;
  week: 'this' | 'next';
  start: string;
  end: string;
  label: string;
  heading: string;
  events: number;
  tracks: Track[];
  eventsList?: { day: string; venue: string; artists: string[] }[];
  empty?: boolean;
};

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('No #app to render into');

const state: {
  city: string;
  week: 'this' | 'next';
  lineup: Lineup | null;
  status: 'loading' | 'ok' | 'error';
  message: string;
  current: number;
  copied: boolean;
} = {
  city: 'Berlin',
  week: 'this',
  lineup: null,
  status: 'loading',
  message: '',
  current: 0,
  copied: false,
};

const escape = (value: string): string =>
  value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] as string);

let run = 0;

const load = async (): Promise<void> => {
  const token = ++run;
  state.status = 'loading';
  state.message = '';
  state.current = 0;
  render();

  try {
    const response = await fetch(`/api/lineup?city=${encodeURIComponent(state.city)}&week=${state.week}`);
    const body = (await response.json()) as Lineup & { error?: string };
    if (token !== run) return;
    if (!response.ok) throw new Error(body.error ?? `the server answered ${response.status}`);

    state.lineup = body;
    state.status = 'ok';
  } catch (error) {
    if (token !== run) return;
    state.status = 'error';
    state.message = error instanceof Error ? error.message : String(error);
  }
  render();
};

const currentTrack = (): Track | null => {
  const tracks = state.lineup?.tracks ?? [];
  return tracks[state.current] ?? tracks[0] ?? null;
};

/** Swap the player in place so clicking a row does not rebuild the page. */
const play = (index: number): void => {
  const track = state.lineup?.tracks[index];
  if (!track) return;
  state.current = index;

  const audio = app.querySelector<HTMLAudioElement>('#audio');
  if (audio) {
    audio.src = track.preview;
    void audio.play().catch(() => {
      /* autoplay rules: the controls are right there */
    });
  }

  app.querySelectorAll<HTMLLIElement>('.tracks li').forEach((row, position) => {
    row.classList.toggle('playing', position === index);
  });

  const now = app.querySelector<HTMLElement>('#now');
  if (now) now.innerHTML = `<b>${escape(track.title)}</b> <span class="a">${escape(track.artist)}</span>`;

  const meta = app.querySelector<HTMLElement>('#meta');
  if (meta) meta.textContent = [track.album, '30 second preview'].filter(Boolean).join(' · ');

  const art = app.querySelector<HTMLImageElement>('#art');
  if (art) {
    art.src = track.artwork ?? '';
    art.hidden = !track.artwork;
  }

  const deezer = app.querySelector<HTMLAnchorElement>('#open');
  if (deezer) deezer.href = track.url;

  const spotify = app.querySelector<HTMLAnchorElement>('#spotify');
  if (spotify) spotify.href = track.spotify;
};

/** The playlist's address: the same city and week, so the link opens what you see. */
const playlistLink = (): string => {
  const url = new URL(window.location.href);
  url.search = new URLSearchParams({ city: state.city, week: state.week }).toString();
  return url.toString();
};

const copyList = async (): Promise<void> => {
  const tracks = state.lineup?.tracks ?? [];
  if (tracks.length === 0) return;
  try {
    await navigator.clipboard.writeText(playlistLink());
    state.copied = true;
    render();
    window.setTimeout(() => {
      state.copied = false;
      render();
    }, 2000);
  } catch {
    state.message = 'The clipboard refused. Select the list instead.';
    render();
  }
};

const render = (): void => {
  const lineup = state.lineup;
  const tracks = lineup?.tracks ?? [];
  const playing = currentTrack();
  const heading = lineup?.heading ?? (state.week === 'next' ? 'next week' : 'this week');
  const label = lineup?.label ?? '';
  const artists = new Set((lineup?.eventsList ?? []).flatMap((event) => event.artists));

  app.innerHTML = `
    <header class="bar">
      <div class="brand"><span class="badge">WP</span><span class="name">Who's Playing?</span></div>
      <p class="tag">A playlist from whoever happens to be in town. Zero research.</p>
    </header>

    <main>
      <section class="controls" aria-label="City and week">
        <label class="field">
          <span>City</span>
          <select id="city">
            ${CITIES.map((option) => `<option value="${escape(option)}"${option === state.city ? ' selected' : ''}>${escape(option)}</option>`).join('')}
          </select>
        </label>
        <div class="weeks" role="group" aria-label="Which week">
          <button type="button" data-week="this" class="${state.week === 'this' ? 'on' : ''}">This week</button>
          <button type="button" data-week="next" class="${state.week === 'next' ? 'on' : ''}">Next week</button>
        </div>
        <span class="dates">${escape(label)}</span>
        <span class="sticker">this week's lineup</span>
      </section>

      <section class="hero">
        <h1>${escape(state.city)},<br /><em>${escape(heading)}</em></h1>
        <p class="count">${
          state.status === 'loading'
            ? 'Working out who is in town&hellip;'
            : lineup && !lineup.empty
              ? `<b>${tracks.length}</b> tracks &middot; <b>${artists.size}</b> artists &middot; <b>0</b> decisions by you`
              : 'Nobody playing, nothing to play'
        }</p>
        <p class="why">
          One song from every artist playing in ${escape(state.city)} ${escape(heading)}, in gig order.
          Pick any row to hear it. Nothing to sign up for.
        </p>
        ${state.message ? `<p class="problem">${escape(state.message)}</p>` : ''}
      </section>

      <section class="panel single">
        ${
          state.status === 'loading'
            ? `<p class="empty">Checking the listings&hellip;<br /><span>then one track per artist.</span></p>`
            : lineup?.empty
              ? `<p class="empty">No gigs in ${escape(state.city)} ${escape(heading)}.<br /><span>Try the other week, or another city.</span></p>`
              : playing
                ? `<div class="player">
                     <div class="player-top">
                       ${playing.artwork ? `<img class="art" id="art" src="${escape(playing.artwork)}" alt="" />` : '<img class="art" id="art" alt="" hidden />'}
                       <div class="player-now">
                         <p id="now"><b>${escape(playing.title)}</b> <span class="a">${escape(playing.artist)}</span></p>
                         <p id="meta" class="sub">${escape([playing.album, '30 second preview'].filter(Boolean).join(' · '))}</p>
                       </div>
                       <div class="player-actions">
                         <a class="shuffle" id="open" href="${escape(playing.url)}" target="_blank" rel="noopener">Deezer</a>
                         <a class="shuffle" id="spotify" href="${escape(playing.spotify)}" target="_blank" rel="noopener">Find on Spotify</a>
                         <a class="shuffle" id="m3u" href="/api/playlist.m3u?city=${encodeURIComponent(state.city)}&week=${state.week}">Playlist file</a>
                         <button type="button" class="shuffle" id="copy">${state.copied ? 'Link copied' : 'Copy link'}</button>
                       </div>
                     </div>
                     <audio id="audio" controls preload="none" src="${escape(playing.preview)}"></audio>
                   </div>
                   <ol class="tracks selectable">
                     ${tracks
                       .map(
                         (track, index) => `
                       <li data-index="${index}" class="${index === state.current ? 'playing' : ''}">
                         <span class="n">${String(index + 1).padStart(2, '0')}</span>
                         <span class="t">
                           <b>${escape(track.title)}</b>
                           <span class="a">${escape(track.artist)}</span>
                         </span>
                         <span class="play" aria-hidden="true">&#9654;</span>
                       </li>`,
                       )
                       .join('')}
                   </ol>`
                : `<p class="empty">Nothing came back.<br /><span>${escape(state.message || 'Try another week.')}</span></p>`
        }
      </section>

      <p class="fineprint">
        Lineups from the Ticketmaster Discovery API. Tracks and 30 second previews from Deezer's
        public catalogue. Spotify links carry the artist and title to a search, because building
        an actual playlist there needs an approval we are not asking anyone for.
      </p>
    </main>
  `;

  app.querySelector<HTMLSelectElement>('#city')?.addEventListener('change', (event) => {
    state.city = (event.target as HTMLSelectElement).value;
    void load();
  });

  app.querySelectorAll<HTMLButtonElement>('button[data-week]').forEach((button) => {
    button.addEventListener('click', () => {
      state.week = button.dataset.week === 'next' ? 'next' : 'this';
      void load();
    });
  });

  app.querySelectorAll<HTMLLIElement>('.tracks.selectable li').forEach((row) => {
    row.addEventListener('click', () => play(Number(row.dataset.index ?? '0')));
  });

  app.querySelector<HTMLButtonElement>('#copy')?.addEventListener('click', () => void copyList());
};

/* A shared link carries the city and week with it. */
const params = new URLSearchParams(window.location.search);
if (CITIES.includes(params.get('city') ?? '')) state.city = params.get('city') as string;
if (params.get('week') === 'next') state.week = 'next';

void load().then(() => {
  window.history.replaceState({}, '', playlistLink());
});

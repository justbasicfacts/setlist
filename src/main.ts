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
  weeks: { this: Lineup | null; next: Lineup | null } | null;
  status: 'loading' | 'ok' | 'error';
  message: string;
  current: number;
  copied: 'tracks' | 'link' | null;
} = {
  city: 'Berlin',
  week: 'this',
  lineup: null,
  weeks: null,
  status: 'loading',
  message: '',
  current: 0,
  copied: null,
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
    /* One request per city: the server prepares this week and next week together. */
    const response = await fetch(`/api/city?city=${encodeURIComponent(state.city)}`);
    const body = (await response.json()) as {
      city: string;
      this: Lineup;
      next: Lineup;
      error?: string;
    };
    if (token !== run) return;
    if (!response.ok) throw new Error(body.error ?? `the server answered ${response.status}`);

    state.weeks = { this: body.this, next: body.next };
    state.lineup = state.weeks[state.week];
    state.status = 'ok';
  } catch (error) {
    if (token !== run) return;
    state.status = 'error';
    state.message = error instanceof Error ? error.message : String(error);
  }
  render();
};

/** Both weeks are already in hand, so switching costs nothing. */
const switchWeek = (week: 'this' | 'next'): void => {
  const next = state.weeks?.[week];
  if (!next) {
    state.week = week;
    void load();
    return;
  }
  state.week = week;
  state.lineup = next;
  state.current = 0;
  window.history.replaceState({}, '', playlistLink());
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

/** Clipboard with a fallback, because a refused write should not lose the list. */
const copyText = async (text: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    const copied = document.execCommand('copy');
    area.remove();
    return copied;
  }
};

const copy = async (what: 'tracks' | 'link'): Promise<void> => {
  const tracks = state.lineup?.tracks ?? [];
  if (tracks.length === 0) return;

  /* Spotify cannot read a playlist file, so the list is copied as text it can import. */
  const text =
    what === 'link' ? playlistLink() : tracks.map((track) => `${track.artist} - ${track.title}`).join('\n');

  const copied = await copyText(text);
  if (!copied) {
    state.message = 'The clipboard refused. Open the playlist link and copy the rows by hand.';
    render();
    return;
  }

  state.copied = what;
  render();
  window.setTimeout(() => {
    state.copied = null;
    render();
  }, 4000);
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
        ${
          state.weeks
            ? `<p class="also">${
                state.week === 'this'
                  ? `Next week is ready as well: <b>${state.weeks.next?.tracks.length ?? 0}</b> tracks. <button type="button" class="linkish" id="other">Show next week</button>`
                  : `This week is still here: <b>${state.weeks.this?.tracks.length ?? 0}</b> tracks. <button type="button" class="linkish" id="other">Show this week</button>`
              }</p>`
            : ''
        }
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
                         <button type="button" class="shuffle primary" id="tracks">${state.copied === 'tracks' ? 'Copied' : 'Send to Spotify'}</button>
                         <button type="button" class="shuffle" id="link">${state.copied === 'link' ? 'Link copied' : 'Playlist link'}</button>
                         <a class="shuffle" id="m3u" href="/api/playlist.m3u?city=${encodeURIComponent(state.city)}&week=${state.week}">For VLC</a>
                       </div>
                     </div>
                     <audio id="audio" controls preload="none" src="${escape(playing.preview)}"></audio>
                     ${
                       state.copied === 'tracks'
                         ? `<p class="howto">Copied ${tracks.length} tracks. Now paste it at
                              <a href="https://www.tunemymusic.com/" target="_blank" rel="noopener">TuneMyMusic</a>,
                              pick Spotify as the destination, and it becomes a real playlist. Netflix-style
                              one-time faff, no approval for this site.</p>`
                         : ''
                     }
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
    button.addEventListener('click', () => switchWeek(button.dataset.week === 'next' ? 'next' : 'this'));
  });

  app.querySelectorAll<HTMLLIElement>('.tracks.selectable li').forEach((row) => {
    row.addEventListener('click', () => play(Number(row.dataset.index ?? '0')));
  });

  app.querySelector<HTMLButtonElement>('#other')?.addEventListener('click', () => switchWeek(state.week === 'this' ? 'next' : 'this'));
  app.querySelector<HTMLButtonElement>('#tracks')?.addEventListener('click', () => void copy('tracks'));
  app.querySelector<HTMLButtonElement>('#link')?.addEventListener('click', () => void copy('link'));
};

/* A shared link carries the city and week with it. */
const params = new URLSearchParams(window.location.search);
if (CITIES.includes(params.get('city') ?? '')) state.city = params.get('city') as string;
if (params.get('week') === 'next') state.week = 'next';

void load().then(() => {
  window.history.replaceState({}, '', playlistLink());
});

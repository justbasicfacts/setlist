import './styles.css';

/**
 * City, week, and the week's tracks, playing in the page.
 *
 * No accounts and nothing to authorise: the server reads the public Spotify catalogue
 * with an app token, and the page plays the tracks through Spotify's embed. Every row
 * opens the same player, so the list stays a list.
 */

const CITIES = ['Berlin', 'London', 'Amsterdam', 'Dublin'];

type Track = {
  id: string;
  title: string;
  artist: string;
  url: string;
  embed: string;
  album?: string | null;
  artwork?: string | null;
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
  limited?: boolean;
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

/** Swap the player in place, so clicking a row does not rebuild the page. */
const play = (index: number): void => {
  const track = state.lineup?.tracks[index];
  if (!track) return;
  state.current = index;

  const frame = app.querySelector<HTMLIFrameElement>('#player');
  if (frame) frame.src = `${track.embed}?utm_source=generator&theme=0`;

  app.querySelectorAll<HTMLLIElement>('.tracks li').forEach((row, position) => {
    row.classList.toggle('playing', position === index);
  });

  const now = app.querySelector<HTMLElement>('#now');
  if (now) {
    now.innerHTML = `<b>${escape(track.title)}</b> <span class="a">${escape(track.artist)}</span>`;
  }

  const link = app.querySelector<HTMLAnchorElement>('#open');
  if (link) link.href = track.url;
};

const copyList = async (): Promise<void> => {
  const tracks = state.lineup?.tracks ?? [];
  if (tracks.length === 0) return;
  const text = tracks.map((track) => `${track.artist} - ${track.title}`).join('\n');
  try {
    await navigator.clipboard.writeText(text);
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
              ? tracks.length > 0
                ? `<b>${tracks.length}</b> tracks &middot; <b>${new Set(tracks.map((track) => track.artist)).size}</b> artists &middot; <b>0</b> decisions by you`
                : `<b>${lineup.events}</b> gigs &middot; <b>${new Set((lineup.eventsList ?? []).flatMap((event) => event.artists)).size}</b> artists &middot; tracks once Spotify's allowance resets`
              : 'Nobody playing, nothing to play'
        }</p>
        <p class="why">
          One song from every artist playing in ${escape(state.city)} ${escape(heading)}, in gig order.
          Pick any row to hear it. Nothing to sign up for.
        </p>
        ${state.message ? `<p class="problem">${escape(state.message)}</p>` : ''}
        ${lineup?.limited ? `<p class="problem">Spotify's daily allowance for this app is spent, so some tracks are missing until it resets. The lineup is unaffected.</p>` : ''}
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
                       <p id="now"><b>${escape(playing.title)}</b> <span class="a">${escape(playing.artist)}</span></p>
                       <div class="player-actions">
                         <a class="shuffle" id="open" href="${escape(playing.url)}" target="_blank" rel="noopener">Open in Spotify</a>
                         <button type="button" class="shuffle" id="copy">${state.copied ? 'Copied' : 'Copy list'}</button>
                       </div>
                     </div>
                     <iframe
                       id="player"
                       title="Spotify player"
                       src="${escape(playing.embed)}?utm_source=generator&theme=0"
                       width="100%"
                       height="152"
                       frameborder="0"
                       allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
                       loading="lazy"></iframe>
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
                : lineup && (lineup.eventsList?.length ?? 0) > 0
                  ? `<p class="empty">The lineup is in, the tracks are not.<br /><span>Spotify's daily allowance for this app is spent. The names below are still worth knowing.</span></p>
                     <ol class="tracks">
                       ${(lineup.eventsList ?? [])
                         .map(
                           (event, index) => `
                         <li>
                           <span class="n">${String(index + 1).padStart(2, '0')}</span>
                           <span class="t">
                             <b>${escape(event.artists.join(' + '))}</b>
                             <span class="a">${escape(event.day)} &middot; ${escape(event.venue)}</span>
                           </span>
                         </li>`,
                         )
                         .join('')}
                     </ol>`
                  : `<p class="empty">Nothing came back.<br /><span>${escape(state.message || 'Try another week.')}</span></p>`
        }
      </section>

      <p class="fineprint">
        Lineups from the Ticketmaster Discovery API. Tracks from the public Spotify catalogue,
        played through Spotify's own player. The enthusiasm is ours.
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
    const index = Number(row.dataset.index ?? '0');
    row.addEventListener('click', () => play(index));
  });

  app.querySelector<HTMLButtonElement>('#copy')?.addEventListener('click', () => void copyList());
};

/** Playlists cannot be created without a person approving once, so nothing asks. */
void load();

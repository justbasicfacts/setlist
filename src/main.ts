import { artistsIn, CITIES, fallbackTitle, fetchEvents, hasKey, weekHeading, weekRange, type Event, type Source, type Week } from './events';
import {
  activeSession,
  connect,
  ensurePlaylist,
  findTrack,
  finishConnect,
  madePlaylist,
  signOut,
  spotifyReady,
  type FoundTrack,
  type MadePlaylist,
  type Session,
} from './spotify';
import './styles.css';

/**
 * City, week, and a playlist in the visitor's own Spotify account. The page makes it,
 * links it, and refuses to make a second one for the same week.
 */

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('No #app to render into');

type State = {
  city: string;
  week: Week;
  events: Event[];
  source: Source;
  tracks: FoundTrack[];
  playlist: MadePlaylist | null;
  reused: boolean;
  session: Session | null;
  busy: boolean;
  problem: string;
  copied: boolean;
};

const state: State = {
  city: 'Berlin',
  week: 'this',
  events: [],
  source: 'sample',
  tracks: [],
  playlist: null,
  reused: false,
  session: null,
  busy: true,
  problem: '',
  copied: false,
};

const escape = (value: string): string =>
  value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] as string);

const playlistName = (city: string, week: Week): string =>
  `${city} · ${weekHeading(week)} · ${weekRange(week).label}`;

const playlistKey = (city: string, week: Week): string => {
  const { start } = weekRange(week);
  return `${city.trim().toLowerCase()}|${week}|${start.toISOString().slice(0, 10)}`;
};

let run = 0;

const build = async (): Promise<void> => {
  const token = ++run;
  state.busy = true;
  state.problem = '';
  state.tracks = [];
  state.playlist = null;
  state.reused = false;
  render();

  const found = await fetchEvents(state.city, state.week);
  const artists = artistsIn(found.events);

  const session = state.session;
  const tracks: FoundTrack[] = [];

  if (session) {
    for (const artist of artists) {
      tracks.push(await findTrack(session.accessToken, artist, fallbackTitle(artist)));
    }
  }

  if (token !== run) return;

  state.events = found.events;
  state.source = found.source;
  state.tracks = tracks;
  state.problem = found.problem ?? '';

  if (session && tracks.length > 0) {
    try {
      const uris = tracks.map((track) => track.uri).filter((uri): uri is string => !!uri);
      const made = await ensurePlaylist(
        session,
        playlistKey(state.city, state.week),
        playlistName(state.city, state.week),
        'Generated from whoever is playing that week. No decisions were made.',
        uris,
      );
      if (token !== run) return;
      state.playlist = made.playlist;
      state.reused = made.reused;
    } catch (error) {
      if (token !== run) return;
      state.problem = error instanceof Error ? error.message : 'Spotify refused';
    }
  }

  state.busy = false;
  render();
};

const copy = async (): Promise<void> => {
  if (!state.playlist) return;
  try {
    await navigator.clipboard.writeText(state.playlist.url);
    state.copied = true;
    render();
    window.setTimeout(() => {
      state.copied = false;
      render();
    }, 2000);
  } catch {
    state.problem = 'The clipboard refused. Select the link instead.';
    render();
  }
};

const whatsMissing = (): string | null => {
  if (!spotifyReady) return 'Set SPOTIFY_CLIENT_ID in .env and register the redirect URI, then restart.';
  if (!state.session) return null;
  return null;
};

const render = (): void => {
  const known = madePlaylist(playlistKey(state.city, state.week));
  const sticker = state.source === 'ticketmaster' ? 'live from Ticketmaster' : hasKey ? 'sample lineups' : 'sample lineups - no API key';

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
        <span class="dates">${weekRange(state.week).label}</span>
        <span class="sticker">${escape(sticker)}</span>
      </section>

      <section class="hero">
        <h1>${escape(state.city)},<br /><em>${weekHeading(state.week)}</em></h1>
        ${
          state.busy
            ? `<p class="count">Making the playlist&hellip;</p>`
            : `<p class="count"><b>${state.tracks.length}</b> tracks &middot; <b>${new Set(state.events.flatMap((event) => event.artists)).size}</b> artists &middot; <b>0</b> decisions by you</p>`
        }
        <p class="why">
          One song from every artist playing in ${escape(state.city)} ${weekHeading(state.week)}, in gig order,
          written into a Spotify playlist so you can send it to whoever you are going with.
        </p>
        ${state.problem ? `<p class="problem">${escape(state.problem)}</p>` : ''}
        ${whatsMissing() ? `<p class="problem">${escape(whatsMissing()!)}</p>` : ''}
      </section>

      <section class="panel single">
        <h2>The playlist <span class="hint">generated, not curated</span></h2>

        ${
          !spotifyReady
            ? `<p class="empty">Spotify is not set up.<br /><span>Add SPOTIFY_CLIENT_ID to .env and register http://localhost:5180/ as a redirect URI.</span></p>`
            : !state.session
              ? `<div class="connect-block">
                   <p class="empty">Connect once and we make the playlist in your account.<br /><span>We only create playlists and read your name. That is the lot.</span></p>
                   <button type="button" class="shuffle big" id="connect">Connect Spotify</button>
                 </div>`
              : state.busy
                ? `<p class="empty">Asking ${escape(state.session.displayName)}&rsquo;s Spotify&hellip;<br /><span>one track per artist, then straight into a playlist.</span></p>`
                : state.playlist
                  ? `<div class="share">
                       <div>
                         <p class="share-label">${state.reused ? 'Already made for this week, so we left it alone' : 'Created just now'}</p>
                         <a class="share-link" href="${escape(state.playlist.url)}" target="_blank" rel="noopener">Open in Spotify</a>
                         <p class="share-url">${escape(state.playlist.url)}</p>
                       </div>
                       <button type="button" class="shuffle" id="copy">${state.copied ? 'Copied' : 'Copy link'}</button>
                     </div>
                     <ol class="tracks">
                       ${state.tracks
                         .map(
                           (track, index) => `
                         <li>
                           <span class="n">${String(index + 1).padStart(2, '0')}</span>
                           <span class="t">
                             ${track.url ? `<b><a href="${escape(track.url)}" target="_blank" rel="noopener">${escape(track.title)}</a></b>` : `<b>${escape(track.title)}</b>`}
                             <span class="a">${escape(track.artist)}</span>
                           </span>
                         </li>`,
                         )
                         .join('')}
                     </ol>`
                  : `<p class="empty">Nothing to put on it.<br /><span>No gigs, no playlist. Try another week.</span></p>`
        }

        ${
          state.session
            ? `<p class="aside">Connected as ${escape(state.session.displayName)}. <button type="button" class="linkish" id="disconnect">Disconnect</button></p>`
            : ''
        }
        ${known && !state.playlist && !state.busy && state.session ? `<p class="aside">There is a playlist from earlier (${escape(known.id)}), but Spotify would not return it. A new one will be made.</p>` : ''}
      </section>

      <p class="fineprint">
        Lineups ${state.source === 'ticketmaster' ? 'from the Ticketmaster Discovery API' : 'are invented for the sample cities'}.
        Titles and the playlist are Spotify's. The enthusiasm is ours.
      </p>
    </main>
  `;

  app.querySelector<HTMLSelectElement>('#city')?.addEventListener('change', (event) => {
    state.city = (event.target as HTMLSelectElement).value;
    void build();
  });

  app.querySelectorAll<HTMLButtonElement>('button[data-week]').forEach((button) => {
    button.addEventListener('click', () => {
      state.week = button.dataset.week === 'next' ? 'next' : 'this';
      void build();
    });
  });

  app.querySelector<HTMLButtonElement>('#connect')?.addEventListener('click', () => {
    void connect().catch((error: Error) => {
      state.problem = error.message;
      render();
    });
  });

  app.querySelector<HTMLButtonElement>('#copy')?.addEventListener('click', () => void copy());

  app.querySelector<HTMLButtonElement>('#disconnect')?.addEventListener('click', () => {
    signOut();
    state.session = null;
    state.playlist = null;
    state.tracks = [];
    render();
  });
};

/** Connect a returning redirect, then build. */
void (async () => {
  try {
    state.session = await finishConnect();
    if (state.session) state.session = await activeSession();
  } catch (error) {
    state.problem = error instanceof Error ? error.message : 'The Spotify login failed';
  }
  await build();
})();

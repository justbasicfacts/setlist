import './styles.css';

/**
 * City, week, playlist.
 *
 * Everything else happens on the server: it holds the Spotify authorisation, finds
 * whoever is playing that week, and keeps one playlist per city and week. This page
 * asks for it and puts the player on screen.
 */

const CITIES = ['Berlin', 'London', 'Lisbon'];

type Track = { title: string; artist: string; url?: string | null };

type Playlist = {
  city: string;
  week: 'this' | 'next';
  label: string;
  heading: string;
  id: string | null;
  url: string | null;
  name: string | null;
  tracks: Track[];
  embed: string | null;
  created: boolean;
  empty?: boolean;
};

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('No #app to render into');

const state: {
  city: string;
  week: 'this' | 'next';
  playlist: Playlist | null;
  status: 'loading' | 'ok' | 'unauthorised' | 'error';
  message: string;
  copied: boolean;
  setup: boolean;
} = {
  city: 'Berlin',
  week: 'this',
  playlist: null,
  status: 'loading',
  message: '',
  copied: false,
  setup: false,
};

const escape = (value: string): string =>
  value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] as string);

let run = 0;

const load = async (): Promise<void> => {
  const token = ++run;
  state.status = 'loading';
  state.message = '';
  render();

  try {
    const response = await fetch(`/api/playlist?city=${encodeURIComponent(state.city)}&week=${state.week}`);
    if (token !== run) return;

    if (response.status === 401) {
      state.status = 'unauthorised';
      state.playlist = null;
      render();
      return;
    }

    const body = (await response.json()) as Playlist & { error?: string };
    if (!response.ok) throw new Error(body.error ?? `the server answered ${response.status}`);

    state.playlist = body;
    state.status = 'ok';
  } catch (error) {
    if (token !== run) return;
    state.status = 'error';
    state.message = error instanceof Error ? error.message : String(error);
  }
  render();
};

const copy = async (): Promise<void> => {
  if (!state.playlist?.url) return;
  try {
    await navigator.clipboard.writeText(state.playlist.url);
    state.copied = true;
    render();
    window.setTimeout(() => {
      state.copied = false;
      render();
    }, 2000);
  } catch {
    state.status = 'error';
    state.message = 'The clipboard refused. Select the link instead.';
    render();
  }
};

const stats = (playlist: Playlist): string => {
  const artists = new Set(playlist.tracks.map((track) => track.artist)).size;
  return `<b>${playlist.tracks.length}</b> tracks &middot; <b>${artists}</b> artists &middot; <b>0</b> decisions by you`;
};

const render = (): void => {
  const playlist = state.playlist;
  const heading = playlist?.heading ?? (state.week === 'next' ? 'next week' : 'this week');
  const label = playlist?.label ?? '';

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
        <span class="sticker">made for you, weekly</span>
      </section>

      <section class="hero">
        <h1>${escape(state.city)},<br /><em>${escape(heading)}</em></h1>
        <p class="count">${
          state.status === 'loading'
            ? 'Putting the playlist together&hellip;'
            : state.status === 'unauthorised'
              ? 'Not switched on yet'
              : playlist && !playlist.empty
                ? stats(playlist)
                : 'Nobody playing, nothing to play'
        }</p>
        <p class="why">
          One song from every artist playing in ${escape(state.city)} ${escape(heading)}, in gig order,
          in a Spotify playlist you can play here or send to whoever you are going with.
        </p>
        ${state.message ? `<p class="problem">${escape(state.message)}</p>` : ''}
      </section>

      <section class="panel single">
        ${
          state.status === 'loading'
            ? `<p class="empty">Working on it&hellip;<br /><span>one track per artist, then the player appears.</span></p>`
            : state.status === 'unauthorised'
              ? `<p class="empty">Playlists are not switched on yet.<br /><span>One approval by whoever runs the site, then every city and week fills itself in.</span></p>
                 ${state.setup ? `<p class="aside"><a class="setup-link" href="/auth">Authorise Spotify now</a></p>` : ''}`
              : playlist?.empty
                ? `<p class="empty">No gigs in ${escape(state.city)} ${escape(heading)}.<br /><span>Try the other week, or another city.</span></p>`
                : playlist?.embed
                  ? `<div class="embed">
                       <iframe
                         title="${escape(playlist.name ?? 'Playlist')}"
                         src="${escape(playlist.embed)}"
                         width="100%"
                         height="420"
                         frameborder="0"
                         allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
                         loading="lazy"></iframe>
                     </div>
                     <div class="share">
                       <div>
                         <p class="share-label">${playlist.created ? 'Made just now, for this week' : 'Made earlier, left alone'}</p>
                         <a class="share-link" href="${escape(playlist.url ?? '#')}" target="_blank" rel="noopener">Open in Spotify</a>
                         <p class="share-url">${escape(playlist.url ?? '')}</p>
                       </div>
                       <button type="button" class="shuffle" id="copy">${state.copied ? 'Copied' : 'Copy link'}</button>
                     </div>
                     <ol class="tracks">
                       ${playlist.tracks
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
                  : `<p class="empty">Nothing came back.<br /><span>${escape(state.message || 'Try another week.')}</span></p>`
        }
      </section>

      <p class="fineprint">
        Lineups from the Ticketmaster Discovery API, tracks and playlists from Spotify.
        ${state.setup ? '<a class="setup-link" href="/auth">Authorise Spotify</a>' : '<a class="setup-link" href="?setup=1">Setup</a>'}
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

  app.querySelector<HTMLButtonElement>('#copy')?.addEventListener('click', () => void copy());
};

state.setup = new URLSearchParams(window.location.search).has('setup');
void load();

import {
  buildPlaylist,
  CITIES,
  fetchEvents,
  hasKey,
  spotifyReady,
  weekHeading,
  weekRange,
  type Event,
  type Source,
  type Track,
  type Week,
} from './events';
import './styles.css';

/**
 * Two choices and one automatic result: a city, a week, and the playlist the gigs of
 * that week produce. Nothing is typed by hand, which is the whole joke.
 */

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('No #app to render into');

let city = 'Berlin';
let week: Week = 'this';
let events: Event[] = [];
let tracks: Track[] = [];
let source: Source = 'sample';
let problem = '';
let loading = true;
let requestId = 0;

const escape = (value: string): string =>
  value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] as string);

const load = async (): Promise<void> => {
  const token = ++requestId;
  loading = true;
  problem = '';
  render();

  const found = await fetchEvents(city, week);
  const listed = await buildPlaylist(found.events);
  if (token !== requestId) return; /* a newer choice has already been made */

  events = found.events;
  tracks = listed;
  source = found.source;
  problem = found.problem ?? '';
  loading = false;
  render();
};

const render = (): void => {
  const venues = new Set(events.map((event) => event.venue)).size;
  const artists = new Set(events.flatMap((event) => event.artists)).size;
  const fromSpotify = tracks.filter((track) => track.fromSpotify).length;

  const sourceLabel =
    source === 'ticketmaster'
      ? 'live from Ticketmaster'
      : hasKey
        ? 'sample lineups'
        : 'sample lineups - no API key';

  const titlesLabel = fromSpotify > 0 ? 'titles from Spotify' : 'invented titles';

  app.innerHTML = `
    <header class="bar">
      <div class="brand">
        <span class="badge">WP</span>
        <span class="name">Who's Playing?</span>
      </div>
      <p class="tag">A playlist from whoever happens to be in town. Zero research.</p>
    </header>

    <main>
      <section class="controls" aria-label="City and week">
        <label class="field">
          <span>City</span>
          <select id="city">
            ${CITIES.map((option) => `<option value="${escape(option)}"${option === city ? ' selected' : ''}>${escape(option)}</option>`).join('')}
          </select>
        </label>

        <div class="weeks" role="group" aria-label="Which week">
          <button type="button" data-week="this" class="${week === 'this' ? 'on' : ''}">This week</button>
          <button type="button" data-week="next" class="${week === 'next' ? 'on' : ''}">Next week</button>
        </div>

        <span class="dates">${weekRange(week).label}</span>
        <span class="sticker">${escape(sourceLabel)}</span>
      </section>

      <section class="hero">
        <h1>${escape(city)},<br /><em>${weekHeading(week)}</em></h1>
        ${
          loading
            ? `<p class="count">Checking who is in town&hellip;</p>`
            : `<p class="count">
                 <b>${tracks.length}</b> tracks &middot; <b>${artists}</b> artists &middot;
                 <b>${venues}</b> venues &middot; <b>0</b> decisions by you
               </p>`
        }
        <p class="why">
          One song from every artist playing in ${escape(city)} ${weekHeading(week)}, in gig order.
          So when someone asks if you have heard of them, you can say yes and mean it.
        </p>
        ${problem ? `<p class="problem">${escape(problem)}</p>` : ''}
        ${!spotifyReady ? `<p class="problem">Spotify credentials are not set, so the titles are invented. See .env.example.</p>` : ''}
      </section>

      <section class="split">
        <div class="panel">
          <h2>The playlist <span class="hint">generated, not curated &middot; ${escape(titlesLabel)}</span></h2>
          ${
            loading
              ? `<p class="empty">Hold on&hellip;<br /><span>asking around.</span></p>`
              : tracks.length === 0
                ? `<p class="empty">Nothing on. Either the city is quiet, or we made this up.<br /><span>(We made this up.)</span></p>`
                : `<ol class="tracks">
                    ${tracks
                      .map(
                        (track, index) => `
                      <li>
                        <span class="n">${String(index + 1).padStart(2, '0')}</span>
                        <span class="t">
                          ${
                            track.url
                              ? `<b><a href="${escape(track.url)}" target="_blank" rel="noopener">${escape(track.title)}</a></b>`
                              : `<b>${escape(track.title)}</b>`
                          }
                          <span class="a">${escape(track.artist)}</span>
                        </span>
                        <span class="src">${escape(track.event.venue)} &middot; ${escape(track.event.day)}</span>
                      </li>`,
                      )
                      .join('')}
                  </ol>`
          }
        </div>

        <div class="panel">
          <h2>The gigs <span class="hint">why those songs</span></h2>
          <ul class="gigs">
            ${events
              .map(
                (event) => `
              <li>
                <span class="night">${escape(event.day)}</span>
                <span class="who"><b>${event.artists.map(escape).join(' + ')}</b><span class="venue">${escape(event.venue)}</span></span>
                ${event.note ? `<span class="note">${escape(event.note)}</span>` : ''}
              </li>`,
              )
              .join('')}
          </ul>
          <p class="aside">
            ${source === 'ticketmaster' ? 'Lineups from the Ticketmaster Discovery API.' : 'Invented lineups, standing in for the real listings.'}
            ${fromSpotify > 0 ? ` ${fromSpotify} of ${tracks.length} titles came back from Spotify.` : ''}
          </p>
        </div>
      </section>

      <section class="extra">
        <button type="button" id="shuffle" class="shuffle">Surprise me with another city</button>
        <p class="fineprint">
          No Spotify account was harmed. Playlists are generated from the gigs above, which
          is why nobody had to pick anything.
        </p>
      </section>
    </main>
  `;

  app.querySelector<HTMLSelectElement>('#city')?.addEventListener('change', (event) => {
    city = (event.target as HTMLSelectElement).value;
    void load();
  });

  app.querySelectorAll<HTMLButtonElement>('button[data-week]').forEach((button) => {
    button.addEventListener('click', () => {
      week = button.dataset.week === 'next' ? 'next' : 'this';
      void load();
    });
  });

  app.querySelector<HTMLButtonElement>('#shuffle')?.addEventListener('click', () => {
    const others = CITIES.filter((option) => option !== city);
    const next = others[Math.floor(Math.random() * others.length)];
    if (next) city = next;
    void load();
  });
};

void load();

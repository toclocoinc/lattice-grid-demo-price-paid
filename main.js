/**
 * The entry point: open the saved copy, hand it to the dashboard, then ask
 * HM Land Registry for the live answer and put that through the same router.
 *
 * Three ways to open the page:
 *
 *   (nothing)              the saved copy, then the live answer from the API
 *   ?source=snapshot       the saved copy in `data/snapshot`, held still
 *   ?district=oxford       open narrowed to one city (cambridge, oxford, york)
 *
 * When the API cannot be reached the saved copy stays on screen and the page
 * says so at the top, rather than showing an error.
 */

import { createGrid, createHeadlessGrid, setLicence } from './node_modules/@toclocoinc/lattice-grid/lattice-grid.esm.min.js';
import { createChart } from './node_modules/@toclocoinc/lattice-grid/modules/charts.esm.min.js';
import { createKPI } from './node_modules/@toclocoinc/lattice-grid/modules/kpi.esm.min.js';
import { createTabs } from './node_modules/@toclocoinc/lattice-grid/modules/tabs.esm.min.js';
import { createDataRouter } from './node_modules/@toclocoinc/lattice-grid/modules/data-router.esm.min.js';
import { DEMO_LICENCE } from './src/licence.js';
import { buildDashboard } from './src/dashboard.js';
import { DISTRICTS, decodeRows, fetchDistrict } from './src/land-registry.js';

/* Applied before anything is drawn, because a grid that already exists keeps
   whatever licence was in force when it was built. */
setLicence(DEMO_LICENCE);

const TITLE = 'House sales in Cambridge, Oxford and York';

const root = document.querySelector('#app');
const params = new URLSearchParams(location.search);
const mode = params.get('source') === 'snapshot' ? 'snapshot' : 'live';
const wantedDistrict = DISTRICTS.some((d) => d.slug === params.get('district')) ? params.get('district') : null;

/** Draw the waiting state, and return a function that updates its message. */
function showProgress(first) {
  root.textContent = '';
  const panel = document.createElement('div');
  panel.className = 'loading';
  const title = document.createElement('h1');
  title.textContent = TITLE;
  const message = document.createElement('p');
  message.className = 'loading-message';
  message.textContent = first;
  const bar = document.createElement('div');
  bar.className = 'loading-bar';
  const fill = document.createElement('div');
  fill.className = 'loading-fill';
  bar.append(fill);
  panel.append(title, message, bar);
  root.append(panel);
  return (text, fraction) => {
    message.textContent = text;
    fill.style.width = `${Math.round((fraction || 0) * 100)}%`;
  };
}

/** Say what went wrong, in words a reader can act on. */
function showError(error) {
  root.textContent = '';
  const panel = document.createElement('div');
  panel.className = 'loading';
  const title = document.createElement('h1');
  title.textContent = 'The sales could not be loaded';
  const message = document.createElement('p');
  message.className = 'loading-message';
  message.textContent = String((error && error.message) || error);
  const hint = document.createElement('p');
  hint.className = 'loading-message';
  hint.textContent = 'The page reads the saved copy in data/snapshot first. Check that the folder is being served alongside the page.';
  panel.append(title, message, hint);
  root.append(panel);
  console.error('[price paid demo]', error);
}

/** One file of the saved copy. */
async function readSaved(path) {
  const response = await fetch(`./data/snapshot/${path}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`The saved copy is missing ${path}.`);
  return response.json();
}

/** The whole saved copy: its meta and every district's rows. */
async function loadSnapshot(update) {
  const meta = await readSaved('meta.json');
  if (!Array.isArray(meta.months) || !meta.months.length) throw new Error('The saved copy lists no months.');
  const rows = [];
  let done = 0;
  await Promise.all(
    DISTRICTS.map(async (district) => {
      const file = await readSaved(`districts/${district.slug}.json`);
      rows.push(...decodeRows(file, district));
      done += 1;
      update(`Reading the saved copy... ${done} of ${DISTRICTS.length} cities`, 0.2 + (0.5 * done) / DISTRICTS.length);
    }),
  );
  return { meta, rows };
}

async function start() {
  const started = performance.now();
  try {
    const update = showProgress('Reading the saved copy...');
    const saved = await loadSnapshot(update);
    const fetched = performance.now();
    update('Building the dashboard...', 0.8);

    const built = buildDashboard({
      root,
      createGrid,
      createHeadlessGrid,
      createChart,
      createKPI,
      createTabs,
      createDataRouter,
      rows: saved.rows,
      meta: { ...saved.meta, mode },
      district: wantedDistrict,
    });
    const builtAt = performance.now();

    built.timings = {
      mode,
      rows: built.allGrid ? built.allGrid.rows.totalCount() : 0,
      loaded: saved.rows.length,
      snapshotMs: Math.round(fetched - started),
      buildMs: Math.round(builtAt - fetched),
    };
    /* Kept by reference, not copied: the New builds table is only created
       when its tab is first opened, and a copy taken now would never see it. */
    window.__priceDemo = Object.assign(built, { ready: true, liveSettled: mode === 'snapshot' });
    console.log('[price paid demo] ready on the saved copy', built.timings);

    if (mode !== 'live') return;

    /*
     * Now the live answer. One request per city, in parallel, for the same
     * window the saved copy covers; the result goes through the router as a
     * keyed diff, so the rows the two share are not repainted. A failure
     * leaves the saved copy on screen and says so.
     */
    const liveStarted = performance.now();
    try {
      const perDistrict = await Promise.all(
        DISTRICTS.map((district) => fetchDistrict(district, saved.meta.from, { signal: AbortSignal.timeout(90000) })),
      );
      const liveRows = perDistrict.flat();
      built.onLive(liveRows, Date.now());
      built.timings.liveRows = liveRows.length;
      built.timings.liveMs = Math.round(performance.now() - liveStarted);
      built.timings.added = built.status.added;
      built.timings.updated = built.status.updated;
      built.timings.removed = built.status.removed;
      console.log('[price paid demo] live answer applied', built.timings);
    } catch (liveError) {
      built.onLiveError(liveError);
      built.timings.liveError = built.status.liveError;
    } finally {
      built.liveSettled = true;
    }
  } catch (error) {
    window.__priceDemo = { ready: false, liveSettled: true, error: String((error && error.message) || error) };
    showError(error);
  }
}

start();

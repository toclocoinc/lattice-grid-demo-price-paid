/**
 * Load the demo in a real browser and check that it works.
 *
 * Serves the project and opens the saved copy, so the check never depends on
 * HM Land Registry being reachable. Beyond "it drew something", it asserts
 * the things this demo exists to show:
 *
 *   - every headline figure agrees with the saved copy, recomputed here in
 *     Node from the saved files rather than read back off the page: the
 *     counts, the median, the average, the month-on-month change of the
 *     median, and the average for each property type;
 *   - the month-by-month medians the chart draws agree with Node's, month
 *     by month, and so do the ten streets;
 *   - choosing a city narrows the table and the figures follow, and still
 *     agree with the recomputation over that city's rows;
 *   - the rows under a collapsed group still count towards the tiles;
 *   - the New builds tab holds exactly the new-build rows;
 *   - the four charts drew marks, not empty axes;
 *   - there is no watermark on localhost.
 *
 * It then blocks the API in the browser and opens the default page, to prove
 * a visitor gets the saved copy, and is told so, when HM Land Registry
 * cannot be reached.
 *
 * `--live` also opens the default page with the API reachable, fetches the
 * same query from the API here in Node, reduces the raw SPARQL bindings
 * independently, and insists the live page's figures agree with them. That
 * needs the internet, so it is not part of the deployment gate.
 *
 * Exits non-zero when any of that fails, so it can gate a deployment.
 *
 * Usage: node tools/verify.mjs [--live] [--shots <dir>]
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { startServer } from './serve.mjs';
import {
  API_HOST,
  DISTRICTS,
  PROPERTY_TYPES,
  decodeRows,
  monthShort,
  previousMonth,
  runQuery,
  salesQuery,
} from '../src/land-registry.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const args = process.argv.slice(2);
const shotIndex = args.indexOf('--shots');
const shotDir = shotIndex >= 0 ? resolve(args[shotIndex + 1]) : null;
const live = args.includes('--live');

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
].filter(Boolean);

/** The first browser on this machine that actually exists. */
async function findChrome() {
  for (const path of CHROME_CANDIDATES) {
    try {
      await access(path);
      return path;
    } catch {}
  }
  throw new Error(`No browser found. Tried:\n  ${CHROME_CANDIDATES.join('\n  ')}\nSet CHROME_PATH to point at one.`);
}

/**
 * This check talks to the browser over a WebSocket, which Node only provides
 * as a global from version 22. Say so plainly rather than failing later with
 * an unexplained missing name.
 */
function requireModernNode() {
  if (typeof WebSocket === 'undefined') {
    throw new Error(
      `This check needs Node 22 or newer. You are running ${process.version}, which has no built in WebSocket.`,
    );
  }
}

/** A free TCP port, asked of the operating system. */
function freePort() {
  return new Promise((ok, reject) => {
    const probe = createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => ok(port));
    });
  });
}

const failures = [];
const notes = [];

/** Record a check and its outcome. */
function check(ok, description, detail) {
  if (ok) {
    notes.push(`  ok   ${description}${detail ? ` (${detail})` : ''}`);
  } else {
    failures.push(`${description}${detail ? ` (${detail})` : ''}`);
    notes.push(`  FAIL ${description}${detail ? ` (${detail})` : ''}`);
  }
}

/* ------------------------------------------------------------------ */
/* The independent recomputation, in Node.                             */
/* ------------------------------------------------------------------ */

/**
 * The median: the middle value, or the mean of the two middle values when
 * there is an even number. The same convention the page states, written
 * again here rather than imported, so the two are independent.
 */
function median(values) {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  const n = sorted.length;
  if (!n) return null;
  return n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
}

/**
 * The headline figures for a set of rows, as the tiles and charts should
 * show them. A row here needs only `price`, `month`, `type`, `newBuild`,
 * `street` and `category`, so the same reducer runs over the saved rows and
 * over rows reduced straight from raw API bindings.
 */
function figures(rows, newest) {
  const previous = previousMonth(newest);
  const prices = [];
  const nowPrices = [];
  const beforePrices = [];
  const byType = new Map();
  const byMonth = new Map();
  const byStreet = new Map();
  let latest = 0;
  let newBuilds = 0;
  let sum = 0;
  for (const row of rows) {
    prices.push(row.price);
    sum += row.price;
    if (row.month === newest) {
      latest += 1;
      nowPrices.push(row.price);
    } else if (row.month === previous) {
      beforePrices.push(row.price);
    }
    if (row.newBuild) newBuilds += 1;
    const t = byType.get(row.type) || { total: 0, n: 0 };
    t.total += row.price;
    t.n += 1;
    byType.set(row.type, t);
    if (!byMonth.has(row.month)) byMonth.set(row.month, []);
    byMonth.get(row.month).push(row.price);
    if (row.street) byStreet.set(row.street, (byStreet.get(row.street) || 0) + 1);
  }
  const a = median(nowPrices);
  const b = median(beforePrices);
  const typeAverages = {};
  for (const [type, t] of byType) typeAverages[type] = t.total / t.n;
  const monthMedians = {};
  for (const month of [...byMonth.keys()].sort()) monthMedians[month] = median(byMonth.get(month));
  const streets = [...byStreet.entries()]
    .sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1))
    .slice(0, 10)
    .map(([street, sales]) => ({ street, sales }));
  return {
    rows: rows.length,
    sales: rows.length,
    latest,
    median: median(prices),
    average: rows.length ? sum / rows.length : null,
    change: a != null && b ? (a - b) / b : null,
    newBuilds,
    typeAverages,
    monthMedians,
    streets,
  };
}

/** Two figures agree: exactly for counts, to a rounding for the rest. */
function same(a, b) {
  if (a == null || b == null) return a == null && b == null;
  return Math.abs(Number(a) - Number(b)) <= 1e-6 * Math.max(1, Math.abs(Number(b)));
}

const meta = JSON.parse(await readFile(join(root, 'data', 'snapshot', 'meta.json'), 'utf8'));
const newest = meta.newest;
const savedByDistrict = new Map();
const savedRows = [];
for (const district of DISTRICTS) {
  const file = JSON.parse(await readFile(join(root, 'data', 'snapshot', 'districts', `${district.slug}.json`), 'utf8'));
  const rows = decodeRows(file, district);
  savedByDistrict.set(district.slug, rows);
  savedRows.push(...rows);
}
const expected = figures(savedRows, newest);
console.log(`Saved copy: ${savedRows.length} sales across ${DISTRICTS.length} districts, ${meta.months.length} months to ${newest}; copy taken ${meta.fetchedAt}`);
console.log(`  expected tiles: sales ${expected.sales}, latest ${expected.latest}, median ${expected.median}, average ${expected.average.toFixed(2)}, change ${expected.change}, new builds ${expected.newBuilds}`);

let browser;
let browserPid = null;
let profile;
let server;

try {
  requireModernNode();
  const chromePath = await findChrome();
  const started = await startServer(0);
  server = started.server;
  const origin = `http://127.0.0.1:${started.port}`;
  console.log(`Browser: ${chromePath}`);
  console.log(`Serving: ${origin}`);

  profile = await mkdtemp(join(tmpdir(), 'price-paid-demo-verify-'));
  /* A port of the operating system's choosing, so two checks running side by
     side on one machine cannot land on the same debugging socket. */
  const port = await freePort();
  /* Its own process group, so the whole browser tree can be taken down
     together rather than leaving orphaned renderers behind. Only the browser
     this check started is ever signalled. */
  browser = spawn(chromePath, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--hide-scrollbars',
    '--window-size=1440,900',
    'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  browserPid = browser.pid;
  browser.stderr.on('data', () => {});

  let wsUrl;
  for (let i = 0; i < 150 && !wsUrl; i += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) wsUrl = (await response.json()).webSocketDebuggerUrl;
    } catch {}
    if (!wsUrl) await sleep(200);
  }
  if (!wsUrl) throw new Error('the browser never opened its debugging port');

  const socket = new WebSocket(wsUrl);
  await new Promise((done, fail) => {
    socket.onopen = done;
    socket.onerror = () => fail(new Error('could not attach to the browser'));
  });

  let nextId = 0;
  const pending = new Map();
  let consoleErrors = [];
  let pageErrors = [];
  const requested = [];

  /* A browser that goes away mid-run, killed from outside or crashed, would
     otherwise leave every call waiting for an answer that never comes. Fail
     the run instead of hanging it. */
  socket.onclose = () => {
    for (const { reject } of pending.values()) reject(new Error('the browser went away before it answered'));
    pending.clear();
  };

  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id != null && pending.has(message.id)) {
      const { resolve: ok, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else ok(message.result);
      return;
    }
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      consoleErrors.push(message.params.args.map((a) => a.value ?? a.description ?? a.type).join(' '));
    }
    if (message.method === 'Runtime.exceptionThrown') {
      const details = message.params.exceptionDetails;
      pageErrors.push(details.exception?.description || details.text);
    }
    if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
      consoleErrors.push(message.params.entry.text);
    }
    if (message.method === 'Network.requestWillBeSent') {
      requested.push(message.params.request.url);
    }
  };

  const send = (method, params = {}, sessionId) =>
    new Promise((ok, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve: ok, reject });
      socket.send(JSON.stringify({ id, method, params, sessionId }));
    });

  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const call = (method, params) => send(method, params, sessionId);

  await call('Page.enable');
  await call('Runtime.enable');
  await call('Log.enable');
  await call('Network.enable');
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  const evaluate = async (expression) => {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text + ' ' + (result.exceptionDetails.exception?.description || ''));
    }
    return result.result.value;
  };

  const waitFor = async (expression, timeout, what) => {
    const until = Date.now() + timeout;
    while (Date.now() < until) {
      let value;
      try {
        value = await evaluate(expression);
      } catch {}
      if (value) return value;
      await sleep(250);
    }
    throw new Error(`timed out waiting for ${what}`);
  };

  /** Open a URL with a clean error log and wait for the dashboard to report in. */
  const open = async (url, label) => {
    consoleErrors = [];
    pageErrors = [];
    console.log(`\n--- ${label} ---\n${url}`);
    await call('Page.navigate', { url });
    await waitFor('!!(window.__priceDemo)', 120000, `${label} to load`);
    const state = await evaluate('({ ready: window.__priceDemo.ready, error: window.__priceDemo.error || null })');
    if (!state.ready) throw new Error(`${label} reported a failure: ${state.error}`);
    await waitFor('window.__priceDemo.allGrid && window.__priceDemo.allGrid.rows.count() > 0', 60000, `${label} rows`);
  };

  /** Save a screenshot, when a directory was asked for. */
  const shoot = async (name) => {
    if (!shotDir) return;
    await mkdir(shotDir, { recursive: true });
    const { data } = await call('Page.captureScreenshot', { format: 'png' });
    const file = join(shotDir, `${name}.png`);
    await writeFile(file, Buffer.from(data, 'base64'));
    console.log(`  shot ${file}`);
  };

  /** Complain about anything the page logged. */
  const noErrors = (label) => {
    check(consoleErrors.length === 0, `${label}: no console errors`, consoleErrors.slice(0, 3).join(' | '));
    check(pageErrors.length === 0, `${label}: no page errors`, pageErrors.slice(0, 3).join(' | '));
  };

  /** The tiles, the type averages, the chart points and the counts, as the page shows them. */
  const readFigures = () => evaluate(`(() => {
    const d = window.__priceDemo;
    const tiles = Object.fromEntries(d.kpi.tiles().map((t) => [t.id, t.value]));
    const points = (i) => { const data = d.charts[i] && d.charts[i].data(); const s = (data && data.series && data.series[0] && data.series[0].points) || []; return s.map((p) => [p.rowKey != null ? p.rowKey : p.x, p.y]); };
    const monthRows = []; d.monthGrid.rows.forEach((r) => { if (r && r.data) monthRows.push([r.data.month, r.data.median, r.data.sales]); });
    return {
      rows: d.allGrid.rows.count(),
      total: d.allGrid.rows.totalCount(),
      sales: tiles.sales, latest: tiles.latest, median: tiles.median, average: tiles.average, change: tiles.change,
      typeAverages: Object.fromEntries(Object.entries(d.typeAverages || {}).map(([k, v]) => [k, v.average])),
      monthRows,
      monthPoints: points(0),
      streetPoints: points(3),
      histogramRows: d.histogramGrid.rows.count(),
      district: d.district,
      selectValue: d.districtSelect.value,
      badges: [...document.querySelectorAll('[role=tab]')].map((t) => t.textContent.trim()),
    };
  })()`);

  /** Every headline figure against the recomputation. */
  const compareFigures = (label, shown, want) => {
    check(shown.rows === want.rows, `${label}: the row count matches`, `${shown.rows} against ${want.rows}`);
    check(shown.sales === want.sales, `${label}: the sales tile matches`, `${shown.sales} against ${want.sales}`);
    check(shown.latest === want.latest, `${label}: the sales-in-the-latest-month tile matches`, `${shown.latest} against ${want.latest}`);
    check(same(shown.median, want.median), `${label}: the median tile matches, to the pound`, `${shown.median} against ${want.median}`);
    check(same(shown.average, want.average), `${label}: the average tile matches`, `${shown.average} against ${want.average}`);
    check(same(shown.change, want.change), `${label}: the month-on-month change of the median matches`, `${shown.change} against ${want.change}`);
    for (const type of Object.keys(want.typeAverages)) {
      check(
        same(shown.typeAverages[type], want.typeAverages[type]),
        `${label}: the average for ${type} matches`,
        `${shown.typeAverages[type]} against ${want.typeAverages[type]}`,
      );
    }
    /* The chart's points are read by row key (the month) and value. */
    const months = Object.keys(want.monthMedians);
    const shownMonths = new Map(shown.monthPoints);
    let monthsAgree = 0;
    const monthMisses = [];
    for (const month of months) {
      if (same(shownMonths.get(month), want.monthMedians[month])) monthsAgree += 1;
      else monthMisses.push(`${month}: chart ${shownMonths.get(month)} against ${want.monthMedians[month]}`);
    }
    check(
      shown.monthPoints.length === months.length && monthsAgree === months.length,
      `${label}: the median-by-month chart agrees with Node for every month`,
      `${monthsAgree} of ${months.length} months agree${monthMisses.length ? `; ${monthMisses.slice(0, 3).join(', ')}` : ''}`,
    );
    const shownStreets = shown.streetPoints.map(([street, sales]) => `${street}=${sales}`).join(', ');
    const wantStreets = want.streets.map((s) => `${s.street}=${s.sales}`).join(', ');
    check(shownStreets === wantStreets, `${label}: the ten streets and their counts match, in order`, `${shownStreets} | expected ${wantStreets}`);
  };

  /* =================================================================== */
  /* 1. The saved copy, cross-checked against the saved files.            */
  /* =================================================================== */

  await open(`${origin}/index.html?source=snapshot`, 'saved copy');

  const snap = await evaluate(`(() => {
    const d = window.__priceDemo;
    return {
      rows: d.allGrid.rows.count(),
      total: d.allGrid.rows.totalCount(),
      columns: d.allGrid.columns.visible().length,
      painted: document.querySelectorAll('.lattice [role="row"]').length,
      charts: d.charts.length,
      watermark: d.allGrid.licence.watermark(),
      licenceState: d.allGrid.licence.state(),
      badge: (document.querySelector('.head-note .pill') || {}).textContent || null,
      freshness: (document.querySelector('.freshness') || {}).textContent || null,
      attribution: (document.querySelector('.foot .attribution') || {}).textContent || null,
      marks: d.marks,
      timings: d.timings,
    };
  })()`);
  console.log(`  ${snap.rows} rows, ${snap.columns} columns, ${snap.painted} painted, ${snap.charts} charts; badge "${snap.badge}"`);
  console.log(`  ${snap.freshness}`);
  console.log(`  build marks (ms): ${JSON.stringify(snap.marks)}`);
  check(snap.rows === savedRows.length, 'saved copy: the table holds every saved sale', `${snap.rows} against ${savedRows.length}`);
  check(snap.painted > 0, 'saved copy: the table painted rows', `${snap.painted}`);
  check(snap.charts === 4, 'saved copy: all four charts were built', `${snap.charts}`);
  check(snap.badge === 'Saved copy', 'saved copy: the badge says it is the saved copy', `"${snap.badge}"`);
  check(/copy taken on/.test(snap.freshness || ''), 'saved copy: the readout says when the copy was taken', snap.freshness);
  check(snap.watermark === false, 'saved copy: no watermark on localhost', `state ${snap.licenceState}`);
  check(
    snap.attribution === meta.attribution && /Crown copyright and database right 2026/.test(snap.attribution || ''),
    'saved copy: the required attribution is on the page, word for word',
    snap.attribution,
  );

  /* Built is not drawn. A chart whose points all carry a null measure puts an
     empty pair of axes on the page and reports no error, so each one is asked
     what it actually plotted. */
  const drawn = await evaluate(`(() => window.__priceDemo.charts.map((c, i) => {
    const data = c.data();
    const series = (data && data.series) || [];
    const points = series.reduce((n, s) => n + ((s.points || []).length), 0);
    const withValue = series.reduce((n, s) => n + (s.points || []).filter((p) => p.y != null && p.y !== 0).length, 0);
    const svg = c.element;
    const marks = svg ? svg.querySelectorAll('rect, circle, path').length : 0;
    /* The bars proper: a chart also holds a clip rectangle, which is not a mark. */
    const bars = svg ? [...svg.querySelectorAll('rect.lat-chartview__mark')].filter((r) => +r.getAttribute('height') > 0 && +r.getAttribute('width') > 0).length : 0;
    return { i, points, withValue, marks, bars };
  }))()`);
  for (const c of drawn) {
    console.log(`  chart ${c.i}: ${c.points} points, ${c.withValue} with a value, ${c.marks} marks, ${c.bars} bars`);
    check(c.withValue > 0, `saved copy: chart ${c.i} plotted values rather than empty axes`, `${c.withValue} of ${c.points} points carry a measure`);
    check(c.marks > 2, `saved copy: chart ${c.i} drew marks`, `${c.marks} marks`);
  }
  check(drawn[0] && drawn[0].points === meta.months.length, 'saved copy: the median chart has a point per month', `${drawn[0] && drawn[0].points} against ${meta.months.length}`);
  check(drawn[1] && drawn[1].bars === Object.keys(expected.typeAverages).length, 'saved copy: the type chart has a bar per property type', `${drawn[1] && drawn[1].bars}`);
  check(drawn[2] && drawn[2].bars > 5, 'saved copy: the histogram drew a spread of bars, not one', `${drawn[2] && drawn[2].bars} bars`);
  check(drawn[3] && drawn[3].bars === 10, 'saved copy: the streets chart has ten bars', `${drawn[3] && drawn[3].bars}`);
  noErrors('saved copy');
  await shoot('01-saved-copy');

  /* ---- the headline figures against the saved files ---- */

  const first = await readFigures();
  console.log(`  shown tiles: sales ${first.sales}, latest ${first.latest}, median ${first.median}, average ${first.average}, change ${first.change}`);
  compareFigures('saved copy', first, expected);
  const cap = await evaluate('window.__priceDemo.histogramCap');
  const expectedUnderCap = savedRows.filter((r) => r.price < cap).length;
  check(first.histogramRows === expectedUnderCap, `saved copy: the histogram reads every sale under ${cap}`, `${first.histogramRows} against ${expectedUnderCap}`);
  check(first.district === null && first.selectValue === '', 'saved copy: the page opens on all three cities');
  check(
    first.badges.some((b) => /^All sales/.test(b) && b.includes(String(savedRows.length))),
    'saved copy: the All sales tab badge carries the row count',
    first.badges.join(' / '),
  );
  check(
    first.badges.some((b) => /^New builds/.test(b) && b.includes(String(expected.newBuilds))),
    'saved copy: the New builds tab badge counts the new builds before the tab is opened',
    `${first.badges.join(' / ')}; expected ${expected.newBuilds}`,
  );

  /* ---- choosing a city narrows everything ---- */

  const oxford = DISTRICTS.find((d) => d.slug === 'oxford');
  const oxfordRows = savedByDistrict.get('oxford');
  const expectedOxford = figures(oxfordRows, newest);
  const before = await evaluate(`(() => {
    const d = window.__priceDemo;
    return { rows: d.allGrid.rows.count(), chartRows: d.charts.map((c) => { const data = c.data(); return data ? JSON.stringify(data).length : 0; }) };
  })()`);
  await evaluate(`window.__priceDemo.selectDistrict('oxford')`);
  await sleep(1200);
  const narrowed = await readFigures();
  const afterCharts = await evaluate(`(() => {
    const d = window.__priceDemo;
    let other = 0;
    d.allGrid.rows.forEach((r) => { if (r && r.data && r.data.district !== ${JSON.stringify(oxford.name)}) other += 1; });
    return { other, url: location.search, chartRows: d.charts.map((c) => { const data = c.data(); return data ? JSON.stringify(data).length : 0; }) };
  })()`);
  console.log(`  narrowed to ${oxford.name}: ${before.rows} rows -> ${narrowed.rows} rows`);
  check(narrowed.rows < before.rows, 'choosing a city narrows the table', `${before.rows} -> ${narrowed.rows}`);
  check(afterCharts.other === 0, 'every remaining row is in the chosen city');
  check(narrowed.district === 'oxford' && narrowed.selectValue === 'oxford', 'the selector shows the chosen city', narrowed.selectValue);
  check(/district=oxford/.test(afterCharts.url), 'the chosen city is in the address', afterCharts.url);
  compareFigures(`narrowed to ${oxford.name}`, narrowed, expectedOxford);
  const chartsMoved = afterCharts.chartRows.filter((size, i) => size !== before.chartRows[i]).length;
  check(chartsMoved === 4, 'all four charts rebound to the narrowed data', `${chartsMoved} of 4 changed`);
  check(
    narrowed.badges.some((b) => /^New builds/.test(b) && b.includes(String(expectedOxford.newBuilds))),
    'the New builds badge narrows with the city',
    `${narrowed.badges.join(' / ')}; expected ${expectedOxford.newBuilds}`,
  );
  await shoot('02-oxford');

  await evaluate(`window.__priceDemo.selectDistrict('')`);
  await sleep(1200);
  const restored = await readFigures();
  check(restored.rows === before.rows, 'choosing all three cities restores the table', `${restored.rows} of ${before.rows}`);

  /* ---- standard sales only ---- */

  await evaluate('window.__priceDemo.standardButton.click()');
  await sleep(1200);
  const standard = await readFigures();
  const expectedStandard = figures(savedRows.filter((r) => r.category === 'Standard'), newest);
  check(standard.rows < restored.rows, 'the standard-sales toggle narrows the table', `${restored.rows} -> ${standard.rows}`);
  compareFigures('standard sales only', standard, expectedStandard);
  await evaluate('window.__priceDemo.standardButton.click()');
  await sleep(900);

  /* ---- grouping ---- */

  await evaluate("window.__priceDemo.allGrid.columns.group(['street'])");
  await sleep(1200);
  const grouped = await evaluate(`(() => {
    const d = window.__priceDemo;
    let groups = 0;
    d.allGrid.rows.forEach((r) => { if (r && r.group) groups += 1; });
    const tiles = Object.fromEntries(d.kpi.tiles().map((t) => [t.id, t.value]));
    return { groups, sales: tiles.sales, median: tiles.median };
  })()`);
  check(grouped.groups > 0, 'grouping by street produces group rows', `${grouped.groups} groups`);
  check(grouped.sales === expected.sales && same(grouped.median, expected.median), 'the rows under collapsed groups still count towards the tiles', `${grouped.sales} sales, median ${grouped.median}`);
  await shoot('03-grouped-by-street');
  await evaluate('window.__priceDemo.allGrid.columns.group([])');
  await sleep(600);

  /* ---- the New builds tab ---- */

  await evaluate("window.__priceDemo.tabs.activate('newbuild')");
  await waitFor('window.__priceDemo.newBuildGrid && window.__priceDemo.newBuildGrid.rows.count() > 0', 30000, 'the New builds table');
  const newBuilds = await evaluate(`(() => {
    const d = window.__priceDemo;
    let allNew = true;
    d.newBuildGrid.rows.forEach((r) => { if (r && r.data && r.data.newBuild !== true) allNew = false; });
    return { rows: d.newBuildGrid.rows.count(), allNew, painted: document.querySelectorAll('.lattice [role="row"]').length };
  })()`);
  console.log(`  New builds table: ${newBuilds.rows} rows, saved copy holds ${expected.newBuilds}`);
  check(newBuilds.rows === expected.newBuilds, 'the New builds table holds exactly the new-build sales', `${newBuilds.rows} against ${expected.newBuilds}`);
  check(newBuilds.allNew, 'the New builds table holds only new builds');
  await shoot('04-new-builds');
  await evaluate("window.__priceDemo.tabs.activate('all')");
  await sleep(300);
  noErrors('saved copy, after the checks');

  const snapshotCalls = requested.filter((url) => url.includes(API_HOST));
  check(snapshotCalls.length === 0, 'the saved-copy page made no request to the API', `${snapshotCalls.length} requests`);

  /* =================================================================== */
  /* 2. What a visitor gets when HM Land Registry cannot be reached.     */
  /* =================================================================== */

  /*
   * The API is blocked in the browser rather than asked politely to fail, so
   * this exercises the same path a real outage takes and the demo carries no
   * test-only code. A failed request does log to the console, so the check
   * here is that nothing was thrown and the saved copy is on screen saying
   * so.
   */
  await call('Network.setBlockedURLs', { urls: [`*${API_HOST}*`] });
  requested.length = 0;
  await open(`${origin}/index.html`, 'default page, with the API unreachable');
  await waitFor('window.__priceDemo.liveSettled === true', 120000, 'the live fetch to settle');
  const fallback = await evaluate(`(() => {
    const d = window.__priceDemo;
    const notice = document.querySelector('.notice');
    const tiles = Object.fromEntries(d.kpi.tiles().map((t) => [t.id, t.value]));
    return {
      rows: d.allGrid.rows.count(),
      painted: document.querySelectorAll('.lattice [role="row"]').length,
      live: d.status.live,
      liveError: d.status.liveError,
      badge: (document.querySelector('.head-note .pill') || {}).textContent || null,
      notice: notice && !notice.hidden ? notice.textContent.trim() : null,
      freshness: (document.querySelector('.freshness') || {}).textContent || null,
      median: tiles.median,
      sales: tiles.sales,
    };
  })()`);
  console.log(`  rows ${fallback.rows}, badge "${fallback.badge}", live: ${fallback.live}, error: ${fallback.liveError}`);
  console.log(`  notice: ${fallback.notice}`);
  check(requested.filter((url) => url.includes(API_HOST)).length > 0, 'fallback: the page did try the API', `${requested.filter((url) => url.includes(API_HOST)).length} requests attempted`);
  check(fallback.rows === savedRows.length, 'fallback: the saved copy is on screen', `${fallback.rows} rows`);
  check(fallback.painted > 0, 'fallback: the table painted rows', `${fallback.painted}`);
  check(fallback.live === false && !!fallback.liveError, 'fallback: the page recorded that the live fetch failed', fallback.liveError);
  check(fallback.badge === 'Saved copy', 'fallback: the badge reads "Saved copy"', `"${fallback.badge}"`);
  check(!!fallback.notice && /could not be reached/i.test(fallback.notice), 'fallback: the page says HM Land Registry was unreachable', fallback.notice);
  check(/copy taken on/.test(fallback.freshness || ''), "fallback: the saved copy's date is shown", fallback.freshness);
  check(fallback.sales === expected.sales && same(fallback.median, expected.median), 'fallback: the tiles read the saved copy', `${fallback.sales} sales, median ${fallback.median}`);
  check(pageErrors.length === 0, 'fallback: no page errors', pageErrors.slice(0, 3).join(' | '));
  await shoot('05-fallback');
  await call('Network.setBlockedURLs', { urls: [] });

  if (live) {
    /* ================================================================= */
    /* 3. Live: the page's figures against the raw API, reduced in Node. */
    /* ================================================================= */

    /*
     * The same query the page sends, sent from here, and the raw SPARQL
     * bindings reduced without going through the page's shaping: the price,
     * the date, the property type URI and the new-build flag are read
     * straight off each binding.
     */
    console.log(`\n--- fetching the raw API answer in Node, for the cross-check ---`);
    const rawStarted = Date.now();
    const rawRows = [];
    for (const district of DISTRICTS) {
      const bindings = await runQuery(salesQuery(district.district, meta.from), { signal: AbortSignal.timeout(120000) });
      console.log(`  ${district.name}: ${bindings.length} bindings`);
      for (const b of bindings) {
        const street = b.street ? b.street.value : null;
        rawRows.push({
          price: Number(b.price.value),
          month: b.date.value.slice(0, 7),
          type: PROPERTY_TYPES[b.ptype.value.split('/').pop()] || 'Other',
          newBuild: b.newBuild.value === 'true',
          /* The streets chart shows title-cased names; the comparison is
             made case-insensitively on the raw upper-case value. */
          street: street ? street.toUpperCase() : null,
          category: b.category.value.endsWith('standardPricePaidTransaction') ? 'Standard' : 'Additional',
        });
      }
    }
    const rawNewest = rawRows.reduce((m, r) => (r.month > m ? r.month : m), '');
    console.log(`  ${rawRows.length} raw rows in ${((Date.now() - rawStarted) / 1000).toFixed(1)}s; newest month ${rawNewest}`);
    const expectedLive = figures(rawRows, rawNewest);

    requested.length = 0;
    await open(`${origin}/index.html`, 'default page, live');
    await waitFor('window.__priceDemo.liveSettled === true', 120000, 'the live fetch to settle');
    const liveState = await evaluate(`(() => {
      const d = window.__priceDemo;
      return {
        live: d.status.live, liveError: d.status.liveError, timings: d.timings,
        badge: (document.querySelector('.head-note .pill') || {}).textContent || null,
        freshness: (document.querySelector('.freshness') || {}).textContent || null,
        watermark: d.allGrid.licence.watermark(),
        newest: d.meta.newest,
      };
    })()`);
    console.log(`  live: ${liveState.live}, badge "${liveState.badge}", timings ${JSON.stringify(liveState.timings)}`);
    console.log(`  ${liveState.freshness}`);
    check(liveState.live === true, 'live: the page read HM Land Registry', liveState.liveError || 'ok');
    check(liveState.badge === 'Live', 'live: the badge reads "Live"', `"${liveState.badge}"`);
    check(/read from HM Land Registry at/.test(liveState.freshness || ''), 'live: the readout says when the API was read', liveState.freshness);
    check(liveState.watermark === false, 'live: no watermark on localhost');
    check(requested.filter((url) => url.includes(API_HOST)).length === DISTRICTS.length, `live: one request per city went to the API`, `${requested.filter((url) => url.includes(API_HOST)).length}`);
    const liveFigures = await readFigures();
    /* The page keeps the saved copy's window; if the API has published a
       newer month since the copy was taken, the two "newest" months differ
       and the latest-month tiles are compared on the page's own month. */
    const liveWant = rawNewest === liveState.newest ? expectedLive : figures(rawRows, liveState.newest);
    if (rawNewest !== liveState.newest) console.log(`  the API now holds ${rawNewest}; the page's newest month is ${liveState.newest}, so the latest-month figures are compared on that`);
    liveFigures.streetPoints = liveFigures.streetPoints.map(([street, sales]) => [String(street).toUpperCase(), sales]);
    compareFigures('live, against the raw API answer', liveFigures, liveWant);
    check(liveFigures.rows === rawRows.length, 'live: the table holds every row the API returned', `${liveFigures.rows} against ${rawRows.length}`);
    noErrors('live');
    await shoot('06-live');
  }

  socket.close();
} catch (error) {
  failures.push(String((error && error.stack) || error));
} finally {
  /* Take the whole browser tree down, not just the process that was spawned:
     a surviving renderer is an orphan nobody will reap. Only the browser this
     check started. */
  if (browserPid) {
    try { process.kill(-browserPid, 'SIGKILL'); } catch {}
    try { process.kill(browserPid, 'SIGKILL'); } catch {}
  }
  if (server) server.close();
  await sleep(400);
  if (profile) await rm(profile, { recursive: true, force: true });
}

console.log('\nChecks:');
for (const note of notes) console.log(note);

if (failures.length) {
  console.error(`\nFAILED (${failures.length}):`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(`\nAll ${notes.length} checks passed.`);
process.exit(0);

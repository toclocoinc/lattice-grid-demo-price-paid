/**
 * Take a fresh copy of the sales from HM Land Registry and save it to
 * `data/snapshot/`, which is what the page opens on before it asks the API.
 *
 * Run it with `npm run snapshot`. It is a development tool and a nightly job;
 * nothing the page loads imports it.
 *
 * It asks the API for the newest sale date across the districts, takes the
 * twenty-four months ending on that month, and fetches each district in one
 * SPARQL request. It uses exactly the query and the shaping the page uses,
 * imported from `src/land-registry.js`, so the saved copy is what the page
 * would have fetched itself.
 */

import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DISTRICTS,
  WINDOW_MONTHS,
  encodeRows,
  fetchDistrict,
  monthLabel,
  monthOf,
  monthsEndingAt,
  newestDateQuery,
  runQuery,
} from '../src/land-registry.js';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'data', 'snapshot');
const districtDir = join(outDir, 'districts');

const started = Date.now();
let requests = 0;

/** One query, timed and counted, with one retry after a pause. */
async function query(sparql, label) {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    requests += 1;
    const at = Date.now();
    try {
      const bindings = await runQuery(sparql, { signal: AbortSignal.timeout(120000) });
      console.log(`  ${label}: ${bindings.length} rows in ${((Date.now() - at) / 1000).toFixed(1)}s`);
      return bindings;
    } catch (error) {
      console.log(`  ${label}: ${error.message}${attempt < 2 ? '; trying again in 15s' : ''}`);
      if (attempt < 2) await new Promise((r) => setTimeout(r, 15000));
    }
  }
  throw new Error(`${label}: the API did not answer after two attempts`);
}

/* ---------------- the window ---------------- */

console.log('Finding the newest sale date across the districts...');
const [latest] = await query(newestDateQuery(DISTRICTS.map((d) => d.district)), 'newest date');
const newestDate = latest && latest.latest ? latest.latest.value : null;
if (!newestDate) throw new Error('the API reported no sales at all for the districts');
const newest = monthOf(newestDate);
const months = monthsEndingAt(newest, WINDOW_MONTHS);
const from = `${months[0]}-01`;
console.log(`  newest sale ${newestDate}; window ${monthLabel(months[0])} to ${monthLabel(newest)}, from ${from}`);

/* ---------------- the districts ---------------- */

console.log(`Fetching ${DISTRICTS.length} districts, one request each...`);
const files = new Map();
const counts = {};
let total = 0;
for (const district of DISTRICTS) {
  const at = Date.now();
  requests += 1;
  const rows = await fetchDistrict(district, from, { signal: AbortSignal.timeout(120000) });
  console.log(`  ${district.name}: ${rows.length} sales in ${((Date.now() - at) / 1000).toFixed(1)}s`);
  /* Sorted newest first so the file is stable between runs when nothing
     changed, and the diff is readable when something did. */
  rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.id < b.id ? -1 : 1));
  files.set(district.slug, encodeRows(rows));
  counts[district.slug] = rows.length;
  total += rows.length;
}

/* ---------------- write ---------------- */

await rm(districtDir, { recursive: true, force: true });
await mkdir(districtDir, { recursive: true });
for (const [slug, file] of files) {
  await writeFile(join(districtDir, `${slug}.json`), JSON.stringify(file));
}

const seconds = Number(((Date.now() - started) / 1000).toFixed(1));
const meta = {
  fetchedAt: new Date().toISOString(),
  fetchedAtMs: Date.now(),
  seconds,
  requests,
  source: 'HM Land Registry Price Paid Data',
  sourceUrl: 'https://landregistry.data.gov.uk/',
  attribution:
    'Contains HM Land Registry data © Crown copyright and database right 2026. This data is licensed under the Open Government Licence v3.0.',
  licence: 'Open Government Licence v3.0',
  licenceUrl: 'https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/',
  districts: DISTRICTS,
  months,
  newest,
  newestDate,
  from,
  rows: total,
  counts,
};
await writeFile(join(outDir, 'meta.json'), JSON.stringify(meta, null, 2));

const written = await readdir(districtDir);
console.log(`\nSaved ${total} sales across ${written.length} districts in ${seconds}s, ${requests} requests.`);

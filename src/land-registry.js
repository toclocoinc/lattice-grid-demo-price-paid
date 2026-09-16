/**
 * HM Land Registry Price Paid Data: the query, the shaping, and the format of
 * the saved copy.
 *
 * One module, shared three ways. The page imports it to read the API live in
 * the browser; `tools/build-snapshot.mjs` imports it under Node to take the
 * saved copy; `tools/verify.mjs` imports it to know what the page was given.
 * Nothing in here touches the DOM or the grid.
 *
 * The API. HM Land Registry publishes Price Paid Data as linked data at
 * https://landregistry.data.gov.uk/. There are two ways in, both keyless:
 *
 *   - a linked-data API, `/data/ppi/transaction-record.json?...`, which pages
 *     two hundred records at a time and takes several seconds a page;
 *   - a SPARQL endpoint, `/landregistry/query`, which answers a whole local
 *     authority's two years in one request of a few seconds.
 *
 * Both send the cross-origin header a browser needs, so a page on another web
 * address can read them directly. This demo uses SPARQL: one request per
 * district, no paging. The figures behind those sentences are in the README.
 */

/** The SPARQL endpoint. `GET` with the query in the address, JSON results back. */
export const SPARQL_URL = 'https://landregistry.data.gov.uk/landregistry/query';

/** The host, for a check that wants to know whether a request went to the API. */
export const API_HOST = 'landregistry.data.gov.uk';

/** How many months the window holds, ending on the newest month published. */
export const WINDOW_MONTHS = 24;

/**
 * The local authorities in the slice.
 *
 * `district` is the value HM Land Registry stores, which is upper case;
 * `name` is what the page shows. Three cities of a similar size with quite
 * different markets, each a few thousand sales over two years.
 */
export const DISTRICTS = [
  { slug: 'cambridge', district: 'CAMBRIDGE', name: 'Cambridge' },
  { slug: 'oxford', district: 'OXFORD', name: 'Oxford' },
  { slug: 'york', district: 'YORK', name: 'York' },
];

/** The property type, as the page names it, by the tail of the API's URI. */
export const PROPERTY_TYPES = {
  detached: 'Detached',
  'semi-detached': 'Semi-detached',
  terraced: 'Terraced',
  'flat-maisonette': 'Flat or maisonette',
  otherPropertyType: 'Other',
};

/** The order the property types are listed in, wherever they are listed. */
export const PROPERTY_TYPE_ORDER = ['Detached', 'Semi-detached', 'Terraced', 'Flat or maisonette', 'Other'];

/** The tenure, by the tail of the API's URI. */
export const TENURES = { freehold: 'Freehold', leasehold: 'Leasehold' };

/**
 * The transaction category, by the tail of the API's URI. A standard sale is
 * a home sold for its full market value to a private buyer; the additional
 * category covers buy-to-lets, repossessions and transfers under a power of
 * sale, which HM Land Registry publishes separately because the price is not
 * always a market one.
 */
export const CATEGORIES = {
  standardPricePaidTransaction: 'Standard',
  additionalPricePaidTransaction: 'Additional',
};

/** The price bands the table colours and can group by, lowest first. */
export const PRICE_BANDS = [
  { id: 'under250', label: 'Under £250k', max: 250000 },
  { id: '250to500', label: '£250k to £500k', min: 250000, max: 500000 },
  { id: '500to1m', label: '£500k to £1m', min: 500000, max: 1000000 },
  { id: 'over1m', label: '£1m and over', min: 1000000 },
];

/** The band a price falls in. */
export function bandOf(price) {
  for (const band of PRICE_BANDS) {
    if (band.min != null && price < band.min) continue;
    if (band.max != null && price >= band.max) continue;
    return band.label;
  }
  return PRICE_BANDS[PRICE_BANDS.length - 1].label;
}

/* ------------------------------------------------------------------ */
/* Months                                                              */
/* ------------------------------------------------------------------ */

/** `'2026-07'` for a `'2026-07-28'`. */
export function monthOf(date) {
  return String(date).slice(0, 7);
}

/** `'July 2026'` for a `'2026-07'`. */
export function monthLabel(month) {
  const [year, m] = String(month).split('-').map(Number);
  return new Date(Date.UTC(year, m - 1, 1)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** `'Jul 26'` for a `'2026-07'`: the short form, for a chart axis. */
export function monthShort(month) {
  const [year, m] = String(month).split('-').map(Number);
  return new Date(Date.UTC(year, m - 1, 1)).toLocaleDateString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' });
}

/** The month before `'2026-07'`, which is `'2026-06'`. */
export function previousMonth(month) {
  const [year, m] = String(month).split('-').map(Number);
  const d = new Date(Date.UTC(year, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** The `count` months ending on `newest`, oldest first. */
export function monthsEndingAt(newest, count) {
  const months = [];
  let month = newest;
  for (let i = 0; i < count; i += 1) {
    months.unshift(month);
    month = previousMonth(month);
  }
  return months;
}

/* ------------------------------------------------------------------ */
/* The query                                                           */
/* ------------------------------------------------------------------ */

const PREFIXES = `PREFIX lrppi: <http://landregistry.data.gov.uk/def/ppi/>
PREFIX lrcommon: <http://landregistry.data.gov.uk/def/common/>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
`;

/**
 * Every sale in one local authority on or after a date.
 *
 * The address is matched first, on its district, and the transactions hang
 * off it. The address parts are optional in the data (a handful of sales
 * have no postcode), so they are `OPTIONAL` here too rather than silently
 * dropping the sale.
 *
 * @param {string} district the value HM Land Registry stores, e.g. `'CAMBRIDGE'`
 * @param {string} from an ISO date, e.g. `'2024-08-01'`
 * @returns {string} the SPARQL
 */
export function salesQuery(district, from) {
  const literal = JSON.stringify(String(district));
  return `${PREFIXES}SELECT ?id ?date ?price ?ptype ?newBuild ?estate ?paon ?saon ?street ?town ?postcode ?county ?category ?status
WHERE {
  ?addr lrcommon:district ${literal} .
  ?t lrppi:propertyAddress ?addr ;
     lrppi:transactionId ?id ;
     lrppi:transactionDate ?date ;
     lrppi:pricePaid ?price ;
     lrppi:propertyType ?ptype ;
     lrppi:newBuild ?newBuild ;
     lrppi:estateType ?estate ;
     lrppi:transactionCategory ?category ;
     lrppi:recordStatus ?status .
  OPTIONAL { ?addr lrcommon:county ?county }
  OPTIONAL { ?addr lrcommon:paon ?paon }
  OPTIONAL { ?addr lrcommon:saon ?saon }
  OPTIONAL { ?addr lrcommon:street ?street }
  OPTIONAL { ?addr lrcommon:town ?town }
  OPTIONAL { ?addr lrcommon:postcode ?postcode }
  FILTER(?date >= "${from}"^^xsd:date)
}`;
}

/**
 * The newest sale date across the districts in the slice: how the window's
 * end is found before the window is fetched.
 *
 * @param {string[]} districts the stored district values
 * @returns {string} the SPARQL
 */
export function newestDateQuery(districts) {
  const values = districts.map((d) => JSON.stringify(String(d))).join(' ');
  return `${PREFIXES}SELECT (MAX(?date) AS ?latest)
WHERE {
  VALUES ?d { ${values} }
  ?addr lrcommon:district ?d .
  ?t lrppi:propertyAddress ?addr ; lrppi:transactionDate ?date .
}`;
}

/** The address a query is sent to: a `GET`, so it can be cached and linked to. */
export function queryUrl(sparql) {
  return `${SPARQL_URL}?query=${encodeURIComponent(sparql)}`;
}

/**
 * Send a query and return its bindings.
 *
 * @param {string} sparql the query
 * @param {object} [options]
 * @param {AbortSignal} [options.signal]
 * @param {Function} [options.fetch] a fetch to use instead of the global one
 * @returns {Promise<object[]>} the `results.bindings` array
 */
export async function runQuery(sparql, { signal, fetch: fetchFn } = {}) {
  const doFetch = fetchFn || globalThis.fetch;
  const response = await doFetch(queryUrl(sparql), {
    headers: { accept: 'application/sparql-results+json' },
    signal,
  });
  if (!response.ok) {
    throw new Error(`HM Land Registry answered ${response.status} ${response.statusText || ''}`.trim());
  }
  const body = await response.json();
  if (!body || !body.results || !Array.isArray(body.results.bindings)) {
    throw new Error('HM Land Registry answered with something other than SPARQL results.');
  }
  return body.results.bindings;
}

/* ------------------------------------------------------------------ */
/* Shaping                                                             */
/* ------------------------------------------------------------------ */

/** The last path segment of a URI: `'terraced'` from `.../common/terraced`. */
function tail(uri) {
  return String(uri || '').split('/').pop();
}

/** A binding's plain value, or null when the variable is unbound. */
function value(binding, name) {
  const cell = binding[name];
  return cell && cell.value != null ? cell.value : null;
}

/**
 * `'PERNE ROAD'` as `'Perne Road'`. HM Land Registry stores addresses in
 * capitals; a table of them is hard to read. Small words and possessives are
 * handled, and anything with a digit in it is left alone.
 */
export function titleCase(text) {
  if (text == null) return null;
  const small = new Set(['and', 'of', 'the', 'on', 'at', 'in', 'by', 'to']);
  return String(text)
    .toLowerCase()
    .split(/(\s+|-)/)
    .map((word, i) => {
      if (!word || /^\s+$/.test(word) || word === '-') return word;
      if (i > 0 && small.has(word)) return word;
      if (/\d/.test(word)) return word.toUpperCase();
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join('')
    .replace(/'S\b/g, "'s");
}

/**
 * One SPARQL binding as the row the page holds.
 *
 * @param {object} binding a row of `results.bindings`
 * @param {object} district the entry of {@link DISTRICTS} the query was for
 * @returns {object} the row
 */
export function shapeBinding(binding, district) {
  const date = value(binding, 'date');
  const price = Number(value(binding, 'price'));
  const saon = titleCase(value(binding, 'saon'));
  const paon = titleCase(value(binding, 'paon'));
  const postcode = value(binding, 'postcode');
  return {
    id: value(binding, 'id'),
    date,
    month: monthOf(date),
    price,
    type: PROPERTY_TYPES[tail(value(binding, 'ptype'))] || 'Other',
    newBuild: value(binding, 'newBuild') === 'true',
    tenure: TENURES[tail(value(binding, 'estate'))] || 'Unknown',
    address: [saon, paon].filter(Boolean).join(', ') || null,
    street: titleCase(value(binding, 'street')),
    town: titleCase(value(binding, 'town')),
    postcode,
    outward: postcode ? postcode.split(' ')[0] : null,
    district: district.name,
    county: titleCase(value(binding, 'county')),
    category: CATEGORIES[tail(value(binding, 'category'))] || 'Standard',
    status: tail(value(binding, 'status')),
    band: bandOf(price),
    /* Always 1: what a chart adds up and a group subtotal counts. */
    count: 1,
  };
}

/**
 * Fetch one district's sales from the API and shape them.
 *
 * @param {object} district an entry of {@link DISTRICTS}
 * @param {string} from the first date wanted, ISO
 * @param {object} [options] passed to {@link runQuery}
 * @returns {Promise<object[]>} the rows
 */
export async function fetchDistrict(district, from, options) {
  const bindings = await runQuery(salesQuery(district.district, from), options);
  return bindings.map((binding) => shapeBinding(binding, district));
}

/* ------------------------------------------------------------------ */
/* The saved copy                                                      */
/* ------------------------------------------------------------------ */

/** The fields a saved row carries, in the order its array holds them. */
export const SAVED_FIELDS = [
  'id', 'date', 'price', 'type', 'newBuild', 'tenure', 'address', 'street', 'town', 'postcode', 'county', 'category', 'status',
];

/**
 * Rows as the saved copy stores them: one array per row, the fields in
 * {@link SAVED_FIELDS} order, and no derived field. The derived ones are
 * cheap to put back and would triple the file.
 */
export function encodeRows(rows) {
  return { fields: SAVED_FIELDS, rows: rows.map((row) => SAVED_FIELDS.map((field) => row[field] ?? null)) };
}

/**
 * The saved rows back into what the page holds.
 *
 * @param {object} file the parsed JSON of a district file
 * @param {object} district the entry of {@link DISTRICTS} the file is for
 * @returns {object[]} the rows
 */
export function decodeRows(file, district) {
  const fields = file.fields || SAVED_FIELDS;
  return file.rows.map((cells) => {
    const row = {};
    fields.forEach((field, i) => {
      row[field] = cells[i];
    });
    row.month = monthOf(row.date);
    row.outward = row.postcode ? String(row.postcode).split(' ')[0] : null;
    row.district = district.name;
    row.band = bandOf(row.price);
    row.count = 1;
    return row;
  });
}

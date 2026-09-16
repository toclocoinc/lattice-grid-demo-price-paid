/**
 * The dashboard: one set of sales in the router, and every view built on top
 * of it.
 *
 * The data router is the hub. Nothing here fetches anything and nothing here
 * imports the grid: every factory is handed in.
 *
 * How the pieces fit together:
 *
 *   the saved copy   ->  the router  ->  the All sales grid   ->  the tiles
 *   then the API                     ->  (New builds derives       the type-by-type reading
 *                                          from it)                the type and price charts
 *                                                             ->  a derived grid, by month  -> the median chart
 *                                                             ->  a derived grid, by street -> the streets chart
 *
 * The page opens on the saved copy, then the live answer from HM Land
 * Registry goes through the same router as a keyed diff: rows the two share
 * are left alone, new ones are added, and only what changed is repainted.
 *
 * The district selector is a named filter on the table. Everything else is a
 * viewer of that table, so the tiles, the charts and the New builds tab all
 * narrow with it.
 */

import { DISTRICTS, PRICE_BANDS, PROPERTY_TYPE_ORDER, monthLabel, monthShort, previousMonth } from './land-registry.js';

/** Make an element with a class and optional text, the long way round. */
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/** A sum of money in pounds, rounded the way a reader says it. */
function pounds(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '-';
  if (n >= 1e6) return `£${(n / 1e6).toFixed(2)}m`;
  if (n >= 1e3) return `£${Math.round(n / 1e3).toLocaleString('en-GB')}k`;
  return `£${Math.round(n).toLocaleString('en-GB')}`;
}

/** One number, written the way a reader expects to see it. */
function commas(value) {
  return Number(value || 0).toLocaleString('en-GB');
}

/**
 * The histogram's ceiling. Above it the sales are mostly not homes: the
 * "other" category holds blocks of flats, commercial premises and portfolio
 * sales up to nine figures, and one of those stretches twenty-four equal
 * bands so far that every home lands in the first. The table keeps every
 * sale; the histogram reads the ones under this.
 */
const HISTOGRAM_CAP = 1500000;

/** A clock time, local to whoever is reading. */
function clockText(ms) {
  return new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

/**
 * The median of a list of numbers: the middle value, or the mean of the two
 * middle values when there is an even number of them. Null over nothing.
 */
export function median(values) {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  const n = sorted.length;
  if (!n) return null;
  return n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
}

/* ------------------------------------------------------------------ */
/* Columns                                                             */
/* ------------------------------------------------------------------ */

/**
 * The sale columns, grouped under three headings.
 *
 * The price column's total is the median rather than the sum, because the
 * sum of a column of house prices tells a reader nothing and the median is
 * the figure the market is described by. A group subtotal is then the median
 * for that street, type or month.
 *
 * @returns {object[]} the column definitions
 */
function saleColumns() {
  return [
    {
      title: 'The sale',
      columns: [
        {
          id: 'date',
          field: 'date',
          title: 'Date',
          type: 'date',
          filter: { type: 'date' },
          /* Newest first. It also decides the order of the per-type chart's
             categories: a chart lays them out in the order the table walks
             its rows. */
          sort: { direction: 'desc' },
          layout: { width: 110 },
        },
        {
          id: 'price',
          field: 'price',
          title: 'Price paid',
          type: 'number',
          format: { style: 'currency', currency: 'GBP', decimals: 0 },
          filter: { type: 'number' },
          total: 'median',
          groupTotal: 'median',
          layout: { width: 120 },
        },
        {
          id: 'type',
          field: 'type',
          title: 'Property type',
          filter: { type: 'set' },
          layout: { width: 140 },
        },
        {
          id: 'newBuild',
          field: 'newBuild',
          title: 'New build',
          type: 'boolean',
          filter: { type: 'boolean' },
          layout: { width: 90 },
        },
        {
          id: 'tenure',
          field: 'tenure',
          title: 'Tenure',
          filter: { type: 'set' },
          layout: { width: 100 },
        },
        {
          id: 'category',
          field: 'category',
          title: 'Category',
          filter: { type: 'set' },
          layout: { width: 100, hidden: true },
        },
      ],
    },
    {
      title: 'The property',
      columns: [
        {
          id: 'address',
          field: 'address',
          title: 'Number or name',
          filter: { type: 'text' },
          layout: { width: 150 },
        },
        {
          id: 'street',
          field: 'street',
          title: 'Street',
          filter: { type: 'text' },
          layout: { width: 190 },
        },
        {
          id: 'town',
          field: 'town',
          title: 'Town',
          filter: { type: 'set' },
          layout: { width: 120 },
        },
        {
          id: 'postcode',
          field: 'postcode',
          title: 'Postcode',
          filter: { type: 'text' },
          layout: { width: 100 },
        },
        {
          id: 'outward',
          field: 'outward',
          title: 'Postcode area',
          filter: { type: 'set' },
          layout: { width: 110, hidden: true },
        },
        {
          id: 'district',
          field: 'district',
          title: 'Local authority',
          filter: { type: 'set' },
          layout: { width: 130 },
        },
      ],
    },
    {
      title: 'For grouping',
      columns: [
        {
          id: 'month',
          field: 'month',
          title: 'Month',
          filter: { type: 'set' },
          layout: { width: 90 },
        },
        {
          id: 'band',
          field: 'band',
          title: 'Price band',
          filter: { type: 'set' },
          layout: { width: 130, hidden: true },
        },
        /* Always 1. It is what the charts add up and what a group subtotal
           counts, so it is available but starts out of the way. */
        {
          id: 'count',
          field: 'count',
          title: 'Sales',
          type: 'number',
          total: 'sum',
          groupTotal: 'sum',
          filter: { type: 'none' },
          layout: { width: 80, hidden: true },
        },
      ],
    },
  ];
}

/**
 * The colour on the price column: one rule per band, highest first, each
 * stopping the ones below it.
 *
 * These are conditional formatting rules the grid holds as runtime state, so
 * a reader can open the Formatting panel and change them.
 *
 * @returns {object} rules keyed by column id
 */
function formattingRules() {
  const styles = {
    over1m: { background: '#5b1a12', color: '#ffffff', fontWeight: '700' },
    '500to1m': { background: '#fbe3d6', color: '#7a2e12', fontWeight: '600' },
    '250to500': { background: '#fff7e0', color: '#5a4300' },
    under250: { background: '#e6f4ea', color: '#1b5e20' },
  };
  const rules = [];
  for (const band of [...PRICE_BANDS].reverse()) {
    rules.push({
      id: `band-${band.id}`,
      label: band.label,
      when: band.min != null ? { op: 'gte', value: band.min } : { op: 'lt', value: band.max },
      style: styles[band.id],
      stopIfTrue: true,
    });
  }
  return { price: rules };
}

/**
 * The shared grid settings both tables use.
 *
 * @param {string} title the table's heading
 * @returns {object} a partial grid config
 */
function baseGridConfig(title) {
  return {
    rowKey: 'id',
    columns: saleColumns(),
    formatting: formattingRules(),
    theme: 'light',
    density: 'compact',
    stripedRows: true,
    columnMenu: true,
    groupPanel: true,
    statusBar: true,
    find: true,
    grandTotalRow: 'bottom',
    groupDefaultExpanded: 0,
    toolPanel: { side: 'right', panels: ['filters', 'columns', 'formatting'] },
    selection: 'multiple',
    /* A row the live answer changed lights up for a moment rather than
       changing silently under the reader. */
    highlightOnChange: { colour: '#ffe8a3', duration: 2500 },
    title,
    rows: [],
  };
}

/* ------------------------------------------------------------------ */
/* The dashboard                                                       */
/* ------------------------------------------------------------------ */

/**
 * Build the whole page into `root`.
 *
 * @param {object} options
 * @param {HTMLElement} options.root where the dashboard is drawn
 * @param {Function} options.createGrid the grid factory
 * @param {Function} options.createHeadlessGrid the factory for a grid with no DOM
 * @param {Function} options.createChart the charts module's factory
 * @param {Function} options.createKPI the KPI module's factory
 * @param {Function} options.createTabs the tabs module's factory
 * @param {Function} options.createDataRouter the data router module's factory
 * @param {object[]} options.rows the sales to start with
 * @param {object} options.meta the saved copy's `meta.json`, and how the page was opened
 * @param {string|null} options.district the district slug to open on, or null for all
 * @returns {object} the pieces that were built, for a caller that wants them
 */
export function buildDashboard({
  root,
  createGrid,
  createHeadlessGrid,
  createChart,
  createKPI,
  createTabs,
  createDataRouter,
  rows,
  meta,
  district,
}) {
  root.textContent = '';

  const newest = meta.newest;
  const previous = previousMonth(newest);

  const marks = { start: performance.now() };
  const mark = (name) => { marks[name] = Math.round(performance.now() - marks.start); };

  const built = {
    marks,
    allGrid: null,
    newBuildGrid: null,
    monthGrid: null,
    streetGrid: null,
    router: null,
    kpi: null,
    charts: [],
    tabs: null,
    meta,
    /* Everything the page currently holds, by id. */
    store: new Map(),
    status: { live: false, liveAt: null, liveError: null, added: 0, updated: 0 },
    district: null,
  };

  /* ---------------- the masthead ---------------- */

  const header = el('header', 'head');
  const heading = el('div', 'head-text');
  heading.append(el('h1', null, 'House sales in Cambridge, Oxford and York'));
  heading.append(
    el(
      'p',
      'lede',
      `Every home sold in the three cities over the ${meta.months.length} months to ${monthLabel(newest)}, ` +
        'as registered with HM Land Registry. Pick a city; group, sort and filter the table; ' +
        'the figures and the charts follow it.',
    ),
  );
  const notice = el('p', 'notice');
  notice.hidden = true;
  heading.append(notice);
  header.append(heading);

  const provenance = el('div', 'head-note');
  const modePill = el('span', 'pill', 'Saved copy');
  const liveDot = el('span', 'dot');
  const freshness = el('span', 'freshness', '');
  provenance.append(modePill, freshness);
  header.append(provenance);
  root.append(header);

  /* ---------------- the tiles ---------------- */

  const kpiHost = el('section', 'kpi-strip');
  kpiHost.setAttribute('aria-label', 'Headline figures');
  const panelHost = el('div', 'kpi-panel');
  const typeTile = el('div', 'kpi-types');
  typeTile.append(el('div', 'kpi-types-label', 'Average price by property type, in view'));
  const typeList = el('dl', 'kpi-types-list');
  typeTile.append(typeList);
  kpiHost.append(panelHost, typeTile);
  root.append(kpiHost);

  /* ---------------- the charts ---------------- */

  const chartHost = el('section', 'chart-wrap');
  chartHost.setAttribute('aria-label', 'Charts');
  const chartBoxes = [];
  for (let i = 0; i < 4; i += 1) {
    const box = el('div', 'chart-box');
    chartHost.append(box);
    chartBoxes.push(box);
  }
  root.append(chartHost);

  /* ---------------- the controls ---------------- */

  const actions = el('div', 'actions');
  root.append(actions);

  /* ---------------- the tables ---------------- */

  const tabsHost = el('section', 'tabs-host');
  root.append(tabsHost);

  const tabs = createTabs(tabsHost, {
    createGrid,
    /* So a tab that has not been opened yet still carries a live count. */
    createHeadlessGrid,
    ariaLabel: 'Sales views',
    tabs: [
      {
        id: 'all',
        label: 'All sales',
        badge: true,
        config: baseGridConfig('Every sale in the window'),
      },
      /*
       * Derived from the first table by the tabs module: its source is built
       * over the All table's rows, narrowed by `where`, and kept in step as
       * rows arrive. `follow: 'filtered'` means it narrows with the district
       * selector and with any filter the reader sets on the All table: it is
       * the new-build subset of whatever is in view.
       */
      {
        id: 'newbuild',
        label: 'New builds',
        badge: true,
        from: 'all',
        where: (row) => row.newBuild === true,
        follow: 'filtered',
        config: baseGridConfig('New builds in the window'),
      },
    ],
  });
  built.tabs = tabs;
  built.allGrid = tabs.tab('all');
  mark('tabs');

  /* ---------------- the router ---------------- */

  /*
   * One stream in, one table out, and everything else derived from or bound
   * to that table. A load is a keyed diff: when the live answer arrives, the
   * rows it shares with the saved copy are left alone, new ones are added,
   * and only what changed is repainted.
   */
  const router = createDataRouter({
    key: () => 'all',
    rowKey: 'id',
  });
  built.router = router;
  router.attach(built.allGrid, () => true);

  tabs.on('tab:changed', (event) => {
    if (event.id === 'newbuild' && !built.newBuildGrid) built.newBuildGrid = tabs.tab('newbuild');
  });

  /* The first load: the whole saved copy in one snapshot. */
  for (const row of rows) built.store.set(row.id, row);
  router.load([...built.store.values()]);
  mark('routerLoad');

  /* ---------------- the derived grids ---------------- */

  /*
   * The median price by month, derived from the table and following its
   * filter. A chart bound to the table itself would add prices up, and the
   * sum of a month's house prices is not a figure anyone wants; the derived
   * grid reduces each month to its median and the chart draws that.
   */
  const monthGrid = createHeadlessGrid({
    rowKey: '__key',
    source: {
      mode: 'derived',
      from: built.allGrid,
      follow: 'filtered',
      groupBy: 'month',
      select: {
        median: { of: 'price', fn: 'median' },
        sales: { fn: 'count' },
      },
      sort: [{ col: 'month', dir: 'asc' }],
    },
    columns: [
      { id: 'month', field: 'month', title: 'Month' },
      { id: 'label', title: 'Month', value: { deps: ['month'], compute: (deps) => monthShort(deps.month) } },
      { id: 'median', field: 'median', title: 'Median price', type: 'number' },
      { id: 'sales', field: 'sales', title: 'Sales', type: 'number' },
    ],
  });
  built.monthGrid = monthGrid;
  mark('monthGrid');

  /* The sales under the histogram's ceiling, for the price chart. */
  const histogramGrid = createHeadlessGrid({
    rowKey: 'id',
    source: {
      mode: 'derived',
      from: built.allGrid,
      follow: 'filtered',
      where: (row) => row.price < HISTOGRAM_CAP,
    },
    columns: [
      { id: 'price', field: 'price', title: 'Price', type: 'number' },
      { id: 'count', field: 'count', title: 'Sales', type: 'number' },
    ],
  });
  built.histogramGrid = histogramGrid;
  built.histogramCap = HISTOGRAM_CAP;
  mark('histogramGrid');

  /* The ten streets with the most sales in view, for the streets chart. */
  const streetGrid = createHeadlessGrid({
    rowKey: '__key',
    source: {
      mode: 'derived',
      from: built.allGrid,
      follow: 'filtered',
      where: (row) => !!row.street,
      groupBy: 'street',
      select: { sales: { fn: 'count' }, median: { of: 'price', fn: 'median' } },
      sort: [{ col: 'sales', dir: 'desc' }, { col: 'street', dir: 'asc' }],
      limit: 10,
    },
    columns: [
      { id: 'street', field: 'street', title: 'Street' },
      { id: 'sales', field: 'sales', title: 'Sales', type: 'number' },
      { id: 'median', field: 'median', title: 'Median price', type: 'number' },
    ],
  });
  built.streetGrid = streetGrid;
  mark('streetGrid');

  /* ---------------- the tiles, bound to the All table ---------------- */

  const kpi = createKPI(panelHost, {
    /*
     * Bound to the table. The panel reads what the table currently matches
     * and follows it on its own: the district selector, a filter, a grouping
     * (the rows under a collapsed heading included) and the live answer all
     * reach the tiles without the host handing it anything.
     */
    grid: built.allGrid,
    rowKey: 'id',
    /* The columns the custom tiles and the type-by-type reading need on each
       projected row. */
    fields: ['price', 'type', 'month'],
    columns: 5,
    ariaLabel: 'Headline figures',
    tiles: [
      { id: 'sales', label: 'Sales in view', aggregation: 'count', format: 'number' },
      {
        id: 'latest',
        label: `Sales in ${monthLabel(newest)}, so far`,
        aggregation: 'count',
        filter: (row) => row.month === newest,
        format: 'number',
      },
      {
        id: 'median',
        label: 'Median price in view',
        aggregation: 'custom',
        format: { type: 'currency', currency: 'GBP', decimals: 0 },
        compute: (tileRows) => median(tileRows.map((row) => Number(row.price))),
      },
      {
        id: 'average',
        label: 'Average price in view',
        aggregation: 'avg',
        field: 'price',
        format: { type: 'currency', currency: 'GBP', decimals: 0 },
      },
      {
        id: 'change',
        label: `Median, ${monthShort(newest)} against ${monthShort(previous)}`,
        aggregation: 'custom',
        format: { type: 'percent', decimals: 1 },
        /* The median of the newest month's sales in view against the median
           of the month before, over the same rows in view. Both months are
           still filling in, so this moves as registrations land. */
        compute: (tileRows) => {
          const now = [];
          const before = [];
          for (const row of tileRows) {
            if (row.month === newest) now.push(Number(row.price));
            else if (row.month === previous) before.push(Number(row.price));
          }
          const a = median(now);
          const b = median(before);
          if (a == null || b == null || !b) return null;
          return (a - b) / b;
        },
      },
    ],
  });
  built.kpi = kpi;

  /**
   * The average price for each property type, over the rows in view.
   *
   * Five numbers rather than one, so not a tile: it is drawn by hand from
   * the bound panel's own rows each time the panel says it has re-read the
   * table, and reads the same rows the tiles do.
   */
  const refreshTypeTile = () => {
    const sums = new Map();
    kpi.rows.forEach((row) => {
      const entry = sums.get(row.type) || { total: 0, n: 0 };
      entry.total += Number(row.price) || 0;
      entry.n += 1;
      sums.set(row.type, entry);
    });
    typeList.textContent = '';
    built.typeAverages = {};
    for (const type of PROPERTY_TYPE_ORDER) {
      const entry = sums.get(type);
      if (!entry || !entry.n) continue;
      const average = entry.total / entry.n;
      built.typeAverages[type] = { average, sales: entry.n };
      const term = el('dt', null, type);
      const detail = el('dd', null, `${pounds(average)}`);
      detail.title = `${commas(entry.n)} sales`;
      typeList.append(term, detail);
    }
    if (!typeList.children.length) typeList.append(el('dt', null, 'No sales in view'));
  };
  kpi.on('change', refreshTypeTile);
  refreshTypeTile();
  mark('kpi');

  /* ---------------- the charts ---------------- */

  const chartSpecs = [
    {
      grid: monthGrid,
      type: 'line',
      x: 'label',
      y: 'median',
      title: 'Median price by month, in view',
      axis: { x: { labels: true, rotate: 'auto', every: 3 }, y: 'Median price' },
      legend: false,
    },
    {
      grid: built.allGrid,
      type: 'bar',
      x: 'type',
      y: 'count',
      title: 'Sales by property type, in view',
      axis: { y: 'Sales', x: { labels: true } },
      legend: false,
    },
    {
      grid: histogramGrid,
      type: 'histogram',
      /*
       * A histogram bins its measure, one reading per row, so the price is
       * the `y` and there is no `x`. Naming a category column as well would
       * make the chart add the prices up per category first and bin the
       * sums, which is a different chart.
       */
      y: 'price',
      buckets: 24,
      title: `Sales under ${pounds(HISTOGRAM_CAP)} by price, in view`,
      axis: { x: 'Price paid, in pounds', y: 'Sales' },
      legend: false,
    },
    {
      grid: streetGrid,
      type: 'horizontalBar',
      x: 'street',
      y: 'sales',
      title: 'Ten streets with the most sales, in view',
      axis: { x: 'Sales' },
      margin: { left: 118 },
      legend: false,
    },
  ];

  chartSpecs.forEach((spec, index) => {
    try {
      built.charts.push(createChart({ container: chartBoxes[index], ...spec }));
    } catch (error) {
      chartBoxes[index].append(el('p', 'chart-error', `This chart could not be drawn: ${error.message}`));
      console.error('[price paid demo] chart', spec.type, error);
    }
    mark(`chart${index}`);
  });

  /* ---------------- the controls ---------------- */

  const button = (label, onClick, className) => {
    const node = el('button', className || 'action', label);
    node.type = 'button';
    node.addEventListener('click', onClick);
    return node;
  };

  /* The district selector: a named filter on the All table, which every
     other view follows. */
  const districtSelect = el('select', 'district-select');
  districtSelect.setAttribute('aria-label', 'Local authority');
  const allOption = el('option', null, 'All three cities');
  allOption.value = '';
  districtSelect.append(allOption);
  for (const entry of DISTRICTS) {
    const option = el('option', null, entry.name);
    option.value = entry.slug;
    districtSelect.append(option);
  }
  built.districtSelect = districtSelect;

  /**
   * Narrow the table to one city, or widen it back to all three.
   *
   * @param {string|null} slug a district slug, or null or '' for all
   * @returns {boolean} whether the slug named a district
   */
  built.selectDistrict = (slug) => {
    const entry = DISTRICTS.find((d) => d.slug === slug) || null;
    built.district = entry ? entry.slug : null;
    districtSelect.value = entry ? entry.slug : '';
    /* A named row predicate: registering it is what activates it, and
       removing it by name leaves any other filter the reader has set
       untouched. */
    built.allGrid.filters.where('district', entry ? (row) => row.district === entry.name : null);
    const url = new URL(location.href);
    if (entry) url.searchParams.set('district', entry.slug);
    else url.searchParams.delete('district');
    history.replaceState(null, '', url);
    setFreshness();
    return !!entry;
  };
  districtSelect.addEventListener('change', () => built.selectDistrict(districtSelect.value));

  actions.append(el('span', 'actions-label', 'City'));
  actions.append(districtSelect);

  const group = (ids) => () => built.allGrid && built.allGrid.columns.group(ids);

  actions.append(el('span', 'actions-gap'));
  actions.append(el('span', 'actions-label', 'Group by'));
  actions.append(button('Street', group(['street'])));
  actions.append(button('Property type', group(['type'])));
  actions.append(button('Month', group(['month'])));
  actions.append(button('Price band', group(['band'])));
  actions.append(button('Type, then month', group(['type', 'month'])));
  actions.append(button('No grouping', group([])));

  actions.append(el('span', 'actions-gap'));
  actions.append(el('span', 'actions-label', 'Order by'));
  actions.append(button('Newest first', () => built.allGrid && built.allGrid.sort.set([{ col: 'date', dir: 'desc' }])));
  actions.append(button('Highest price first', () => built.allGrid && built.allGrid.sort.set([{ col: 'price', dir: 'desc' }])));

  const standardButton = button('Standard sales only', () => {
    const on = standardButton.getAttribute('aria-pressed') === 'true';
    built.allGrid.filters.where('standard', on ? null : (row) => row.category === 'Standard');
    standardButton.setAttribute('aria-pressed', String(!on));
    standardButton.classList.toggle('on', !on);
  }, 'action toggle');
  standardButton.setAttribute('aria-pressed', 'false');
  standardButton.title = 'Leave out buy-to-lets, repossessions and transfers under a power of sale, which HM Land Registry publishes as additional price paid transactions';
  actions.append(el('span', 'actions-gap'));
  actions.append(standardButton);
  built.standardButton = standardButton;

  /* The grouping and ordering act on the All table, so they only belong on
     its tab. The city selector belongs everywhere. */
  const tabActions = [...actions.children].slice(2);
  const showActionsFor = (id) => {
    for (const node of tabActions) node.hidden = id !== 'all';
  };
  showActionsFor(tabs.activeId);
  tabs.on('tab:changed', (event) => showActionsFor(event.id));

  /* ---------------- the readout ---------------- */

  /** Say what the reader is looking at, where it came from, and how fresh it is. */
  function setFreshness() {
    const taken = new Date(meta.fetchedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    const where = built.district ? DISTRICTS.find((d) => d.slug === built.district).name : 'all three cities';
    const window = `${monthLabel(meta.months[0])} to ${monthLabel(newest)}`;
    if (built.status.live) {
      const changed = built.status.added || built.status.updated
        ? ` ${commas(built.status.added)} new and ${commas(built.status.updated)} changed since the copy was saved.`
        : ' Nothing has changed since the copy was saved.';
      freshness.textContent = `Sales in ${where}, ${window}, read from HM Land Registry at ${clockText(built.status.liveAt)}.${changed}`;
    } else {
      freshness.textContent = `Sales in ${where}, ${window}, from a copy taken on ${taken}.`;
    }
  }
  built.setFreshness = setFreshness;

  /* ---------------- the live answer ---------------- */

  /**
   * Take the live answer from HM Land Registry: put it through the router as
   * a keyed diff and say so.
   *
   * @param {object[]} liveRows every sale the API returned
   * @param {number} at when it was received
   */
  built.onLive = (liveRows, at) => {
    const before = new Map(built.store);
    built.store.clear();
    for (const row of liveRows) built.store.set(row.id, row);
    const diffs = router.load([...built.store.values()]);
    let added = 0;
    let updated = 0;
    let removed = 0;
    for (const diff of diffs) {
      added += diff.added || 0;
      updated += diff.updated || 0;
      removed += diff.removed || 0;
    }
    built.status.live = true;
    built.status.liveAt = at || Date.now();
    built.status.liveError = null;
    built.status.added = added;
    built.status.updated = updated;
    built.status.removed = removed;
    built.status.savedRows = before.size;
    modePill.textContent = 'Live';
    modePill.prepend(liveDot);
    liveDot.classList.add('beat');
    setTimeout(() => liveDot.classList.remove('beat'), 900);
    notice.hidden = true;
    kpi.refresh();
    setFreshness();
  };

  /**
   * Take a failed live fetch: keep the saved copy on screen, say what
   * happened.
   *
   * @param {Error} error what went wrong
   */
  built.onLiveError = (error) => {
    built.status.live = false;
    built.status.liveError = String((error && error.message) || error);
    const taken = new Date(meta.fetchedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    notice.textContent =
      `HM Land Registry could not be reached, so this is the saved copy taken on ${taken}. Reloading the page will try again.`;
    notice.hidden = false;
    setFreshness();
    console.warn('[price paid demo] the live fetch failed, keeping the saved copy:', built.status.liveError);
  };

  /* ---------------- the footer ---------------- */

  const footer = el('footer', 'foot');
  const credit = el('p', 'attribution', meta.attribution);
  footer.append(credit);
  const line = el('p', null, 'Source: ');
  const link = el('a', null, 'HM Land Registry Price Paid Data');
  link.href = meta.sourceUrl || 'https://landregistry.data.gov.uk/';
  link.rel = 'noopener';
  line.append(link);
  line.append(
    document.createTextNode(
      ', read from the linked-data SPARQL endpoint. A sale reaches the register two weeks to two months ' +
        'after it completes, so the newest two months are incomplete and their figures will rise as ' +
        'registrations land. Prices are what was paid, as recorded; they are not adjusted. HM Land Registry ' +
        'publishes a month of sales on the twentieth working day of the month after.',
    ),
  );
  footer.append(line);
  root.append(footer);

  /* The opening view. */
  built.selectDistrict(district);
  mark('district');
  setTimeout(() => mark('firstTimeout'), 0);
  requestAnimationFrame(() => mark('firstFrame'));

  built.destroy = () => {
    for (const chart of built.charts) chart.destroy();
    kpi.destroy();
    router.destroy();
    tabs.destroy();
    streetGrid.destroy();
    histogramGrid.destroy();
    monthGrid.destroy();
  };

  return built;
}

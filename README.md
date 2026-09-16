# House sales in Cambridge, Oxford and York, from HM Land Registry

A dashboard of every home sold in three English cities over the last two
years, from HM Land Registry Price Paid Data, built on Lattice Grid and
reading the Land Registry's linked-data API directly from the browser.

**[See it running](https://toclocoinc.github.io/lattice-grid-demo-price-paid/)**

| | |
| --- | --- |
| Grid on npm | [@toclocoinc/lattice-grid](https://www.npmjs.com/package/@toclocoinc/lattice-grid) |
| This demo | [toclocoinc/lattice-grid-demo-price-paid](https://github.com/toclocoinc/lattice-grid-demo-price-paid) |
| Product site | [latticegrid.dev](https://www.latticegrid.dev) |
| Data | [HM Land Registry Price Paid Data](https://landregistry.data.gov.uk/), Open Government Licence v3.0 |

Contains HM Land Registry data © Crown copyright and database right 2026. This data is licensed under the Open Government Licence v3.0.

## What it shows

One set of sales in a data router with several views on it: a table of every
sale, a strip of headline figures, four charts, and a second tab of the new
builds. Everything reads the same rows, so choosing a city, or grouping,
sorting or filtering the table, moves the figures and the charts with it.

The page opens on a saved copy that ships with the demo, so it is on screen
in well under a second. It then asks HM Land Registry for the same window of
sales, and the live answer goes through the router as a keyed diff: the rows
the two share are left alone, the new ones are added, and only what changed
is repainted. The badge at the top says which you are looking at. If the API
cannot be reached, the saved copy stays and the page says so.

**The table.** One row per sale: the date, the price paid, the property type,
whether it was a new build, the tenure, the number or name, the street, the
town, the postcode, the local authority and the month. Group by street,
type, month or price band; sort; filter any column; search the whole table.
The price column's total is the median rather than the sum, so a group
subtotal is the median for that street or that month. Prices are coloured by
band, under £250k to £1m and over; that is a conditional formatting rule the
grid holds, and the Formatting panel lets a reader change it.

**Headline figures.** A KPI panel bound to the table
(`createKPI(host, { grid, rowKey, fields, tiles })`), so it reads whatever the
table currently matches and follows it on its own: sales in view, sales in
the newest month so far, the median price, the average price, and the change
in the median between the newest month and the one before. The median is the
middle value, or the mean of the two middle values when the count is even.
The one reading that is not a tile is the average price for each property
type, which is five numbers rather than one; it is drawn by hand from the
bound panel's own rows.

**Charts.** The median price month by month; sales by property type; how
many sales at each price; and the ten streets with the most sales. The type
chart is bound to the table itself. The other three are bound to derived
grids over the table (`source: { mode: 'derived', from, follow: 'filtered' }`),
because they need something a chart bound to the raw rows cannot give: a
median per month, a top ten, and a ceiling on the price so that one nine-figure
commercial sale does not stretch every home into the first band. The
derived grids follow the table's filter, so all four charts narrow with it.

**Tabs.** The New builds tab is derived from the All sales table by the tabs
module (`from` and `where`), with a live count on the tab before it has ever
been opened. It follows the table's filter, so it is the new-build subset
of whatever is in view.

**A city selector.** Choosing a city is a named filter on the table, and the
city is in the address (`?district=oxford`), so a view can be linked to.

## The API, as measured

Everything below was established by real requests from Node on 16 September
2026, not read from the documentation alone.

- **Two ways in, both keyless.** A linked-data API at
  `https://landregistry.data.gov.uk/data/ppi/transaction-record.json` with
  filters such as `propertyAddress.district=CAMBRIDGE`,
  `propertyAddress.postcode=CB1 2AB`, `min-transactionDate=2024-08-01` and
  `_sort=-transactionDate`; and a SPARQL endpoint at
  `https://landregistry.data.gov.uk/landregistry/query`, `GET` with the
  query in the address or `POST` as a form, JSON results back with
  `Accept: application/sparql-results+json`.
- **CORS: yes, on both.** The linked-data API answers
  `Access-Control-Allow-Origin: *`. The SPARQL endpoint reflects the
  requesting origin (`Access-Control-Allow-Origin: https://toclocoinc.github.io`
  with `Access-Control-Allow-Credentials: true`) and answers a preflight
  `OPTIONS` with `GET,POST` and the usual headers allowed. A page on GitHub
  Pages can therefore read either directly, and this demo does.
- **Why SPARQL.** The linked-data API pages two hundred records at a time,
  whatever `_pageSize` asks for, and a page of a district query took seven
  seconds. A district's two years is fourteen pages and over a minute and a
  half. One SPARQL request answers the same in four to thirteen seconds.
- **Response sizes.** SPARQL results are verbose: 2,730 sales came back as
  3.5 MB of JSON, about 1.3 KB a sale. The saved copy stores the same rows
  as compact arrays, 1.9 MB for 11,615 sales.
- **Rate limits.** None documented and none observed: no rate-limit header
  on any answer, and four requests in quick succession were all answered.
  HM Land Registry's own search page states a one-minute time limit on a
  query. The requests here take seconds.
- **Cadence.** HM Land Registry publishes a month of sales on the twentieth
  working day of the month after; July 2026 appeared on 28 August 2026, and
  on 16 September the newest sale in the data was dated 31 July 2026. A
  sale is registered two weeks to two months after it completes, so the
  newest two months are incomplete when they first appear and fill in over
  the following releases. Earlier months also change a little as late
  registrations land.
- **Record status.** Every record in the window carried the status `add`.
  The dataset also has `change` and `delete` statuses for corrections; the
  page shows the status column hidden by default.
- **Attribution.** Required, in exactly these words: "Contains HM Land
  Registry data © Crown copyright and database right 2026. This data is
  licensed under the Open Government Licence v3.0."

## The slice

Every sale in three local authorities, Cambridge, Oxford and York, for the
twenty-four months to the newest month published: 11,615 sales on the day the
copy was taken (Cambridge 2,730, Oxford 2,933, York 5,952), in 1.9 MB of saved
JSON.

Why that shape:

- **Three cities, not one.** A city selector needs more than one city to
  select, and three markets with different price levels make the medians
  and the type averages worth comparing. Each is a few thousand sales over
  two years, so a city is a table a reader can group by street and read the
  groups.
- **Twenty-four months.** Enough for a year-on-year comparison at any point,
  and for the seasonal shape to show twice. The newest month is thin on the
  day it appears, for the reason under "Cadence" above, and the page says so.
- **Every sale, standard and additional.** HM Land Registry publishes
  buy-to-lets, repossessions and transfers under a power of sale as
  "additional" price paid transactions, because the price is not always a
  market one. They are in the table with a Category column, and a toggle
  leaves them out.
- **Eleven thousand rows.** The grid holds that without noticing; the point
  of the slice is that every view is readable, not that the browser is
  full.

## Running it

You need Node. Nothing is compiled and there is no build step.

```
npm install
npm start
```

The server prints the address to open, for example `http://localhost:41234/`.
It picks a free port each time so it will not clash with anything else you
have running.

| Address | What you get |
| --- | --- |
| `/` | the saved copy, then the live answer from HM Land Registry |
| `/?source=snapshot` | the saved copy in `data/snapshot`, no network needed |
| `/?district=york` | open narrowed to one city: `cambridge`, `oxford` or `york` |

The saved copy lives in `data/snapshot/` and records when it was taken. To
take a fresh one:

```
npm run snapshot
```

A workflow does that every night and publishes the page when the copy has
changed.

## Files

```
index.html                page shell
main.js                   opens the saved copy, then asks the API
src/licence.js            the key for the demo's own published address
src/land-registry.js      the API: the query, the shaping, the saved copy's format
src/dashboard.js          the views: router, tables, tiles, charts, tabs
styles.css                the page around the grid
tools/serve.mjs           a small static file server
tools/build-snapshot.mjs  take a fresh copy from the API into data/snapshot
tools/verify.mjs          open it in a real browser and check it
data/snapshot/meta.json   the window, the districts, the counts, the attribution
data/snapshot/districts/  one file per city, a compact array of rows
.github/workflows/        publish on push; refresh the saved copy nightly
```

## Checking it

```
npm run verify              # the saved copy, and the fallback with the API blocked
npm run verify -- --live    # also the live page, against the raw API answer
npm run verify -- --shots out/   # the same, saving screenshots
```

`npm run verify` needs Node 22 and a Chrome or Chromium on the machine. It is
not a smoke test: it recomputes every headline figure from the saved files
in Node, the medians included, and compares it with what the page shows, to
the pound; checks the twenty-four points of the median chart and the ten
streets one by one; narrows the table to Oxford and insists the tiles, the
charts and the tab count moved with it and still agree with the
recomputation over Oxford's rows; turns on the standard-sales toggle and
checks again; groups the table and insists the rows under the collapsed
groups still count; opens the New builds tab and insists it holds exactly
the new-build sales; and insists the required attribution is on the page
word for word. It then blocks the API in the browser, opens the default
page, and insists the saved copy is on screen and says why. None of that
needs the internet, so it gates the deployment. `--live` opens the default
page with the API reachable, fetches the same query from the API in Node,
reduces the raw SPARQL bindings without going through the page's code, and
insists the live page agrees with that.

## Things worth knowing about the data

- Prices are what was paid, in pounds, as recorded on the register. They are
  not adjusted for anything.
- Addresses are stored in capitals at source; the page title-cases them.
  A handful of sales have no postcode.
- The "Other" property type covers what is not a house or a flat: blocks of
  flats sold whole, commercial premises, land, portfolios. It is where the
  very large prices live, which is why the price histogram stops at £1.5m
  and says so.
- The median-by-month chart is a derived grid's `median` reduction; the
  grid's own convention for an even count is the mean of the two middle
  values, and the verification checks that it agrees with Node's, month by
  month.
- The window the page asks the API for is the saved copy's window, so the
  live answer covers the same months plus anything registered since. When
  HM Land Registry publishes a new month, the nightly refresh rolls the
  window forward.

## Licence

The code in this repository is available under the MIT licence. See
[LICENSE](LICENSE).

Contains HM Land Registry data © Crown copyright and database right 2026. This data is licensed under the Open Government Licence v3.0.

Lattice Grid itself is a separate commercial product with its own terms. It
is free to use on localhost, with no key and no watermark, so a copy of this
repository runs unrestricted on your own machine. This demo carries a key for
its own published address only, which is why you will find one in the
source. Keys for your own sites come from
[latticegrid.dev](https://www.latticegrid.dev).

# BizTrack — Current specification

BizTrack is a static SvelteKit/Svelte 5 PWA for expense and mileage tracking across
businesses. It calls Google Drive and Sheets directly using `fetch`; there is no
application server or database. Drive folder sharing controls access. Styling uses
Tailwind CSS and CSS variables with a dark theme. GitHub Pages serves the app at
`biztrack.lol`, with directory indexes for each route and a static 404 page.

This document describes the current implementation. Historical designs remain in
[the decision log](log.md); they are not requirements to restore retired features.

## Workflows

Routes below are relative to `/beta/` or `/v/<version>/`. The site root is the version chooser.

| Route | Behavior |
|-------|----------|
| `/` | Selected business, current-year expense/mileage list, uncategorized count, entry buttons. |
| `/expense` | Create, edit, delete, split expenses; attach receipts; share a completion link. |
| `/mileage` | Create, edit, delete trips; round-trip toggle, driver defaults, favorite routes. |
| `/history` | Browse the selected business's available years and open rows for editing. |
| `/review` | Open uncategorized expenses from the current year and previous two years; skip IDs persist for the page session. |
| `/settings` | Business list, account sign-out/disconnection, bank import link. |
| `/settings/business` | Browse My Drive, Shared Drives, or shared folders; add or reconnect a business. |
| `/settings/business-config` | Edit a business name or remove it from the personal index without deleting Drive data. |
| `/settings/categories` | Add/remove shared categories or restore defaults; `Uncategorized` cannot be removed. |
| `/settings/favorites` | Remove personal favorite mileage routes for the selected business. |
| `/settings/csv-import` | Preview and import debit transactions from the supported bank export. |
| `/share` | Consume a temporarily cached shared receipt, then navigate toward expense entry. |
| `/privacy`, `/terms` | Public pages that do not require authentication. |

Expense entry suggests vendors and payment methods from current-year history.
Picking a vendor fills empty category/payment fields from its latest transaction.
Payment methods are free text with autocomplete, not a separate configured list.
Single-entry amounts use calculator-style cents input. Split rows share the date,
vendor, payment method, receipt, notes, and submitter, with individual descriptions,
amounts, and categories. New expenses preserve date/category/payment after saving.

Mileage entry suggests origins, destinations, and drivers. A destination can fill
an empty origin from its latest trip. Round trip doubles the entered miles before
storage. Favorites preserve the entered miles and round-trip flag. Duplicate
confirmation compares cached date, origin, destination, effective miles, and driver.
Mileage fields remain populated after saving. Mileage rates and deductions are not
calculated or stored by the current app.

Transaction links use `/expense` or `/mileage` with `biz`, `year`, and `txn` query
parameters. `returnTo` preserves the history year or review workflow. Existing
parameter names and business UUIDs are compatibility requirements.

## Drive data and ownership

```text
<Business Folder>/
  config.json
  <year>/
    <year>_<business-name>_expenses       (Google spreadsheet)
    <year>_<business-name>_Receipts/      (receipt files)

BizTrack/                               (user's Drive root)
  profile.json
```

Characters `/ \ : * ? " < > |` are stripped from the business name used in file
names. Discovery scans four-digit year folders. Missing year structures are created
when adding/loading a business or submitting a backdated entry. Concurrent setup
calls for the same business/year share one operation. Existing cached IDs are
retained when recovering a known year whose children are not found.

`config.json` holds the business `id`, `name`, and shared `categories`. Older config
fields, including `mileage_favorites`, may remain on disk; personal favorites are
read from the profile instead. Config writes preserve existing unrelated fields.

`profile.json` contains:

- `businesses`: entries with `name` and `folderId`; file IDs are rediscovered.
- `mileage_favorites`: arrays keyed by business folder ID. Each favorite has `name`,
  `from`, `to`, `miles`, `purpose`, `driver`, and optional `roundTrip`.
- `default_drivers`: driver names keyed by business folder ID.

Each spreadsheet has bold/frozen headers and these ordered columns:

| Tab | Column order |
|-----|--------------|
| Expenses, A–J | Date, Vendor/Payee, Description, Amount, Category, Payment Method, Receipt, Notes, Submitted By, ID |
| Mileage, A–H | Date, From, To, Purpose/Description, Miles, Saved By, ID, Driver |

IDs are UUIDs. Edits/deletes locate the current row by its UUID column, rather than
saving a row number across requests. Reads omit rows without a UUID. The receipt
column holds a filename, not a Drive file ID; editing resolves it within that year's
receipts folder. Keep column order and these meanings compatible with existing data.

## Loading, authentication, and offline changes

Google Identity Services supplies a short-lived access token. The OAuth client ID
is the only build-time credential. The app requests the full Drive scope for its
folder-browser/shared-file workflows. See [Google setup](google_cloud_setup.md).

A restored token's account is verified before cached business data is exposed.
Expiry/reconnection preserves a mounted form and receipt. Waiting requests share
one reconnect operation; a rejected HTTP 401 is retried once after authorization.
Other failed writes are not automatically retried by the auth layer. Sign-out clears
local account state; disconnection additionally revokes the Google grant. Pending
offline changes require syncing or explicit discard before either action.

Svelte stores hold session state. `bt_cache` in localStorage holds business/config
snapshots and transaction arrays keyed by spreadsheet ID and tab. Cache failures
are non-fatal. Home/history render cached rows immediately and share a two-tab
refresh with a 60-second cooldown. Concurrent callers join the same request; failed
requests release their marker and can retry. Results from a cleared account session
cannot repopulate the cache. Writes invalidate the relevant refresh cooldown.

`biztrack_offline_queue` holds failed create/update/delete operations. Unlike the
convenience cache, queued changes can be the only copy: storage write failure must
surface. The queue drains on reconnect or an online event with valid authorization.
It retains failures except entries treated as missing/deleted destinations. It is
not a general guarantee that every form action can begin and finish offline: auth,
folder creation, and receipt upload can require connectivity.

## Receipts, import, and PWA

Images are converted with Canvas to JPEG at quality 0.7, at most 1920 pixels on the
longest side. PDFs pass through. Filenames follow `YYYY-MM-DD_VENDOR_N.ext`, with a
sanitized/truncated vendor and an available counter determined from the folder's
existing filenames. File selection supports the platform's camera/gallery/files
chooser. Receipt bytes are uploaded before the ledger write.

CSV import supports the fixed bank export's Posting Date, Transaction Type, Amount,
Description, and Extended Description columns. It imports debits, converts amounts
to positive values, previews five rows, and uses an entered payment method. Vendor
history from the current and previous year supplies a category only when that vendor
has one distinct known category. Duplicate detection uses date/vendor/amount rounded
to two decimals, including duplicates within the imported file. Writes are batched
by year. The parser handles commas and doubled quotes within a line; it does not
support quoted multiline records or arbitrary bank schemas.

Workbox precaches each build's routes and assets. Google requests are not
service-worker cached. Each build has its own manifest identity and worker scope.
Beta retains legacy local storage and receipt cache names; fixed versions prefix
their keys with the build path. Sign-out clears only that version's account data;
Google revocation can affect every version using the grant.

Beta updates can activate while forms remain mounted; reload is offered only when
safe. Fixed release assets are reused unchanged. Android shares POST to the same
build's `/share/` route, then redirect there with GET to consume the cached receipt.
The root migration worker passes version routes through, serves cached modules for
old open tabs, and forwards legacy receipt shares to beta without clearing data.
See [releases](releases.md) for deployment and migration details.

## Known limitations and separate correctness work

- Cross-year edits and split replacements delete the original before appending
  replacements. Failure between requests is not atomic; cross-year offline recovery
  can queue an update for a destination row that does not exist. A recoverable
  compound-write design is separate from the simplification work.
- Renaming a business changes its config name but does not rename existing year
  files or synchronize every name reference. Do not treat rename as a file migration.
- Browser-local data and tokens are not an encrypted vault. Unfinished forms are not
  backed up across reload/browser termination; ambiguous network failures can leave
  partial multi-request operations. UUID lookup and mutation are separate API calls.

## Validation and release checks

Run `npm test`, `npm run check`, and `npm run build`. CI runs these before uploading
the Pages artifact. The Node/assert scripts cover auth, queue protections, shared
refreshes, Drive pagination/year setup, links, and entry payloads with mocked API
calls. Version checks cover storage isolation and receipt handoff; Python checks
cover release archives, catalog generation, and unchanged release files across deployments.
TypeScript checks cover TS modules; the plain-JS Svelte scripts receive build
compilation and targeted handler checks, not comprehensive static type checking.

Before release, use test Drive data and exercise:

- Add/reconnect a business, browse shared folders, and switch businesses during loading.
- Create single/split expenses with image/PDF receipts; edit/delete and return to history.
- Save mileage with round trip, duplicate confirmation, favorites, and default drivers.
- Import the supported bank CSV twice; verify duplicate counts and year destinations.
- Review uncategorized rows, skip, and apply a vendor category across the review years.
- Lose connectivity, reconnect, reject/cancel authorization, and sign out with pending changes.
- Install the PWA, navigate offline, and activate an update without losing an entry.
- Check Android receipt sharing and the separate failure cases above before claiming support.

# Implementation reference

- **Audience:** developers changing behavior or persisted data.
- **Stack:** SvelteKit 2, Svelte 5 runes, Tailwind 4, `adapter-static`, Workbox `injectManifest`.
- **Runtime:** browser → Google Identity Services, Drive API v3, Sheets API v4; no application server.
- **Hosting:** GitHub Pages; directory indexes; scoped manifests/workers. [Deployment](releases.md).

## Routes

App-relative paths; production bases: `/beta/`, `/v/<version>/`, `/demo/`.

| Route | Behavior |
|---|---|
| `/` | Business selector; current-year transactions; uncategorized count; entry buttons |
| `/expense` | Create, edit, delete, split; optional receipt |
| `/mileage` | Create, edit, delete; manual total miles; driver defaults; favorites |
| `/history` | Year selector; transaction editing |
| `/review` | Uncategorized expenses: current year + previous two; session-only skipped IDs |
| `/settings` | Businesses, import, sign-out, Google disconnection |
| `/settings/business` | Add/import business; My Drive, Shared Drives, shared folders |
| `/settings/business-config` | Rename; remove from personal index without deleting Drive files |
| `/settings/categories` | Shared categories; `Uncategorized` required |
| `/settings/favorites` | Remove personal favorite routes |
| `/settings/csv-import` | Preview/import supported bank CSV |
| `/share` | Consume cached Android receipt; open expense form |
| `/privacy`, `/terms` | Public; no authentication required |

- Transaction URLs: `biz`, `year`, `txn`; optional `returnTo` for history/review.
- Preserve query names, business IDs, receipt filename semantics; change data formats only through explicit upgrades.
- Expense amount input: calculator-style cents. Autocomplete: current-year vendors/payment methods.
- Splits: shared date/vendor/payment/receipt/notes/submitter; separate descriptions/amounts/categories.
- Mileage: one description; positive finite total miles entered manually; driver required.
- Drivers: selected business, all years; empty focus shows all names by trip count; exact/prefix/substring/subsequence matching while typing. Pending writes overlaid by sheet/transaction ID; alphabetical ties.
- Duplicate-trip confirmation: date + description + numeric total miles + driver.
- No GPS tracking or mileage-rate/deduction calculation.

## Drive layout

```text
<Business Folder>/
  config-v2.json
  <year>/
    <year>_<name>_expenses_v2 # Spreadsheet: Expenses + Mileage tabs
    <year>_<name>_Receipts/   # Receipt files

BizTrack/                   # User's Drive root
  profile-v2.json
```

| File | Fields |
|---|---|
| `config-v2.json` | `dataVersion: 2`, business `id`, `name`, shared `categories` |
| `profile-v2.json` | `dataVersion: 2`; `businesses`: name/folderId pairs; `mileage_favorites` and `default_drivers`: keyed by business folder ID |
| Favorite route | `name`, `description`, total `miles`, `driver` |

| Tab | Ordered columns |
|---|---|
| Expenses A–J | Date, Vendor/Payee, Description, Amount, Category, Payment Method, Receipt, Notes, Submitted By, ID |
| Mileage A–F | Date, Description, Miles, Saved By, ID, Driver |

- Headers: bold, frozen. Mileage writes: literal descriptions; numeric distance.
- IDs: opaque strings; new entries use UUIDs; split replacements use `<originalId>-split-<n>`.
- Reads: omit rows without IDs. Updates/deletes: rescan ID column before mutation.
- Receipt field: filename, resolved in the transaction year's receipt folder.
- File names: strip `/ \ : * ? " < > |` from business name.
- Year discovery: four digits; missing structures created on setup/backdated entry.
- Concurrent setup: one in-flight operation per business/year; cached child IDs retained during recovery.

## Data upgrades

- Data version: integer, independent of app version. Current: `2`; legacy conversion isolated in `upgrade.ts`.
- Before workspace/queue replay: inspect version; explicit **Back up & upgrade** prompt. New accounts/demo use version 2 directly.
- Sweep all registered businesses/years; native spreadsheet copies; originals and legacy JSON retained.
- Copies: `_v2` suffix; merge From/To/Purpose into Description; retain recorded total miles and IDs. Legacy round-trip favorites: multiply once.
- Verify all copied tab values; recheck sources; publish version 2 configs/profile. Receipts stay in their existing folders.
- `upgrade-v1-v2.json`: per-business source/copy IDs, fingerprints, verification progress. Tagged copies recover lost responses.
- `biztrack_upgrade_1_2`: account-bound local queue backup and cutover status. Original queue retained until completion; IDs remapped before replay.
- Block on failed verification, changed sources, unrecognized data/formulas in mileage, unmapped queued writes, or storage failure. No automatic deletion/rollback.
- Offline: upgrade needs connectivity once; subsequent cached entry remains available.
- Old versions: original files only; later edits never merged. Close other writers before upgrading; no cross-device lock.

## Authentication and local state

| Component | Contract |
|---|---|
| Auth | Public OAuth client ID; full `drive` scope; browser token model; no refresh token |
| Restore | Verify token's account before exposing cached workspace |
| Reconnect | Same-account verification; mounted form/receipt retained; one shared authorization wait |
| API retry | Rejected HTTP 401 once after authorization; no automatic replay of other write failures |
| Sign Out | Clear this version's local account data; retain Google grant |
| Disconnect | Revoke Google grant, then clear local account data; other devices/versions may be affected |
| `bt_cache_v2` | Business/config/transaction snapshots; cache-write failure non-fatal |
| Refresh | Home/history share both-tab refresh; 60-second cooldown; writes invalidate; stale sessions cannot repopulate cache |
| Unsaved forms | Memory only; reload/browser termination loses input |

## Durable writes

- `biztrack_offline_queue_v2`: saved pending operations; localStorage write failure must surface.
- Drain: online + valid authorization; triggered on reconnect/online event.
- Simple operations: create/update/delete; failures retained except destinations treated as missing/deleted.
- Compound operation: `replace`; source/destination IDs, original ID, replacement rows persisted together.
- Sequence: append missing replacements → read back every field → delete original.
- Replacement writes: literal text (`RAW`); numeric amounts/distances. Confirmation: unformatted values.
- Unchanged retries: stable IDs; reuse matching copies. Conflicts/duplicate IDs: stop before deletion.
- Failed compound operation: retain queue entry, including 404; block later queued writes from overtaking it.
- Sign-out/disconnection: sync or explicitly discard pending operations.
- Offline limits: authorization, folder creation, receipt upload can require connectivity.

## Receipts and CSV

| Feature | Contract |
|---|---|
| Images | Canvas → JPEG, quality 0.7, longest side ≤1920px |
| PDFs | Unmodified |
| Names | `YYYY-MM-DD_VENDOR_N.ext`; sanitized vendor; available folder counter |
| Upload order | Receipt bytes before ledger write |
| CSV columns | Posting Date, Transaction Type, Amount, Description, Extended Description |
| Import | Debits only; positive amounts; five-row preview; supplied payment method; writes grouped by year |
| Categories | Current/prior-year vendor history; auto-match only one distinct known category |
| CSV duplicates | Date + vendor + amount rounded to cents; includes duplicates within input |
| Parser limits | Quoted commas/doubled quotes supported; multiline fields and arbitrary bank schemas unsupported |

## Demo

- Two fictional businesses; distinct current/prior-year expenses and trips.
- Core tracking, splits, history, review, business switching: enabled.
- Business settings, CSV, receipt upload/sharing, favorite management, default-driver changes: disabled.
- Data/preferences: memory only; separate tabs; reload restores seed data.
- **Reset demo:** confirmation → reload home. **Exit demo:** root chooser.
- No Google requests, persistent queue writes, account-data access, sync indicator, or install prompt.
- Worker: static-file caching under `/demo/`; manifest: no share target.

## PWA and version isolation

- Each build: manifest identity, scope, worker, static caches.
- Beta: unprefixed storage keys. Fixed releases: path-prefixed keys. Cache/queue keys also identify the data model.
- Same origin: prefixes prevent collisions, not access by other same-origin code.
- Google requests: network only; no service-worker caching.
- Beta updates: deferred reload while forms/operations are active.
- Android shares: POST to build's `/share/`; temporary receipt cache; GET redirect to consumer.
- Root migration worker: preserve old cached modules/forms; forward legacy shares to beta.

## Known limitations and separate correctness work

- Cross-sheet writes: no atomic transaction; interrupted operations can leave both copies until retry.
- Concurrent writers: ID lookup and mutation are separate requests; no distributed lock.
- Cross-year receipt files: not relocated with ledger entries; filename lookup uses the destination year's folder.
- Business rename: config change; existing files and all name references not migrated.
- Browser storage: no app-level encryption; clearing it loses unsynced work.
- Single creates: ambiguous network failures can still duplicate writes on retry.

## Validation

| Command | Coverage |
|---|---|
| `npm test` | Auth; queue durability; replacement failure/retry paths; form handlers; refresh; Drive pagination/setup; demo isolation; driver ranking; upgrade failure/retry paths; release assembly |
| `npm run check` | TypeScript modules; excludes plain-JS Svelte scripts |
| `npm run build` | Production compilation and prerendering |
| `npm run build:demo` | Separate demo build |

[Manual release checks](releases.md#release-checks)

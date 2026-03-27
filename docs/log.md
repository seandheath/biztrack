# BizTrack — Decision Log

---

## 2026-03-27 — SvelteKit + adapter-static + GitHub Pages

**Decision:** Use SvelteKit 2 with `adapter-static` (pure SPA output) deployed to GitHub Pages via GitHub Actions. Custom domain: `biztrack.lol`.

**Rationale:** Zero infrastructure cost. GitHub Pages is free, HTTPS via Let's Encrypt, no server to maintain. `adapter-static` with `fallback: '404.html'` gives SPA routing without a server. Custom domain registered separately.

**Alternatives considered:** Vercel or Netlify (free tiers, but adds third-party dependency and account overhead). Cloudflare Workers (overkill for static). Self-hosted (maintenance burden).

---

## 2026-03-27 — Google Drive as database, zero backend

**Decision:** All user data is stored in the user's own Google Drive. No BizTrack server, no BizTrack database. The app is a browser client that talks directly to Google APIs.

**Rationale:** Users in Sean's context (small LLC accountants) already use Google Workspace. Their data lives where they control it. Zero backend means zero hosting cost, zero data breach surface, and access control is handled entirely by Drive sharing permissions (no in-app user management needed).

**Alternatives considered:** Firebase Firestore (adds a backend dependency, cost after free tier, Sean controls the data). Supabase (same issues). IndexedDB only (no multi-device, no accountant access).

---

## 2026-03-27 — `drive.file` OAuth scope

**Decision:** Use only `https://www.googleapis.com/auth/drive.file` — the narrowest Drive scope that covers all required operations.

**Rationale:** `drive.file` is non-sensitive; it only grants access to files the app creates or the user explicitly selects via Picker. Google's OAuth consent screen does not require app verification for non-sensitive scopes, so the app can stay in "Testing" mode indefinitely for a small user base. Full `drive` scope would expose all Drive files unnecessarily.

**Alternatives considered:** `drive.readonly` + `drive` (too broad). `drive.appdata` (hidden app folder, accountant can't access files directly). `spreadsheets` alone (would not cover Drive file/folder operations).

---

## 2026-03-27 — GIS token model (implicit, not authorization code)

**Decision:** Use Google Identity Services (GIS) `initTokenClient` token model. Tokens are obtained via browser popup with no server-side OAuth exchange.

**Rationale:** No server means no server-side OAuth code exchange. The token model is appropriate for single-page apps with no backend. Tokens are short-lived (1 hour) and held in memory only. GIS is Google's current recommended approach (the older `gapi.auth2` is deprecated).

**Alternatives considered:** Authorization code flow with PKCE (requires a redirect URI handler, adds complexity with no benefit since there's no server to persist refresh tokens). `gapi.auth2` (deprecated).

---

## 2026-03-27 — Memory-only token storage

**Decision:** The OAuth access token is stored in a module-level variable in `auth.js` only. It is NOT written to localStorage, sessionStorage, or any other persistent store.

**Rationale:** Access tokens stored in `localStorage` are vulnerable to XSS — any injected script can read them. Storing in memory means the token is gone on page reload (user must re-authenticate), which is an acceptable UX trade-off for the security boundary. The 1-hour token lifetime limits exposure even if XSS were somehow exploited.

**Alternatives considered:** `sessionStorage` (same XSS exposure as localStorage, clears on tab close). `httpOnly` cookie (requires a server).

<!-- TODO:SECURITY — If XSS attack surface ever grows (e.g., user-controlled content rendered as HTML), revisit token storage. Current risk is low since the app renders no user-provided HTML. -->

---

## 2026-03-27 — Raw fetch() instead of gapi.client

**Decision:** All Google API calls use raw `fetch()` with `Authorization: Bearer` headers. The `gapi.client` library is not used.

**Rationale:** `gapi.client` is ~90KB of JavaScript loaded from Google's CDN, adds initialization latency, and provides no functionality not available via `fetch()`. All Drive, Sheets, and Picker APIs are fully accessible via REST calls. The `apiFetch()` wrapper in `auth.js` handles Bearer injection and 401 handling centrally.

**Alternatives considered:** `gapi.client` (heavier, CDN dependency, deprecation risk). `googleapis` npm package (Node.js oriented, massive bundle).

---

## 2026-03-27 — Svelte 5 (runes API)

**Decision:** Use Svelte 5 with the runes API (`$state`, `$derived`, `$derived.by`, `$props`, `$bindable`, `$effect`).

**Rationale:** Svelte 5 runes are explicit and easier to reason about than Svelte 4's implicit reactivity. The project started when Svelte 5 was at release candidate stage and has remained on the stable 5.x line throughout.

**Alternatives considered:** Svelte 4 (older reactivity model, fewer explicit guarantees). React (heavier runtime). Vue (heavier, less ergonomic for small apps).

---

## 2026-03-27 — injectManifest SW strategy (vs. generateSW)

**Decision:** Use `@vite-pwa/sveltekit` with `strategies: 'injectManifest'` and a custom `src/service-worker.js`. The service worker handles both Workbox precaching and the Android Web Share Target.

**Rationale:** `generateSW` mode generates the service worker entirely from Workbox config — no room for custom fetch handlers. The Web Share Target requires intercepting POST `/share` requests in the service worker, caching the shared file blob, and redirecting to `/`. This custom logic requires `injectManifest` so the SW source is hand-authored and Workbox only injects the precache manifest.

**Alternatives considered:** `generateSW` with `runtimeCaching` (no support for custom fetch handlers). Separate SW registration outside the plugin (creates coordination problems with Workbox's precaching).

---

## 2026-03-27 — Canvas API for client-side receipt compression

**Decision:** Images attached as receipts are compressed to JPEG at 70% quality, max 1920px on the longest side, using the browser Canvas API before upload to Drive.

**Rationale:** Phone camera photos are typically 3–8MB. Uploading them raw to Drive is slow on mobile connections and wastes Drive quota. Canvas compression is synchronous-capable, requires no libraries, and works in all modern browsers. 70% quality at 1920px produces files typically under 300KB while remaining visually acceptable for receipt records.

**Alternatives considered:** `browser-image-compression` npm library (additional dependency). Server-side compression (requires a backend). No compression (poor UX on slow connections, Drive quota waste). WebP format (better compression but PDFs and other files still need JPEG fallback; complicates filename logic).

---

## 2026-03-27 — Drive folder structure per business and year

**Decision:**
```
<Business Drive Folder>/
  config.json                (payment methods, mileage favorites)
  2026/
    2026_expenses            (Google Sheet with Expenses + Mileage tabs)
    2026_Receipts/           (folder for receipt files)
  2025/
    2025_expenses
    2025_Receipts/
```

**Rationale:** Year-based subfolder isolation allows the accountant to hand off a complete `2025/` folder at year-end without touching ongoing data. The Google Sheet is named after the year to avoid confusion if accessed outside the app. Receipts go in a separate folder to keep the sheet clean.

**Alternatives considered:** Single spreadsheet with year as a column (hard to hand off, grows unboundedly). One sheet per month (too many files). No year subfolder (all files in root, gets messy quickly).

---

## 2026-03-27 — Per-business config.json in Drive

**Decision:** Each business has a `config.json` file in its root Drive folder containing `payment_accounts` and `mileage_favorites`.

**Rationale:** Keeping config in Drive (rather than localStorage) means multiple users sharing the same business folder all see the same payment methods and favorites. No out-of-sync states between devices or users. localStorage is only a cache.

**Alternatives considered:** localStorage only (no multi-user sync, data lost on browser clear). Separate "BizTrack app data" Drive folder (breaks the per-business isolation, harder to share).

---

<!-- TODO:FEATURE — Consider adding an IndexedDB offline queue so expenses/mileage can be queued when offline and submitted when connectivity returns. Currently offline submissions show an error and the form is preserved. -->

<!-- TODO:FEATURE — GPS mileage tracking (capture route + auto-compute miles) was explicitly out of scope for v1. Revisit if users request it. -->

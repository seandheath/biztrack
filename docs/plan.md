# BizTrack PWA — Implementation Plan

## Reference Documents

- **Specification:** `pwa_specification.md`
- **Technical Validation:** PWA research findings

## Architecture Summary

This is a **fully client-side PWA** with zero backend infrastructure:

- **SvelteKit 2** with `adapter-static` outputs a pure static SPA
- **Google Identity Services (GIS)** handles auth via token model (browser popup, no server)
- **Google Picker API** handles Drive folder selection (native JavaScript, no WebView hack)
- **Google Drive API v3** + **Sheets API v4** called via raw `fetch()` (no gapi.client)
- **`drive.file` scope only** — non-sensitive, covers all Drive + Sheets operations on app-created and Picker-selected files
- **Tailwind CSS** for styling with system light/dark mode
- **GitHub Pages** for hosting via GitHub Actions deployment
- **localStorage** for convenience caching (business list, vendor names, last-used business)

## Project Structure

```
biztrack/
  src/
    routes/
      +layout.svelte
      +layout.js
      +page.svelte              # Main: expense/mileage entry
      share/
        +page.svelte            # Web Share Target handler (Android)
      settings/
        +page.svelte
        business/+page.svelte
        payments/+page.svelte
        favorites/+page.svelte
    lib/
      auth.js
      drive.js
      sheets.js
      picker.js
      store.js
      constants.js
      storage.js
      receipt.js
      business.js
    components/
      BusinessDropdown.svelte
      VendorAutocomplete.svelte
      ReceiptPicker.svelte
      FavoriteRouteList.svelte
      Toast.svelte
    app.html
    app.css
  static/
    icon-192.png
    icon-512.png
    icon-512-maskable.png
    .nojekyll
    CNAME
  .github/workflows/deploy.yml
  svelte.config.js
  vite.config.js
  tailwind.config.js
  package.json
```

---

## Implementation Phases

### Phase 1: Project Scaffold & Build Pipeline

**Goal:** Empty SvelteKit app builds, deploys to GitHub Pages, and is installable as a PWA.

#### Step 1.1 — Create SvelteKit project with dependencies

- Run `npx sv create biztrack` (skeleton project, TypeScript)
- Install dependencies:
  - `@sveltejs/adapter-static`
  - `@vite-pwa/sveltekit`
  - `tailwindcss` + `@tailwindcss/vite`
- Configure `svelte.config.js`:
  - Use `adapter-static` with `fallback: '404.html'` (SPA routing for GitHub Pages)
  - Set `paths.base` to `''` if using custom domain, or `'/repo-name'` for project site
- Configure `+layout.js`:
  - `export const ssr = false;`
  - `export const prerender = true;`
- Run `npm run build` and verify output in `build/` directory includes `index.html` and `404.html`
- **Test:** `npm run dev` serves the app locally. `npm run build && npm run preview` works.

#### Step 1.2 — Tailwind CSS and theming

- Configure Tailwind via `@tailwindcss/vite` plugin in `vite.config.js`
- Create `app.css` with Tailwind imports and CSS custom properties for light/dark mode:
  - Use `@media (prefers-color-scheme: dark)` for system-following theme
  - Define color variables for surfaces, text, primary actions
- Update `app.html`:
  - Add viewport meta tag for mobile
  - Add `<meta name="theme-color">`
  - Add `<meta name="apple-mobile-web-app-capable" content="yes">`
  - Add `<link rel="apple-touch-icon">`
- Create `+layout.svelte` with a minimal app shell: top bar, main content slot
- **Test:** App renders with Tailwind styles. Toggle system dark mode, theme follows.

#### Step 1.3 — PWA configuration

- Configure `@vite-pwa/sveltekit` in `vite.config.js`:
  - `registerType: 'autoUpdate'`
  - Manifest: name, short_name, display: standalone, icons (192, 512, 512 maskable)
  - Workbox: `globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}']`
  - Set `base` to match `paths.base` from SvelteKit config
- Create placeholder icons in `static/`
- Add `.nojekyll` to `static/`
- **Test:** Build the app, serve locally, verify manifest loads in DevTools → Application. Verify install prompt appears in Chrome.

#### Step 1.4 — GitHub Actions deployment

- Create `.github/workflows/deploy.yml`:
  - Trigger on push to `main`
  - Permissions: `pages: write`, `id-token: write`
  - Steps: checkout → setup-node → `npm ci` → `npm run build` → `actions/upload-pages-artifact@v3` → `actions/deploy-pages@v4`
- In GitHub repo Settings → Pages → Source: select "GitHub Actions"
- If using custom domain: add `CNAME` file to `static/` with domain name, configure DNS (CNAME record for subdomain, or A records for apex)
- Push to main branch, verify GitHub Action runs and site deploys
- **Test:** Visit the GitHub Pages URL. App loads. PWA is installable. Direct link to a deep route (e.g., `/settings`) loads via 404.html fallback.

#### Step 1.5 — Placeholder screens and routing

- Create route files:
  - `src/routes/+page.svelte` — main screen placeholder ("Expense Entry")
  - `src/routes/settings/+page.svelte` — settings placeholder
  - `src/routes/settings/business/+page.svelte` — add business placeholder
  - `src/routes/settings/payments/+page.svelte` — manage payments placeholder
  - `src/routes/settings/favorites/+page.svelte` — manage favorites placeholder
- Update `+layout.svelte`:
  - Top bar with "BizTrack" title and gear icon linking to `/settings`
  - Back button on settings pages linking to parent
- Verify client-side routing works (navigate between pages, no full reload)
- **Test:** All routes render. Navigation works. Deploy to GitHub Pages, verify deep links work via 404.html fallback.

---

### Phase 2: Google Authentication

**Goal:** User can sign in with Google and the app holds a valid access token.

#### Step 2.1 — Google Cloud project setup documentation

- Create `docs/google_cloud_setup.md` documenting:
  - Creating a Google Cloud project
  - Enabling Drive API, Sheets API, and Picker API
  - Creating an OAuth 2.0 client ID (Web application type)
  - Setting Authorized JavaScript Origins (production URL + `http://localhost:5173`)
  - Creating an API key restricted to Picker API
  - Configuring OAuth consent screen: app name, scope (`drive.file`), test user emails
  - Setting publishing status to "Testing"
- **Test:** Documentation is complete (manual review).

#### Step 2.2 — Auth module

- Create `src/lib/auth.js`:
  - `loadGisScript()` — dynamically loads `https://accounts.google.com/gsi/client` if not already loaded
  - `initTokenClient(clientId, scopes)` — calls `google.accounts.oauth2.initTokenClient()` with callback
  - `requestToken()` — calls `tokenClient.requestAccessToken()`, returns promise resolving with token response
  - `refreshToken(loginHint)` — calls `requestAccessToken` with `prompt: ''` and `login_hint` for near-silent refresh
  - `getToken()` — returns current access token string or null
  - `isTokenValid()` — checks if token exists and hasn't expired
  - `revokeToken()` — calls `google.accounts.oauth2.revoke(token)`
- Store token, expiry timestamp, and user email in module-level variables (memory only)
- **Test:** Manual: sign-in popup appears, token returned. `getToken()` returns value. `isTokenValid()` returns true.

#### Step 2.3 — Auth store and sign-in screen

- Create `src/lib/store.js` (auth-related stores, expanded in later steps):
  - `authToken` — Svelte writable store holding current token (or null)
  - `userEmail` — Svelte writable store holding signed-in email
  - `isAuthenticated` — Svelte derived store (`!!$authToken`)
- Update `+layout.svelte`:
  - If `!$isAuthenticated`: show sign-in screen (centered "Sign in with Google" button)
  - If `$isAuthenticated`: show normal app shell with content slot
  - Button calls `requestToken()`, updates stores on success
- **Test:** Manual: app shows sign-in. Click button, popup appears. On success, transitions to main screen. Refresh: must sign in again (token in memory only).

#### Step 2.4 — Token refresh handling

- In `+layout.svelte` or a dedicated component:
  - Set interval (every 30 seconds): check `isTokenValid()`
  - When token has < 5 minutes remaining: show a "Session expiring" banner with "Continue" button
  - "Continue" button calls `refreshToken(email)` — near-instant popup
  - If any API call returns 401: clear token store, show sign-in screen
- Create an `apiFetch` wrapper function that:
  1. Checks `isTokenValid()` before every call
  2. Adds `Authorization: Bearer` header
  3. Catches 401 → triggers re-auth
  4. Catches network errors → throws descriptive error
- **Test:** Manual: sign in, verify refresh banner appears before token expires. Click Continue, token refreshed.

---

### Phase 3: Google Drive Service

**Goal:** App can create folders, upload files, and read/write JSON in Drive.

#### Step 3.1 — Drive module: folder operations

- Create `src/lib/drive.js`:
  - All functions take `token` as first argument (or use the `apiFetch` wrapper)
  - `createFolder(token, name, parentId)` — POST to Drive files endpoint with folder MIME type, returns `{id, name}`
  - `listFolders(token, parentId)` — GET files list filtered by parent + folder MIME type + not trashed, returns array of `{id, name}`
  - `findFile(token, name, parentId)` — search for file by name in parent, return id or null
  - `getFileMeta(token, fileId)` — returns `{id, name, parents}`
- Error handling: check `response.ok`, throw on 401/403/404 with descriptive messages
- **Test:** Manual: call `createFolder` from console, verify in Drive. Call `listFolders`, verify results.

#### Step 3.2 — Drive module: file operations

- Add to `src/lib/drive.js`:
  - `uploadFile(token, filename, blob, mimeType, parentId)` — multipart upload via FormData, returns `{id, name}`
  - `downloadJson(token, fileId)` — GET file with `alt=media`, parse and return JSON
  - `uploadJson(token, filename, data, parentId)` — create new JSON file in folder
  - `updateJson(token, fileId, data)` — PATCH existing file with new JSON content
  - `moveFile(token, fileId, newParentId, oldParentId)` — PATCH with addParents/removeParents
- **Test:** Manual: upload JSON, download it, verify roundtrip. Upload image file, verify in Drive.

---

### Phase 4: Google Sheets Service

**Goal:** App can create spreadsheets and append rows.

#### Step 4.1 — Sheets module: create spreadsheet

- Create `src/lib/sheets.js`:
  - `createExpenseSheet(token, title)`:
    - POST to Sheets create endpoint with two named sheets and header rows
    - Expenses headers: Date, Vendor/Payee, Description, Amount, Category, Payment Method, Receipt, Notes
    - Mileage headers: Date, From, To, Purpose/Description, Miles, IRS Standard Rate, Deduction Amount
    - Bold + freeze first row
    - Returns `{spreadsheetId}`
    - Note: created in Drive root — caller must move to correct folder
- **Test:** Manual: create sheet, open in browser, verify two tabs with headers.

#### Step 4.2 — Sheets module: append and read

- Add to `src/lib/sheets.js`:
  - `appendRow(token, spreadsheetId, sheetName, values)` — POST to values.append endpoint with `USER_ENTERED` + `INSERT_ROWS`
  - `readColumn(token, spreadsheetId, sheetName, column)` — GET values for a column range, return flat array
- **Test:** Manual: append row, verify in sheet. Read column B, verify vendor list returned.

---

### Phase 5: Google Picker Integration

**Goal:** User can browse Drive and select a folder via the native Picker.

#### Step 5.1 — Picker module

- Create `src/lib/picker.js`:
  - `loadPickerApi()` — dynamically loads `https://apis.google.com/js/api.js`, then `gapi.load('picker', callback)`, returns promise
  - `openFolderPicker(token, apiKey, appId)` — returns Promise resolving with `{id, name}`:
    - Build picker with `ViewId.FOLDERS`, `setSelectFolderEnabled(true)`
    - Set token, developer key, app ID
    - On PICKED action: resolve with folder doc
    - On CANCEL: resolve with null
- **Test:** Manual: call `openFolderPicker`, Picker overlay renders, select folder, verify `{id, name}` returned.

---

### Phase 6: Constants, Storage, and Stores

**Goal:** Define shared data structures, constants, and local persistence.

#### Step 6.1 — Constants

- Create `src/lib/constants.js`:
  - `QUICKBOOKS_CATEGORIES` — array of all category strings
  - `IRS_RATES` — `{2024: 0.67, 2025: 0.70, 2026: 0.70}`
  - `DRIVE_SCOPE` — scope URI string
  - `DEFAULT_PAYMENT_METHODS` — `['Cash']`
  - `GOOGLE_CLIENT_ID`, `GOOGLE_API_KEY`, `GOOGLE_APP_ID`
- **Test:** Import and verify all constants defined.

#### Step 6.2 — Local storage wrapper

- Create `src/lib/storage.js`:
  - `get(key, fallback)` — JSON.parse from localStorage with try/catch
  - `set(key, value)` — JSON.stringify to localStorage with QuotaExceeded handling
  - `remove(key)`
- **Test:** Unit test: roundtrip, fallback, invalid JSON handling.

#### Step 6.3 — Svelte stores

- Expand `src/lib/store.js`:
  - `businesses` — writable store (array of business objects with name, folderId, yearFolders, sheetIds, receiptFolderIds)
  - `selectedBusiness` — writable store (current business object or null)
  - `businessConfig` — writable store (payment_accounts + mileage_favorites)
  - `vendorCache` — writable store (array of vendor name strings)
  - Initialize all from localStorage on module load
  - Subscribe to stores → persist to localStorage on change
- **Test:** Set values, verify localStorage. Reload page, verify stores initialized from cache.

---

### Phase 7: Business Management

**Goal:** User can add a business, app creates Drive folder structure.

#### Step 7.1 — Business setup logic

- Create `src/lib/business.js`:
  - `setupBusiness(token, name, folderId)`:
    1. Check if `config.json` exists in folder via `findFile`
    2. If not: create default config
    3. If yes: download and parse
    4. Return config
  - `ensureYearFolder(token, business, year)`:
    1. Check for `YYYY/` subfolder
    2. If not: create folder, create sheet (move to folder), create `YYYY_Receipts/`
    3. Return updated business object with new IDs
- **Test:** Manual: setup a business with a test folder. Call ensureYearFolder, verify structure in Drive.

#### Step 7.2 — Add business screen

- Build `src/routes/settings/business/+page.svelte`:
  - Text input for name
  - "Select Drive Folder" button → `openFolderPicker`
  - Shows selected folder name
  - "Add Business" button → loading → setupBusiness → ensureYearFolder → update stores → navigate to settings
  - Validation: name not empty, folder selected, no duplicate name
- **Test:** Manual: add business by selecting shared folder. Add another with new folder. Both in store.

#### Step 7.3 — Settings screen

- Build `src/routes/settings/+page.svelte`:
  - Businesses list with delete button
  - "Add Business" link
  - "Payment Methods" link (per selected business)
  - "Mileage Favorites" link
  - Account section: email + sign out
- **Test:** Manual: list, add, remove businesses. Sign out works.

---

### Phase 8: Expense Entry Form

**Goal:** User can submit expenses that write to Google Sheets.

#### Step 8.1 — Main screen layout

- Build `src/routes/+page.svelte`:
  - If no businesses: message with link to Settings
  - `BusinessDropdown` component at top
  - Tab toggle: "Expense" | "Mileage"
  - Content area: expense or mileage form
  - On business change: update stores, load config, sync vendor cache
- Create `src/components/BusinessDropdown.svelte`:
  - `<select>` from `$businesses`, pre-selects last-used, persists choice
- **Test:** Dropdown shows businesses, switching persists across reload.

#### Step 8.2 — Expense form fields

- Build expense form:
  - Date (`type="date"`, default today), Vendor (text), Description (text), Amount (`inputmode="decimal"`), Category (select), Payment Method (select), Receipt (placeholder), Notes (textarea)
  - Submit button
  - `bind:value` on all fields
  - Validation: Date, Vendor, Amount, Category, Payment Method required
- **Test:** Form renders, fields work, validation fires.

#### Step 8.3 — Expense submission

- On submit: validate → check token → check online → ensure year folder → build row → `appendRow` → add vendor to cache → clear form → show toast
- Create `src/components/Toast.svelte`: auto-dismiss notification (success/error variants)
- Spinner on submit button during API calls
- On error: toast + preserve form
- **Test:** Submit, verify row in Sheet. Submit offline, verify error + form preserved.

#### Step 8.4 — Vendor autocomplete

- Create `src/components/VendorAutocomplete.svelte`:
  - Text input with dropdown suggestion list
  - Filter `$vendorCache` with `toLowerCase().includes()`
  - Show top 5 matches, click to fill
  - Keyboard navigation (arrows + Enter)
- Add vendor sync: on business select, read column B from sheet, update cache
- Replace Vendor text input with `VendorAutocomplete`
- **Test:** Type partial name, see suggestions. New vendor appears after submit.

---

### Phase 9: Receipt Photos

**Goal:** User can attach, compress, and upload receipt photos.

#### Step 9.1 — Receipt picker component

- Create `src/components/ReceiptPicker.svelte`:
  - Hidden `<input type="file" accept="image/*,application/pdf">` (no `capture` attribute)
  - "Add Receipt" button with camera/attachment icon
  - On file selected:
    - If image: show thumbnail preview + remove button
    - If PDF: show filename + file size + remove button
  - Expose file via binding
- **Test:** On phone: chooser shows camera, gallery, and file browser. Photo selected, thumbnail shown. PDF selected, filename shown.

#### Step 9.2 — Compression and filename generation

- Create `src/lib/receipt.js`:
  - `compressReceipt(file, quality=0.7, maxWidth=1920)` — Canvas API, returns JPEG Blob. **Only called for image files.**
  - `isImage(file)` — checks `file.type.startsWith('image/')`
  - `processReceipt(file)` — if image: compress and return `{blob, ext: 'jpg'}`. If PDF: return `{blob: file, ext: 'pdf'}` as-is.
  - `generateFilename(vendor, date, ext, existingFiles)` — returns `YYYY-MM-DD_Vendor_N.<ext>`
- **Test:** Compress image, verify < 300KB. PDF passes through unchanged. Filename increments with duplicates. Extension matches file type.

#### Step 9.3 — Wire into expense flow

- Update expense submission:
  - If receipt: `processReceipt` (compress image or pass PDF) → list existing files in Receipts folder → generate filename → upload → set receipt column
- Add `ReceiptPicker` to expense form
- **Test:** Submit with image receipt, `.jpg` appears in `YYYY_Receipts/`. Submit with PDF, `.pdf` appears. Increment works across mixed types.

#### Step 9.4 — Web Share Target (Android)

- Add `share_target` to the PWA manifest in `vite.config.js` (see spec §9.1)
- Create `src/routes/share/+page.svelte`:
  - On mount: read the shared file from the `FormData` POST body via service worker
  - Store the shared file in a module-level variable or Svelte store
  - Redirect to the main expense form (`/`) with a flag indicating a shared receipt is pending
- Update expense form: if a shared receipt is pending, pre-attach it to the receipt picker
- Service worker must intercept POST requests to `/share` and cache the file for the client page to read
- Note: only works on Android Chrome when the PWA is installed. Gracefully ignored on iOS.
- **Test:** Manual on Android: share a PDF from Gmail → BizTrack appears in Share menu → app opens with file pre-attached. Complete and submit expense. On iOS: verify Share Target is simply absent (no errors).

---

### Phase 10: Mileage Entry

**Goal:** Mileage entries with favorite route support.

#### Step 10.1 — Mileage form

- Date, From, To, Purpose, Miles fields
- IRS Rate (read-only), Deduction (reactive: `miles * rate`)
- Validation: all required
- **Test:** Form renders, deduction auto-calculates.

#### Step 10.2 — Mileage submission

- Validate → check token/online → ensure year folder → build row → append → clear → toast
- **Test:** Submit, verify row in Mileage tab with correct rate + deduction.

#### Step 10.3 — Favorite routes: display and fill

- Create `src/components/FavoriteRouteList.svelte`: chips from `$businessConfig.mileage_favorites`
- On tap: populate all fields + today's date
- **Test:** Tap favorite, fields populate. Edit and submit successfully.

#### Step 10.4 — Favorite routes: save and manage

- "Save as Favorite" button on mileage form (when all fields filled)
- Settings page at `/settings/favorites`: list, delete
- Changes written to config.json in Drive
- **Test:** Save favorite, appears in list. Delete, removed. Config updated in Drive.

---

### Phase 11: Payment Methods

**Goal:** Per-business payment method management.

#### Step 11.1 — Config read/write helpers

- On business selection: download config.json, update `$businessConfig`
- Helpers: `addPaymentMethod`, `removePaymentMethod` (block "Cash" removal)
- Cache config in localStorage
- **Test:** Modify config, verify Drive file updated. Switch business, correct config loads.

#### Step 11.2 — Manage payments screen

- `/settings/payments`: list methods, add (text dialog), delete (except Cash)
- Expense form dropdown updates when methods change
- **Test:** Add method, appears in dropdown. Delete, disappears. Switch business, correct methods shown.

---

### Phase 12: Polish & Edge Cases

**Goal:** Final UX quality and error resilience.

#### Step 12.1 — Connectivity handling

- Check `navigator.onLine` before API calls
- `online`/`offline` event listeners for persistent banner
- Preserve form on failure
- **Test:** Offline → error + form preserved. Online → submit succeeds.

#### Step 12.2 — Year rollover

- On launch: `ensureYearFolder` for current year
- On date change in form: ensure target year folder exists
- **Test:** Expense dated previous year writes to correct sheet.

#### Step 12.3 — Form UX polish

- Clear + reset date after submit. Auto-focus vendor/from field.
- Amount: two-decimal format on blur
- Dismiss keyboard on submit
- Preserve state across tab switches
- Touch targets ≥ 48px. Safe area padding on bottom.
- **Test:** On phone: submit, fields clear, focus correct. Tab switch preserves state.

#### Step 12.4 — Error handling and loading states

- Submit buttons: spinner + disabled during API calls
- Business setup: full-screen loader
- Config sync: subtle spinner
- 401 → sign-in screen. 403 → "Check sharing permissions." Network → "Try again."
- **Test:** No unhandled errors in any flow.

#### Step 12.5 — App icon and install experience

- Design icons (192, 512, 512 maskable) — receipt motif, clean minimal
- iOS install instructions component ("Share → Add to Home Screen")
- **Test:** Install on Android + iOS. Icon, splash, standalone mode all correct.

---

## Post-Launch / Future Enhancements (Out of Scope)

1. Offline entry queue with IndexedDB
2. GPS mileage tracking
3. OCR receipt scanning
4. In-app history viewing/editing
5. Multiple currencies
6. Fiscal year support
7. Push notifications
8. Custom expense categories
9. Fuse.js fuzzy matching for vendor autocomplete

---

## Step Summary (Quick Reference)

| Step | Description | Dependencies |
|------|-------------|-------------|
| 1.1 | Create SvelteKit project + deps | None |
| 1.2 | Tailwind CSS + theming | 1.1 |
| 1.3 | PWA manifest + service worker | 1.1 |
| 1.4 | GitHub Actions deployment | 1.1 |
| 1.5 | Placeholder screens + routing | 1.2 |
| 2.1 | Google Cloud setup docs | None |
| 2.2 | Auth module (GIS) | 1.1, 2.1 |
| 2.3 | Auth store + sign-in screen | 1.5, 2.2 |
| 2.4 | Token refresh handling | 2.3 |
| 3.1 | Drive module: folders | 2.2 |
| 3.2 | Drive module: files | 3.1 |
| 4.1 | Sheets module: create | 2.2 |
| 4.2 | Sheets module: append + read | 4.1 |
| 5.1 | Picker module | 2.2 |
| 6.1 | Constants | 1.1 |
| 6.2 | Storage wrapper | 1.1 |
| 6.3 | Svelte stores | 6.2 |
| 7.1 | Business setup logic | 3.1, 3.2, 4.1, 4.2, 6.3 |
| 7.2 | Add business screen | 5.1, 7.1 |
| 7.3 | Settings screen | 7.2 |
| 8.1 | Main screen + dropdown | 6.3, 7.1, 1.5 |
| 8.2 | Expense form fields | 8.1, 6.1 |
| 8.3 | Expense submission | 8.2, 4.2 |
| 8.4 | Vendor autocomplete | 8.3, 4.2 |
| 9.1 | Receipt picker component | 8.2 |
| 9.2 | Compression + filename gen | 9.1 |
| 9.3 | Receipt upload in expense flow | 9.2, 3.2 |
| 9.4 | Web Share Target (Android) | 9.3, 1.3 |
| 10.1 | Mileage form | 8.1, 6.1 |
| 10.2 | Mileage submission | 10.1, 4.2 |
| 10.3 | Favorites: display + fill | 10.1, 6.3 |
| 10.4 | Favorites: save + manage | 10.3, 3.2 |
| 11.1 | Config read/write | 3.2, 6.3 |
| 11.2 | Payment methods screen | 11.1, 7.3 |
| 12.1 | Connectivity handling | 8.3, 10.2 |
| 12.2 | Year rollover | 7.1 |
| 12.3 | Form UX polish | 8.3, 10.2 |
| 12.4 | Error handling + loading | All prior |
| 12.5 | App icon + install UX | All prior |

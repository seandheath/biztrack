# BizTrack — Business Expense & Mileage Tracker

## Application Specification v1.0

---

## 1. Overview

BizTrack is a Progressive Web App (PWA) for tracking business expenses and mileage across multiple LLCs. It runs entirely in the browser with no backend server — Google Drive stores all data (spreadsheets, receipt photos, config), and Google Sheets serves as the accountant-ready ledger. Users authenticate with their Google account, and Google Drive's built-in sharing model provides access control between business partners.

The app is designed as a **rapid data entry tool**, not a data viewer. Users open the app, log an expense or mileage entry, and close it. Historical data is viewed directly in the Google Sheet.

### 1.1 Technical Stack

| Layer | Technology |
|-------|------------|
| Framework | SvelteKit 2 with adapter-static (pure static SPA) |
| Styling | Tailwind CSS with system light/dark mode |
| PWA | @vite-pwa/sveltekit (manifest + service worker generation) |
| Auth | Google Identity Services (GIS) token model |
| APIs | Google Drive API v3 + Google Sheets API v4 via raw fetch() |
| Folder Selection | Google Picker API |
| Hosting | GitHub Pages (free, public repository) |
| Local Storage | localStorage (convenience cache only — all real data in Drive) |

---

## 2. Users & Access Model

### 2.1 Target Users

Three initial users across three LLCs. The app supports any number of users and businesses.

### 2.2 Access Control

Access is managed entirely through Google Drive folder sharing. If a user has access to a business's Google Drive folder, they can use that business in the app. There is no in-app user management, roles, or permissions system.

### 2.3 Business Management

- Users can manage multiple businesses.
- Businesses are added in Settings by naming the business and linking it to a Google Drive folder via the Google Picker.
- A business folder can be an existing shared folder or a newly created one.
- The number of businesses per user is unlimited.

---

## 3. Google Drive Architecture

### 3.1 Folder Structure

Each business has a root folder in Google Drive. Within it, the app creates yearly subfolders containing a Google Sheet and a Receipts folder.

```
<Business Name>/
  config.json
  2026/
    2026_expenses.gsheet
    2026_Receipts/
      2026-03-23_Office_Depot_1.jpg
      2026-03-23_Office_Depot_2.jpg
  2025/
    2025_expenses.gsheet
    2025_Receipts/
```

### 3.2 Yearly Sheet Structure

Each `YYYY_expenses.gsheet` file contains two tabs:

#### Expenses Tab — Columns

| Column | Type | Description |
|--------|------|-------------|
| Date | Date | Date of expense (YYYY-MM-DD) |
| Vendor/Payee | String | Business or individual paid |
| Description | String | What was purchased or the purpose |
| Amount | Currency (USD) | Dollar amount |
| Category | String | QuickBooks standard category (see §5.1) |
| Payment Method | String | User-defined payment account (see §5.2) |
| Receipt | String | Filename of receipt image in Receipts folder, or blank |
| Notes | String | Optional free-text notes |

#### Mileage Tab — Columns

| Column | Type | Description |
|--------|------|-------------|
| Date | Date | Date of trip (YYYY-MM-DD) |
| From | String | Starting location |
| To | String | Destination |
| Purpose/Description | String | Business purpose of trip |
| Miles | Decimal | Total miles driven |
| IRS Standard Rate | Currency | IRS mileage rate for that year (auto-filled) |
| Deduction Amount | Currency | Auto-calculated: Miles × IRS Standard Rate |

### 3.3 Config File

A `config.json` file lives in the root of each business's Drive folder. It is per-business and shared with anyone who has access to the folder.

```json
{
  "payment_accounts": [
    "Cash",
    "Chase Business Visa x4521",
    "Business Checking x8834"
  ],
  "mileage_favorites": [
    {
      "name": "Home to Togus VA",
      "from": "Windsor, ME",
      "to": "Togus VA Medical Center",
      "miles": 22.4,
      "purpose": "Client Meeting"
    }
  ]
}
```

**Contents:**

- **payment_accounts** — List of user-defined payment method strings. "Cash" is the default and always present.
- **mileage_favorites** — Saved routes with all fields pre-populated for one-tap entry.

### 3.4 Auto-Creation Behavior

When a user adds a new business or when the calendar year rolls over:

1. App checks if the `YYYY/` subfolder exists; if not, creates it.
2. App checks if `YYYY_expenses.gsheet` exists; if not, creates it with Expenses and Mileage tabs and header rows.
3. App checks if `YYYY_Receipts/` folder exists; if not, creates it.
4. App checks if `config.json` exists in the business root; if not, creates it with the default `["Cash"]` payment account and an empty mileage favorites list.

### 3.5 Receipt File Naming Convention

```
YYYY-MM-DD_<VENDOR>_<INCREMENT>.<ext>
```

- `<VENDOR>` — Vendor name with spaces replaced by underscores, special characters removed.
- `<INCREMENT>` — Starts at 1, increments if the same vendor appears multiple times on the same date.
- `<ext>` — `.jpg` for images (compressed to JPEG before upload) or `.pdf` for PDF documents.

Examples:
- `2026-03-23_Office_Depot_1.jpg`
- `2026-03-23_Amazon_1.pdf`
- `2026-03-23_Amazon_2.jpg`

---

## 4. Authentication & Permissions

### 4.1 Google Sign-In

- Users authenticate via Google Identity Services (GIS) using the **token model** (implicit grant).
- The app requests a single OAuth scope: `https://www.googleapis.com/auth/drive.file` — this covers all Drive and Sheets operations on files the app creates or files selected via the Google Picker.
- No backend server is required. The access token is returned directly to the browser via popup.

### 4.2 Token Lifecycle

- Access tokens expire after **3,600 seconds** (1 hour) with no automatic refresh in the browser.
- The app tracks token expiry time and shows a "Session expiring — tap to continue" prompt before expiration.
- Re-authorization uses `requestAccessToken()` with `prompt: ''` and `login_hint` for a near-instant popup.
- All API calls catch 401 errors as a fallback trigger for re-authorization.
- Token and user info (email, name) are stored in memory only — not persisted to localStorage.

### 4.3 Google Picker for Folder Selection

- The Google Picker API renders an in-app iframe for browsing and selecting Drive folders.
- When a user selects a folder via the Picker, the `drive.file` scope grants the app access to that folder and allows creating new files/subfolders inside it.
- Requires three parameters: OAuth access token, API key (from Cloud Console), and numeric App ID (Cloud project number).
- The Picker is used only during business setup in Settings — not during day-to-day expense entry.

### 4.4 OAuth Verification Strategy

- The Google Cloud project uses **Testing mode** permanently (supports up to 100 explicitly listed test users).
- No OAuth verification, CASA security audit, or demo video required.
- Users see a one-time "app isn't verified" interstitial on first sign-in and click through.
- Testing mode imposes a 7-day authorization expiry, after which users see a full consent re-prompt.
- Alternative: publishing to Production with only `drive.file` requires basic brand verification (2-3 days, free, no audit) since `drive.file` is classified as non-sensitive.

### 4.5 Google Cloud Project Setup

- Create a Google Cloud project with Drive API, Sheets API, and Picker API enabled.
- Create an OAuth 2.0 client ID (Web application type).
- Set Authorized JavaScript Origins to the production URL (custom domain like `https://app.biztrack.io` or GitHub Pages URL like `https://<username>.github.io`) and `http://localhost:5173` for development.
- Create an API key (restricted to Picker API).
- Configure OAuth consent screen with app name, logo, privacy policy URL, and test user emails.

---

## 5. Data Definitions

### 5.1 Expense Categories (QuickBooks Standard)

The following categories are available as a dropdown in the expense form. This list is fixed for v1.

- Advertising
- Car & Truck Expenses
- Commissions & Fees
- Contract Labor
- Depreciation
- Employee Benefits
- Insurance
- Interest (Mortgage)
- Interest (Other)
- Legal & Professional Services
- Office Expenses
- Pension & Profit Sharing
- Rent or Lease (Vehicles/Machinery/Equipment)
- Rent or Lease (Other Business Property)
- Repairs & Maintenance
- Supplies
- Taxes & Licenses
- Travel
- Meals
- Utilities
- Wages
- Other Expenses

### 5.2 Payment Methods

- A default "Cash" entry is always present and cannot be deleted.
- Users can add custom payment methods as free-text strings (e.g., "Chase Business Visa x4521", "PayPal", "Business Checking x8834").
- Payment methods are stored in the per-business `config.json`.
- Displayed as a dropdown in the expense form.

### 5.3 IRS Standard Mileage Rates

The app includes a lookup table for IRS standard mileage rates by year, maintained in the app codebase.

| Year | Rate |
|------|------|
| 2024 | $0.67 |
| 2025 | $0.70 |
| 2026 | TBD (update at IRS announcement) |

---

## 6. User Interface

### 6.1 Design System

- **Styling:** Tailwind CSS with system light/dark mode via `prefers-color-scheme`
- **Theme:** Clean, minimal, mobile-first
- **Currency:** USD only
- **Inputs:** Native HTML form elements (better accessibility, browser autofill support, smaller bundle)
- **Touch targets:** Minimum 48×48px for all interactive elements
- **Safe areas:** Bottom navigation respects `env(safe-area-inset-bottom)` for notched phones

### 6.2 App Launch Flow

1. If not authenticated → Google Sign-In screen with "Sign in with Google" button.
2. If no businesses configured → Redirect to Settings to add first business.
3. Otherwise → Open directly to the **Expense Entry Form** with the last-used business pre-selected.

### 6.3 Main Screen — Expense Entry Form

The primary screen of the app. Visible on launch.

**Layout:**

- **Top bar:** Business selector dropdown (remembers last used). Tab or toggle to switch between "Expense" and "Mileage" modes.
- **Form fields (Expense mode):**
  - Date — Pre-populated with today's date, editable via native date picker (`type="date"`)
  - Vendor/Payee — Text field with fuzzy autocomplete against cached vendors
  - Description — Free text field
  - Amount — Numeric field (`inputmode="decimal"`) with currency formatting
  - Category — Dropdown (QuickBooks categories per §5.1)
  - Payment Method — Dropdown (from config.json per §5.2)
  - Receipt — File input accepting images and PDFs (`accept="image/*,application/pdf"`) offering camera, gallery, or file browser
  - Notes — Optional free text field
- **Submit button** at the bottom.

**Behavior:**

- On submit: validate form, check auth token validity, compress receipt if attached and is an image (JPEG, ~200KB target via canvas — PDFs uploaded as-is), upload receipt to `YYYY_Receipts/` folder, append row to Expenses tab, clear form, show success toast.
- Receipt column in the sheet contains the uploaded filename.
- After successful submission, the form clears and is ready for the next entry.
- If offline or token expired: show appropriate error message, preserve all form field values.

### 6.4 Mileage Entry Form

Accessible via tab/toggle at the top of the main screen.

**Form fields:**

- Date — Pre-populated with today's date, editable via native date picker
- From — Text field
- To — Text field
- Purpose/Description — Free text field
- Miles — Numeric field (`inputmode="decimal"`)
- IRS Rate — Read-only display of current year's rate
- Deduction — Read-only, auto-calculated (miles × rate), updates live as miles field changes

**Favorites section:**

- Displays saved mileage routes from `config.json` as tappable chips or list items above the form.
- Tapping a favorite populates **all fields** including today's date.
- User reviews pre-filled fields and taps Submit.
- "Save as Favorite" button appears after all fields are filled — prompts for a route name.

**Behavior:**

- On submit: validate, append row to Mileage tab with auto-calculated IRS rate and deduction.
- Same error handling and form preservation as expense submission.

### 6.5 Vendor Autocomplete

- The app maintains a local cache of previously entered vendor names per business (in localStorage).
- On app launch (when online), the cache is updated by reading the Vendor/Payee column from the current year's sheet.
- Autocomplete uses simple substring matching (`String.includes()`), upgradeable to fuzzy matching (Fuse.js) if needed.
- New vendors are added to the local cache after successful submission.

### 6.6 Settings Screen

Accessible via a gear icon or bottom navigation.

**Sections:**

#### Manage Businesses
- List of configured businesses with their linked Drive folder name.
- **Add Business:**
  - Name field (free text)
  - "Select Drive Folder" button → opens Google Picker (folder mode)
  - Shows selected folder name after selection
  - App validates access and creates folder structure if needed (per §3.4)
- **Remove Business:** Removes the business from the app only. Does not delete the Drive folder or any data.

#### Manage Payment Methods (per business)
- Displays the current business's payment methods from `config.json`.
- Add new payment method (free text field).
- Delete payment method (except "Cash").
- Changes written to Drive config.json.

#### Manage Mileage Favorites (per business)
- Displays saved routes.
- Add, edit, or delete favorites.
- Changes written to Drive config.json.

#### Account
- Shows the signed-in Google account email.
- Sign Out button.

---

## 7. Receipt & Document Handling

### 7.1 Supported File Types

- **Images:** JPEG, PNG, HEIC (iOS auto-converts HEIC to JPEG via file input)
- **Documents:** PDF (for emailed digital receipts, bank statements, etc.)

### 7.2 File Input (All Platforms)

- Uses `<input type="file" accept="image/*,application/pdf">` without the `capture` attribute.
- On iOS: Safari shows a chooser with "Take Photo," "Photo Library," or "Choose File."
- On Android: Chrome shows a similar chooser between camera, gallery, and file browser.
- This is the primary receipt attachment method and works reliably on all platforms.

### 7.3 Web Share Target (Android Only)

- The app registers as a **Web Share Target** in the PWA manifest, allowing it to appear in Android's native Share menu.
- Use case: user receives an email receipt in Gmail, taps Share on the attachment, selects BizTrack, and the app opens with the file pre-loaded into the expense form.
- **iOS does not support Web Share Target.** iOS users save the file first, then attach via the file input.
- Manifest entry:
  ```json
  "share_target": {
    "action": "/share",
    "method": "POST",
    "enctype": "multipart/form-data",
    "params": {
      "files": [
        {
          "name": "receipt",
          "accept": ["image/*", "application/pdf"]
        }
      ]
    }
  }
  ```
- The app handles the `/share` route by reading the shared file and pre-populating the expense form with the receipt attached. The user fills in the remaining fields and submits normally.

### 7.4 Compression

- **Images only:** Compressed client-side using the Canvas API before upload. Target: JPEG at 70% quality, max width 1920px, resulting in ~200KB files. Modern browsers auto-correct EXIF orientation.
- **PDFs:** Uploaded as-is with no compression. Most email receipts are already small (< 1MB).
- The app checks the file MIME type and skips compression for non-image files.

### 7.5 Naming Convention

```
YYYY-MM-DD_<VENDOR>_<INCREMENT>.<ext>
```

- `<ext>` is `.jpg` for images (all images converted to JPEG during compression) or `.pdf` for documents.
- Same increment logic as before: starts at 1, increments for duplicate vendor+date combinations.

Examples:
- `2026-03-23_Amazon_1.pdf`
- `2026-03-23_Amazon_2.jpg`
- `2026-03-23_Home_Depot_1.jpg`

### 7.6 Upload

- Uses multipart upload to Google Drive API (`uploadType=multipart`).
- FormData with JSON metadata blob (filename, parent folder ID, MIME type) and file blob.
- Multipart upload supports files up to 5MB — sufficient for compressed images and typical email receipts.

---

## 8. Connectivity

### 8.1 Online-Only (v1)

- All data operations require an active internet connection.
- Before any write operation, the app checks `navigator.onLine` and verifies the auth token is valid.
- If offline: display "No internet connection. Please connect to save your entry."
- If token expired: display re-auth prompt.
- Form state is preserved in all error cases so the user doesn't lose their input.

### 8.2 Service Worker (App Shell Caching)

- The service worker (auto-generated by vite-plugin-pwa) pre-caches the app shell (HTML, CSS, JS, icons).
- This allows the app UI to load instantly even on slow connections.
- API calls to Google are not cached — they always go to the network.
- If fully offline, the app loads but shows an offline message when the user tries to submit.

### 8.3 Future Consideration (Out of Scope for v1)

- IndexedDB queue for offline entries with sync-on-reconnect.

---

## 9. PWA Configuration

### 9.1 Manifest

```json
{
  "name": "BizTrack Expense Tracker",
  "short_name": "BizTrack",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#0f172a",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/icon-512-maskable.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ],
  "share_target": {
    "action": "/share",
    "method": "POST",
    "enctype": "multipart/form-data",
    "params": {
      "files": [
        {
          "name": "receipt",
          "accept": ["image/*", "application/pdf"]
        }
      ]
    }
  }
}
```

### 9.2 iOS Considerations

- Include `<meta name="apple-mobile-web-app-capable" content="yes">` and `<link rel="apple-touch-icon">` in the HTML head.
- OAuth popups open in an in-app browser on iOS and return correctly to the standalone PWA.
- PWA and Safari do **not** share cookies/storage — users must sign in separately after installing to home screen.
- No `beforeinstallprompt` event on iOS — provide manual "Add to Home Screen" instructions in the app.
- localStorage in installed PWAs is **not** subject to Safari's 7-day ITP eviction. Eviction occurs only under device storage pressure.

### 9.3 Hosting

- Hosted on **GitHub Pages** from a public repository (free tier: 100GB bandwidth/month, unlimited Actions minutes for public repos).
- HTTPS is required for PWA installation and is provided automatically by GitHub Pages via Let's Encrypt.
- **Deployment:** GitHub Actions is now the only deployment engine (legacy build infrastructure was shut down mid-2024). The app uses a custom GitHub Actions workflow (`.github/workflows/deploy.yml`) that builds the SvelteKit static output and deploys via the official `actions/upload-pages-artifact@v3` and `actions/deploy-pages@v4` actions. The publishing source is set to "GitHub Actions" in repo Settings → Pages.
- **SPA routing:** GitHub Pages has no native SPA support — no catch-all redirects, no `_redirects` file, no custom headers. The workaround is the **404.html trick**: copy `index.html` to `404.html` in the build output. GitHub serves the 404 page for any unrecognized route, and SvelteKit's client-side router resolves the correct page. **Caveat:** the page is served with a 404 HTTP status code, which harms SEO and breaks link previews. This is acceptable for a private 3-user business tool.
- **Base path:** Project sites (any repo not named `<username>.github.io`) serve from `https://<username>.github.io/<repo-name>/`. SvelteKit must be configured with `paths.base` in `svelte.config.js` (e.g., `/biztrack`). The manifest `start_url`, service worker scope, and all asset references must include this base. **Recommended:** use a custom domain to eliminate the subpath entirely.
- **Custom domain (recommended):** Any project repo can be configured with a custom domain, which eliminates the `/repo-name/` subpath and serves from root `/`. DNS setup: CNAME record for a subdomain (e.g., `app.biztrack.io` → `<username>.github.io`), or A records for an apex domain pointing to GitHub's IPs (185.199.108–111.153). The "Enforce HTTPS" toggle provisions a free Let's Encrypt certificate. Add a `CNAME` file to the build output containing the domain name.
- Google Cloud Console Authorized JavaScript Origins must include the GitHub Pages URL (e.g., `https://<username>.github.io` or the custom domain) and `http://localhost:5173` for development.
- No secrets in the client-side code — OAuth client IDs and API keys are inherently public for web apps, so a public repository is safe.
- A `.nojekyll` file must be in the build output to prevent GitHub from processing files through Jekyll.

---

## 10. API Integration Details

### 10.1 Google Drive API (via fetch)

All Drive API calls use `fetch()` with `Authorization: Bearer <token>` header. No `gapi.client` library — it adds 90KB+ and doesn't support multipart uploads.

**Endpoints used:**

| Operation | Method | Endpoint |
|-----------|--------|----------|
| Create folder | POST | `https://www.googleapis.com/drive/v3/files` |
| List files in folder | GET | `https://www.googleapis.com/drive/v3/files?q='FOLDER_ID'+in+parents` |
| Upload file (receipt) | POST | `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart` |
| Download file (config) | GET | `https://www.googleapis.com/drive/v3/files/FILE_ID?alt=media` |
| Update file (config) | PATCH | `https://www.googleapis.com/upload/drive/v3/files/FILE_ID?uploadType=media` |
| Move file to folder | PATCH | `https://www.googleapis.com/drive/v3/files/FILE_ID?addParents=X&removeParents=Y` |
| Get file metadata | GET | `https://www.googleapis.com/drive/v3/files/FILE_ID?fields=id,name,parents` |

### 10.2 Google Sheets API (via fetch)

**Endpoints used:**

| Operation | Method | Endpoint |
|-----------|--------|----------|
| Create spreadsheet | POST | `https://sheets.googleapis.com/v4/spreadsheets` |
| Append row | POST | `https://sheets.googleapis.com/v4/spreadsheets/ID/values/TAB!A1:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS` |
| Read column | GET | `https://sheets.googleapis.com/v4/spreadsheets/ID/values/TAB!B:B` |

**Notes:**

- `valueInputOption=USER_ENTERED` ensures Sheets interprets dates and numbers correctly.
- `insertDataOption=INSERT_ROWS` appends after the last row.
- The `drive.file` scope authorizes all Sheets API operations on app-created spreadsheets.
- Spreadsheets created via the Sheets API land in Drive root — follow up with a Drive API move to place them in the correct year folder.

### 10.3 Rate Limits

| API | Limit | Impact |
|-----|-------|--------|
| Drive API | 12,000 queries/min/project | No concern for 3 users |
| Sheets API | 60 reads + 60 writes/min/user | No concern for manual data entry |

---

## 11. Data Flow Diagrams

### 11.1 Add Expense

```
User fills form → Tap Submit
  → Validate required fields
  → Check navigator.onLine
    → If offline: show error, preserve form
  → Check token expiry
    → If expired: prompt re-auth, preserve form
  → If receipt file attached:
    → If image: compress via canvas (JPEG, 70%, max 1920px wide)
    → If PDF: use as-is
    → Generate filename (YYYY-MM-DD_Vendor_N.jpg/.pdf)
    → Upload to YYYY_Receipts/ via multipart upload
  → Append row to Expenses tab via Sheets API
  → Update local vendor cache
  → Clear form, show success toast
```

### 11.2 Add Mileage

```
User fills form (manually or via favorite) → Tap Submit
  → Validate required fields
  → Check connectivity + token
  → Calculate deduction (miles × IRS rate)
  → Append row to Mileage tab via Sheets API
  → Clear form, show success toast
```

### 11.3 App Launch

```
App opens (service worker serves cached shell instantly)
  → Check for existing auth state in memory
    → If no auth: show Sign In screen
    → If auth present but token expired: prompt re-auth
  → Load business list from localStorage
    → If no businesses: redirect to Settings
    → If businesses exist:
      → Select last-used business
      → Fetch config.json from Drive
      → Update local vendor cache from current year sheet
      → Show Expense Entry Form with today's date
```

### 11.4 Add Business

```
User taps "Add Business" in Settings
  → Enter business name
  → Tap "Select Drive Folder" → Google Picker opens
    → User browses Drive, selects or creates folder
    → Picker returns folder ID + name
  → App checks for existing config.json in folder
    → If exists: load it (another user already set up this business)
    → If not: create default config.json
  → App runs ensureYearFolder for current year
  → Save business (name, folderId, yearIds) to localStorage
  → Navigate back to Settings
```

---

## 12. Project Structure

```
biztrack/
  src/
    routes/
      +layout.svelte          # Root layout: auth guard, nav, theme
      +layout.js              # SPA mode config (ssr=false, prerender=true)
      +page.svelte            # Main screen: expense/mileage tabs
      share/
        +page.svelte           # Web Share Target handler (Android)
      settings/
        +page.svelte           # Settings screen
        business/
          +page.svelte         # Add business screen
        payments/
          +page.svelte         # Manage payment methods
        favorites/
          +page.svelte         # Manage mileage favorites
    lib/
      auth.js                  # GIS token model: init, sign-in, refresh
      drive.js                 # Drive API: folders, files, upload, download
      sheets.js                # Sheets API: create, append, read
      picker.js                # Google Picker: folder selection
      store.js                 # Svelte stores: auth state, businesses, config
      constants.js             # Categories, IRS rates, scope URIs
      storage.js               # localStorage wrapper
      receipt.js               # Photo compression + filename generation
    components/
      BusinessDropdown.svelte
      VendorAutocomplete.svelte
      ReceiptPicker.svelte
      FavoriteRouteList.svelte
      Toast.svelte
    app.html                   # HTML shell with GIS + Picker script tags
    app.css                    # Tailwind imports + CSS custom properties
  static/
    icon-192.png
    icon-512.png
    icon-512-maskable.png
    .nojekyll                  # Prevents GitHub Pages Jekyll processing
    CNAME                      # Custom domain (if used), e.g., app.biztrack.io
  .github/
    workflows/
      deploy.yml               # GitHub Action: build + deploy via actions/deploy-pages
  svelte.config.js             # adapter-static config + base path for GitHub Pages
  vite.config.js               # vite-plugin-pwa config
  tailwind.config.js
```

---

## 13. Out of Scope (v1)

The following features are explicitly excluded from the initial version:

- Viewing/browsing past entries in the app (use Google Sheets directly)
- Editing or deleting synced entries (edit in Google Sheets directly)
- Offline entry queue with sync-on-reconnect
- GPS-based mileage tracking
- OCR / receipt scanning
- Multiple currencies
- Fiscal year support (calendar year only)
- Push notifications or reminders
- Custom expense categories beyond the QuickBooks standard list
- Native mobile app (Android/iOS)

---

## 14. Glossary

| Term | Definition |
|------|------------|
| Business | An LLC or business entity tracked in the app, linked to a Google Drive folder |
| Config | The `config.json` file in each business's Drive root containing payment methods and mileage favorites |
| Favorite | A saved mileage route that pre-fills the mileage form on tap |
| GIS | Google Identity Services — Google's current OAuth library for web apps |
| Picker | Google Picker API — a Google-hosted iframe for browsing and selecting Drive files/folders |
| Token model | GIS authorization flow that returns an access token directly to the browser without a backend server |
| Vendor cache | A locally stored list of previously used vendor names for autocomplete |

# BizTrack — Google Cloud Setup Guide

Follow these steps once to configure the Google Cloud project that BizTrack uses for OAuth, Drive, Sheets, and Picker.

---

## 1. Create a Google Cloud Project

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Click the project selector (top-left) → **New Project**
3. Name it `BizTrack` (or similar) — billing not required for these APIs at typical usage
4. Click **Create** and wait for it to provision

---

## 2. Enable APIs

In the left sidebar go to **APIs & Services → Library**.

Enable each of these:

| API | Search term |
|-----|-------------|
| Google Drive API | `Drive API` |
| Google Sheets API | `Sheets API` |
| Google Picker API | `Picker API` |

Click the API name, then **Enable**.

---

## 3. Configure the OAuth Consent Screen

Go to **APIs & Services → OAuth consent screen**.

1. **User type:** External → **Create**
2. Fill in the required fields:
   - **App name:** `BizTrack`
   - **User support email:** your email
   - **Developer contact information:** your email
3. Click **Save and Continue**
4. **Scopes** → **Add or Remove Scopes**
   - Search for `drive.file`
   - Select `https://www.googleapis.com/auth/drive.file` (listed as non-sensitive — no security audit required)
   - Click **Update** → **Save and Continue**
5. **Test users** → **Add Users**
   - Add the Google account email addresses of all BizTrack users (up to 100)
   - Click **Save and Continue**
6. Review and click **Back to Dashboard**

**Publishing status:** Leave as **Testing**. This is permanent — no OAuth verification or CASA security audit is required. Testing mode supports up to 100 explicitly listed test users.

> **Note:** Testing mode imposes a 7-day authorization expiry. After 7 days, users see a full re-consent screen. If this becomes inconvenient, you can publish to Production — `drive.file` is non-sensitive and only requires basic brand verification (2–3 days, free, no audit). See [OAuth verification policy](https://support.google.com/cloud/answer/9110914).

---

## 4. Create an OAuth 2.0 Client ID

Go to **APIs & Services → Credentials** → **Create Credentials → OAuth client ID**.

1. **Application type:** Web application
2. **Name:** `BizTrack Web`
3. **Authorized JavaScript origins** — add all of:
   - `http://localhost:5173` (Vite dev server)
   - `http://localhost:4173` (Vite preview server)
   - Your production URL, e.g. `https://app.biztrack.io` or `https://yourusername.github.io`
4. **Authorized redirect URIs** — leave **empty** (the GIS token model does not use redirect URIs)
5. Click **Create**

Copy the **Client ID** (format: `XXXXXXXXXX.apps.googleusercontent.com`).

Paste it into `biztrack/src/lib/auth.js`:
```js
const GOOGLE_CLIENT_ID = 'PASTE_YOUR_CLIENT_ID_HERE.apps.googleusercontent.com';
```

---

## 5. Create an API Key

Go to **APIs & Services → Credentials** → **Create Credentials → API key**.

After it's created, click **Edit API key** and configure:

1. **Name:** `BizTrack Picker Key`
2. **Application restrictions:** HTTP referrers (websites)
   - Add: `http://localhost:5173/*`
   - Add: `http://localhost:4173/*`
   - Add your production domain: `https://app.biztrack.io/*` (or your GitHub Pages URL)
3. **API restrictions:** Restrict key → select **Google Picker API** only
4. Click **Save**

Copy the **API key**.

Paste it into `biztrack/src/lib/auth.js`:
```js
export const GOOGLE_API_KEY = 'PASTE_YOUR_API_KEY_HERE';
```

---

## 6. Get Your Numeric App ID

The Google Picker requires your project's numeric App ID (different from the client ID).

1. Go to **IAM & Admin → Settings** (or the Home dashboard)
2. Copy the **Project number** (numeric, e.g. `123456789012`)

Paste it into `biztrack/src/lib/auth.js`:
```js
export const GOOGLE_APP_ID = 'PASTE_YOUR_PROJECT_NUMBER_HERE';
```

---

## 7. Verify Setup

After configuring credentials in `auth.js`, run the dev server:

```bash
cd biztrack
npm run dev
```

Click **Sign in with Google**. You should see:
- A Google account chooser popup
- A one-time "This app isn't verified" interstitial (expected — click **Continue**)
- The drive.file scope consent screen
- Successful sign-in, returning to the BizTrack app shell

If the popup is blocked: allow popups for `localhost:5173` in your browser settings.

---

## Summary of Credentials

| Credential | Where to paste |
|------------|----------------|
| OAuth Client ID | `src/lib/auth.js` → `GOOGLE_CLIENT_ID` |
| API Key | `src/lib/auth.js` → `GOOGLE_API_KEY` |
| Project Number | `src/lib/auth.js` → `GOOGLE_APP_ID` |

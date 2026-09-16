# BizTrack — Google Cloud Setup Guide

Follow these steps once to configure the Google Cloud project that BizTrack uses for OAuth, Drive, and Sheets.

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
   - Search for `drive`
   - Select `https://www.googleapis.com/auth/drive`, matching `src/lib/constants.ts` (restricted scope; needed by the current shared-folder browser)
   - Click **Update** → **Save and Continue**
5. **Test users** → **Add Users**
   - Add the Google account email addresses of all BizTrack users (up to 100)
   - Click **Save and Continue**
6. Review and click **Back to Dashboard**

**Publishing status:** Check **Google Auth Platform → Audience** in the Console.
For regular use, use **In production**, completing the requirements applicable to
your audience and the restricted Drive scope. For an app limited to one Google
Workspace organization, check whether an Internal audience is appropriate.

Testing mode is suitable for development, but Drive consent expires after seven
days. Production removes that testing limit; it does **not** extend the roughly
one-hour access-token lifetime or guarantee that Google never asks for consent.
The repo cannot report the project's current publishing or verification status.

See [Google's audience guidance](https://support.google.com/cloud/answer/15549945)
and [Drive scope requirements](https://developers.google.com/workspace/drive/api/guides/api-specific-auth).
Do not substitute `drive.file` without redesigning and testing existing shared-file
selection and discovery.

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

Set it in `.env` (and the GitHub Actions repository secret):
```env
VITE_GOOGLE_CLIENT_ID=PASTE_YOUR_CLIENT_ID_HERE.apps.googleusercontent.com
```

---

## 5. Optional Legacy Picker Credentials

The current app uses its own Drive folder browser, not Google Picker. The
`VITE_GOOGLE_API_KEY` and `VITE_GOOGLE_APP_ID` variables remain for compatibility;
they are not used for the reconnect flow. Do not place an OAuth client secret in
any `VITE_*` variable: those values are public in the browser bundle.

---

## 7. Verify Setup

After configuring `.env`, run the dev server:

```bash
npm run dev
```

Click **Sign in with Google**. You should see:
- A Google account chooser popup
- An unverified-app warning if the current project configuration requires it
- The Drive scope consent screen
- Successful sign-in, returning to the BizTrack app shell

The sign-in buttons become available after the Google script loads. Returning users
see **Continue as <email>**, using `prompt: ''` and a login hint. Google may still
require authentication or consent. No popup is opened automatically by a timer.

If the popup is blocked, allow popups for this site and retry. If script loading
fails, check the connection and use **Retry loading Google sign-in**.

Before release, test on desktop Chrome/Firefox/Safari, Android Chrome, and iOS
Safari (browser and installed PWA where supported):

- Reopen with a valid token; reopen after expiry and verify cached data is hidden.
- Enter an expense with a receipt and split lines, and a mileage entry. Expire
  access before saving and between API requests; reconnect without losing input.
- Cancel or block the popup; retry and select a wrong account. No prior work may
  run under the wrong account.
- Background an expired session and return; the workspace must be hidden until
  reconnect. Returning to an active session must retain the form.
- Trigger an app update on an entry form; it must offer a deferred reload.
- Verify Sign Out clears account data without revocation, and Disconnect reports
  Google's actual revocation result. Test the unsynced-change discard warning.
- Confirm `/privacy` and `/terms` remain accessible without sign-in.

Automated auth regressions: `npm test`. Production build: `npm run build`.

---

## Summary of Credentials

| Credential | Where to paste |
|------------|----------------|
| OAuth Client ID | `.env` → `VITE_GOOGLE_CLIENT_ID` |
| API Key | Optional `.env` → `VITE_GOOGLE_API_KEY` |
| Project Number | Optional `.env` → `VITE_GOOGLE_APP_ID` |

# Google integration setup

- **Audience:** developers hosting BizTrack or testing Google integration.
- **Hosted-app users:** [quick start](../README.md#for-users); no Cloud setup.
- **UI-only development:** `npm run dev:demo`; no credentials.

## Configure the project

In [Google Cloud Console](https://console.cloud.google.com/):

| Setting | Value |
|---|---|
| Project | Create or select a project |
| APIs | Enable Google Drive API and Google Sheets API |
| Google Auth Platform → Branding | App name, support email, developer contact, homepage, privacy and terms URLs |
| Audience | External for public access; Internal only for one eligible Workspace organization |
| Data Access | `https://www.googleapis.com/auth/drive` |
| Clients | OAuth 2.0 client; Web application |
| JavaScript origins | `http://localhost:5173`, `http://localhost:4173`, production origin (e.g. `https://biztrack.lol`) |
| Redirect URIs | None; browser token/popup flow |

- Origins: scheme + host + port; no `/beta/` or release path.
- Custom dev port: add its exact origin.
- Hosted policy URLs: `https://biztrack.lol/beta/privacy/`, `https://biztrack.lol/beta/terms/`.
- Full `drive`: restricted scope; current folder discovery requires broad access. `drive.file`: workflow redesign, not a configuration swap. [Scope requirements](https://developers.google.com/workspace/drive/api/guides/api-specific-auth).

## Credentials

```sh
cp .env.example .env
```

```env
VITE_GOOGLE_CLIENT_ID=YOUR_CLIENT_ID.apps.googleusercontent.com
```

- GitHub Actions: same value in repository secret `VITE_GOOGLE_CLIENT_ID`.
- Client ID: public in browser bundle.
- Client secret: never in frontend code or `VITE_*` variables.
- Picker API key/project number: unused.

## Audience and verification

| Mode | Constraints |
|---|---|
| Testing | Listed test users only; up to 100; Drive consent expires after 7 days |
| Production | Public audience; applicable scope verification still required |
| Unverified restricted scopes | Warning screen; new-user cap may apply |

- Production status ≠ verified scope approval.
- Verify current status in Console; repository code cannot establish it.
- Reference: [Google audience settings and limits](https://support.google.com/cloud/answer/15549945).

## Check sign-in

```sh
npm run dev
```

1. **Sign in with Google** → account chooser → Drive consent → workspace.
2. Public deployment: repeat with an account outside the test-user list.
3. Create a disposable business; save an expense and mileage; verify Sheets contents.

| Failure | Check |
|---|---|
| Origin rejected | Exact browser origin in OAuth client |
| Popup blocked | Browser popup permission; retry from sign-in button |
| Google script unavailable | Network; **Retry loading Google sign-in** |
| User blocked / unverified warning | Audience, test users, scope verification, Workspace policy |
| Returning session expired | Reconnect with the same account; no manual reload of unfinished forms |

[Release checks](releases.md#release-checks)

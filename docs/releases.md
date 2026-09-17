# Release operations

**Audience:** maintainers publishing or verifying builds.

| URL | Content / updates |
|---|---|
| `/` | Version chooser; no root PWA installation |
| `/beta/` | Current `main`; automatic updates |
| `/demo/` | Current `main`; memory-only sample data |
| `/v/1.2.3/` | Original archived build of `v1.2.3` |

## One-time GitHub setup

Repository-admin settings; merging files alone does not configure them.

1. **Settings → General → Releases:** enable release immutability before publishing.
2. **Settings → Rules → Rulesets:** import [version-tag ruleset](../.github/release-ruleset.json); active; no exclusions/bypasses; block `v*` update/deletion.
3. **Secrets:** `VITE_GOOGLE_CLIENT_ID`.
4. **Pages:** GitHub Actions; custom domain `biztrack.lol`.
5. **Environments → github-pages:** allow `main` and `v*` deployments.

CLI alternative for steps 1–2:

```sh
gh api --method PUT repos/seandheath/biztrack/immutable-releases
gh api --method POST repos/seandheath/biztrack/rulesets \
  --input .github/release-ruleset.json
```

- Immutability: future releases only; tags/assets locked after publication; titles/notes editable.
- Rulesets: administrators can change them. [GitHub guarantees](https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases).

## Publish

1. Commit tested changes; push `main` for beta/demo.
2. Read the committed `package.json` version; lockfile must match. The local hook bumps patches unless a version change is explicitly staged.
3. Tag that commit; example for version `1.2.3`:

```sh
git tag v1.2.3
git push origin v1.2.3
```

| Stage | Behavior |
|---|---|
| Tag validation | `vMAJOR.MINOR.PATCH`; exact package-version match; protection rules checked |
| Publication | Checks → versioned build → draft → ZIP + `SHA256SUMS` → publish → immutability verification |
| Assembly | Build beta/demo from current `main`; verify/download all published archives; never rebuild fixed releases |
| Retry | Reuse published archives; replace assets only in unpublished drafts |
| Failure | Stop deployment; retain last live site; rerun failed Actions workflow |

- Failures: missing archive, checksum mismatch, unlocked release, failed build, combined site >1 GB.
- Keep all release archives; assembly requires them.
- Actions token cannot inspect the admin-only immutability setting; post-publication verification can detect an unlocked release only after publication.

## Verify and preview

Requirements: Node.js 22+, Python 3, authenticated GitHub CLI with release-verification support; fetched version tags.

```sh
gh release verify v1.2.3 --repo seandheath/biztrack
gh release download v1.2.3 --repo seandheath/biztrack --pattern biztrack-1.2.3.zip
gh release verify-asset v1.2.3 biztrack-1.2.3.zip --repo seandheath/biztrack
```

```sh
npm test
npm run check
BIZTRACK_BASE_PATH=/beta npm run build
npm run build:demo
python3 scripts/releases.py assemble pages
python3 -m http.server 8080 --bind 127.0.0.1 --directory pages
```

- Assembly output: absent directory; beta/demo must match commit and version.
- Beta output: `build/`. Demo: `build-demo/`.
- Release build: `BIZTRACK_BASE_PATH=/v/1.2.3 npm run build` on matching commit.
- `build-info.json`: version, commit, base; manifest/assets/routes/worker use that base.
- Chooser only: `npm run preview:site`; local tags; no downloads/publication verification. Optional `-- --port 8081`; restart after edits.

## Existing installations

| Action / boundary | Effect |
|---|---|
| Root bookmark | Opens chooser; old route links redirect to beta with query parameters |
| Legacy root install | Finish forms; close old tabs; open beta; sync; then install chosen release |
| Beta | Reuses legacy account/cache/queue keys |
| Fixed release | Separate sign-in/local state; install separately to pin |
| Switch versions | Sync first; use a compatible data version; pending writes stay in their originating installation |
| Sign Out | Clear one version's local account data; keep Drive files |
| Disconnect Google Drive | Revoke shared grant across versions/devices; keep Drive files |
| Same origin | Storage prefixes prevent collisions, not cross-version access |
| Data model 2 (0.2+) | Explicit upgrade to new copies; originals retained; no subsequent merging from older releases |
| Immutable archive | Auditable original build; Google services/scripts remain external dependencies |
| Hosted site | Owner can replace served files; independently host a reviewed archive to remove that control |

## Data upgrade checks (0.1 → 0.2)

- Sync/close other installations first; one upgrader at a time.
- Confirm business/year list; **Back up & upgrade**; verify new mileage descriptions/totals, expenses, favorites, receipts, and pending writes.
- Original spreadsheets/JSON: retained under original names. Active spreadsheets: `_v2`; config/profile: `config-v2.json` / `profile-v2.json`.
- Interrupted upgrade: reopen; retry. Originals unchanged; verified copies reused.
- Changed originals, duplicate copies, or unknown columns: stop and inspect; no automatic cleanup. Preserve originals and local storage.
- Restore: originals remain usable in 0.1; changes made after upgrading are not included. No automatic reverse migration.
- After upgrade: use 0.2+ on every device. Legacy versions continue writing original files.

## Release checks

- Chrome/Firefox/Safari; Android Chrome; iOS Safari; browser and installed PWA.
- Demo: no sign-in/network API calls; edit/split/history; independent tabs; reload/reset.
- Fresh Google account: consent → business setup → expense/mileage → verify Drive data.
- Receipts: image/PDF upload; Android share; correct version's form.
- Edits: same year, cross-year, splits; failed append/confirmation/delete; retry without duplicates; durable offline replay.
- Auth: expired token; reconnect/cancel/wrong account; retained form; background/resume; sign-out with pending writes.
- Versions: beta + two fixed builds; scopes, launch URLs, direct routes/query parameters, offline reload, account isolation.
- Migration: old root install with pending writes/receipt; no forced form reload or dropped work.
- UI: history; uncategorized skip/bulk category; mileage favorites/defaults; supported CSV imported twice.

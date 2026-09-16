# Releases

| URL | Updates |
|---|---|
| `/` | Version chooser; no new PWA installation at the root |
| `/beta/` | Current `main`; automatic updates |
| `/v/1.2.3/` | Original build of `v1.2.3`; never rebuilt after publication |

## One-time GitHub setup

Use repository-admin access. These are GitHub settings, not configuration files
that take effect just by merging this repository.

1. In **Settings → General → Releases**, enable **release immutability**. It applies
   to future releases. Keep it enabled before creating any version tags.
2. In **Settings → Rules → Rulesets**, import
   [the version-tag ruleset](../.github/release-ruleset.json). It restricts updates
   and deletion of `v*` tags, has no exclusions or bypass actors, and is active.
3. Set the repository secret `VITE_GOOGLE_CLIENT_ID`. Keep Pages configured for
   **GitHub Actions** with the custom domain `biztrack.lol`. In **Settings →
   Environments → github-pages**, allow deployments from `main` and `v*` tags.
4. Merge and deploy version support to `main` before creating the first tag.

With an authenticated GitHub CLI, steps 1–2 can also be applied once from the repo:

```sh
gh api --method PUT repos/seandheath/biztrack/immutable-releases
gh api --method POST repos/seandheath/biztrack/rulesets \
  --input .github/release-ruleset.json
```

The ruleset JSON is the required shape checked by the publisher. Administrators
can edit rulesets later. GitHub itself locks published immutable release tags and
assets; release titles and notes remain editable. See
[GitHub's guarantees](https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases).

## Publish

Set `package.json` and the lockfile to the intended version, commit, and push to
`main`. Then tag that commit:

```sh
git tag v1.2.3
git push origin v1.2.3
```

Only `vMAJOR.MINOR.PATCH` tags are accepted; the version must match `package.json`.
Use beta for work in progress. Tag pushes run checks, build at `/v/1.2.3/`, create a
draft, attach `biztrack-1.2.3.zip` and `SHA256SUMS`, and publish automatically.
GitHub publication locks the artifacts and produces a release attestation.

The workflow then builds beta from current `main`, verifies and downloads every
published release archive, and deploys the complete site. Archives include source
commit and base-path metadata. Existing releases are never rebuilt, and retries
reuse their verified archives. Only unpublished drafts allow replacement assets.

CI checks tag protections before publication and verifies immutability after
publication. The Actions token cannot inspect the admin-only immutability setting;
if that setting was disabled, publication may create an unlocked release, but
verification stops deployment. Correct the settings before publishing another tag.

Queued runs do not cancel an in-progress release. A failed build, missing archive,
invalid checksum, unlocked release, or site exceeding Pages' 1 GB limit stops
deployment and leaves the last successful site live. Rerun the failed workflow
from Actions; already-published builds are reused. Do not delete release archives:
site assembly needs all of them. Hosting every release consumes storage and does
not guarantee availability forever.

## Verify and build locally

The GitHub CLI must support immutable-release verification:

```sh
gh release verify v1.2.3 --repo seandheath/biztrack
gh release download v1.2.3 --repo seandheath/biztrack --pattern biztrack-1.2.3.zip
gh release verify-asset v1.2.3 biztrack-1.2.3.zip --repo seandheath/biztrack
```

For local checks and a complete site (requires Python 3, GitHub CLI, and fetched tags):

```sh
npm test
npm run check
BIZTRACK_BASE_PATH=/beta npm run build
python3 scripts/releases.py assemble pages
python3 -m http.server 4173 --directory pages
```

Use an absent output directory for assembly. Local development defaults to `/`.
For a release build, use `BIZTRACK_BASE_PATH=/v/1.2.3` on the corresponding commit.
The generated manifest, asset paths, route indexes, and service worker use that
base. `build-info.json` records the version, commit, and base.

## Existing installations

Existing root bookmarks open the chooser; old route links go to beta with their
query parameters intact. The migration worker does not reload open forms or clear
local data. It retains access to cached legacy modules and hands old receipt
shares to beta. Existing users should finish entries, close old tabs, and open beta
to sync before installing a fixed release.

Beta reuses the original sign-in, cache, preference, and queue keys. Fixed releases
have separate local state and require their own sign-in. Sign Out affects only
that version; Disconnect Google Drive revokes the shared grant. Neither deletes
Drive files. A pending write belongs to the version where it was entered—switching
versions does not transfer it. Old root home-screen shortcuts remain chooser
shortcuts; install the chosen release separately to pin it.

Version paths share an origin. Storage prefixes prevent accidental collisions,
not access by other code on that origin. All versions still edit the same Drive
files; changes to those formats must account for older clients. Pinning BizTrack
does not freeze Google services or the Google sign-in script.

## Release checks

- Open beta and two fixed versions; verify launch URLs, names, worker scopes, and
  every route on direct load and refresh, including transaction query parameters.
- Sign in, reconnect, save, and sign out in one version without clearing another's
  account or queue. Confirm offline shell navigation after an online visit.
- Start from an old root install with pending writes and a receipt; upgrade online,
  finish the form without a forced reload, then continue in beta and sync once.
- Install separate versions on Android Chrome and iOS Safari. Relaunch each after
  a beta deployment and another release. Each must keep its selected version.
- Share an image and PDF into an installed Android release and confirm the receipt
  reaches that version's expense form.

Release archives are immutable, but Pages is mutable hosting. Source links,
checksums, and attestations allow auditing; they cannot stop the website owner
from replacing hosted files. Independently hosting a reviewed archive removes
that control from the project maintainer.

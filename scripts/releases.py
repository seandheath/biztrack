"""Publish immutable builds and assemble Pages. Requires Python 3 and GitHub CLI."""
import hashlib
import html
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parent.parent
VERSION = re.compile(r"v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\Z")
REPO = os.environ.get("GITHUB_REPOSITORY", "seandheath/biztrack")


def run(*args, **kwargs):
    return subprocess.check_output(args, text=True, **kwargs).strip()


def api(endpoint):
    return json.loads(run("gh", "api", endpoint))


def releases():
    pages = json.loads(run("gh", "api", f"repos/{REPO}/releases?per_page=100", "--paginate", "--slurp"))
    return [release for page in pages for release in page]


def version_for(tag):
    if not VERSION.fullmatch(tag):
        raise ValueError("Release tags must have the form vMAJOR.MINOR.PATCH.")
    return tag[1:]


def check_build(directory, version, base, commit=None):
    info = json.loads((directory / "build-info.json").read_text())
    if info.get("version") != version or info.get("base") != base or not re.fullmatch(r"[a-f0-9]{40}", info.get("commit", "")):
        raise ValueError(f"Build metadata does not match {base}.")
    if commit is not None and info["commit"] != commit:
        raise ValueError(f"Build commit does not match {base}.")
    manifest = json.loads((directory / "manifest.webmanifest").read_text())
    if any(manifest.get(key) != base + "/" for key in ("id", "scope", "start_url")):
        raise ValueError(f"Manifest does not belong to {base}.")
    for filename in ("index.html", "service-worker.js"):
        if not (directory / filename).is_file():
            raise ValueError(f"Missing {filename} in {base}.")
    if f'href="{base}/manifest.webmanifest"' not in (directory / "index.html").read_text():
        raise ValueError(f"Missing manifest link in {base}.")
    return info


def archive_build(directory, archive):
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as output:
        for path in sorted(directory.rglob("*")):
            if path.is_symlink():
                raise ValueError(f"Build contains symlink: {path}")
            if path.is_file():
                output.write(path, path.relative_to(directory).as_posix())


def extract_build(archive, destination):
    with zipfile.ZipFile(archive) as source:
        entries = source.infolist()
        names = set()
        if sum(entry.file_size for entry in entries) > 1_000_000_000:
            raise ValueError("Release exceeds the Pages site size limit.")
        for entry in entries:
            name = PurePosixPath(entry.filename)
            mode = entry.external_attr >> 16
            if (name.is_absolute() or ".." in name.parts or "\\" in entry.filename
                    or any(ord(c) < 32 for c in entry.filename)
                    or stat.S_IFMT(mode) not in (0, stat.S_IFREG, stat.S_IFDIR)
                    or str(name) in names):
                raise ValueError(f"Unsafe archive entry: {entry.filename!r}")
            names.add(str(name))
        source.extractall(destination)


def verify_download(release, directory):
    tag = release["tag_name"]
    version = version_for(tag)
    if release.get("draft") or not release.get("immutable"):
        raise ValueError(f"{tag} is not a published immutable release. Enable release immutability before publishing.")
    filename = f"biztrack-{version}.zip"
    run("gh", "release", "verify", tag, "--repo", REPO)
    for asset in (filename, "SHA256SUMS"):
        run("gh", "release", "download", tag, "--repo", REPO, "--pattern", asset, "--dir", str(directory))
        run("gh", "release", "verify-asset", tag, str(directory / asset), "--repo", REPO)
    archive = directory / filename
    expected = f"{hashlib.sha256(archive.read_bytes()).hexdigest()}  {filename}"
    if (directory / "SHA256SUMS").read_text().strip() != expected:
        raise ValueError(f"Checksum mismatch for {tag}.")
    return archive


def publish(tag):
    version = version_for(tag)
    package = json.loads((ROOT / "package.json").read_text())
    if package["version"] != version:
        raise ValueError("Tag must match package.json version.")
    commit = run("git", "rev-parse", "HEAD", cwd=ROOT)
    if run("git", "rev-parse", f"refs/tags/{tag}^{{commit}}", cwd=ROOT) != commit:
        raise ValueError("Check out the tagged commit before publishing.")
    existing = next((r for r in releases() if r["tag_name"] == tag), None)
    if existing and not existing["draft"]:
        with tempfile.TemporaryDirectory() as tmp:
            archive = verify_download(existing, Path(tmp))
            extract_build(archive, Path(tmp) / "build")
            check_build(Path(tmp) / "build", version, f"/v/{version}", commit)
        print(f"{tag} already published; original build verified.")
        return
    # Verify tag protections before creating anything. Repository admins enable
    # release immutability once; the published release is also checked below.
    rulesets = api(f"repos/{REPO}/rulesets")
    protected = False
    for summary in rulesets:
        ruleset = api(f"repos/{REPO}/rulesets/{summary['id']}")
        names = ruleset.get("conditions", {}).get("ref_name", {})
        if (ruleset.get("target") == "tag" and ruleset.get("enforcement") == "active"
                and not ruleset.get("bypass_actors") and not names.get("exclude")
                and "refs/tags/v*" in names.get("include", [])
                and {"update", "deletion"}.issubset({r["type"] for r in ruleset.get("rules", [])})):
            protected = True
    if not protected:
        raise ValueError("Enable the release tag ruleset before publishing (see docs/releases.md).")
    env = {**os.environ, "BIZTRACK_BASE_PATH": f"/v/{version}"}
    subprocess.run(["npm", "run", "build"], cwd=ROOT, env=env, check=True)
    check_build(ROOT / "build", version, f"/v/{version}", commit)
    if not existing:
        run("gh", "release", "create", tag, "--repo", REPO, "--verify-tag", "--draft", "--generate-notes")
    with tempfile.TemporaryDirectory() as tmp:
        archive = Path(tmp) / f"biztrack-{version}.zip"
        archive_build(ROOT / "build", archive)
        checksums = Path(tmp) / "SHA256SUMS"
        checksums.write_text(f"{hashlib.sha256(archive.read_bytes()).hexdigest()}  {archive.name}\n")
        # Only drafts can be resumed with replacement assets.
        run("gh", "release", "upload", tag, str(archive), str(checksums), "--repo", REPO, "--clobber")
        run("gh", "release", "edit", tag, "--repo", REPO, "--draft=false")
    published = api(f"repos/{REPO}/releases/tags/{tag}")
    with tempfile.TemporaryDirectory() as tmp:
        verify_download(published, Path(tmp))
    print(f"Published and verified {tag}.")


def page(title, body, script=""):
    return f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>{html.escape(title)}</title><link rel="stylesheet" href="/style.css"></head>
<body><main>{body}</main>{script}</body></html>\n'''


def write_site(site, versions, beta):
    site.mkdir(parents=True, exist_ok=True)
    for source in (ROOT / "site").iterdir():
        shutil.copy2(source, site / source.name)
    for name in ("CNAME", ".nojekyll", "icon-192.png", "icon-512.png", "icon-120.png"):
        shutil.copy2(ROOT / "static" / name, site / name)
    rows = []
    for info in sorted(versions, key=lambda info: tuple(map(int, info["version"].split('.'))), reverse=True):
        version = info["version"]
        tag = f"v{version}"
        repo_url = f"https://github.com/{REPO}"
        rows.append(f'<li><a href="/v/{version}/">{version}</a> · '
                    f'<a href="{repo_url}/releases/tag/{tag}">Release notes</a> · '
                    f'<a href="{repo_url}/commit/{info["commit"]}">Source</a> · '
                    f'<a href="{repo_url}/releases/download/{tag}/biztrack-{version}.zip">Download</a></li>')
    body = f'''<h1>BizTrack</h1>
<p>Expenses and mileage. Data stays on your device and in your Google Drive. No infrastructure setup needed.</p>
<h2>Choose a version</h2>
<p>Open a fixed version, then bookmark it or install it from your browser. It stays on that release until you choose another.</p>
{('<ul>' + ''.join(rows) + '</ul>') if rows else '<p>No fixed releases yet.</p>'}
<h2><a href="/beta/">Beta</a></h2>
<p>Tracks main and updates automatically. Build <a href="https://github.com/{REPO}/commit/{beta['commit']}">{beta['commit'][:7]}</a>.</p>
<p>Already using BizTrack? Continue in beta to keep your sign-in and pending changes. Sync there before switching versions. Fixed versions sign in separately and use the same Drive files.</p>
<p>To pin a version on your phone, install it separately. Your old home-screen shortcut still opens this chooser.</p>
<h2>Trust and updates</h2>
<p>Published release archives are immutable. The site owner can still change what this website serves. Using the hosted app requires trusting its maintainers; you can inspect or host a release yourself.</p>
<p><a href="/beta/privacy/">Privacy</a> · <a href="/beta/terms/">Terms</a> · <a href="https://github.com/{REPO}">GitHub</a></p>'''
    (site / "index.html").write_text(page("BizTrack versions", body, '<script src="/migrate.js" defer></script>'))
    (site / "404.html").write_text(page("Page not found — BizTrack", '<h1>Page not found</h1><p><a href="/">Choose a version</a></p>'))
    # Preserve old bookmarks and OAuth policy URLs. Query strings stay in-browser.
    for index in (site / "beta").rglob("index.html"):
        route = index.parent.relative_to(site / "beta")
        if route == Path('.'):
            continue
        target = site / route
        target.mkdir(parents=True, exist_ok=True)
        destination = f"/beta/{route.as_posix()}/"
        (target / "index.html").write_text(page("BizTrack has moved", f'<p><a data-destination href="{html.escape(destination)}">Continue in beta</a></p>',
                                                '<script src="/migrate.js" defer></script><script src="/redirect.js" defer></script>'))


def assemble(destination):
    site = Path(destination)
    if site.exists():
        raise ValueError(f"Use an empty output path: {site}")
    beta = json.loads((ROOT / "build/build-info.json").read_text())
    check_build(ROOT / "build", beta["version"], "/beta")
    versions = []
    # ponytail: download all releases per deploy; add incremental assembly if archive size makes this slow.
    with tempfile.TemporaryDirectory() as tmp:
        stage = Path(tmp) / "site"
        shutil.copytree(ROOT / "build", stage / "beta")
        for release in releases():
            if release["draft"]:
                continue
            version = version_for(release["tag_name"])
            downloads = Path(tmp) / version
            downloads.mkdir()
            archive = verify_download(release, downloads)
            output = stage / "v" / version
            extract_build(archive, output)
            commit = run("git", "rev-parse", f"refs/tags/v{version}^{{commit}}", cwd=ROOT)
            versions.append(check_build(output, version, f"/v/{version}", commit))
        write_site(stage, versions, beta)
        if sum(p.stat().st_size for p in stage.rglob('*') if p.is_file()) > 1_000_000_000:
            raise ValueError("Combined site exceeds the GitHub Pages size limit; no versions were removed.")
        shutil.copytree(stage, site)
    print(f"Assembled beta and {len(versions)} fixed releases in {site}.")


if __name__ == "__main__":
    try:
        if len(sys.argv) != 3 or sys.argv[1] not in ("publish", "assemble"):
            raise ValueError("Usage: python3 scripts/releases.py publish v1.2.3 | assemble OUTPUT")
        if not re.fullmatch(r"[\w.-]+/[\w.-]+", REPO):
            raise ValueError("Invalid GitHub repository.")
        (publish if sys.argv[1] == "publish" else assemble)(sys.argv[2])
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        sys.exit(str(error))

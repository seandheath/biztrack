"""Run with python3 tests/releases.py; uses only temporary files and no GitHub writes."""
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import stat
import tempfile
import zipfile
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("releases", ROOT / "scripts/releases.py")
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)


def rejects(operation):
    try:
        operation()
    except ValueError:
        return
    raise AssertionError("Expected rejection")


def fixture(path, version, base, content):
    path.mkdir(parents=True)
    info = {"version": version, "base": base, "commit": "a" * 40}
    (path / "build-info.json").write_text(json.dumps(info))
    (path / "manifest.webmanifest").write_text(json.dumps(dict.fromkeys(("id", "scope", "start_url"), base + "/")))
    (path / "index.html").write_text(f'<link rel="manifest" href="{base}/manifest.webmanifest">{content}')
    (path / "service-worker.js").write_text(content)
    (path / "history").mkdir()
    (path / "history/index.html").write_text(content)
    return info


for tag in ("v1.2.3", "v0.0.0", "v10.20.30"):
    assert r.version_for(tag) == tag[1:]
for tag in ("main", "v01.2.3", "v1.2.3/../../", "v1.2.3-beta", "v1.2.3\n"):
    rejects(lambda: r.version_for(tag))

with tempfile.TemporaryDirectory() as tmp:
    tmp = Path(tmp)
    original_root = r.ROOT
    r.ROOT = tmp / "repo"
    r.ROOT.mkdir()
    shutil.copytree(ROOT / "site", r.ROOT / "site")
    shutil.copytree(ROOT / "static", r.ROOT / "static")
    beta = fixture(r.ROOT / "build", "1.2.4", "/beta", "beta one")
    archived = tmp / "archives"
    archived.mkdir()
    published = []
    for version in ("1.2.3", "1.2.4"):
        source = tmp / version
        fixture(source, version, f"/v/{version}", f"original {version}")
        r.archive_build(source, archived / f"{version}.zip")
        published.append({"tag_name": f"v{version}", "draft": False, "immutable": True})
    # Verify immutable metadata, GitHub verification calls, and checksums before extraction.
    actual_run = r.run
    calls = []
    def gh(*args, **kwargs):
        calls.append(args)
        if args[:3] == ("gh", "release", "download"):
            directory = Path(args[args.index("--dir") + 1])
            name = args[args.index("--pattern") + 1]
            if name.endswith('.zip'):
                shutil.copy2(archived / "1.2.3.zip", directory / name)
            else:
                digest = hashlib.sha256((archived / "1.2.3.zip").read_bytes()).hexdigest()
                (directory / name).write_text(f"{digest}  biztrack-1.2.3.zip\n")
        return ""
    r.run = gh
    download = tmp / "download"
    download.mkdir()
    archive = r.verify_download(published[0], download)
    assert sum(call[:3] == ("gh", "release", "verify-asset") for call in calls) == 2
    rejects(lambda: r.verify_download({**published[0], "immutable": False}, download))
    extracted = tmp / "extracted"
    r.extract_build(archive, extracted)
    r.check_build(extracted, "1.2.3", "/v/1.2.3", "a" * 40)
    rejects(lambda: r.check_build(extracted, "1.2.4", "/v/1.2.4"))
    rejects(lambda: r.check_build(extracted, "1.2.3", "/v/1.2.3", "b" * 40))

    # All deployments use archived files, even as beta and the catalog change.
    r.releases = lambda: published[:1]
    r.verify_download = lambda release, directory: archived / f"{r.version_for(release['tag_name'])}.zip"
    r.run = lambda *args, **kwargs: "a" * 40
    first = tmp / "first"
    r.assemble(first)
    before = {p.relative_to(first / "v/1.2.3"): p.read_bytes() for p in (first / "v/1.2.3").rglob('*') if p.is_file()}
    (r.ROOT / "build/index.html").write_text('<link rel="manifest" href="/beta/manifest.webmanifest">beta two')
    r.releases = lambda: published
    second = tmp / "second"
    r.assemble(second)
    after = {p.relative_to(second / "v/1.2.3"): p.read_bytes() for p in (second / "v/1.2.3").rglob('*') if p.is_file()}
    assert before == after
    assert (second / "beta/index.html").read_text().endswith("beta two")
    chooser = (second / "index.html").read_text()
    assert chooser.index('href="/v/1.2.4/"') < chooser.index('href="/v/1.2.3/"')
    assert '<link rel="manifest"' not in chooser
    for icon in ("icon.svg", "icon-180.png"):
        assert f'href="/{icon}"' in chooser
        assert (second / icon).read_bytes() == (ROOT / "static" / icon).read_bytes()
    assert 'href="/beta/history/"' in (second / "history/index.html").read_text()
    assert (second / "404.html").is_file()
    rejects(lambda: r.assemble(second))
    r.releases = lambda: [{"tag_name": "v9.9.9", "draft": False, "immutable": True}]
    try:
        r.assemble(tmp / "missing")
    except FileNotFoundError:
        pass
    else:
        raise AssertionError("Missing release must fail the deployment")
    assert not (tmp / "missing").exists()

    for name, mode in [("../outside", 0), ("/absolute", 0), ("bad\\path", 0), ("link", stat.S_IFLNK | 0o777)]:
        bad = tmp / "bad.zip"
        with zipfile.ZipFile(bad, 'w') as output:
            entry = zipfile.ZipInfo(name)
            entry.external_attr = mode << 16
            output.writestr(entry, 'bad')
        rejects(lambda: r.extract_build(bad, tmp / "unsafe"))
    assert not (tmp / "outside").exists()

# Publication uploads to a draft before locking it; reruns never rebuild it.
with tempfile.TemporaryDirectory() as tmp:
    root = Path(tmp)
    (root / "package.json").write_text('{"version":"1.2.3"}')
    release = {"tag_name": "v1.2.3", "draft": True, "immutable": False}
    state = []
    commands = []
    builds = []
    ruleset = json.loads((ROOT / ".github/release-ruleset.json").read_text())

    def command(*args, **kwargs):
        commands.append(args)
        if args[0] == "git":
            return "a" * 40
        if args[:3] == ("gh", "release", "create"):
            assert "--draft" in args
            state.append(release)
        if args[:3] == ("gh", "release", "upload"):
            assert release["draft"]
            shutil.copy2(args[4], root / "published.zip")
        if args[:3] == ("gh", "release", "edit"):
            assert (root / "published.zip").is_file()
            release.update(draft=False, immutable=True)
        return ""

    def build(*args, **kwargs):
        assert kwargs["env"]["BIZTRACK_BASE_PATH"] == "/v/1.2.3"
        builds.append(args)
        fixture(root / "build", "1.2.3", "/v/1.2.3", "original")

    def endpoint(path):
        if path.endswith("/rulesets"):
            return [{"id": 1}]
        return ruleset if path.endswith("/rulesets/1") else release

    with patch.object(r, "ROOT", root), patch.object(r, "run", command), \
            patch.object(r, "releases", lambda: state), patch.object(r, "api", endpoint), \
            patch.object(r.subprocess, "run", build), \
            patch.object(r, "verify_download", lambda *args: root / "published.zip"):
        rejects(lambda: r.publish("v1.2.4"))
        with patch.object(r, "api", lambda path: []):
            rejects(lambda: r.publish("v1.2.3"))
        ruleset["bypass_actors"] = [{"actor_id": 5, "actor_type": "RepositoryRole", "bypass_mode": "always"}]
        rejects(lambda: r.publish("v1.2.3"))
        assert not builds
        ruleset["bypass_actors"] = []
        r.publish("v1.2.3")
        assert release["immutable"]
        r.publish("v1.2.3")
        assert len(builds) == 1
        assert sum(cmd[:3] == ("gh", "release", "upload") for cmd in commands) == 1

print("Release publication, integrity, safe extraction, and unchanged-version checks passed.")

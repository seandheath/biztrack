"""Preview the root version chooser using local version tags."""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import tempfile

from releases import ROOT, VERSION, run, version_for, write_site


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8080)
    args = parser.parse_args()
    commit = run("git", "rev-parse", "HEAD", cwd=ROOT)
    tags = run("git", "tag", "--list", "v*", cwd=ROOT).splitlines()
    versions = [
        {"version": version_for(tag), "commit": run("git", "rev-parse", f"refs/tags/{tag}^{{commit}}", cwd=ROOT)}
        for tag in tags if VERSION.fullmatch(tag)
    ]
    with tempfile.TemporaryDirectory(prefix="biztrack-preview-") as directory:
        write_site(Path(directory), versions, {"commit": commit})
        handler = partial(SimpleHTTPRequestHandler, directory=directory)
        with ThreadingHTTPServer(("127.0.0.1", args.port), handler) as server:
            print(f"Preview: http://localhost:{server.server_port}", flush=True)
            print("Chooser only; local tags are listed without checking GitHub publication. Restart after edits. Ctrl+C to stop.", flush=True)
            try:
                server.serve_forever()
            except KeyboardInterrupt:
                pass


if __name__ == "__main__":
    main()

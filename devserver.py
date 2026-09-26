#!/usr/bin/env python3
"""Local dev server for the site.

`python3 -m http.server` sends no Cache-Control at all, so browsers fall back to
heuristic caching and hold on to ES modules across reloads. The symptom is
editing a file, reloading, and seeing the old behaviour — which during this
build repeatedly looked like a bug in the code rather than a stale module.

This serves the same directory with caching switched off, so a reload always
gets what is on disk. Production is the opposite and is configured separately in
public/_headers, where assets are allowed to cache and revalidate.

    python3 devserver.py [port]
"""

import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent


class NoCacheHandler(SimpleHTTPRequestHandler):
    # Correct types matter here: a module served as text/plain is refused by the
    # browser outright, and .mjs is missing from some Python installs.
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".css": "text/css",
        ".json": "application/json",
        ".svg": "image/svg+xml",
        ".webmanifest": "application/manifest+json",
    }

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def send_header(self, keyword, value):
        # Drop the validators too. Without this the browser still sends
        # If-Modified-Since and can be told 304 Not Modified, which reintroduces
        # exactly the staleness no-store was meant to remove.
        if keyword in ("Last-Modified", "ETag"):
            return
        super().send_header(keyword, value)

    def log_message(self, fmt, *args):
        # Quiet by default; a 200 per asset per reload drowns anything useful.
        if args and len(args) > 1 and str(args[1]) not in ("200", "304"):
            super().log_message(fmt, *args)


def main() -> int:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 4713
    handler = partial(NoCacheHandler, directory=str(ROOT))
    server = ThreadingHTTPServer(("127.0.0.1", port), handler)
    print(f"serving {ROOT} at http://localhost:{port}  (caching disabled)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

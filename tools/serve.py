#!/usr/bin/env python3
"""Dev server for the game: static files with caching switched off, so a normal reload
always shows the latest art and code.   python3 tools/serve.py [port]"""
import sys, http.server, functools
class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, max-age=0')
        super().end_headers()
port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
http.server.ThreadingHTTPServer(('0.0.0.0', port), NoCache).serve_forever()

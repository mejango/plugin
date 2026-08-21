"""Static server with clean URLs and a bendystraw GraphQL proxy (CORS-free search)."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import socket
import urllib.request

BENDYSTRAW = "https://bendystraw.up.railway.app/graphql"


class Handler(SimpleHTTPRequestHandler):
    def do_POST(self):
        if self.path.split("?")[0] != "/api/bendystraw":
            self.send_error(404)
            return
        length = min(int(self.headers.get("Content-Length", 0)), 100_000)
        body = self.rfile.read(length)
        try:
            json.loads(body)  # only forward JSON
            req = urllib.request.Request(
                BENDYSTRAW, data=body, headers={"Content-Type": "application/json"}, method="POST"
            )
            with urllib.request.urlopen(req, timeout=15) as resp:
                payload = resp.read()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
        except Exception:
            self.send_error(502)

    def do_GET(self):
        path = self.path.split("?")[0].split("#")[0]
        if path in ("/home", "/home.html", "/index.html", "/index"):
            self.send_response(301)
            self.send_header("Location", "/")
            self.end_headers()
            return
        if path.endswith(".html"):
            self.send_response(301)
            self.send_header("Location", path[: -len(".html")])
            self.end_headers()
            return
        if path != "/" and "." not in path.rstrip("/").rsplit("/", 1)[-1]:
            self.path = path.rstrip("/") + ".html"
        super().do_GET()


class Server(ThreadingHTTPServer):
    address_family = socket.AF_INET6


Server(("::", 8080), Handler).serve_forever()

"""Static server with clean URLs: /create serves create.html, /create.html 301s to /create."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import socket


class Handler(SimpleHTTPRequestHandler):
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

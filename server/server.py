#!/usr/bin/env python3
"""
Password gate + static server for the Colectivo Pepita Space.

Everything (the game under /src, the assets under /data, every file) is gated
behind a password. The password is read at runtime from the APP_PASSWORD
environment variable, which is set as a Hugging Face Space *secret*.

Layout: ROOT (APP_ROOT, default /app) is the document root holding src/ and data/.
The login page is ../landing/index.html (override with LANDING_PATH).

Flow:
  - GET /            -> landing page with a password form (or redirect to /src/ if already in)
  - POST /login      -> validates password; on success sets a signed cookie and redirects
  - anything else    -> served only when a valid auth cookie is present, otherwise -> /

If APP_PASSWORD is unset the gate fails closed: the landing page renders a
"not configured" notice and no password can ever succeed.
"""
import hashlib
import hmac
import os
import time
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs

ROOT = os.environ.get("APP_ROOT", "/app")
PORT = int(os.environ.get("PORT", "7860"))
PASSWORD = os.environ.get("APP_PASSWORD", "")

COOKIE_NAME = "pepita_auth"
COOKIE_MAX_AGE = 60 * 60 * 12  # 12h
# Public salt: combined with the secret password to form an unforgeable cookie
# token. Knowing the salt is useless without the password (one-way HMAC).
_SALT = b"colectivo-pepita-gate-v1"

# Paths reachable without a session (the gate itself).
PUBLIC_PATHS = {"/", "/index.html", "/login"}

HERE = os.path.dirname(os.path.abspath(__file__))

LANDING_PATH = os.environ.get("LANDING_PATH", os.path.join(HERE, "..", "landing", "index.html"))

with open(LANDING_PATH, "r", encoding="utf-8") as fh:
    LANDING_TEMPLATE = fh.read()


def auth_token(password: str) -> str:
    return hmac.new(_SALT, password.encode("utf-8"), hashlib.sha256).hexdigest()


VALID_TOKEN = auth_token(PASSWORD) if PASSWORD else None


def render_landing(error: str = "", notice: str = "") -> bytes:
    error_block = f'<p class="error">{error}</p>' if error else ""
    notice_block = f'<p class="notice">{notice}</p>' if notice else ""
    html = (
        LANDING_TEMPLATE
        .replace("<!--ERROR-->", error_block)
        .replace("<!--NOTICE-->", notice_block)
    )
    return html.encode("utf-8")


class GateHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    # --- session ---
    def _authed(self) -> bool:
        if not VALID_TOKEN:
            return False
        raw = self.headers.get("Cookie")
        if not raw:
            return False
        morsel = SimpleCookie(raw).get(COOKIE_NAME)
        return bool(morsel) and hmac.compare_digest(morsel.value, VALID_TOKEN)

    def _serve_landing(self, status=HTTPStatus.OK, error=""):
        notice = "" if PASSWORD else (
            "Este Space todavía no tiene configurado el secreto <code>APP_PASSWORD</code> — "
            "añádelo en Ajustes › Variables and secrets para habilitar el acceso."
        )
        body = render_landing(error=error, notice=notice)
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _redirect(self, location, cookie_value=None):
        self.send_response(HTTPStatus.SEE_OTHER)
        self.send_header("Location", location)
        self.send_header("Content-Length", "0")
        if cookie_value is not None:
            self.send_header(
                "Set-Cookie",
                f"{COOKIE_NAME}={cookie_value}; Path=/; HttpOnly; Secure; "
                f"SameSite=Lax; Max-Age={COOKIE_MAX_AGE}",
            )
        self.end_headers()

    # --- routing ---
    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path in PUBLIC_PATHS:
            if self._authed():
                self._redirect("/src/")
            else:
                self._serve_landing()
            return
        if not self._authed():
            self._redirect("/")
            return
        super().do_GET()

    def do_HEAD(self):
        path = self.path.split("?", 1)[0]
        if not self._authed() and path not in PUBLIC_PATHS:
            self._redirect("/")
            return
        super().do_HEAD()

    def do_POST(self):
        if self.path.split("?", 1)[0] != "/login":
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        length = int(self.headers.get("Content-Length") or 0)
        data = self.rfile.read(length).decode("utf-8") if length else ""
        supplied = parse_qs(data).get("password", [""])[0]
        if PASSWORD and hmac.compare_digest(supplied, PASSWORD):
            self._redirect("/src/", cookie_value=VALID_TOKEN)
        else:
            time.sleep(0.5)  # mild brute-force friction
            self._serve_landing(status=HTTPStatus.UNAUTHORIZED, error="Clave incorrecta. Inténtalo de nuevo.")

    def log_message(self, *args):
        pass  # keep Space logs quiet


if __name__ == "__main__":
    print(f"[pepita] serving {ROOT} on :{PORT} | auth {'ON' if PASSWORD else 'NOT CONFIGURED (fail-closed)'}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", PORT), GateHandler).serve_forever()

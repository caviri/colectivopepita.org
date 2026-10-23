"""The password gate must fail closed and never serve content without a session."""
import importlib
import threading
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer

import pytest


@pytest.fixture
def gate(tmp_path, monkeypatch):
    (tmp_path / "src").mkdir()
    (tmp_path / "src" / "index.html").write_text("<h1>game</h1>")
    monkeypatch.setenv("APP_ROOT", str(tmp_path))

    def start(password):
        if password:
            monkeypatch.setenv("APP_PASSWORD", password)
        else:
            monkeypatch.delenv("APP_PASSWORD", raising=False)
        import server

        mod = importlib.reload(server)
        httpd = ThreadingHTTPServer(("127.0.0.1", 0), mod.GateHandler)
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        servers.append(httpd)
        return httpd.server_address[1], mod

    servers = []
    yield start
    for s in servers:
        s.shutdown()


def request(port, method, path, body=None, headers=None):
    conn = HTTPConnection("127.0.0.1", port)
    conn.request(method, path, body=body, headers=headers or {})
    res = conn.getresponse()
    res.read()
    return res


def test_anonymous_is_redirected_to_landing(gate):
    port, _ = gate("secret")
    res = request(port, "GET", "/src/index.html")
    assert res.status == 303 and res.getheader("Location") == "/"


def test_wrong_password_rejected(gate):
    port, _ = gate("secret")
    res = request(port, "POST", "/login", "password=nope",
                  {"Content-Type": "application/x-www-form-urlencoded", "Content-Length": "13"})
    assert res.status == 401 and res.getheader("Set-Cookie") is None


def test_login_grants_access(gate):
    port, _ = gate("secret")
    body = "password=secret"
    res = request(port, "POST", "/login", body, {"Content-Length": str(len(body))})
    assert res.status == 303
    cookie = res.getheader("Set-Cookie").split(";")[0]
    res = request(port, "GET", "/src/index.html", headers={"Cookie": cookie})
    assert res.status == 200


def test_unset_password_fails_closed(gate):
    port, _ = gate(None)
    body = "password="
    res = request(port, "POST", "/login", body, {"Content-Length": str(len(body))})
    assert res.status == 401
    assert request(port, "GET", "/src/index.html").status == 303

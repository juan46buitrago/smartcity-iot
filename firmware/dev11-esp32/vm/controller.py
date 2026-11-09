#!/usr/bin/env python3
"""
Controlador de DEV11 bajo demanda (corre en la VM, sin dependencias externas).

Enciende y apaga el simulador Wokwi CLI cuando la web se lo pide y lo apaga solo si nadie la mira:
  - POST /start   enciende (crea un «arriendo» de LEASE_S segundos)
  - POST /ping    lo manda la web mientras alguien tiene la página visible: renueva el arriendo
  - POST /stop    apaga
  - GET  /status  {running, lease_s, max_s}
Todas las rutas exigen  Authorization: Bearer $CTL_TOKEN  (lo llama solo el backend, nunca el navegador).

Límites: el arriendo vence a los LEASE_S sin ping y una sesión nunca pasa de MAX_S. La cuenta gratis de
Wokwi corta cada simulación a los 5 min: mientras haya arriendo vigente, el controlador la relanza.
"""
import hmac
import json
import os
import signal
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

TOKEN = os.environ.get("CTL_TOKEN", "")
PORT = int(os.environ.get("CTL_PORT", "8790"))
LEASE_S = int(os.environ.get("LEASE_S", "150"))
MAX_S = int(os.environ.get("MAX_S", "5400"))
WORKDIR = os.environ.get("DEV11_DIR", os.path.expanduser("~/dev11"))
CLI = os.environ.get("WOKWI_CLI", os.path.expanduser("~/.wokwi/bin/wokwi-cli"))

lock = threading.Lock()
proc = None  # subprocess.Popen | None
wanted = False  # el usuario quiere DEV11 encendido
lease_until = 0.0
session_start = 0.0
spawned_at = 0.0
quick_fails = 0
last_error = None
QUICK_S = 20  # un simulador que dura menos es un fallo, no un corte normal de 5 min
MAX_QUICK_FAILS = 3


def log(msg):
    print(f"[controller] {msg}", flush=True)


def _spawn():
    global proc, spawned_at
    spawned_at = time.time()
    proc = subprocess.Popen([CLI, "--timeout", "600000", "."], cwd=WORKDIR, start_new_session=True)
    log(f"wokwi-cli pid {proc.pid}")


def _kill():
    global proc
    if proc and proc.poll() is None:
        try:
            os.killpg(proc.pid, signal.SIGTERM)
            proc.wait(timeout=8)
        except Exception:
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except Exception:
                pass
    proc = None


def start():
    global wanted, lease_until, session_start, quick_fails, last_error
    with lock:
        if not wanted:
            session_start = time.time()
            quick_fails = 0
            last_error = None
        wanted = True
        lease_until = time.time() + LEASE_S
        if proc is None or proc.poll() is not None:
            _spawn()


def stop(reason="solicitado"):
    global wanted
    with lock:
        wanted = False
        _kill()
        log(f"apagado ({reason})")


def ping():
    global lease_until
    with lock:
        if wanted:
            lease_until = time.time() + LEASE_S
        return wanted


def status():
    with lock:
        running = wanted and proc is not None and proc.poll() is None
        left = max(0, int(lease_until - time.time())) if wanted else 0
        left_max = max(0, int(session_start + MAX_S - time.time())) if wanted else 0
        return {"running": bool(wanted), "process": running, "lease_s": left, "max_s": left_max, "error": last_error}


def supervisor():
    """Vence el arriendo, limita la sesión y relanza el simulador si Wokwi lo corta."""
    global quick_fails, last_error
    while True:
        time.sleep(3)
        reason = None
        pause = 0
        with lock:
            now = time.time()
            if not wanted:
                continue
            if now > lease_until:
                reason = "nadie mira la página"
            elif now > session_start + MAX_S:
                reason = "tiempo máximo de sesión"
            elif proc is None or proc.poll() is not None:
                quick = now - spawned_at < QUICK_S
                quick_fails = quick_fails + 1 if quick else 0
                if quick_fails >= MAX_QUICK_FAILS:
                    reason = "el simulador no arranca"
                    last_error = "Wokwi rechazó el simulador (cuota gratuita mensual de minutos agotada, token inválido o sin red). Mira el log del controlador."
                else:
                    log("el simulador terminó; se relanza (límite de la cuenta gratis)")
                    _spawn()
                    pause = 10 if quick else 0
        if reason:
            stop(reason)
        elif pause:
            time.sleep(pause)  # freno fuera del candado: no martillar la API de Wokwi


class Handler(BaseHTTPRequestHandler):
    def _auth(self):
        got = self.headers.get("Authorization", "")
        return bool(TOKEN) and hmac.compare_digest(got, f"Bearer {TOKEN}")

    def _send(self, code, body):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if not self._auth():
            return self._send(401, {"error": "no autorizado"})
        if self.path == "/status":
            return self._send(200, status())
        self._send(404, {"error": "no encontrado"})

    def do_POST(self):
        if not self._auth():
            return self._send(401, {"error": "no autorizado"})
        if self.path == "/start":
            start()
        elif self.path == "/stop":
            stop()
        elif self.path == "/ping":
            ping()
        else:
            return self._send(404, {"error": "no encontrado"})
        self._send(200, status())

    def log_message(self, fmt, *args):  # sin ruido por petición
        pass


if __name__ == "__main__":
    if not TOKEN or len(TOKEN) < 16:
        raise SystemExit("Falta CTL_TOKEN (mínimo 16 caracteres)")
    threading.Thread(target=supervisor, daemon=True).start()
    log(f"escuchando en :{PORT} · arriendo {LEASE_S}s · sesión máx {MAX_S}s")
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()

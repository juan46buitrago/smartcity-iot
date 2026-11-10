#!/usr/bin/env python3
"""
Genera el informe académico de SmartCityBGA (HTML + PDF) con datos reales de producción.

    python docs/informe/generar_informe.py                 # ventana: desde el inicio de la captura hasta ahora
    python docs/informe/generar_informe.py --hasta 2026-11-13T23:59:00-05:00

Requisitos: Python 3.11+ con matplotlib, y Microsoft Edge o Google Chrome (para el PDF y las capturas).
Solo usa endpoints PÚBLICOS de lectura de https://smartcitybga.duckdns.org: no necesita credenciales.
Salida: docs/informe/INFORME-SmartCityBGA.pdf, informe.html y figuras/.
"""
from __future__ import annotations

import argparse
import html
import json
import shutil
import subprocess
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.dates as mdates  # noqa: E402
import matplotlib.pyplot as plt  # noqa: E402

BASE = "https://smartcitybga.duckdns.org"
HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
FIG = HERE / "figuras"
BOGOTA = timezone(timedelta(hours=-5))
CAPTURE_START = datetime(2026, 11, 7, 0, 0, tzinfo=BOGOTA)  # inicio de la captura en producción (DESPLIEGUE.md)
FINAL_TARGET = datetime(2026, 11, 13, 23, 59, tzinfo=BOGOTA)
# Perfil aislado: si el navegador ya está abierto, el modo headless sin perfil propio termina sin hacer nada.
PROFILE = Path(__import__("tempfile").gettempdir()) / "scbga-informe-browser"

# Paleta categórica validada (skill dataviz, modo claro), en orden fijo; nunca cíclica.
SERIES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100"]
UNAB = "#fea604"  # naranja del logo institucional
INK, INK2, MUTED, GRID, SURFACE = "#1f2420", "#4a524c", "#7b847d", "#e3e6e2", "#fcfcfb"
REF = {"promedio": INK2, "mín": "#2a78d6", "máx": "#c2410c"}

plt.rcParams.update({
    "font.family": "DejaVu Sans", "font.size": 9, "axes.edgecolor": GRID, "axes.labelcolor": INK2,
    "axes.titlesize": 10, "axes.titleweight": "bold", "axes.titlecolor": INK, "xtick.color": MUTED, "ytick.color": MUTED,
    "axes.grid": True, "grid.color": GRID, "grid.linewidth": 0.6, "axes.spines.top": False, "axes.spines.right": False,
    "figure.facecolor": SURFACE, "axes.facecolor": SURFACE, "savefig.facecolor": SURFACE, "legend.frameon": False,
})


def get(path: str, **params) -> object:
    q = ("?" + urllib.parse.urlencode(params)) if params else ""
    req = urllib.request.Request(BASE + path + q, headers={"User-Agent": "scbga-informe/1.0", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode("utf-8"))


def iso(d: datetime) -> str:
    return d.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def local(s: str | None, fmt="%d/%m %H:%M") -> str:
    if not s:
        return "—"
    return datetime.fromisoformat(s.replace("Z", "+00:00")).astimezone(BOGOTA).strftime(fmt)


def num(v, d=1) -> str:
    if v is None:
        return "—"
    s = f"{v:,.{d}f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return s


def esc(s) -> str:
    return html.escape(str(s))


# ----------------------------------------------------------------------------- datos


def collect(frm: datetime, to: datetime) -> dict:
    print(f"→ Datos {iso(frm)} → {iso(to)}")
    catalog = get("/api/catalog")
    capture = get("/api/capture", **{"from": iso(frm), "to": iso(to)})
    stats, history = {}, {}
    for d in catalog:
        for v in d["variables"]:
            if v["kind"] != "number":
                continue
            key = f"{d['id']}.{v['key']}"
            try:
                stats[key] = get(f"/api/stats/{d['id']}/{v['key']}", **{"from": iso(frm), "to": iso(to)})
                history[key] = get(f"/api/history/{d['id']}/{v['key']}", **{"from": iso(frm), "to": iso(to), "points": 700})
            except Exception as e:  # noqa: BLE001
                print(f"  ! {key}: {e}")
    hourly = {}
    for key in ["DEV03.noise_db", "DEV05.vehicles_per_min", "DEV01.temperature", "DEV08.occupancy_pct"]:
        dev, var = key.split(".")
        hourly[key] = get(f"/api/history/{dev}/{var}", **{"from": iso(frm), "to": iso(to), "points": max(24, int((to - frm).total_seconds() // 3600))})
    smoke_file = ROOT / "docs/evidencias/ia/enrutador-2026-11-08.json"
    return {
        "frm": frm, "to": to, "catalog": catalog, "capture": capture, "stats": stats, "history": history, "hourly": hourly,
        "incidents": get("/api/incidents/stats", **{"from": iso(frm), "to": iso(to)}),
        "alerts": get("/api/alerts", limit=500),
        "devices": get("/api/devices"),
        "analysis": get("/api/ai/analysis"),
        "ai_status": get("/api/ai/status"),
        "smoke": json.loads(smoke_file.read_text("utf-8")) if smoke_file.exists() else None,
    }


# ----------------------------------------------------------------------------- figuras


def _times(points):
    return [datetime.fromisoformat(p["t"].replace("Z", "+00:00")).astimezone(BOGOTA) for p in points], [p["v"] for p in points]


def _fmt_time_axis(ax, t: list[datetime]):
    """Marcas explícitas según el lapso REAL de los datos (las automáticas se encimaban en gráficas angostas)."""
    span_h = (t[-1] - t[0]).total_seconds() / 3600 if len(t) > 1 else 1
    if span_h >= 72:
        loc, fmt = mdates.DayLocator(tz=BOGOTA), "%d/%m"
    elif span_h >= 20:
        loc, fmt = mdates.HourLocator(byhour=[0, 12], tz=BOGOTA), "%d/%m %Hh"
    elif span_h >= 3:
        loc, fmt = mdates.HourLocator(interval=3, tz=BOGOTA), "%H:%M"
    else:
        loc, fmt = mdates.MinuteLocator(byminute=[0, 15, 30, 45], tz=BOGOTA), "%H:%M"
    ax.xaxis.set_major_locator(loc)
    ax.xaxis.set_major_formatter(mdates.DateFormatter(fmt, tz=BOGOTA))
    if len(t) > 1:
        ax.set_xlim(t[0], t[-1])
    for lbl in ax.get_xticklabels():
        lbl.set_rotation(0)


def device_figure(data: dict, dev: dict) -> str | None:
    """Pequeños múltiplos: una gráfica por variable numérica (nunca doble eje), con promedio/mín/máx."""
    keys = [f"{dev['id']}.{v['key']}" for v in dev["variables"] if v["kind"] == "number" and v["key"] not in ("lat", "lon", "energy_kwh")]
    # Con menos de 20 puntos una serie no describe un comportamiento (p. ej. DEV11 antes de la sesión en Wokwi).
    keys = [k for k in keys if len(data["history"].get(k, {}).get("points", [])) >= 20]
    if not keys:
        return None
    n = len(keys)
    cols = 2 if n > 1 else 1
    rows = (n + cols - 1) // cols
    fig, axes = plt.subplots(rows, cols, figsize=(7.2, 2.15 * rows), squeeze=False)
    for i, key in enumerate(keys):
        ax = axes[i // cols][i % cols]
        h, s = data["history"][key], data["stats"].get(key, {})
        t, v = _times(h["points"])
        var = next(x for x in dev["variables"] if f"{dev['id']}.{x['key']}" == key)
        ax.plot(t, v, color=SERIES[0], linewidth=1.4)
        if s.get("count"):
            refs = [("mín", s["min"]), ("promedio", s["mean"]), ("máx", s["max"])]
            rng = (s["max"] - s["min"]) or 1
            last_y = None
            for lab, val in refs:
                ax.axhline(val, color=REF[lab], linewidth=0.8, linestyle=(0, (4, 3)))
                # Etiqueta directa solo si no se encima con la anterior (> 12 % del rango).
                if last_y is None or (val - last_y) / rng > 0.12:
                    ax.annotate(f"{lab} {num(val, var.get('decimals', 1))}", xy=(1, val), xycoords=("axes fraction", "data"), xytext=(2, 0),
                                textcoords="offset points", fontsize=7, color=INK2, va="center")
                    last_y = val
        ax.set_title(f"{var['label']}" + (f" ({var['unit']})" if var.get("unit") else ""), loc="left", fontsize=9)
        _fmt_time_axis(ax, t)
    for j in range(n, rows * cols):
        axes[j // cols][j % cols].axis("off")
    fig.tight_layout(w_pad=4.5)
    out = FIG / f"{dev['id']}.png"
    fig.savefig(out, dpi=170)
    plt.close(fig)
    return out.name


def hourly_figure(data: dict) -> str:
    fig, axes = plt.subplots(2, 2, figsize=(7.2, 4.4))
    labels = {"DEV03.noise_db": "Ruido DEV03 (dB(A))", "DEV05.vehicles_per_min": "Flujo DEV05 (veh/min)", "DEV01.temperature": "Temperatura DEV01 (°C)", "DEV08.occupancy_pct": "Ocupación DEV08 (%)"}
    for ax, (key, h) in zip(axes.flat, data["hourly"].items()):
        sums, cnt = [0.0] * 24, [0] * 24
        for p in h["points"]:
            hr = datetime.fromisoformat(p["t"].replace("Z", "+00:00")).astimezone(BOGOTA).hour
            sums[hr] += p["v"]
            cnt[hr] += 1
        means = [sums[i] / cnt[i] if cnt[i] else 0 for i in range(24)]
        bars = ax.bar(range(24), means, color=SERIES[0], width=0.8)
        top = max(range(24), key=lambda i: means[i])
        bars[top].set_color(SERIES[1])
        ax.annotate(f"pico {top}h", xy=(top, means[top]), xytext=(0, 3), textcoords="offset points", ha="center", fontsize=7, color=INK2)
        ax.set_title(labels[key], loc="left", fontsize=9)
        ax.set_xticks(range(0, 24, 3))
        ax.set_xticklabels([f"{i}h" for i in range(0, 24, 3)])
        ax.grid(axis="x", visible=False)
    fig.tight_layout()
    out = FIG / "perfil-horario.png"
    fig.savefig(out, dpi=170)
    plt.close(fig)
    return out.name


def comparison_figure(data: dict) -> str | None:
    keys = [("DEV01.temperature", "DEV01 gemelo digital"), ("DEV10.temperature", "DEV10 API Open-Meteo"), ("DEV12.temperature", "DEV12 dataset ERA5 (mismo día 2025)")]
    keys = [(k, lab) for k, lab in keys if data["history"].get(k, {}).get("points")]
    if len(keys) < 2:
        return None
    fig, ax = plt.subplots(figsize=(7.2, 2.8))
    for i, (k, lab) in enumerate(keys):
        t, v = _times(data["history"][k]["points"])
        ax.plot(t, v, color=SERIES[i], linewidth=1.5, label=lab)
        ax.annotate(lab.split(" ")[0], xy=(t[-1], v[-1]), xytext=(4, 0), textcoords="offset points", fontsize=7, color=INK2, va="center")
    ax.set_title("Temperatura (°C): fuentes comparadas", loc="left")
    ax.legend(loc="upper left", fontsize=7, ncol=3)
    _fmt_time_axis(ax, _times(data["history"][keys[0][0]]["points"])[0])
    fig.tight_layout()
    out = FIG / "comparacion-temperatura.png"
    fig.savefig(out, dpi=170)
    plt.close(fig)
    return out.name


def incidents_figure(data: dict) -> str | None:
    rows = sorted(data["incidents"]["byType"], key=lambda r: -r["n"])
    if not rows:
        return None
    fig, ax = plt.subplots(figsize=(7.2, 1.9))
    ax.barh([r["type"].replace("_", " ") for r in rows][::-1], [r["n"] for r in rows][::-1], color=SERIES[0], height=0.6)
    for i, r in enumerate(rows[::-1]):
        ax.annotate(str(r["n"]), xy=(r["n"], i), xytext=(3, 0), textcoords="offset points", va="center", fontsize=8, color=INK2)
    ax.set_title("Incidentes viales simulados por tipo (DEV04, sintético)", loc="left")
    ax.grid(axis="y", visible=False)
    fig.tight_layout()
    out = FIG / "incidentes.png"
    fig.savefig(out, dpi=170)
    plt.close(fig)
    return out.name


def find_browser() -> str | None:
    """Edge o Chrome en Windows, macOS o Linux (para las capturas y el PDF)."""
    candidates = [
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        shutil.which("msedge"),
        shutil.which("google-chrome"),
        shutil.which("chromium"),
    ]
    return next((b for b in candidates if b and Path(b).exists()), None)


def screenshots() -> dict[str, str]:
    browser = find_browser()
    shots = {}
    if not browser:
        return shots
    for name, path in [
        ("app-panel", "/?bienvenida=0"),
        ("app-mapa", "/mapa?bienvenida=0"),
        ("app-dispositivos", "/dispositivos?bienvenida=0"),
        ("app-dev11", "/dispositivos/DEV11?bienvenida=0"),
        ("app-asistente", "/asistente?bienvenida=0"),
        ("app-asistente-panel", "/?asistente=resumen%20del%20d%C3%ADa"),
    ]:
        out = FIG / f"{name}.png"
        subprocess.run([browser, "--headless=new", "--disable-gpu", f"--user-data-dir={PROFILE}", "--hide-scrollbars", f"--screenshot={out}", "--window-size=1440,900",
                        "--virtual-time-budget=20000", BASE + path], capture_output=True, timeout=90)
        if out.exists():
            shots[name] = out.name
    return shots


# ----------------------------------------------------------------------------- HTML


ARCH_SVG = """
<svg viewBox="0 0 980 520" xmlns="http://www.w3.org/2000/svg" font-family="DejaVu Sans, Arial" font-size="12">
  <defs><marker id="a" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#4a524c"/></marker></defs>
  <style>.box{fill:#fff;stroke:#9aa39c;stroke-width:1.2}.t{fill:#1f2420;font-weight:bold}.s{fill:#4a524c;font-size:10.5px}.lane{fill:#f2f4f1;stroke:none}.ln{stroke:#4a524c;stroke-width:1.3;fill:none;marker-end:url(#a)}.lbl{fill:#2a78d6;font-size:10.5px;font-weight:bold}</style>
  <rect class="lane" x="10" y="10" width="250" height="500" rx="6"/><text class="t" x="24" y="32">1 · Dispositivos (percepción)</text>
  <rect class="lane" x="280" y="10" width="190" height="500" rx="6"/><text class="t" x="294" y="32">2 · Comunicación</text>
  <rect class="lane" x="490" y="10" width="300" height="500" rx="6"/><text class="t" x="504" y="32">3 · Plataforma (Azure VM, Docker)</text>
  <rect class="lane" x="810" y="10" width="160" height="500" rx="6"/><text class="t" x="822" y="32">4 · Aplicación</text>

  <rect class="box" x="24" y="48" width="222" height="58" rx="5"/><text class="t" x="34" y="68">Real · DEV11 ESP32 (Wokwi)</text><text class="s" x="34" y="86">DHT22 · LDR · relé · firmware C++</text><text class="s" x="34" y="100">MQTT sobre TLS 8883</text>
  <rect class="box" x="24" y="116" width="222" height="58" rx="5"/><text class="t" x="34" y="136">Gemelo digital · DEV01, DEV07</text><text class="s" x="34" y="154">Open-Meteo + dinámica · ciclo solar</text>
  <rect class="box" x="24" y="184" width="222" height="58" rx="5"/><text class="t" x="34" y="204">API · DEV02, DEV06, DEV10</text><text class="s" x="34" y="222">Open-Meteo AQ/Forecast · GPS</text>
  <rect class="box" x="24" y="252" width="222" height="58" rx="5"/><text class="t" x="34" y="272">Dataset · DEV09, DEV12</text><text class="s" x="34" y="290">IDEAM MAJADAS · CSV ERA5</text>
  <rect class="box" x="24" y="320" width="222" height="72" rx="5"/><text class="t" x="34" y="340">Simulado · DEV03–05, DEV08</text><text class="s" x="34" y="358">Ruido · tráfico · incidentes sobre</text><text class="s" x="34" y="372">vías OSM (Poisson) · parqueadero</text>
  <rect class="box" x="24" y="402" width="222" height="92" rx="5"/><text class="t" x="34" y="422">Servicio devices (Node.js)</text><text class="s" x="34" y="440">11 clientes MQTT independientes</text><text class="s" x="34" y="454">credencial + LWT propios</text><text class="s" x="34" y="468">almacenar y reenviar (cola 2000)</text>

  <rect class="box" x="294" y="150" width="162" height="190" rx="5"/><text class="t" x="304" y="172">Mosquitto 2.0</text><text class="s" x="304" y="192">MQTT 3.1.1 / 5</text><text class="s" x="304" y="208">QoS 0/1 · retenidos · LWT</text><text class="s" x="304" y="224">usuario+clave por nodo</text><text class="s" x="304" y="240">ACL por patrón %u</text><text class="s" x="304" y="256">1883 interno</text><text class="s" x="304" y="272">8883 TLS 1.3 (Internet)</text><text class="s" x="304" y="296">smartcity/DEVxx/</text><text class="s" x="304" y="310">telemetry·status·config</text><text class="s" x="304" y="324">control·ack·events</text>

  <rect class="box" x="504" y="48" width="134" height="92" rx="5"/><text class="t" x="514" y="68">Node-RED</text><text class="s" x="514" y="86">validación</text><text class="s" x="514" y="100">reglas entre nodos</text><text class="s" x="514" y="114">cola persistente</text>
  <rect class="box" x="650" y="48" width="128" height="92" rx="5"/><text class="t" x="660" y="68">InfluxDB 2.7</text><text class="s" x="660" y="86">raw (30 d)</text><text class="s" x="660" y="100">agg_5m mean/min/max</text><text class="s" x="660" y="114">(1 año)</text>
  <rect class="box" x="504" y="160" width="274" height="118" rx="5"/><text class="t" x="514" y="180">Backend Fastify (TypeScript)</text><text class="s" x="514" y="198">REST + WebSocket · JWT · límites por IP</text><text class="s" x="514" y="212">órdenes con ack (retroceso) · auditoría</text><text class="s" x="514" y="226">alertas: umbral + z-score · SQLite</text><text class="s" x="514" y="240">estadísticas prom/mín/máx por rango</text><text class="s" x="514" y="258" fill="#c2410c">Asistente IA: enrutador CDM + expertos</text>
  <rect class="box" x="504" y="298" width="274" height="58" rx="5"/><text class="t" x="514" y="318">LLM qwen3.8-flash (API b.ai)</text><text class="s" x="514" y="336">solo decide (JSON restringido, ~800 tokens)</text>
  <rect class="box" x="504" y="376" width="274" height="118" rx="5"/><text class="t" x="514" y="396">Infraestructura</text><text class="s" x="514" y="414">Azure VM B2as_v2 · Ubuntu 24.04</text><text class="s" x="514" y="428">Docker Compose · NSG 80/443/8883</text><text class="s" x="514" y="442">Nginx + Let's Encrypt · DuckDNS</text><text class="s" x="514" y="456">copias diarias (cron) · 7 días</text><text class="s" x="514" y="470">Fuentes: Open-Meteo · IDEAM · OSM</text>

  <rect class="box" x="822" y="100" width="136" height="92" rx="5"/><text class="t" x="832" y="120">App web React</text><text class="s" x="832" y="138">panel · mapa</text><text class="s" x="832" y="152">histórico · alertas</text><text class="s" x="832" y="166">control · asistente</text>
  <rect class="box" x="822" y="210" width="136" height="64" rx="5"/><text class="t" x="832" y="230">Grafana</text><text class="s" x="832" y="248">tablero + tabla</text><text class="s" x="832" y="262">prom/mín/máx</text>
  <rect class="box" x="822" y="292" width="136" height="64" rx="5"/><text class="t" x="832" y="312">Operador</text><text class="s" x="832" y="330">HTTPS · JWT</text><text class="s" x="832" y="344">smartcitybga.duckdns.org</text>

  <path class="ln" d="M246 77 C270 77 270 200 292 200"/><path class="ln" d="M246 448 C270 448 270 290 292 290"/>
  <text class="lbl" x="250" y="140">publica ↑</text><text class="lbl" x="250" y="390">control ↓</text>
  <path class="ln" d="M456 190 C480 190 480 94 502 94"/><path class="ln" d="M638 94 L648 94"/>
  <path class="ln" d="M456 230 L502 230"/><path class="ln" d="M502 250 L458 250"/>
  <text class="lbl" x="462" y="222">sub</text><text class="lbl" x="462" y="264">pub</text>
  <path class="ln" d="M714 140 L714 158"/><path class="ln" d="M640 278 L640 296"/>
  <path class="ln" d="M778 200 L820 146"/><path class="ln" d="M778 110 C800 110 800 240 820 240"/><path class="ln" d="M820 324 L780 250"/>
</svg>
"""


SHOT_CAPTION = {
    "app-panel": "App · Panel (Nodo saluda; estado de la ciudad)",
    "app-mapa": "App · Mapa de dispositivos e incidentes",
    "app-dispositivos": "App · Lista de dispositivos",
    "app-dev11": "App · Ficha de DEV11: ilustración, ubicación y encendido bajo demanda",
    "app-asistente": "App · Página del asistente (Nodo y agentes expertos)",
    "app-asistente-panel": "App · Nodo en el panel lateral: «resumen del día»",
}


def qa_section() -> str:
    """Sección 9: simulación previa al lanzamiento. Texto estático en seccion-qa.html (resultados en docs/QA-LANZAMIENTO.md)."""
    frag = HERE / "seccion-qa.html"
    return frag.read_text(encoding="utf-8") if frag.exists() else ""


def build_html(data: dict, figs: dict, shots: dict, preliminary: bool) -> str:
    cat = {d["id"]: d for d in data["catalog"]}
    span_d = (data["to"] - data["frm"]).total_seconds() / 86400
    readings = data["capture"]["readings"]
    total = sum(readings.values())
    analyses = {a["device_id"]: a for a in data["analysis"]}
    src_label = {"real": "Real", "digital_twin": "Gemelo digital", "api": "API", "dataset": "Dataset", "simulated": "Simulado"}
    live = {d["id"]: d["live"] for d in data["devices"]}

    def sensor_rows():
        out = []
        for d in data["catalog"]:
            vars_ = []
            for v in d["variables"]:
                key = f"{d['id']}.{v['key']}"
                s = data["stats"].get(key)
                rng = f"{num(s['min'], v.get('decimals', 1))} – {num(s['max'], v.get('decimals', 1))}" if s and s.get("count") else ("texto" if v["kind"] == "string" else "sin datos")
                vars_.append(f"{esc(v['label'])}{(' (' + esc(v['unit']) + ')') if v.get('unit') else ''}: <b>{rng}</b>")
            prov = live.get(d["id"], {}).get("telemetry") or {}
            synth = (prov.get("provenance") or {}).get("synthetic", d["provenance"]["synthetic"])
            out.append(f"<tr><td><b>{d['id']}</b></td><td>{esc(d['name'])}</td><td>{src_label[d['source_type']]}{' · SIM' if synth else ''}</td>"
                       f"<td>{'<br>'.join(vars_)}</td><td>{d['interval']['default']} s</td><td>{esc(', '.join(d['actions']))}</td></tr>")
        return "\n".join(out)

    def stats_rows():
        out = []
        for d in data["catalog"]:
            for v in d["variables"]:
                key = f"{d['id']}.{v['key']}"
                s = data["stats"].get(key)
                if not s or not s.get("count") or v["key"] in ("lat", "lon"):
                    continue
                dec = v.get("decimals", 1)
                out.append(f"<tr><td>{d['id']}</td><td>{esc(v['label'])}</td><td>{esc(v.get('unit') or '')}</td><td class=n>{num(s['mean'], dec)}</td>"
                           f"<td class=n>{num(s['min'], dec)}</td><td>{local(s['min_at'])}</td><td class=n>{num(s['max'], dec)}</td><td>{local(s['max_at'])}</td>"
                           f"<td class=n>{num(s['stddev'], dec)}</td><td class=n>{s['count']:,}</td></tr>".replace(",", "."))
        return "\n".join(out)

    def capture_rows():
        out = []
        for d in data["catalog"]:
            n = readings.get(d["id"], 0)
            exp = (data["to"] - max(data["frm"], CAPTURE_START)).total_seconds() / d["interval"]["default"]
            cov = n / exp * 100 if d["source_type"] in ("simulated", "digital_twin") or d["id"] == "DEV12" else None
            note = {"DEV02": "publica solo observaciones nuevas (horarias)", "DEV09": "IDEAM publica con ~1 día de retraso",
                    "DEV10": "modelo con paso de 15 min", "DEV11": "bajo demanda (Wokwi); cuota mensual agotada",
                    "DEV12": "desplegado el 08/11", "DEV06": "intervalo 60 s"}.get(d["id"], "")
            out.append(f"<tr><td>{d['id']}</td><td>{esc(d['name'])}</td><td class=n>{n:,}</td><td class=n>{num(cov, 1) + ' %' if cov else '—'}</td><td>{note}</td></tr>".replace(",", "."))
        return "\n".join(out)

    device_sections = []
    for d in data["catalog"]:
        a = analyses.get(d["id"])
        if d["id"] not in figs:
            n = readings.get(d["id"], 0)
            why = ('El nodo se validó de punta a punta por Internet (TLS 8883, orden confirmada en 466 ms); su serie se captura durante las sesiones en Wokwi.'
                   if d["source_type"] == "real" else 'El dispositivo se desplegó durante la ventana; su serie crece con cada día de captura.')
            device_sections.append(f'<section class="dev"><h3>{d["id"]} · {esc(d["name"])} <span class="tag">{src_label[d["source_type"]]}</span></h3>'
                                   f'<p class="desc">{esc(d["description"])}</p><p class="warn">Sin serie suficiente para graficar en la ventana ({n} lecturas). {why}</p></section>')
            continue
        device_sections.append(f"""
<section class="dev">
  <h3>{d['id']} · {esc(d['name'])} <span class="tag">{src_label[d['source_type']]}</span></h3>
  <p class="desc">{esc(d['description'])} <i>Procedencia: {esc(d['provenance']['provider'])}.</i></p>
  <img src="figuras/{figs[d['id']]}" alt="Gráficas de {d['id']}">
  <div class="ia"><b>Análisis con IA</b> ({esc(a['model']) if a else '—'}, ventana {a['hours'] if a else '—'} h, generado {local(a['created_at']) if a else '—'}):
  {esc(a['text']) if a else '<i>pendiente de generar</i>'}</div>
</section>""")

    inc = data["incidents"]
    total_inc = sum(r["n"] for r in inc["byType"])
    alerts = data["alerts"]
    by_kind: dict[str, int] = {}
    for x in alerts:
        by_kind[x["kind"]] = by_kind.get(x["kind"], 0) + 1
    ai = data["ai_status"]
    chat = next((r for r in ai["all_time"] if r["kind"] == "chat"), None)
    smoke = data["smoke"]["summary"] if data["smoke"] else None

    def static(name, caption):
        return f'<figure><img src="figuras/{name}"><figcaption>{caption}</figcaption></figure>'

    def fig(name, caption):
        return f'<figure><img src="figuras/{name}"><figcaption>{caption}</figcaption></figure>' if name else ""

    prelim = (f'<div class="warn"><b>Versión preliminar.</b> Datos del {data["frm"].strftime("%d/%m/%Y %H:%M")} al {data["to"].astimezone(BOGOTA).strftime("%d/%m/%Y %H:%M")} '
              f'(≈ {num(span_d, 1)} días). La versión final se regenera con <code>docs/informe/generar_informe.py</code> al completar 6 días de captura '
              f'({FINAL_TARGET.strftime("%d/%m/%Y")}).</div>') if preliminary else ""

    return f"""<!doctype html><html lang="es"><head><meta charset="utf-8"><title>SmartCityBGA — Informe del proyecto IoT</title>
<style>
@page {{ size: A4; margin: 16mm 15mm 18mm; }}
body {{ font-family: "Segoe UI", "DejaVu Sans", Arial, sans-serif; color: {INK}; font-size: 10.2pt; line-height: 1.45; background: #fff; }}
h1 {{ font-size: 26pt; margin: 0 0 4px; letter-spacing: .01em; }} h2 {{ font-size: 15pt; border-bottom: 3px solid {UNAB}; padding-bottom: 3px; margin: 22px 0 10px; break-after: avoid; }}
h3 {{ font-size: 11.5pt; margin: 14px 0 4px; break-after: avoid; }} p {{ margin: 6px 0; }}
table {{ border-collapse: collapse; width: 100%; font-size: 8.4pt; margin: 8px 0; }} th, td {{ border-bottom: 1px solid {GRID}; padding: 3px 5px; text-align: left; vertical-align: top; }}
th {{ background: #f2f4f1; font-weight: 600; }} td.n {{ text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }}
tr {{ break-inside: avoid; }} img {{ width: 100%; }} figure {{ margin: 8px 0; break-inside: avoid; }} figcaption {{ font-size: 8.5pt; color: {INK2}; }}
.cover {{ height: 255mm; display: flex; flex-direction: column; justify-content: space-between; break-after: page; }}
.band {{ background: {UNAB}; color: #fff; display: flex; align-items: center; gap: 18px; padding: 0 22px 0 0; }}
.band img {{ width: 112px; height: 112px; display: block; }} .band .u {{ font-size: 19pt; font-weight: 800; letter-spacing: .02em; line-height: 1.1; }}
.band .f {{ font-size: 10pt; margin-top: 5px; font-weight: 500; }}
.cover .sub {{ font-size: 12.5pt; color: {INK2}; }} .cover h1 {{ border-left: 6px solid {UNAB}; padding-left: 14px; }}
.meta td {{ border: 0; font-size: 10pt; padding: 2px 8px 2px 0; }} .meta td:first-child {{ white-space: nowrap; }}
.fig2 figure {{ margin: 8px 0; }} .fig2 img {{ border: 1px solid {GRID}; }}
.warn {{ border: 1px solid #eda100; background: #fff8e6; padding: 8px 10px; font-size: 9pt; margin: 8px 0; }}
.tag {{ font-size: 8pt; border: 1px solid {INK2}; padding: 0 5px; border-radius: 3px; font-weight: 500; vertical-align: middle; }}
.dev {{ break-inside: avoid; margin-bottom: 10px; }} .desc {{ font-size: 9pt; color: {INK2}; }}
.ia {{ background: #f2f6fc; border-left: 3px solid #2a78d6; padding: 6px 9px; font-size: 9pt; margin-top: 4px; }}
.kpi {{ display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 8px 0; }} .kpi div {{ border: 1px solid {GRID}; padding: 6px 8px; }}
.kpi b {{ display: block; font-size: 15pt; }} .kpi span {{ font-size: 8pt; color: {INK2}; }}
code {{ font-family: Consolas, monospace; font-size: 8.8pt; background: #f2f4f1; padding: 0 3px; }} pre {{ font-size: 8pt; background: #f2f4f1; padding: 6px; white-space: pre-wrap; }}
.shots figure {{ display: inline-block; width: 49%; vertical-align: top; margin: 0 0 6px; }} .shots img {{ border: 1px solid {GRID}; }}
.pb {{ break-before: page; }} ol.refs li {{ margin-bottom: 3px; font-size: 9pt; }}
</style></head><body>

<div class="cover">
  <div>
    <div class="band"><img src="figuras/logo-unab.png" alt="Universidad Autónoma de Bucaramanga">
      <div><div class="u">UNIVERSIDAD AUTÓNOMA DE BUCARAMANGA</div>
      <div class="f">FACULTAD DE INGENIERÍA · IoT + Cloud + Sistemas Distribuidos · Docente: Javier Pinzón</div></div></div>
    <p class="sub" style="margin-top:34px">Proyecto de Internet de las Cosas</p>
    <h1>Smart City Bucaramanga<br>(SmartCityBGA)</h1>
    <p class="sub">Plataforma IoT a la medida: 12 dispositivos (real, gemelo digital, API, dataset y simulados), MQTT bidireccional,
    procesamiento en la nube, visualización con Grafana y con una aplicación web propia, y un asistente de IA con personalidad (Nodo).</p>
    {prelim}
  </div>
  <table class="meta">
    <tr><td><b>Asignatura</b></td><td>IoT + Cloud + Sistemas Distribuidos (UNAB) · Docente: Javier Pinzón</td></tr>
    <tr><td><b>Estudiantes</b></td><td>Juan Sebastián Buitrago Caballero<br>José Alejandro Téllez Prada (u00060479)<br>Santiago Cabeza Méndez</td></tr>
    <tr><td><b>URL</b></td><td>https://smartcitybga.duckdns.org · Grafana en /grafana/ · Node-RED en /nodered/</td></tr>
    <tr><td><b>Repositorio</b></td><td>https://github.com/juan46buitrago/smartcity-iot (rama main · README, docs/, evidencias/)</td></tr>
    <tr><td><b>Nube</b></td><td>Microsoft Azure — VM vm-smartcity-iot (158.23.162.76), Docker Compose</td></tr>
    <tr><td><b>Ventana de datos</b></td><td>{data['frm'].strftime('%d/%m/%Y %H:%M')} → {data['to'].astimezone(BOGOTA).strftime('%d/%m/%Y %H:%M')} (hora de Colombia, UTC−5) · {total:,} lecturas</td></tr>
    <tr><td><b>Fecha</b></td><td>{datetime.now(BOGOTA).strftime('%d/%m/%Y')}</td></tr>
  </table>
</div>

<h2>1. Descripción y contexto</h2>
<p>Bucaramanga, "la Ciudad de los Parques", es una meseta andina de ~600 000 habitantes (más de 1,2 millones en el área metropolitana)
con retos típicos de movilidad, calidad del aire, ruido, consumo energético del alumbrado y riesgo hídrico en las quebradas y el río de Oro.
SmartCityBGA modela un <b>centro de operaciones municipal</b>: una red de sensores distribuidos por la ciudad publica mediciones en tiempo real,
una plataforma en la nube las valida, almacena y procesa (promedios, mínimos, máximos, alertas y reglas entre dispositivos), y un operador puede
<b>actuar sobre los sensores</b> (encender/apagar, cambiar el intervalo, calibrar, ajustar umbrales o modos) con confirmación de cada orden.</p>
<p>El escenario combina, de forma explícita y siempre etiquetada, <b>datos reales</b> (Open-Meteo, IDEAM, reanálisis ERA5, un nodo ESP32) y
<b>datos sintéticos</b> (simulaciones calibradas sobre la red vial real de OpenStreetMap). Cada mensaje lleva <code>source_type</code> y
<code>provenance.synthetic</code>, y la interfaz marca con "SIM" todo dato simulado.</p>
<div class="kpi">
  <div><b>12</b><span>dispositivos (1 real, 2 gemelos, 3 API, 2 dataset, 4 simulados)</span></div>
  <div><b>{total:,}</b><span>lecturas en la ventana</span></div>
  <div><b>{num(span_d, 1)} d</b><span>de captura continua</span></div>
  <div><b>{len(data['stats'])}</b><span>variables numéricas</span></div>
</div>

<h2>2. Arquitectura de referencia IoT propia</h2>
<p>La arquitectura sigue las capas del modelo de referencia visto en clase — <b>percepción</b> (dispositivos), <b>comunicación</b> (bróker y protocolo),
<b>plataforma/procesamiento</b> (servicios en la nube) y <b>aplicación</b> (visualización y control) — con los servicios concretos de cada capa:</p>
{ARCH_SVG}
<p><b>Flujo de subida:</b> cada dispositivo publica en <code>smartcity/DEVxx/telemetry</code> → Mosquitto → Node-RED valida el esquema y escribe en InfluxDB;
el backend se suscribe para el estado en vivo, alertas y WebSocket. <b>Flujo de bajada ("retroceso"):</b> la app envía <code>POST /api/devices/:id/commands</code>
(con sesión de operador) → el backend valida la orden contra las capacidades del catálogo y la publica en <code>control</code> con <code>command_id</code> (QoS 1)
→ el dispositivo la aplica y responde en <code>ack</code> → el backend correlaciona, audita en SQLite y notifica a la interfaz (pendiente → confirmada / rechazada / sin respuesta en 10 s).</p>

<h2>3. Tecnologías seleccionadas</h2>
<h3>3.1 Sensores y dispositivos (variables y rangos observados en la ventana)</h3>
<table><tr><th>ID</th><th>Dispositivo</th><th>Tipo</th><th>Variables · rango observado (mín – máx)</th><th>Intervalo</th><th>Controles (retroceso)</th></tr>
{sensor_rows()}
</table>
<p style="font-size:8.5pt">SIM = dato sintético. DEV06 está catalogado como API (gpsmobile.co) pero usa una ruta simulada sobre vías reales mientras no exista autorización
del propietario de los datos; el adaptador descarta placa, conductor y demás datos personales. DEV11 publica con firmware real sobre TLS; en Wokwi los
valores de los sensores los fija una persona con los controles del simulador, por eso se marca SIM (en un ESP32 físico serían mediciones reales).</p>

<h3>3.2 Comunicación: bróker y protocolo</h3>
<p><b>Protocolo: MQTT</b> (publicación/suscripción sobre TCP; versión 3.1.1/5) con el bróker <b>Eclipse Mosquitto 2.0</b>.</p>
<table><tr><th>Aspecto</th><th>Implementación</th></tr>
<tr><td>Tópicos</td><td><code>smartcity/DEVxx/telemetry</code> (mediciones), <code>status</code> (retenido, con LWT), <code>config</code> (retenido), <code>control</code> (órdenes), <code>ack</code> (confirmaciones), <code>events</code> (ciclo de vida de incidentes)</td></tr>
<tr><td>Envío</td><td>Telemetría QoS 0/1 con "almacenar y reenviar": durante un corte cada dispositivo encola hasta 2000 lecturas y las reenvía al reconectar</td></tr>
<tr><td>Recepción</td><td>Órdenes QoS 1 con <code>command_id</code>; el dispositivo descarta duplicados y órdenes de más de 60 s; responde <code>ack</code> con la versión de configuración</td></tr>
<tr><td>Presencia</td><td>Last Will and Testament: si un nodo cae, el bróker publica su estado <i>offline</i> retenido; el backend abre alerta a los 120 s</td></tr>
<tr><td>Seguridad</td><td>Sin acceso anónimo; usuario y contraseña distintos por dispositivo y servicio; ACL por patrón (cada nodo solo escribe sus tópicos y solo lee su <code>control</code>); 1883 solo en la red interna de Docker; <b>8883 con TLS 1.3</b> (certificado Let's Encrypt) para el ESP32 desde Internet</td></tr>
<tr><td>Mensaje</td><td>JSON validado con zod: <code>device_id, timestamp, ingested_at, location, status, source_type, provenance, variables {{nombre: {{value, unit}}}}, seq</code></td></tr>
</table>
<p>Además: HTTP/REST (APIs externas Open-Meteo, IDEAM/Socrata; API propia), WebSocket seguro (tiempo real hacia la app) y HTTPS (Nginx).</p>

<h3>3.3 Nube y servicios utilizados</h3>
<table><tr><th>Servicio</th><th>Función</th></tr>
<tr><td>Microsoft Azure</td><td>VM Standard B2as_v2 (2 vCPU, 8 GB), Ubuntu 24.04, IP pública estática; NSG con solo 80, 443, 8883 y SSH</td></tr>
<tr><td>Docker Compose</td><td>9 contenedores con límites de memoria (≈ 2,6 GB en total): mosquitto, devices, nodered, influxdb, backend, grafana, web (Nginx), certbot</td></tr>
<tr><td>Nginx + Let's Encrypt + DuckDNS</td><td>HTTPS con HSTS/CSP, URL propia <code>smartcitybga.duckdns.org</code>, renovación automática del certificado</td></tr>
<tr><td>Node-RED 4</td><td>Integración: validación de mensajes, escritura en InfluxDB con cola persistente, reglas entre dispositivos</td></tr>
<tr><td>InfluxDB 2.7</td><td>Series temporales: bucket <code>raw</code> (30 días) y <code>agg_5m</code> (media/mín/máx cada 5 min, 1 año) mediante tarea programada</td></tr>
<tr><td>Backend Fastify + SQLite</td><td>API REST/WebSocket, autenticación JWT, órdenes con confirmación, motor de alertas, estado vivo, asistente IA</td></tr>
<tr><td>React + Recharts + Leaflet</td><td>Aplicación web: panel, mapa de la ciudad, dispositivos y control, histórico, alertas, asistente</td></tr>
<tr><td>Grafana 11</td><td>Tablero de análisis provisionado como código (23 paneles), en <code>/grafana/</code></td></tr>
<tr><td>Controlador de DEV11 (Python + systemd)</td><td>Enciende y apaga el simulador del ESP32 bajo demanda desde la app y lo apaga solo cuando nadie mira la página (ver 6.2)</td></tr>
<tr><td>API b.ai (qwen3.8-flash)</td><td>Modelo de lenguaje para el asistente y el análisis de gráficas</td></tr>
<tr><td>Fuentes externas</td><td>Open-Meteo (Forecast, Air Quality CAMS, Historical ERA5), IDEAM (datos.gov.co), OpenStreetMap, Wokwi</td></tr>
</table>

<h3>3.4 Integración y automatización: Node-RED</h3>
<p>Node-RED (<code>/nodered/</code>, protegido con usuario y contraseña) es la capa de integración entre el bróker y la base de series temporales. Tiene dos flujos:</p>
<div class="fig2">
{static('nodered-persistencia.png', 'Figura. Flujo «Persistencia → InfluxDB»: tres suscripciones MQTT (telemetría, estado y eventos de incidentes), validación de esquema, cola persistente en disco, escritura por lotes cada 2 s en InfluxDB con verificación y reencolado. Los contadores bajo cada nodo muestran mensajes aceptados y rechazados (0) y escrituras pendientes (0).')}
{static('nodered-automatizacion.png', 'Figura. Flujo «Automatización»: reglas con histéresis entre dispositivos. La calidad del aire de DEV02 restringe el tráfico de DEV05 y la lluvia de DEV10 atenúa el alumbrado de DEV07; solo se publica una orden MQTT al cruzar el umbral, no en cada lectura.')}
</div>
<p>Así la persistencia no depende del backend: si el backend se reinicia (p. ej. en un despliegue) la captura continúa sin hueco, porque Node-RED es quien escribe en InfluxDB.</p>

<h2>4. Visualización y procesamiento de los datos</h2>
<p>El procesamiento se hace en tres niveles: <b>(1)</b> en InfluxDB (agregación por ventana, promedio, mínimo, máximo, desviación y conteo para cualquier
rango; downsampling a 5 min), <b>(2)</b> en el backend (alertas y reglas) y <b>(3)</b> en Node-RED (automatizaciones entre dispositivos). Tanto la app
(Histórico: 1 h, 24 h, 5 días, 7 días o rango personalizado) como Grafana (selector de tiempo) permiten el <b>ajuste del intervalo de tiempo</b>.</p>
<h3>4.1 Estadísticas de la ventana (promedio, mínimo, máximo)</h3>
<table><tr><th>ID</th><th>Variable</th><th>Unidad</th><th>Promedio</th><th>Mínimo</th><th>Hora mín.</th><th>Máximo</th><th>Hora máx.</th><th>Desv.</th><th>Lecturas</th></tr>
{stats_rows()}
</table>
<h3>4.2 Alertas y reglas</h3>
<table><tr><th>Mecanismo</th><th>Descripción</th></tr>
<tr><td>Umbral</td><td>Por variable: advertencia/crítico alto y bajo, configurables desde la app (p. ej. temperatura DEV01 ≥ 30 °C advertencia, ≥ 33 °C crítica; AQI ≥ 100/150; nivel del río ≥ 2/3 m). Se abre una sola alerta por variable, escala de gravedad y se resuelve sola al normalizarse.</td></tr>
<tr><td>Anomalía (z-score)</td><td>Ventana móvil de 120 muestras: |z| &gt; 4 abre una alerta informativa; se cierra sola cuando |z| &lt; 2. (Defecto corregido el 08/11: antes los atípicos quedaban abiertos.)</td></tr>
<tr><td>Desconexión</td><td>Estado LWT <i>offline</i> durante más de 120 s.</td></tr>
<tr><td>Incidente vial</td><td>Cada incidente simulado de DEV04 (marcado [SIMULACIÓN]).</td></tr>
<tr><td>Regla aire → tráfico</td><td>Node-RED: si DEV02 AQI ≥ 150 ordena a DEV05 <code>demand_factor = 0,7</code> (restricción vehicular); restaura con AQI &lt; 100.</td></tr>
<tr><td>Regla lluvia → alumbrado</td><td>Node-RED: si DEV10 lluvia ≥ 1 mm, DEV07 sube la atenuación nocturna al 100 %; restaura con &lt; 0,2 mm. La lluvia también eleva la tasa de incidentes de DEV04 (×1,8).</td></tr>
</table>
<p>En la ventana: {len(alerts)} alertas registradas ({', '.join(f'{k}: {v}' for k, v in sorted(by_kind.items()))}) y {total_inc} incidentes viales simulados.</p>
{fig(figs.get('incidentes'), 'Figura. Incidentes simulados por tipo en la ventana (proceso de Poisson no homogéneo sobre vías reales de OSM).')}
<h3>4.3 Interfaces</h3>
<p>La aplicación web propia (React) es la interfaz de operación: mirar es libre y controlar exige la sesión de operador. La primera visita abre una guía de Nodo que explica dónde está cada cosa.</p>
<div class="shots">{''.join(f'<figure><img src="figuras/{v}"><figcaption>{SHOT_CAPTION.get(k, k)}</figcaption></figure>' for k, v in shots.items())}<figure><img src="figuras/app-bienvenida.png"><figcaption>App · guía de primera visita («¿Cómo se usa?»)</figcaption></figure></div>
<h3>4.4 Grafana: tablero de análisis</h3>
<p>El tablero <b>«Smart City Bucaramanga — análisis»</b> se provisiona como código (<code>infra/grafana/</code>) y consulta InfluxDB directamente. Muestra seis indicadores de estado (temperatura, AQI, congestión, ocupación del parqueadero, nivel del río y potencia del alumbrado), series de cada dispositivo, incidentes por tipo, la conexión de los dispositivos en el tiempo y una tabla de resumen con <b>promedio, mínimo y máximo</b> del rango seleccionado. El selector de tiempo de Grafana (aquí, últimas 24 h con refresco cada 30 s) ajusta todos los paneles a la vez.</p>
<div class="fig2">{static('grafana-analisis.png', 'Figura. Tablero de Grafana (últimas 24 h, refresco 30 s): indicadores, series por dispositivo, estado de conexión y tabla prom/mín/máx. Captura con el zoom del navegador al 30 % para mostrar el tablero completo.')}</div>

<h2>5. Análisis de gráficas y comportamiento (con IA)</h2>
<p><b>Método.</b> Para cada dispositivo el servidor calcula, sobre InfluxDB, los hechos numéricos de la ventana (promedio, mínimo, máximo, desviación,
hora pico y hora valle del ciclo diario y comparación entre el primer y el último cuarto). Esos números —y nunca las lecturas crudas— se envían al
modelo <b>qwen3.8-flash</b>, que redacta un párrafo con la instrucción de usar solo esos valores, aclarar si los datos son simulados y no confundir el
ciclo día/noche con una tendencia. Cada gráfica muestra la serie con líneas de referencia de promedio, mínimo y máximo.</p>
{fig(figs.get('comparacion'), 'Figura. Temperatura del gemelo digital (DEV01), la API Open-Meteo (DEV10) y el reanálisis ERA5 del mismo día de 2025 (DEV12).')}
{fig(figs.get('perfil'), 'Figura. Perfil horario: promedio por hora del día (hora de Colombia); en naranja, la hora pico.')}
{''.join(device_sections)}

<h2>6. Nodo, el asistente de IA</h2>
<h3>6.1 Qué hace y cómo se diseñó</h3>
<p>Como complemento a Grafana, la app incluye a <b>Nodo</b>, un asistente al que se le pregunta en lenguaje natural ("¿a qué hora hay más tráfico?",
"compara el ruido con el flujo vehicular esta semana", "resumen del día") y que responde con texto y una gráfica generada a pedido, exportable a PNG.
Es un personaje: un robot-nodo de red que rebota en la esquina de cada página, parpadea, sigue el cursor con la mirada y cambia de humor (reposo, pensando, hablando, alerta, contento).
Tiene voz opcional (síntesis del navegador, en español) y un segundo color de acento (lavanda) reservado a la IA.</p>
<p>El diseño es de bajo consumo: el modelo solo <b>enruta</b> — devuelve un JSON de ~40 tokens con <b>decodificación restringida</b> (<code>response_format: json_schema</code> estricto,
enums cerrados de expertos y variables), sin historial, sin razonamiento y con temperatura 0 — y los <b>expertos en código</b> calculan sobre InfluxDB con cero tokens.
Hay siete agentes por tema (general, clima, aire y ruido, movilidad, agua y lluvia, alumbrado, operación) que acotan el vocabulario y bajan aún más los tokens.</p>
<table><tr><th>Capacidad</th><th>Cómo funciona</th></tr>
<tr><td>Consultas de datos</td><td>Estadísticas (promedio/mín/máx), series, perfil horario, valor actual, alertas, incidentes y estado de los dispositivos; cálculo en código</td></tr>
<tr><td>Resumen del día</td><td>Frase fija resuelta sin modelo (0 tokens): promedio, rango y hora del máximo de la variable principal de cada equipo en 24 h</td></tr>
<tr><td>Forma de la gráfica</td><td>Palabras como «en barras», «como área» o «en torta» cambian el estilo sin gastar tokens</td></tr>
<tr><td>Órdenes con confirmación</td><td>«Apaga el alumbrado»: un segundo llamado convierte la frase en una orden candidata; el código la valida con el mismo catálogo del dispositivo y la app muestra una tarjeta «Orden lista para enviar». <b>Nodo solo propone</b>: el envío exige confirmar y la sesión de operador</td></tr>
<tr><td>Análisis de gráficas</td><td>Párrafo por dispositivo redactado con los hechos numéricos calculados (sección 5)</td></tr>
</table>
<table><tr><th>Medición</th><th>Resultado</th></tr>
{f"<tr><td>Prueba de 10 preguntas (enrutador)</td><td>{smoke['aciertos']} aciertos · {smoke['tokens_promedio']} tokens · {num(smoke['latencia_promedio_ms'] / 1000, 1)} s promedio</td></tr>" if smoke else ""}
{f"<tr><td>Uso en producción</td><td>{chat['calls']} consultas · {num(chat['avg_tokens'] or 0, 0)} tokens promedio · {num((chat['avg_total_ms'] or 0) / 1000, 1)} s · {chat['cached']} desde caché (0 tokens)</td></tr>" if chat else ""}
<tr><td>Costo estimado</td><td>≈ 900 tokens/consulta → del orden de 0,0001 USD por pregunta con precios de modelos flash</td></tr>
</table>

<h3>6.2 DEV11 bajo demanda</h3>
<p>El único nodo con firmware propio (ESP32, MQTT sobre TLS 8883) corre en el simulador Wokwi. Como la cuenta gratuita de Wokwi limita cada simulación a 5 minutos y los minutos mensuales,
DEV11 no se deja encendido: el operador lo <b>enciende desde su ficha</b> en la página y se <b>apaga solo</b> unos minutos después de que nadie tiene la página abierta. Un controlador en la VM
(solo accesible desde el backend, con token) arranca y apaga el simulador; la web renueva un «arriendo» mientras alguien mira. Se verificó el encendido, el apagado automático a los ~155 s y el rechazo sin sesión (401).
<b>Limitación:</b> la cuota mensual gratuita de Wokwi CI se agotó durante las pruebas, por lo que el simulador no pudo conectarse en esa verificación; la ficha lo informa («No pudo arrancar…»).
Mientras tanto DEV11 se ejecuta con la extensión de VS Code o un ESP32 físico.</p>

<h3>6.3 Cada dispositivo, ilustrado</h3>
<p>La ficha de cada dispositivo muestra una ilustración de lo que es, <b>qué representa</b> (sin presentar lo simulado como medido) y <b>dónde está</b>, con acceso directo al mapa centrado en él.</p>

<h2>7. Captura de datos y cobertura</h2>
<table><tr><th>ID</th><th>Dispositivo</th><th>Lecturas</th><th>Cobertura</th><th>Nota</th></tr>
{capture_rows()}
</table>
<p style="font-size:8.5pt">Cobertura = lecturas / lecturas esperadas al intervalo por defecto, desde el inicio de la captura (07/11/2026). Los despliegues se registran con su hueco
en <code>docs/BITACORA.md</code> (p. ej. ≈ 24 s el 08/11). No se generan datos retroactivos: el histórico es solo lo capturado en vivo.</p>

<h2>8. Pruebas y operación</h2>
<p>100 pruebas automatizadas (contrato, dispositivos, backend con asistente IA y control de DEV11, funciones de Node-RED) más 31 de integración contra el stack real
(seguridad, ACL, control bidireccional, LWT, persistencia y recuperación); 8 defectos encontrados y corregidos. Prueba de punta a punta del ESP32 por
Internet: anónimo y clave incorrecta rechazados, conexión TLS aceptada, orden desde la API confirmada en 466 ms. Copias de seguridad diarias de InfluxDB
y SQLite con rotación de 7 días. Documentación completa en el repositorio (<code>README.md</code>, <code>docs/</code>).</p>

{qa_section()}

<h2>10. Referencias</h2>
<ol class="refs">
<li>OASIS. <i>MQTT Version 3.1.1</i> (2014) y <i>MQTT Version 5.0</i> (2019). https://mqtt.org/mqtt-specification/</li>
<li>Eclipse Foundation. <i>Eclipse Mosquitto — documentación</i>. https://mosquitto.org/documentation/</li>
<li>Open-Meteo. <i>Weather Forecast, Air Quality y Historical Weather API</i>. https://open-meteo.com/en/docs (CC BY 4.0)</li>
<li>Hersbach, H. et al. (2020). The ERA5 global reanalysis. <i>Q. J. R. Meteorol. Soc.</i>, 146, 1999–2049. https://doi.org/10.1002/qj.3803</li>
<li>Copernicus Atmosphere Monitoring Service (CAMS). Pronósticos de calidad del aire. https://atmosphere.copernicus.eu</li>
<li>IDEAM. Datos hidrometeorológicos — estación MAJADAS [23197700], conjunto <code>bdmn-sqnh</code>. https://www.datos.gov.co</li>
<li>OpenStreetMap contributors. Red vial de Bucaramanga (ODbL). https://www.openstreetmap.org/copyright</li>
<li>InfluxData. <i>InfluxDB 2.7 y lenguaje Flux</i>. https://docs.influxdata.com/influxdb/v2/</li>
<li>OpenJS Foundation. <i>Node-RED</i>. https://nodered.org/docs/</li>
<li>Grafana Labs. <i>Grafana documentation</i>. https://grafana.com/docs/grafana/latest/</li>
<li>Microsoft. <i>Azure Virtual Machines y Network Security Groups</i>. https://learn.microsoft.com/azure/ ; <i>Azure Maps Weather REST API</i> (evaluada). https://learn.microsoft.com/rest/api/maps/weather</li>
<li>Let's Encrypt / ISRG. https://letsencrypt.org/docs/ · DuckDNS. https://www.duckdns.org</li>
<li>Wokwi. <i>ESP32 Simulator</i>. https://docs.wokwi.com · Espressif. <i>ESP32 Arduino Core</i>. https://docs.espressif.com</li>
<li>Willard, B. y Louf, R. (2023). Efficient Guided Generation for Large Language Models. arXiv:2307.09702 (decodificación restringida).</li>
<li>Qwen Team. <i>Qwen models</i>. https://qwenlm.github.io · b.ai API compatible con OpenAI.</li>
</ol>
</body></html>"""


def to_pdf(html_file: Path, pdf_file: Path) -> bool:
    browser = find_browser()
    if not browser:
        print("✘ No hay Edge/Chrome para generar el PDF; queda el HTML.")
        return False
    # Se imprime a un archivo nuevo y luego se reemplaza: así nunca queda un PDF viejo reportado como nuevo.
    tmp = pdf_file.with_suffix(".tmp.pdf")
    tmp.unlink(missing_ok=True)
    subprocess.run([browser, "--headless=new", "--disable-gpu", f"--user-data-dir={PROFILE}-pdf", "--no-pdf-header-footer", f"--print-to-pdf={tmp}", html_file.as_uri()], capture_output=True, timeout=180)
    if not tmp.exists():
        print("✘ El navegador no generó el PDF.")
        return False
    try:
        tmp.replace(pdf_file)
    except PermissionError:
        print(f"✘ {pdf_file.name} está abierto en otro programa; ciérralo y vuelve a correr. El nuevo quedó en {tmp.name}.")
        return False
    return True


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--desde", default=CAPTURE_START.isoformat())
    ap.add_argument("--hasta", default=None)
    ap.add_argument("--sin-capturas", action="store_true")
    a = ap.parse_args()
    frm = datetime.fromisoformat(a.desde)
    to = datetime.fromisoformat(a.hasta) if a.hasta else datetime.now(timezone.utc)
    FIG.mkdir(parents=True, exist_ok=True)
    data = collect(frm, to)
    figs = {}
    for d in data["catalog"]:
        name = device_figure(data, d)
        if name:
            figs[d["id"]] = name
    figs["perfil"] = hourly_figure(data)
    figs["comparacion"] = comparison_figure(data)
    figs["incidentes"] = incidents_figure(data)
    shots = {} if a.sin_capturas else screenshots()
    preliminary = to < FINAL_TARGET.astimezone(timezone.utc) - timedelta(hours=2)
    html_file = HERE / "informe.html"
    html_file.write_text(build_html(data, figs, shots, preliminary), encoding="utf-8")
    pdf = HERE / "INFORME-SmartCityBGA.pdf"
    ok = to_pdf(html_file, pdf)
    print(f"✔ {html_file.relative_to(ROOT)}" + (f" · {pdf.relative_to(ROOT)} ({pdf.stat().st_size // 1024} KB)" if ok else ""))


if __name__ == "__main__":
    sys.exit(main())

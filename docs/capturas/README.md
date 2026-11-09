# Capturas del sitio

Generadas con Chrome sin interfaz sobre el frontend local apuntando a la API pública:

```bash
VITE_BACKEND=https://smartcitybga.duckdns.org npm run dev:frontend
"/c/Program Files/Google/Chrome/Application/chrome.exe" --headless=new --hide-scrollbars --window-size=1440,900 --virtual-time-budget=20000 --screenshot="$(cygpath -w "$PWD/docs/capturas/panel.png")" http://127.0.0.1:5173/
```

Añade `?bienvenida=0` a la URL para omitir la guía de primera visita. Rutas: `/`, `/mapa`, `/dispositivos`, `/historico`, `/alertas`, `/asistente` y `/?asistente=<pregunta>` (abre el panel lateral y pregunta). Son públicas y de solo lectura; no requieren iniciar sesión.

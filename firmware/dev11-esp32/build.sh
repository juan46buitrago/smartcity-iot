#!/usr/bin/env bash
# Compila DEV11 para la extensión Wokwi de VS Code: deja build/dev11-esp32.ino.{bin,elf},
# que es lo que wokwi.toml carga. Sin este paso la extensión dice que no encuentra el firmware.
#   bash firmware/dev11-esp32/build.sh
set -euo pipefail
cd "$(dirname "$0")"

CLI="${ARDUINO_CLI:-$(command -v arduino-cli || echo "/c/Program Files/Arduino CLI/arduino-cli.exe")}"
[ -x "$CLI" ] || { echo "✘ No se encontró arduino-cli (instálelo o defina ARDUINO_CLI)." >&2; exit 1; }
[ -f secrets.h ] || { echo "✘ Falta secrets.h: copie secrets.h.example y ponga la contraseña MQTT de DEV11." >&2; exit 1; }
grep -q CAMBIAR_POR secrets.h && { echo "✘ secrets.h aún tiene la contraseña de ejemplo." >&2; exit 1; }

# Primera vez: core ESP32 y librerías (no hace nada si ya están instaladas).
"$CLI" core list | grep -q '^esp32:esp32' || "$CLI" core install esp32:esp32
for lib in PubSubClient "DHT sensor library for ESPx" ArduinoJson; do
  "$CLI" lib list "$lib" | grep -q . || "$CLI" lib install "$lib"
done

# arduino-cli exige que el .ino se llame como su carpeta: se compila una copia temporal.
TMP="$(mktemp -d)/dev11-esp32"
mkdir -p "$TMP"
cp sketch.ino "$TMP/dev11-esp32.ino"
cp secrets.h "$TMP/"
"$CLI" compile --fqbn esp32:esp32:esp32 --output-dir build "$TMP"
rm -rf "$(dirname "$TMP")"
echo "✔ build/dev11-esp32.ino.bin listo. En VS Code abra diagram.json y ejecute «Wokwi: Start Simulator»."

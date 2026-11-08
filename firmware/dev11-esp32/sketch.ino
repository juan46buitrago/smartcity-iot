/*
 * SmartCityBGA — DEV11: nodo ESP32 «real» (Wokwi o hardware físico).
 *
 * Se conecta por WiFi a Internet y habla con el broker Mosquitto por MQTT sobre TLS (puerto 8883),
 * con el mismo contrato que los dispositivos virtuales DEV01..DEV10:
 *   smartcity/DEV11/telemetry  (QoS0, no retenido)  lecturas periódicas
 *   smartcity/DEV11/status     (retenido)           online/offline; el LWT publica offline
 *   smartcity/DEV11/config     (retenido)           configuración vigente
 *   smartcity/DEV11/control    (suscripción)        órdenes del backend / Node-RED
 *   smartcity/DEV11/ack        (no retenido)        confirmación de cada orden
 *
 * Hardware (ver README.md): DHT22 en GPIO15, LDR (módulo, salida AO) en GPIO34,
 * LED + 220 ohm en GPIO2 y módulo relé en GPIO4 (ambos reflejan el estado del relé).
 *
 * Librerías: PubSubClient, "DHT sensor library for ESPx" (DHTesp) y ArduinoJson v7.
 * Credenciales: copie secrets.h.example a secrets.h (no se versiona).
 */

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <DHTesp.h>
#include <time.h>
#include <math.h>
#include "secrets.h"

// ----------------------------------------------------------------------------
// Constantes del dispositivo (deben coincidir con packages/shared/src/catalog.ts)
// ----------------------------------------------------------------------------
#define DEVICE_ID "DEV11"
#define FIRMWARE "scbga-dev11/1.0"
#define SRC_TYPE "real"
// Los sensores de Wokwi son deslizadores ajustados por una persona: synthetic=true.
// En un ESP32 físico con sensores conectados, ponga SYNTHETIC_DATA en false.
#define SYNTHETIC_DATA true
#define PROVIDER "ESP32 DevKit + DHT22 + LDR (simulado en Wokwi)"
#define LOC_LAT 7.1166f
#define LOC_LON -73.1056f
#define LOC_NAME "Campus UNAB (aprox.)"

#define PIN_DHT 15
#define PIN_LDR 34
#define PIN_LED 2
#define PIN_RELAY 4
// El módulo de fotorresistencia de Wokwi entrega MÁS voltaje con MENOS luz (1) .
// Con un LDR físico en divisor LDR→GND ocurre lo contrario: ponga 0.
#define LDR_INVERTIDO 1

#define MIN_INTERVAL_S 2
#define MAX_INTERVAL_S 300
#define MAX_COMMAND_AGE_S 60
#define DEDUPE_SLOTS 16
#define PAYLOAD_CAP 900  // PubSubClient: búfer 1024 B = cabecera + tópico + carga

static const char TOPIC_TELEMETRY[] = "smartcity/" DEVICE_ID "/telemetry";
static const char TOPIC_STATUS[] = "smartcity/" DEVICE_ID "/status";
static const char TOPIC_CONFIG[] = "smartcity/" DEVICE_ID "/config";
static const char TOPIC_CONTROL[] = "smartcity/" DEVICE_ID "/control";
static const char TOPIC_ACK[] = "smartcity/" DEVICE_ID "/ack";

// Certificado raíz ISRG Root X1 (Let's Encrypt) para validar al broker. Vence en 2035.
static const char ISRG_ROOT_X1[] = R"PEM(
-----BEGIN CERTIFICATE-----
MIIFazCCA1OgAwIBAgIRAIIQz7DSQONZRGPgu2OCiwAwDQYJKoZIhvcNAQELBQAwTzELMAkG
A1UEBhMCVVMxKTAnBgNVBAoTIEludGVybmV0IFNlY3VyaXR5IFJlc2VhcmNoIEdyb3VwMRUw
EwYDVQQDEwxJU1JHIFJvb3QgWDEwHhcNMTUwNjA0MTEwNDM4WhcNMzUwNjA0MTEwNDM4WjBP
MQswCQYDVQQGEwJVUzEpMCcGA1UEChMgSW50ZXJuZXQgU2VjdXJpdHkgUmVzZWFyY2ggR3Jv
dXAxFTATBgNVBAMTDElTUkcgUm9vdCBYMTCCAiIwDQYJKoZIhvcNAQEBBQADggIPADCCAgoC
ggIBAK3oJHP0FDfzm54rVygch77ct984kIxuPOZXoHj3dcKi/vVqbvYATyjb3miGbESTtrFj
/RQSa78f0uoxmyF+0TM8ukj13Xnfs7j/EvEhmkvBioZxaUpmZmyPfjxwv60pIgbz5MDmgK7i
S4+3mX6UA5/TR5d8mUgjU+g4rk8Kb4Mu0UlXjIB0ttov0DiNewNwIRt18jA8+o+u3dpjq+sW
T8KOEUt+zwvo/7V3LvSye0rgTBIlDHCNAymg4VMk7BPZ7hm/ELNKjD+Jo2FR3qyHB5T0Y3Hs
LuJvW5iB4YlcNHlsdu87kGJ55tukmi8mxdAQ4Q7e2RCOFvu396j3x+UCB5iPNgiV5+I3lg02
dZ77DnKxHZu8A/lJBdiB3QW0KtZB6awBdpUKD9jf1b0SHzUvKBds0pjBqAlkd25HN7rOrFle
aJ1/ctaJxQZBKT5ZPt0m9STJEadao0xAH0ahmbWnOlFuhjuefXKnEgV4We0+UXgVCwOPjdAv
BbI+e0ocS3MFEvzG6uBQE3xDk3SzynTnjh8BCNAw1FtxNrQHusEwMFxIt4I7mKZ9YIqioymC
zLq9gwQbooMDQaHWBfEbwrbwqHyGO0aoSCqI3Haadr8faqU9GY/rOPNk3sgrDQoo//fb4hVC
1CLQJ13hef4Y53CIrU7m2Ys6xt0nUW7/vGT1M0NPAgMBAAGjQjBAMA4GA1UdDwEB/wQEAwIB
BjAPBgNVHRMBAf8EBTADAQH/MB0GA1UdDgQWBBR5tFnme7bl5AFzgAiIyBpY9umbbjANBgkq
hkiG9w0BAQsFAAOCAgEAVR9YqbyyqFDQDLHYGmkgJykIrGF1XIpu+ILlaS/V9lZLubhzEFnT
IZd+50xx+7LSYK05qAvqFyFWhfFQDlnrzuBZ6brJFe+GnY+EgPbk6ZGQ3BebYhtF8GaV0nxv
wuo77x/Py9auJ/GpsMiu/X1+mvoiBOv/2X/qkSsisRcOj/KKNFtY2PwByVS5uCbMiogziUwt
hDyC3+6WVwW6LLv3xLfHTjuCvjHIInNzktHCgKQ5ORAzI4JMPJ+GslWYHb4phowim57iaztX
OoJwTdwJx4nLCgdNbOhdjsnvzqvHu7UrTkXWStAmzOVyyghqpZXjFaH3pO3JLF+l+/+sKAIu
vtd7u+Nxe5AW0wdeRlN8NwdCjNPElpzVmbUq4JUagEiuTDkHzsxHpFKVK7q4+63SM1N95R1N
bdWhscdCb+ZAJzVcoyi3B43njTOQ5yOf+1CceWxG1bQVs5ZufpsMljq4Ui0/1lvh+wjChP4k
qKOJ2qxq4RgqsahDYVvTH9w7jXbyLeiNdd8XM2w9U/t7y0Ff/9yi0GE44Za4rF2LN9d11TPA
mRGunUHBcnWEvgJBQl9nJEiU0Zsnvgc/ubhPgXRR4Xq37Z0j4r7g1SgEEzwxA57demyPxgcY
xn/eR44/KJ4EBs+lVDR3veyJm+kXQ99b21/+jh5Xos1AnX5iItreGCc=
-----END CERTIFICATE-----
)PEM";

// ----------------------------------------------------------------------------
// Estado
// ----------------------------------------------------------------------------
struct Threshold {
  float warn_high = NAN, crit_high = NAN, warn_low = NAN, crit_low = NAN;
};

struct Config {
  bool enabled = true;
  int intervalS = 10;
  bool modeAuto = true;      // true = auto (relé según luz), false = manual
  bool relayManual = false;  // valor del relé en modo manual
  float lightThrPct = 30;
  Threshold thrTemp;
  Threshold thrHum;
  float calTemp = 0, calHum = 0;
  unsigned long version = 0;
  char updatedAt[25] = "";
};

struct AckRecord {  // para reenviar el mismo ack si llega una orden duplicada (QoS1)
  char id[40] = "";
  char action[20] = "";
  bool ok = false;
  char error[100] = "";
  unsigned long version = 0;
};

static Config cfg;
static WiFiClientSecure tlsClient;
static PubSubClient mqtt(tlsClient);
static DHTesp dht;

static AckRecord recent[DEDUPE_SLOTS];
static int recentNext = 0;

static unsigned long seqNo = 0;
static bool degraded = false;     // fallo del DHT22
static bool relayState = false;   // estado real del actuador
static char lastSampleAt[25] = "";
static unsigned long lastTelemetryMs = 0;
static bool telemetryDue = true;  // fuerza una lectura inmediata tras conectar
static bool restartPending = false;
static unsigned long restartAtMs = 0;

// Reconexión con retroceso exponencial (1 s … 60 s)
static unsigned long nextAttemptMs = 0;
static unsigned long backoffMs = 1000;

// ----------------------------------------------------------------------------
// Tiempo (NTP, UTC)
// ----------------------------------------------------------------------------
static bool timeSynced() { return time(nullptr) > 1700000000; }

static void isoNow(char *out, size_t n) {
  time_t t = time(nullptr);
  struct tm tmv;
  gmtime_r(&t, &tmv);
  strftime(out, n, "%Y-%m-%dT%H:%M:%SZ", &tmv);
}

// Días desde 1970-01-01 para una fecha civil (algoritmo de H. Hinnant; evita depender de timegm).
static long daysFromCivil(long y, unsigned m, unsigned d) {
  y -= m <= 2;
  const long era = (y >= 0 ? y : y - 399) / 400;
  const unsigned yoe = (unsigned)(y - era * 400);
  const unsigned doy = (153 * (m + (m > 2 ? -3 : 9)) + 2) / 5 + d - 1;
  const unsigned doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
  return era * 146097 + (long)doe - 719468;
}

// Analiza "2026-11-08T15:00:00Z", con fracción opcional (.123) y desfase (Z o ±hh:mm).
static bool parseIso(const char *s, time_t *out) {
  int Y, M, D, h, mi, se;
  if (sscanf(s, "%d-%d-%dT%d:%d:%d", &Y, &M, &D, &h, &mi, &se) != 6) return false;
  const char *p = strchr(s, 'T');
  if (!p) return false;
  p = strchr(p, ':');
  p = p ? strchr(p + 1, ':') : nullptr;
  if (!p) return false;
  p += 3;  // salta ":ss"
  if (*p == '.') { p++; while (*p >= '0' && *p <= '9') p++; }
  long offS = 0;
  if (*p == '+' || *p == '-') {
    int oh = 0, om = 0;
    sscanf(p + 1, "%d:%d", &oh, &om);
    offS = (oh * 3600L + om * 60L) * (*p == '-' ? -1 : 1);
  }
  *out = (time_t)(daysFromCivil(Y, M, D) * 86400L + h * 3600L + mi * 60L + se - offS);
  return true;
}

// ----------------------------------------------------------------------------
// Utilidades
// ----------------------------------------------------------------------------
static float roundTo(float v, int dec) {
  float f = powf(10.0f, (float)dec);
  return roundf(v * f) / f;
}

static void applyOutputs() {
  bool on = cfg.enabled && relayState;
  digitalWrite(PIN_LED, on ? HIGH : LOW);
  digitalWrite(PIN_RELAY, on ? HIGH : LOW);
}

static int readLightPct() {
  int raw = analogRead(PIN_LDR);  // 0..4095
  int pct = (int)roundf(raw * 100.0f / 4095.0f);
#if LDR_INVERTIDO
  pct = 100 - pct;
#endif
  return constrain(pct, 0, 100);
}

static void computeRelay(int lightPct) {
  relayState = cfg.modeAuto ? (lightPct < cfg.lightThrPct) : cfg.relayManual;
  applyOutputs();
}

// Serializa el documento en `buf`; devuelve la longitud, o 0 si no cabe.
static size_t serializeTo(const JsonDocument &doc, char *buf, size_t cap) {
  size_t need = measureJson(doc);
  if (need >= cap) { Serial.println(F("[ERROR] Carga JSON demasiado grande; se descarta")); return 0; }
  return serializeJson(doc, buf, cap);
}

static bool publishJson(const char *topic, const JsonDocument &doc, bool retained) {
  static char buf[PAYLOAD_CAP + 1];
  size_t n = serializeTo(doc, buf, sizeof(buf));
  if (n == 0) return false;
  return mqtt.publish(topic, (const uint8_t *)buf, n, retained);
}

// ----------------------------------------------------------------------------
// Mensajes del contrato
// ----------------------------------------------------------------------------
static void fillStatus(JsonDocument &doc, bool online, const char *reason) {
  char ts[25];
  isoNow(ts, sizeof ts);
  doc["device_id"] = DEVICE_ID;
  doc["timestamp"] = ts;
  doc["connection"] = online ? "online" : "offline";
  if (online) {
    doc["state"] = !cfg.enabled ? "stopped" : (degraded ? "degraded" : "running");
    if (!cfg.enabled) doc["reason"] = "apagado por orden remota";
    else if (degraded) doc["reason"] = "fallo de lectura del DHT22";
    doc["uptime_s"] = millis() / 1000UL;
    if (lastSampleAt[0]) doc["last_sample_at"] = lastSampleAt;
    else doc["last_sample_at"] = nullptr;
  } else if (reason) {
    doc["reason"] = reason;
  }
  doc["firmware"] = FIRMWARE;
}

static void publishStatus() {
  JsonDocument doc;
  fillStatus(doc, true, nullptr);
  publishJson(TOPIC_STATUS, doc, true);
}

static void putThreshold(JsonObject parent, const char *key, const Threshold &t) {
  JsonObject o = parent[key].to<JsonObject>();
  if (!isnan(t.warn_high)) o["warn_high"] = t.warn_high;
  if (!isnan(t.crit_high)) o["crit_high"] = t.crit_high;
  if (!isnan(t.warn_low)) o["warn_low"] = t.warn_low;
  if (!isnan(t.crit_low)) o["crit_low"] = t.crit_low;
}

static void publishConfig() {
  JsonDocument doc;
  doc["device_id"] = DEVICE_ID;
  doc["enabled"] = cfg.enabled;
  doc["interval_s"] = cfg.intervalS;
  doc["mode"] = cfg.modeAuto ? "auto" : "manual";
  JsonObject th = doc["thresholds"].to<JsonObject>();
  putThreshold(th, "temperature", cfg.thrTemp);
  putThreshold(th, "humidity", cfg.thrHum);
  JsonObject cal = doc["calibration"].to<JsonObject>();
  cal["temperature"] = cfg.calTemp;
  cal["humidity"] = cfg.calHum;
  JsonObject pr = doc["params"].to<JsonObject>();
  pr["relay"] = cfg.relayManual;
  pr["light_threshold_pct"] = cfg.lightThrPct;
  doc["version"] = cfg.version;
  doc["updated_at"] = cfg.updatedAt;
  publishJson(TOPIC_CONFIG, doc, true);
}

static void addVar(JsonObject vars, const char *key, float value, const char *unit, int dec) {
  JsonObject v = vars[key].to<JsonObject>();
  v["value"] = roundTo(value, dec);
  if (unit) v["unit"] = unit; else v["unit"] = nullptr;
}

static void publishTelemetry() {
  if (!timeSynced()) return;
  TempAndHumidity th = dht.getTempAndHumidity();
  bool dhtOk = dht.getStatus() == DHTesp::ERROR_NONE && !isnan(th.temperature) && !isnan(th.humidity);
  bool wasDegraded = degraded;
  degraded = !dhtOk;
  int light = readLightPct();
  computeRelay(light);

  char ts[25];
  isoNow(ts, sizeof ts);
  strlcpy(lastSampleAt, ts, sizeof lastSampleAt);

  JsonDocument doc;
  doc["device_id"] = DEVICE_ID;
  doc["timestamp"] = ts;
  doc["ingested_at"] = ts;  // el nodo no tiene retraso de ingesta; el backend lo registra igual
  JsonObject loc = doc["location"].to<JsonObject>();
  loc["lat"] = LOC_LAT;
  loc["lon"] = LOC_LON;
  loc["name"] = LOC_NAME;
  doc["status"] = degraded ? "degraded" : "online";
  doc["source_type"] = SRC_TYPE;
  JsonObject pv = doc["provenance"].to<JsonObject>();
  pv["provider"] = PROVIDER;
  pv["synthetic"] = SYNTHETIC_DATA;
  pv["ref"] = "wokwi";
  JsonObject vars = doc["variables"].to<JsonObject>();
  if (dhtOk) {
    addVar(vars, "temperature", th.temperature + cfg.calTemp, "°C", 1);
    addVar(vars, "humidity", constrain(th.humidity + cfg.calHum, 0.0f, 100.0f), "%", 0);
  }
  addVar(vars, "light_pct", (float)light, "%", 0);
  addVar(vars, "relay", relayState ? 1.0f : 0.0f, nullptr, 0);
  doc["seq"] = ++seqNo;

  if (publishJson(TOPIC_TELEMETRY, doc, false)) {
    Serial.printf("[TEL] #%lu T=%.1f C  H=%.0f %%  luz=%d %%  rele=%d%s\n", seqNo,
                  dhtOk ? th.temperature + cfg.calTemp : NAN, dhtOk ? th.humidity + cfg.calHum : NAN,
                  light, relayState ? 1 : 0, degraded ? "  (DHT22 con fallo)" : "");
  } else {
    Serial.println(F("[ERROR] No se pudo publicar la telemetría"));
  }
  if (wasDegraded != degraded) publishStatus();
}

static void publishAck(const AckRecord &r) {
  JsonDocument doc;
  char ts[25];
  isoNow(ts, sizeof ts);
  doc["command_id"] = r.id;
  doc["device_id"] = DEVICE_ID;
  doc["action"] = r.action;
  doc["ok"] = r.ok;
  if (!r.ok && r.error[0]) doc["error"] = r.error;
  doc["timestamp"] = ts;
  if (r.ok) doc["config_version"] = r.version;
  publishJson(TOPIC_ACK, doc, false);
}

// ----------------------------------------------------------------------------
// Órdenes
// ----------------------------------------------------------------------------
static bool isUuid(const char *s) {
  if (!s || strlen(s) != 36) return false;
  for (int i = 0; i < 36; i++) {
    if (i == 8 || i == 13 || i == 18 || i == 23) { if (s[i] != '-') return false; }
    else if (!isxdigit((unsigned char)s[i])) return false;
  }
  return true;
}

static bool isInt(JsonVariantConst v) { return v.is<int>(); }

static void fail(AckRecord &a, const char *msg) {
  a.ok = false;
  strlcpy(a.error, msg, sizeof a.error);
}

// Lee un umbral {warn_high, crit_high, warn_low, crit_low}; rechaza claves desconocidas.
static bool parseThreshold(JsonObjectConst o, Threshold &t, AckRecord &a) {
  Threshold n;
  for (JsonPairConst kv : o) {
    const char *k = kv.key().c_str();
    if (!kv.value().is<float>()) { fail(a, "threshold: valores deben ser numéricos"); return false; }
    float v = kv.value().as<float>();
    if (!strcmp(k, "warn_high")) n.warn_high = v;
    else if (!strcmp(k, "crit_high")) n.crit_high = v;
    else if (!strcmp(k, "warn_low")) n.warn_low = v;
    else if (!strcmp(k, "crit_low")) n.crit_low = v;
    else { fail(a, "threshold: clave desconocida"); return false; }
  }
  if (!isnan(n.warn_high) && !isnan(n.crit_high) && n.warn_high > n.crit_high) { fail(a, "warn_high no puede superar crit_high"); return false; }
  if (!isnan(n.warn_low) && !isnan(n.crit_low) && n.warn_low < n.crit_low) { fail(a, "warn_low no puede ser menor que crit_low"); return false; }
  t = n;
  return true;
}

// Valida y aplica la orden sobre `cfg`. Devuelve true si la configuración cambió.
static bool applyCommand(const char *action, JsonObjectConst p, AckRecord &a) {
  a.ok = true;
  bool changed = false;

  if (!strcmp(action, "power")) {
    if (p.size() != 1 || !p["on"].is<bool>()) { fail(a, "params: se requiere {on:boolean}"); return false; }
    bool on = p["on"].as<bool>();
    changed = on != cfg.enabled;
    cfg.enabled = on;
    if (changed) { telemetryDue = on; applyOutputs(); }

  } else if (!strcmp(action, "set_interval")) {
    if (p.size() != 1 || !isInt(p["interval_s"])) { fail(a, "params: se requiere {interval_s:entero}"); return false; }
    int v = p["interval_s"].as<int>();
    if (v < MIN_INTERVAL_S || v > MAX_INTERVAL_S) { fail(a, "interval_s fuera de rango (2-300)"); return false; }
    changed = v != cfg.intervalS;
    cfg.intervalS = v;

  } else if (!strcmp(action, "set_mode")) {
    const char *m = p["mode"].is<const char *>() ? p["mode"].as<const char *>() : nullptr;
    if (p.size() != 1 || !m || (strcmp(m, "auto") && strcmp(m, "manual"))) { fail(a, "mode debe ser 'auto' o 'manual'"); return false; }
    bool au = !strcmp(m, "auto");
    changed = au != cfg.modeAuto;
    cfg.modeAuto = au;

  } else if (!strcmp(action, "set_params")) {
    if (p.size() == 0) { fail(a, "Debe indicar al menos un parámetro"); return false; }
    // Primero se valida todo; solo después se aplica (la orden es atómica).
    bool newRelay = cfg.relayManual;
    float newThr = cfg.lightThrPct;
    for (JsonPairConst kv : p) {
      const char *k = kv.key().c_str();
      if (!strcmp(k, "relay")) {
        if (!kv.value().is<bool>()) { fail(a, "relay debe ser booleano"); return false; }
        newRelay = kv.value().as<bool>();
      } else if (!strcmp(k, "light_threshold_pct")) {
        if (!kv.value().is<float>()) { fail(a, "light_threshold_pct debe ser numérico"); return false; }
        newThr = kv.value().as<float>();
        if (newThr < 0 || newThr > 100) { fail(a, "light_threshold_pct fuera de rango (0-100)"); return false; }
      } else { fail(a, "parámetro desconocido"); return false; }
    }
    changed = newRelay != cfg.relayManual || newThr != cfg.lightThrPct;
    cfg.relayManual = newRelay;
    cfg.lightThrPct = newThr;

  } else if (!strcmp(action, "set_thresholds")) {
    const char *var = p["variable"].is<const char *>() ? p["variable"].as<const char *>() : nullptr;
    if (p.size() != 2 || !var || !p["threshold"].is<JsonObjectConst>()) { fail(a, "params: se requiere {variable, threshold}"); return false; }
    Threshold *target = !strcmp(var, "temperature") ? &cfg.thrTemp : !strcmp(var, "humidity") ? &cfg.thrHum : nullptr;
    if (!target) { fail(a, "variable sin umbrales (use temperature o humidity)"); return false; }
    if (!parseThreshold(p["threshold"].as<JsonObjectConst>(), *target, a)) return false;
    changed = true;

  } else if (!strcmp(action, "calibrate")) {
    const char *var = p["variable"].is<const char *>() ? p["variable"].as<const char *>() : nullptr;
    if (p.size() != 2 || !var || !p["offset"].is<float>()) { fail(a, "params: se requiere {variable, offset}"); return false; }
    float off = p["offset"].as<float>();
    if (off < -20 || off > 20) { fail(a, "offset fuera de rango (-20 a 20)"); return false; }
    if (!strcmp(var, "temperature")) { changed = off != cfg.calTemp; cfg.calTemp = off; }
    else if (!strcmp(var, "humidity")) { changed = off != cfg.calHum; cfg.calHum = off; }
    else { fail(a, "variable no calibrable (use temperature o humidity)"); return false; }

  } else if (!strcmp(action, "restart")) {
    if (p.size() != 0) { fail(a, "params debe estar vacío"); return false; }
    restartPending = true;

  } else {
    fail(a, "acción no soportada por DEV11");
    return false;
  }
  return changed;
}

static void handleCommand(const uint8_t *payload, unsigned int len) {
  JsonDocument doc;
  if (deserializeJson(doc, payload, len)) { Serial.println(F("[CMD] Orden no es JSON válido; descartada")); return; }
  const char *id = doc["command_id"] | "";
  const char *action = doc["action"] | "";
  const char *issued = doc["issued_at"] | "";
  if (!isUuid(id) || !action[0] || !issued[0]) { Serial.println(F("[CMD] Orden con formato inválido; descartada")); return; }

  // Idempotencia: QoS1 puede entregar la misma orden dos veces → se reenvía el mismo ack.
  for (int i = 0; i < DEDUPE_SLOTS; i++) {
    if (!strcmp(recent[i].id, id)) {
      Serial.printf("[CMD] Orden duplicada %s; se reenvía el ack\n", id);
      publishAck(recent[i]);
      return;
    }
  }

  AckRecord a;
  strlcpy(a.id, id, sizeof a.id);
  strlcpy(a.action, action, sizeof a.action);

  time_t issuedT;
  JsonObjectConst params = doc["params"].is<JsonObjectConst>() ? doc["params"].as<JsonObjectConst>() : JsonObjectConst();
  if (!parseIso(issued, &issuedT)) {
    fail(a, "issued_at inválido");
  } else if (!timeSynced()) {
    fail(a, "reloj sin sincronizar");
  } else if (difftime(time(nullptr), issuedT) > MAX_COMMAND_AGE_S) {
    char m[60];
    snprintf(m, sizeof m, "Orden caducada (%d s)", (int)difftime(time(nullptr), issuedT));
    fail(a, m);
  } else {
    bool prevEnabled = cfg.enabled;
    bool changed = applyCommand(action, params, a);
    if (a.ok && changed) {
      cfg.version++;
      isoNow(cfg.updatedAt, sizeof cfg.updatedAt);
      telemetryDue = telemetryDue || (!prevEnabled && cfg.enabled);
    }
    a.version = cfg.version;
    if (a.ok) {
      computeRelay(readLightPct());  // aplica de inmediato el modo/relé/umbral nuevos
      if (changed) { publishConfig(); publishStatus(); telemetryDue = telemetryDue || cfg.enabled; }
    }
  }

  recent[recentNext] = a;
  recentNext = (recentNext + 1) % DEDUPE_SLOTS;
  publishAck(a);
  Serial.printf("[CMD] %s ok=%d %s\n", action, a.ok ? 1 : 0, a.error);

  if (a.ok && restartPending) {
    // Se avisa con status offline retenido y se reinicia tras dar tiempo a enviar los mensajes.
    JsonDocument st;
    fillStatus(st, false, "reinicio solicitado");
    publishJson(TOPIC_STATUS, st, true);
    restartAtMs = millis() + 800;
  } else {
    restartPending = false;
  }
}

static void onMessage(char *topic, byte *payload, unsigned int len) {
  if (!strcmp(topic, TOPIC_CONTROL)) handleCommand(payload, len);
}

// ----------------------------------------------------------------------------
// Conexiones
// ----------------------------------------------------------------------------
static void connectWifi() {
  Serial.printf("[WIFI] Conectando a %s ", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  unsigned long t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 30000) { delay(300); Serial.print('.'); }
  if (WiFi.status() == WL_CONNECTED) Serial.printf("\n[WIFI] Conectado, IP %s\n", WiFi.localIP().toString().c_str());
  else Serial.println(F("\n[WIFI] Sin conexión; se reintentará"));
}

static void syncTime() {
  // La validación del certificado TLS necesita la hora correcta.
  configTime(0, 0, "pool.ntp.org", "time.google.com");
  Serial.print(F("[NTP] Sincronizando hora "));
  unsigned long t0 = millis();
  while (!timeSynced() && millis() - t0 < 20000) { delay(300); Serial.print('.'); }
  if (timeSynced()) { char ts[25]; isoNow(ts, sizeof ts); Serial.printf("\n[NTP] Hora UTC %s\n", ts); }
  else Serial.println(F("\n[NTP] No se obtuvo la hora; se reintentará"));
}

static bool connectMqtt() {
  if (!timeSynced()) syncTime();
  if (!timeSynced()) return false;
  // Último testamento: si el nodo se cae, el broker publica «offline» (retenido, QoS1).
  JsonDocument will;
  fillStatus(will, false, "conexión perdida (LWT)");
  static char willBuf[256];
  serializeJson(will, willBuf, sizeof willBuf);

  Serial.printf("[MQTT] Conectando a %s:%d (TLS) como %s\n", MQTT_HOST, MQTT_PORT, MQTT_USER);
  if (!mqtt.connect("scbga-dev11", MQTT_USER, MQTT_PASS, TOPIC_STATUS, 1, true, willBuf, true)) {
    char tlsErr[100] = "";
    tlsClient.lastError(tlsErr, sizeof tlsErr);
    Serial.printf("[MQTT] Falló la conexión (estado=%d, TLS: %s)\n", mqtt.state(), tlsErr);
    return false;
  }
  Serial.println(F("[MQTT] Conectado"));
  mqtt.subscribe(TOPIC_CONTROL, 1);
  publishConfig();
  publishStatus();
  telemetryDue = true;
  return true;
}

// ----------------------------------------------------------------------------
// Arduino
// ----------------------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println(F("\n=== SmartCityBGA DEV11 (ESP32) ==="));
  pinMode(PIN_LED, OUTPUT);
  pinMode(PIN_RELAY, OUTPUT);
  applyOutputs();
  analogReadResolution(12);
  dht.setup(PIN_DHT, DHTesp::DHT22);

  isoNow(cfg.updatedAt, sizeof cfg.updatedAt);  // se corrige al sincronizar la hora
  cfg.thrTemp.warn_high = 30;
  cfg.thrTemp.crit_high = 33;
  cfg.thrHum.warn_low = 30;

  connectWifi();
  syncTime();
  isoNow(cfg.updatedAt, sizeof cfg.updatedAt);

  tlsClient.setCACert(ISRG_ROOT_X1);
  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setCallback(onMessage);
  mqtt.setBufferSize(1024);
  mqtt.setKeepAlive(30);
  mqtt.setSocketTimeout(10);
}

void loop() {
  if (restartPending && (long)(millis() - restartAtMs) >= 0 && restartAtMs != 0) {
    mqtt.loop();
    mqtt.disconnect();
    Serial.println(F("[SYS] Reiniciando…"));
    delay(100);
    ESP.restart();
  }

  if (WiFi.status() != WL_CONNECTED) {
    if (millis() >= nextAttemptMs) {
      Serial.println(F("[WIFI] Reconectando…"));
      WiFi.disconnect();
      WiFi.begin(WIFI_SSID, WIFI_PASS);
      nextAttemptMs = millis() + backoffMs;
      backoffMs = min(backoffMs * 2, 60000UL);
    }
    delay(50);
    return;
  }

  if (!mqtt.connected()) {
    if (millis() >= nextAttemptMs) {
      if (connectMqtt()) {
        backoffMs = 1000;
      } else {
        Serial.printf("[MQTT] Nuevo intento en %lu s\n", backoffMs / 1000UL);
        nextAttemptMs = millis() + backoffMs;
        backoffMs = min(backoffMs * 2, 60000UL);
      }
    }
    delay(50);
    return;
  }

  mqtt.loop();

  if (cfg.enabled && (telemetryDue || millis() - lastTelemetryMs >= (unsigned long)cfg.intervalS * 1000UL)) {
    telemetryDue = false;
    lastTelemetryMs = millis();
    publishTelemetry();
  }
}

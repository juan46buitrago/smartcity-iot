#!/usr/bin/env node
/**
 * Genera infra/nodered/flows/flows.json a partir del código de src/.
 * El código de cada nodo function se mantiene en archivos .js legibles y versionables.
 * Las credenciales del broker NO se versionan: scbga-entrypoint.sh las genera desde el entorno.
 * Uso: node infra/nodered/build-flows.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = (f) => readFileSync(join(here, 'src', f), 'utf8');
const LP = src('lp-common.js');
const RULE = src('rule-common.js');

const TAB_PERSIST = 'tab_persist';
const TAB_RULES = 'tab_rules';
const BROKER = 'cfg_broker';

const fn = (id, z, name, code, x, y, wires, outputs = 1) => ({ id, type: 'function', z, name, func: code, outputs, timeout: 5, noerr: 0, initialize: '', finalize: '', libs: [], x, y, wires });
const mqttIn = (id, z, name, topic, x, y, wires) => ({ id, type: 'mqtt in', z, name, topic, qos: '1', datatype: 'json', broker: BROKER, nl: false, rap: true, rh: 0, inputs: 0, x, y, wires });
const comment = (id, z, name, info, x, y) => ({ id, type: 'comment', z, name, info, x, y, wires: [] });

const flows = [
  { id: TAB_PERSIST, type: 'tab', label: 'Persistencia → InfluxDB', disabled: false, info: 'Valida los mensajes MQTT y los escribe por lotes en el bucket raw de InfluxDB, con reintento ante fallos.' },
  { id: TAB_RULES, type: 'tab', label: 'Automatización', disabled: false, info: 'Reglas entre dispositivos que envían órdenes MQTT con el mismo contrato que la interfaz web.' },
  {
    id: BROKER,
    type: 'mqtt-broker',
    name: 'Mosquitto SmartCityBGA',
    broker: 'mosquitto',
    port: '1883',
    clientid: 'scbga-nodered',
    autoConnect: true,
    usetls: false,
    protocolVersion: '4',
    keepalive: '30',
    cleansession: false, // sesión persistente: el broker encola QoS1 si Node-RED se reinicia
    autoUnsubscribe: false,
    birthTopic: '', closeTopic: '', willTopic: '',
    userProps: '', sessionExpiry: '',
  },

  comment('c_persist', TAB_PERSIST, 'Telemetría, estado y eventos → line protocol → cola persistente en disco → lote cada 2 s → /api/v2/write', '', 330, 40),
  mqttIn('in_tel', TAB_PERSIST, 'smartcity/+/telemetry', 'smartcity/+/telemetry', 150, 100, [['f_tel']]),
  mqttIn('in_status', TAB_PERSIST, 'smartcity/+/status', 'smartcity/+/status', 140, 160, [['f_status']]),
  mqttIn('in_events', TAB_PERSIST, 'smartcity/DEV04/events', 'smartcity/DEV04/events', 160, 220, [['f_inc']]),
  fn('f_tel', TAB_PERSIST, 'Validar telemetría', LP + '\n' + src('fn-telemetry.js'), 400, 100, [['enq']]),
  fn('f_status', TAB_PERSIST, 'Estado de conexión', LP + '\n' + src('fn-status.js'), 400, 160, [['enq']]),
  fn('f_inc', TAB_PERSIST, 'Incidentes sintéticos', LP + '\n' + src('fn-incident.js'), 400, 220, [['enq']]),
  fn('enq', TAB_PERSIST, 'Cola persistente', src('fn-enqueue.js'), 610, 160, [], 0),
  {
    id: 'tick', type: 'inject', z: TAB_PERSIST, name: 'cada 2 s', props: [], repeat: '2', crontab: '', once: true, onceDelay: '3',
    topic: '', x: 610, y: 240, wires: [['f_req']],
  },
  fn('f_req', TAB_PERSIST, 'Petición de escritura', src('fn-build-request.js'), 790, 160, [['http']]),
  {
    id: 'http', type: 'http request', z: TAB_PERSIST, name: 'InfluxDB write', method: 'use', ret: 'txt', paytoqs: 'ignore', url: '',
    tls: '', persist: true, proxy: '', insecureHTTPParser: false, authType: '', senderr: false, headers: [], x: 990, y: 160, wires: [['f_resp']],
  },
  fn('f_resp', TAB_PERSIST, 'Verificar / reencolar', src('fn-check-response.js'), 1190, 160, [[]]),
  {
    id: 'catch', type: 'catch', z: TAB_PERSIST, name: 'Errores de red', scope: ['http'], uncaught: false, x: 990, y: 220, wires: [['f_resp']],
  },

  comment('c_rules', TAB_RULES, 'Reglas con histéresis: solo envían una orden al cruzar el umbral', '', 280, 40),
  mqttIn('in_aq', TAB_RULES, 'DEV02 calidad del aire', 'smartcity/DEV02/telemetry', 160, 100, [['r_air']]),
  fn('r_air', TAB_RULES, 'Restricción por calidad del aire → DEV05', RULE + '\n' + src('rule-air.js'), 440, 100, [['out_ctl']]),
  mqttIn('in_wx', TAB_RULES, 'DEV10 meteorología', 'smartcity/DEV10/telemetry', 150, 180, [['r_rain']]),
  fn('r_rain', TAB_RULES, 'Alumbrado adaptativo con lluvia → DEV07', RULE + '\n' + src('rule-rain.js'), 440, 180, [['out_ctl']]),
  { id: 'out_ctl', type: 'mqtt out', z: TAB_RULES, name: 'Orden MQTT', topic: '', qos: '1', retain: 'false', broker: BROKER, x: 720, y: 140, wires: [] },
];

const out = join(here, 'flows');
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'flows.json'), JSON.stringify(flows, null, 2) + '\n');
console.log(`flows.json: ${flows.length} nodos`);

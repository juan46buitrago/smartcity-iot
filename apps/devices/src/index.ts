/**
 * Servicio de dispositivos virtuales de SmartCityBGA.
 * Arranca los 10 dispositivos; cada uno es un cliente MQTT independiente con su propia credencial.
 */
import { DEVICE_IDS, type DeviceId } from '@scbga/shared';
import { loadEnv } from './core/env.js';
import { logger } from './core/logger.js';
import { defaultRng, seededRng, type Rng } from './core/random.js';
import { StateStore } from './core/stateStore.js';
import type { DeviceDeps, VirtualDevice } from './core/VirtualDevice.js';
import { EnvironmentalStation, NoiseSensor } from './devices/environment.js';
import { AirQualityMonitor, WaterLevelSensor, WeatherStation } from './devices/external.js';
import { GpsTracker, IncidentMonitor, SmartParking, VehicleDetector } from './devices/mobility.js';
import { StreetLight } from './devices/streetlight.js';
import { loadRoadNetwork } from './sim/roads.js';
import { TrafficModel } from './sim/traffic.js';

const env = loadEnv();
const store = new StateStore(env.DEVICES_STATE_FILE);
const network = loadRoadNetwork();
const traffic = new TrafficModel(network.segments);

/** Generador independiente por dispositivo; con SIM_SEED la simulación es reproducible. */
const rngFor = (i: number): Rng => (env.SIM_SEED !== undefined ? seededRng(env.SIM_SEED + i * 7919) : defaultRng);
const deps = (id: DeviceId): DeviceDeps => ({
  mqtt: { url: env.MQTT_URL, username: id, password: env.mqttPasswords[id] },
  store,
});

const devices: VirtualDevice[] = [
  new EnvironmentalStation(deps('DEV01'), rngFor(1)),
  new AirQualityMonitor(deps('DEV02')),
  new NoiseSensor(deps('DEV03'), rngFor(3)),
  new IncidentMonitor(deps('DEV04'), traffic, rngFor(4)),
  new VehicleDetector(deps('DEV05'), traffic, rngFor(5)),
  new GpsTracker(deps('DEV06'), env, network.gps_route, rngFor(6)),
  new StreetLight(deps('DEV07'), rngFor(7)),
  new SmartParking(deps('DEV08'), rngFor(8)),
  new WaterLevelSensor(deps('DEV09'), env.IDEAM_STATION, env.IDEAM_APP_TOKEN),
  new WeatherStation(deps('DEV10')),
];
if (devices.length !== DEVICE_IDS.length) throw new Error('Faltan dispositivos');

logger.info({ segments: network.segments.length, mqtt: env.MQTT_URL, gps_source: env.GPS_SOURCE }, 'Iniciando dispositivos virtuales');
for (const d of devices) await d.start();

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Deteniendo dispositivos');
  await Promise.allSettled(devices.map((d) => d.stop()));
  store.flush();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

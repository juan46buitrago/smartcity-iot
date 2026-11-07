import { DEVICE_IDS, type DeviceId } from '@scbga/shared';
import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0', ''])
  .optional()
  .transform((v) => v === 'true' || v === '1');

const EnvSchema = z.object({
  MQTT_URL: z.string().default('mqtt://localhost:1883'),
  DEVICES_STATE_FILE: z.string().default('./data/devices-state.json'),
  SIM_SEED: z.coerce.number().int().optional(),

  // DEV06 — GPS
  GPS_SOURCE: z.enum(['simulated_route', 'gpsmobile']).default('simulated_route'),
  GPS_USAGE_AUTHORIZED: bool,
  GPS_FALLBACK_TO_SIMULATED: bool,
  GPS_API_BASE_URL: z.string().optional(),
  GPS_VEHICLE_PATH: z.string().optional(),
  GPS_API_USER: z.string().optional(),
  GPS_API_PASS: z.string().optional(),

  // DEV09 — IDEAM
  IDEAM_STATION: z.string().default('0023197700'),
  IDEAM_APP_TOKEN: z.string().optional(),
});

export type DevicesEnv = z.infer<typeof EnvSchema> & { mqttPasswords: Record<DeviceId, string> };

export function loadEnv(src: NodeJS.ProcessEnv = process.env): DevicesEnv {
  const env = EnvSchema.parse(src);
  const mqttPasswords = {} as Record<DeviceId, string>;
  const missing: string[] = [];
  for (const id of DEVICE_IDS) {
    const v = src[`MQTT_PASS_${id}`];
    if (!v) missing.push(`MQTT_PASS_${id}`);
    mqttPasswords[id] = v ?? '';
  }
  if (missing.length) throw new Error(`Faltan variables de entorno: ${missing.join(', ')}`);
  return { ...env, mqttPasswords };
}

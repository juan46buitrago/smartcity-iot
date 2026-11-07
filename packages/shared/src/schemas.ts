/**
 * Esquemas zod del contrato MQTT. Se usan en los dispositivos (al publicar y al recibir
 * órdenes), en el backend (al consumir) y en Node-RED se replica la validación mínima.
 */
import { z } from 'zod';
import {
  COMMAND_ACTIONS,
  DEVICE_CATALOG,
  DEVICE_IDS,
  SOURCE_TYPES,
  type DeviceId,
  type ParamSpec,
} from './catalog.js';

export const DeviceIdSchema = z.enum(DEVICE_IDS);
export const SourceTypeSchema = z.enum(SOURCE_TYPES);
const IsoDate = z.iso.datetime({ offset: true });

export const LocationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  name: z.string().max(120).optional(),
});

export const ProvenanceSchema = z.object({
  provider: z.string().max(160),
  synthetic: z.boolean(),
  ref: z.string().max(160).optional(),
});

export const VariableValueSchema = z.object({
  value: z.union([z.number().finite(), z.string().max(64), z.boolean(), z.null()]),
  unit: z.string().max(16).nullable(),
});

export const TelemetrySchema = z.object({
  device_id: DeviceIdSchema,
  timestamp: IsoDate,
  ingested_at: IsoDate,
  location: LocationSchema,
  status: z.enum(['online', 'degraded']),
  source_type: SourceTypeSchema,
  provenance: ProvenanceSchema,
  variables: z.record(z.string().max(40), VariableValueSchema),
  seq: z.number().int().nonnegative(),
});
export type Telemetry = z.infer<typeof TelemetrySchema>;

export const ConnectionStateSchema = z.enum(['online', 'offline']);
export const OperationalStateSchema = z.enum(['running', 'stopped', 'degraded', 'error']);

export const StatusSchema = z.object({
  device_id: DeviceIdSchema,
  timestamp: IsoDate,
  connection: ConnectionStateSchema,
  state: OperationalStateSchema.optional(),
  reason: z.string().max(200).optional(),
  uptime_s: z.number().nonnegative().optional(),
  last_sample_at: IsoDate.nullable().optional(),
  firmware: z.string().max(32).optional(),
});
export type DeviceStatus = z.infer<typeof StatusSchema>;

export const ThresholdSchema = z
  .object({
    warn_high: z.number().finite().optional(),
    crit_high: z.number().finite().optional(),
    warn_low: z.number().finite().optional(),
    crit_low: z.number().finite().optional(),
  })
  .strict();

export const ParamValueSchema = z.union([z.number().finite(), z.boolean(), z.string().max(64)]);

export const DeviceConfigSchema = z.object({
  device_id: DeviceIdSchema,
  enabled: z.boolean(),
  interval_s: z.number().int().positive(),
  mode: z.string().max(32),
  thresholds: z.record(z.string(), ThresholdSchema),
  calibration: z.record(z.string(), z.number().finite()),
  params: z.record(z.string(), ParamValueSchema),
  version: z.number().int().nonnegative(),
  updated_at: IsoDate,
});
export type DeviceConfig = z.infer<typeof DeviceConfigSchema>;

export const CommandSchema = z.object({
  command_id: z.string().uuid(),
  action: z.enum(COMMAND_ACTIONS),
  params: z.record(z.string(), z.unknown()).default({}),
  issued_at: IsoDate,
  issued_by: z.string().max(64).optional(),
});
export type Command = z.infer<typeof CommandSchema>;

export const AckSchema = z.object({
  command_id: z.string().uuid(),
  device_id: DeviceIdSchema,
  action: z.enum(COMMAND_ACTIONS),
  ok: z.boolean(),
  error: z.string().max(300).optional(),
  timestamp: IsoDate,
  config_version: z.number().int().nonnegative().optional(),
});
export type Ack = z.infer<typeof AckSchema>;

export const INCIDENT_TYPES = ['accidente', 'vehiculo_averiado', 'cierre_parcial', 'congestion'] as const;
export const INCIDENT_SEVERITIES = ['baja', 'media', 'alta', 'critica'] as const;
export const INCIDENT_STATES = ['activo', 'en_atencion', 'resuelto'] as const;
export type IncidentType = (typeof INCIDENT_TYPES)[number];
export type IncidentSeverity = (typeof INCIDENT_SEVERITIES)[number];
export type IncidentState = (typeof INCIDENT_STATES)[number];

export const IncidentSchema = z.object({
  incident_id: z.string().regex(/^SIM-INC-[A-Z0-9-]+$/),
  type: z.enum(INCIDENT_TYPES),
  severity: z.enum(INCIDENT_SEVERITIES),
  state: z.enum(INCIDENT_STATES),
  segment_id: z.string(),
  road_name: z.string(),
  road_class: z.string(),
  location: LocationSchema,
  lanes_blocked: z.number().int().nonnegative(),
  speed_impact: z.number().min(0).max(1),
  started_at: IsoDate,
  attended_at: IsoDate.nullable(),
  resolved_at: IsoDate.nullable(),
  expected_end_at: IsoDate,
  cause: z.string().max(200),
  synthetic: z.literal(true),
  test: z.boolean().default(false),
});
export type Incident = z.infer<typeof IncidentSchema>;

export const IncidentEventSchema = z.object({
  device_id: z.literal('DEV04'),
  timestamp: IsoDate,
  event: z.enum(['incident_created', 'incident_attended', 'incident_resolved']),
  incident: IncidentSchema,
  source_type: z.literal('simulated'),
  provenance: ProvenanceSchema.extend({ synthetic: z.literal(true) }),
});
export type IncidentEvent = z.infer<typeof IncidentEventSchema>;

/* ------------------------------------------------------------------ */
/* Validación de órdenes según las capacidades de cada dispositivo     */
/* ------------------------------------------------------------------ */

function paramSchema(p: ParamSpec): z.ZodTypeAny {
  switch (p.type) {
    case 'number': {
      let s = z.number().finite();
      if (p.min !== undefined) s = s.min(p.min);
      if (p.max !== undefined) s = s.max(p.max);
      return s;
    }
    case 'boolean':
      return z.boolean();
    case 'enum':
      return z.enum(p.options as [string, ...string[]]);
  }
}

/** Devuelve el esquema zod de los parámetros de una acción para un dispositivo concreto. */
export function commandParamsSchema(deviceId: DeviceId, action: Command['action']): z.ZodTypeAny {
  const spec = DEVICE_CATALOG[deviceId];
  const thresholdKeys = spec.variables.filter((v) => v.thresholdable).map((v) => v.key);
  const calibKeys = spec.variables.filter((v) => v.calibratable).map((v) => v.key);

  switch (action) {
    case 'power':
      return z.object({ on: z.boolean() }).strict();
    case 'set_interval':
      return z.object({ interval_s: z.number().int().min(spec.interval.min).max(spec.interval.max) }).strict();
    case 'set_mode':
      return z.object({ mode: z.enum(spec.modes as [string, ...string[]]) }).strict();
    case 'set_params': {
      if (spec.params.length === 0) return z.never();
      const shape: Record<string, z.ZodTypeAny> = {};
      for (const p of spec.params) shape[p.key] = paramSchema(p).optional();
      return z
        .object(shape)
        .strict()
        .refine((o) => Object.keys(o).length > 0, 'Debe indicar al menos un parámetro');
    }
    case 'set_thresholds':
      if (thresholdKeys.length === 0) return z.never();
      return z
        .object({
          variable: z.enum(thresholdKeys as [string, ...string[]]),
          threshold: ThresholdSchema,
        })
        .strict()
        .refine(({ threshold: t }) => !(t.warn_high !== undefined && t.crit_high !== undefined && t.warn_high > t.crit_high), 'warn_high no puede superar crit_high')
        .refine(({ threshold: t }) => !(t.warn_low !== undefined && t.crit_low !== undefined && t.warn_low < t.crit_low), 'warn_low no puede ser menor que crit_low');
    case 'calibrate':
      if (calibKeys.length === 0) return z.never();
      return z
        .object({ variable: z.enum(calibKeys as [string, ...string[]]), offset: z.number().min(-20).max(20) })
        .strict();
    case 'restart':
      return z.object({}).strict();
    case 'inject_test_incident':
      return z
        .object({
          type: z.enum(INCIDENT_TYPES).optional(),
          severity: z.enum(INCIDENT_SEVERITIES).optional(),
        })
        .strict();
  }
}

export type CommandValidation = { ok: true; params: Record<string, unknown> } | { ok: false; error: string };

/** Valida acción + parámetros contra el catálogo. Se usa en backend y en el dispositivo. */
export function validateCommand(deviceId: DeviceId, action: Command['action'], params: unknown): CommandValidation {
  const spec = DEVICE_CATALOG[deviceId];
  if (!spec.actions.includes(action)) {
    return { ok: false, error: `La acción '${action}' no está soportada por ${deviceId}` };
  }
  const res = commandParamsSchema(deviceId, action).safeParse(params ?? {});
  if (!res.success) {
    return { ok: false, error: res.error.issues.map((i) => `${i.path.join('.') || 'params'}: ${i.message}`).join('; ') };
  }
  return { ok: true, params: res.data as Record<string, unknown> };
}

/** Configuración inicial de un dispositivo a partir del catálogo. */
export function defaultConfig(deviceId: DeviceId, now = new Date()): DeviceConfig {
  const spec = DEVICE_CATALOG[deviceId];
  const params: Record<string, number | boolean | string> = {};
  for (const p of spec.params) params[p.key] = p.default;
  const calibration: Record<string, number> = {};
  for (const v of spec.variables) if (v.calibratable) calibration[v.key] = 0;
  return {
    device_id: deviceId,
    enabled: true,
    interval_s: spec.interval.default,
    mode: spec.default_mode,
    thresholds: structuredClone(spec.default_thresholds),
    calibration,
    params,
    version: 0,
    updated_at: now.toISOString(),
  };
}

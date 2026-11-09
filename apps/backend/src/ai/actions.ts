/**
 * Órdenes por lenguaje natural: el modelo SOLO propone; nada se ejecuta aquí.
 *
 * 1. El enrutador marca la pregunta como `accion`.
 * 2. Un segundo llamado (salida cerrada, enums) convierte la frase en una orden candidata.
 * 3. El código la valida con el mismo catálogo que usa el dispositivo (`validateCommand`) y devuelve
 *    una PROPUESTA. El navegador la envía a `POST /api/devices/:id/commands`, que exige sesión de
 *    operador: la confirmación y la autorización siguen siendo humanas y las mismas de siempre.
 */
import { DEVICE_CATALOG, validateCommand, type DeviceId } from '@scbga/shared';
import { z } from 'zod';
import type { AgentSpec } from './agents.js';
import type { LlmClient, LlmUsage } from './client.js';
import { extractJson } from './router.js';

/** Acciones que el asistente puede proponer (no incluye pruebas ni calibración). */
export const AI_ACTIONS = ['power', 'set_interval', 'set_mode', 'set_params', 'restart'] as const;
type AiAction = (typeof AI_ACTIONS)[number];

const ALL = Object.values(DEVICE_CATALOG);
const MODES = [...new Set(ALL.flatMap((d) => [...d.modes]))];
const PARAMS = [...new Set(ALL.flatMap((d) => d.params.map((p) => p.key)))];

export interface CommandProposal {
  device_id: DeviceId;
  action: AiAction;
  params: Record<string, unknown>;
  summary: string;
}

export function commandJsonSchema(devices: readonly DeviceId[]) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['dispositivo', 'accion', 'bandera', 'valor', 'modo', 'parametro'],
    properties: {
      dispositivo: { type: 'string', enum: [...devices] },
      accion: { type: 'string', enum: [...AI_ACTIONS] },
      bandera: { type: 'string', enum: ['si', 'no', 'na'] },
      valor: { type: 'number' },
      modo: { type: 'string', enum: [...MODES, 'na'] },
      parametro: { type: 'string', enum: [...PARAMS, 'na'] },
    },
  };
}

const commandSchema = z.object({
  dispositivo: z.string(),
  accion: z.enum(AI_ACTIONS),
  bandera: z.enum(['si', 'no', 'na']),
  valor: z.coerce.number(),
  modo: z.string(),
  parametro: z.string(),
});
export type RawCommand = z.infer<typeof commandSchema>;

export function commandPrompt(agent: AgentSpec): string {
  const devs = agent.devices
    .map((id) => {
      const d = DEVICE_CATALOG[id];
      const params = d.params.map((p) => `${p.key}(${p.type}${p.options ? ':' + p.options.join('|') : p.min !== undefined ? `:${p.min}-${p.max}` : ''})`).join(', ');
      return `${id} ${d.name}; acciones: ${d.actions.filter((a) => (AI_ACTIONS as readonly string[]).includes(a)).join(',')}; modos: ${d.modes.join('|')}; intervalo ${d.interval.min}-${d.interval.max}s${params ? `; parámetros: ${params}` : ''}`;
    })
    .join('\n');
  return [
    'Convierte la orden del usuario en JSON para un dispositivo IoT. Devuelve SOLO el JSON.',
    'accion: power=encender/apagar (bandera si=encender, no=apagar); set_interval=cada cuántos segundos mide (valor); set_mode=cambiar modo (modo); set_params=cambiar un parámetro (parametro + valor, o bandera si es booleano, o modo si es de opciones); restart=reiniciar.',
    'Usa "na" / 0 en los campos que la acción no necesita. dispositivo debe ser uno de la lista; si dice "la farola" es DEV07, "el ESP32" es DEV11.',
    'Dispositivos:',
    devs,
    'Ejemplos: "apaga la farola"→{"dispositivo":"DEV07","accion":"power","bandera":"no","valor":0,"modo":"na","parametro":"na"}',
    '"mide cada 30 segundos el sensor de ruido"→{"dispositivo":"DEV03","accion":"set_interval","bandera":"na","valor":30,"modo":"na","parametro":"na"}',
  ].join('\n');
}

const ACTION_ERR = 'No pude convertir eso en una orden válida. Dime el dispositivo y qué hacer, por ejemplo: «apaga el alumbrado» o «mide cada 30 segundos el ruido».';

/** Convierte la salida del modelo en una propuesta validada contra el catálogo, o explica por qué no. */
export function buildProposal(raw: RawCommand, devices: readonly DeviceId[]): { ok: true; proposal: CommandProposal } | { ok: false; error: string } {
  const id = raw.dispositivo as DeviceId;
  if (!devices.includes(id)) return { ok: false, error: ACTION_ERR };
  const spec = DEVICE_CATALOG[id];
  let params: Record<string, unknown> = {};
  let summary: string;
  switch (raw.accion) {
    case 'power':
      if (raw.bandera === 'na') return { ok: false, error: `¿Quieres encender o apagar ${spec.name}?` };
      params = { on: raw.bandera === 'si' };
      summary = `${raw.bandera === 'si' ? 'Encender' : 'Apagar'} ${spec.name} (${id})`;
      break;
    case 'set_interval':
      if (raw.valor < spec.interval.min || raw.valor > spec.interval.max) return { ok: false, error: `${spec.name} solo admite un intervalo entre ${spec.interval.min} y ${spec.interval.max} segundos.` };
      params = { interval_s: Math.round(raw.valor) };
      summary = `Cambiar el intervalo de ${spec.name} (${id}) a ${Math.round(raw.valor)} s`;
      break;
    case 'set_mode':
      params = { mode: raw.modo };
      summary = `Poner ${spec.name} (${id}) en modo «${raw.modo}»`;
      break;
    case 'set_params': {
      const p = spec.params.find((x) => x.key === raw.parametro);
      if (!p) return { ok: false, error: `${spec.name} no tiene ese parámetro. Los que acepta: ${spec.params.map((x) => x.label).join(', ') || 'ninguno'}.` };
      const value = p.type === 'boolean' ? raw.bandera === 'si' : p.type === 'enum' ? raw.modo : raw.valor;
      params = { [p.key]: value };
      summary = `Ajustar «${p.label}» de ${spec.name} (${id}) a ${typeof value === 'boolean' ? (value ? 'sí' : 'no') : value}${p.unit ? ' ' + p.unit : ''}`;
      break;
    }
    case 'restart':
      summary = `Reiniciar ${spec.name} (${id})`;
      break;
  }
  const v = validateCommand(id, raw.accion, params);
  if (!v.ok) return { ok: false, error: `No puedo enviar esa orden: ${v.error}.` };
  return { ok: true, proposal: { device_id: id, action: raw.accion, params: v.params, summary } };
}

export async function proposeCommand(
  llm: LlmClient,
  question: string,
  agent: AgentSpec,
): Promise<{ answer: { text: string; proposal?: CommandProposal }; usage: LlmUsage; ms: number }> {
  const r = await llm.complete(
    [
      { role: 'system', content: commandPrompt(agent) },
      { role: 'user', content: question },
    ],
    { schema: { name: 'orden', schema: commandJsonSchema(agent.devices) }, maxTokens: 90 },
  );
  let parsed: ReturnType<typeof commandSchema.safeParse> | null = null;
  try {
    parsed = commandSchema.safeParse(JSON.parse(extractJson(r.content)));
  } catch {
    /* JSON inválido: se responde con el mensaje de ayuda */
  }
  if (!parsed?.success) return { answer: { text: ACTION_ERR }, usage: r.usage, ms: r.ms };
  const b = buildProposal(parsed.data, agent.devices);
  if (!b.ok) return { answer: { text: b.error }, usage: r.usage, ms: r.ms };
  return {
    answer: { text: `${b.proposal.summary}. Confírmalo para enviarlo al dispositivo (hace falta la sesión de operador).`, proposal: b.proposal },
    usage: r.usage,
    ms: r.ms,
  };
}

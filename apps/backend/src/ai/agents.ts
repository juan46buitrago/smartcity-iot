/**
 * Agentes expertos por tema. Cada agente acota el vocabulario que ve el enrutador (menos tokens y
 * menos ambigüedad) y trae sus propias preguntas de ejemplo. "general" ve toda la ciudad.
 */
import { DEVICE_IDS, type DeviceId } from '@scbga/shared';

export const AGENT_IDS = ['general', 'clima', 'aire', 'movilidad', 'agua', 'alumbrado', 'operacion'] as const;
export type AgentId = (typeof AGENT_IDS)[number];

export interface AgentSpec {
  id: AgentId;
  name: string;
  description: string;
  devices: readonly DeviceId[];
  suggestions: string[];
}

export const AGENTS: Record<AgentId, AgentSpec> = {
  general: {
    id: 'general',
    name: 'General',
    description: 'Toda la ciudad: elige el tema por ti.',
    devices: DEVICE_IDS,
    suggestions: ['¿Cómo está la ciudad ahora?', '¿Cuál es la temperatura actual?', '¿A qué hora hay más tráfico?', 'Resumen del día', 'Compara el ruido con el flujo vehicular esta semana', 'Temperatura de hoy en barras'],
  },
  clima: {
    id: 'clima',
    name: 'Clima',
    description: 'Temperatura, humedad, viento, presión y radiación (DEV01, DEV10, DEV11, DEV12).',
    devices: ['DEV01', 'DEV10', 'DEV11', 'DEV12'],
    suggestions: ['¿Qué temperatura hace ahora?', 'Promedio, mínimo y máximo de temperatura hoy', 'Compara la temperatura del gemelo, la API y el dataset', '¿A qué hora hace más calor?'],
  },
  aire: {
    id: 'aire',
    name: 'Aire y ruido',
    description: 'Calidad del aire (AQI, PM2.5, PM10) y nivel de ruido (DEV02, DEV03).',
    devices: ['DEV02', 'DEV03'],
    suggestions: ['¿Cómo está la calidad del aire?', 'PM2.5 de los últimos 3 días', '¿A qué hora hay más ruido?', 'Ruido máximo de ayer'],
  },
  movilidad: {
    id: 'movilidad',
    name: 'Movilidad',
    description: 'Tráfico, incidentes viales, vehículo GPS y parqueadero (DEV04, DEV05, DEV06, DEV08).',
    devices: ['DEV04', 'DEV05', 'DEV06', 'DEV08'],
    suggestions: ['¿A qué hora hay más tráfico?', '¿Cuántos incidentes hubo ayer?', '¿Hay cupo en el parqueadero?', '¿Dónde está el vehículo GPS?'],
  },
  agua: {
    id: 'agua',
    name: 'Agua y lluvia',
    description: 'Nivel del río y precipitación (DEV09, DEV10, DEV12).',
    devices: ['DEV09', 'DEV10', 'DEV12'],
    suggestions: ['¿Está lloviendo?', 'Nivel del río en los últimos 3 días', 'Precipitación de esta semana', '¿El río está subiendo?'],
  },
  alumbrado: {
    id: 'alumbrado',
    name: 'Alumbrado',
    description: 'Luz ambiente, nivel de iluminación, potencia y energía (DEV07).',
    devices: ['DEV07'],
    suggestions: ['¿Cuánta energía gastó el alumbrado hoy?', 'Potencia del alumbrado por hora del día', '¿A qué hora se encienden las luminarias?', 'Luz ambiente de ayer', 'Apaga el alumbrado'],
  },
  operacion: {
    id: 'operacion',
    name: 'Operación',
    description: 'Estado de los equipos, alertas e incidentes de toda la red.',
    devices: DEVICE_IDS,
    suggestions: ['¿Hay algún problema?', '¿Qué alertas hay activas?', '¿Qué dispositivos hay?', '¿Qué equipos están fuera de línea?', 'Resumen del día'],
  },
};

export function agentOf(id: string | undefined | null): AgentSpec {
  return (id && (AGENT_IDS as readonly string[]).includes(id) ? AGENTS[id as AgentId] : AGENTS.general);
}

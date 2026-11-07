import type { DeviceId } from './catalog.js';

export const TOPIC_ROOT = 'smartcity';
export const CHANNELS = ['telemetry', 'status', 'control', 'config', 'ack', 'events'] as const;
export type Channel = (typeof CHANNELS)[number];

export function topic(deviceId: DeviceId, channel: Channel): string {
  return `${TOPIC_ROOT}/${deviceId}/${channel}`;
}

/** Interpreta un tópico `smartcity/DEVxx/<canal>`; devuelve null si no es del sistema. */
export function parseTopic(t: string): { deviceId: string; channel: Channel } | null {
  const parts = t.split('/');
  if (parts.length !== 3 || parts[0] !== TOPIC_ROOT) return null;
  const channel = parts[2] as Channel;
  if (!CHANNELS.includes(channel)) return null;
  return { deviceId: parts[1]!, channel };
}

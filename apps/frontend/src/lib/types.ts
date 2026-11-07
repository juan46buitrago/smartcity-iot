import type { DeviceConfig, DeviceSpec, DeviceStatus, Incident, IncidentEvent, Telemetry } from '@scbga/shared';

export interface DeviceLive {
  status: (DeviceStatus & { received_at: string; stale?: boolean }) | null;
  config: DeviceConfig | null;
  telemetry: (Telemetry & { received_at?: string }) | null;
}

export type DeviceView = DeviceSpec & { live: DeviceLive };

export interface AlertRow {
  id: number;
  device_id: string;
  variable: string | null;
  kind: 'threshold' | 'anomaly' | 'offline' | 'incident';
  severity: 'info' | 'warning' | 'critical';
  message: string;
  value: number | null;
  threshold: number | null;
  status: 'abierta' | 'reconocida' | 'resuelta';
  created_at: string;
  updated_at: string;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  synthetic: number;
}

export interface CommandRecord {
  command_id: string;
  device_id: string;
  action: string;
  params: Record<string, unknown>;
  issued_at: string;
  issued_by: string;
  origin: 'api' | 'external';
  status: 'pending' | 'confirmed' | 'rejected' | 'timeout';
  error: string | null;
  ack_at: string | null;
  config_version: number | null;
}

export type FeedItem = { id: string; at: string; kind: 'telemetry' | 'status' | 'command' | 'alert' | 'incident' | 'config'; device: string; text: string; tone?: 'ok' | 'warn' | 'crit' | 'info' | 'synth' };

export type { Incident, IncidentEvent };

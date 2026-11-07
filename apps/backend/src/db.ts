/**
 * Persistencia de configuración y operación en SQLite (WAL):
 * órdenes (auditoría), alertas, incidentes sintéticos y última instantánea de cada dispositivo.
 * Las series temporales viven en InfluxDB.
 */
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type Db = Database.Database;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS device_snapshot (
  device_id   TEXT PRIMARY KEY,
  status      TEXT,
  config      TEXT,
  telemetry   TEXT,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS commands (
  command_id     TEXT PRIMARY KEY,
  device_id      TEXT NOT NULL,
  action         TEXT NOT NULL,
  params         TEXT NOT NULL,
  issued_at      TEXT NOT NULL,
  issued_by      TEXT NOT NULL,
  origin         TEXT NOT NULL CHECK (origin IN ('api','external')),
  status         TEXT NOT NULL CHECK (status IN ('pending','confirmed','rejected','timeout')),
  error          TEXT,
  ack_at         TEXT,
  config_version INTEGER
);
CREATE INDEX IF NOT EXISTS idx_commands_device ON commands(device_id, issued_at DESC);

CREATE TABLE IF NOT EXISTS alerts (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id        TEXT NOT NULL,
  variable         TEXT,
  kind             TEXT NOT NULL CHECK (kind IN ('threshold','anomaly','offline','incident')),
  severity         TEXT NOT NULL CHECK (severity IN ('info','warning','critical')),
  message          TEXT NOT NULL,
  value            REAL,
  threshold        REAL,
  ref              TEXT,
  status           TEXT NOT NULL CHECK (status IN ('abierta','reconocida','resuelta')),
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  acknowledged_by  TEXT,
  acknowledged_at  TEXT,
  resolved_by      TEXT,
  resolved_at      TEXT,
  synthetic        INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_key ON alerts(device_id, variable, kind, status);

CREATE TABLE IF NOT EXISTS incidents (
  incident_id  TEXT PRIMARY KEY,
  type         TEXT NOT NULL,
  severity     TEXT NOT NULL,
  state        TEXT NOT NULL,
  road_name    TEXT NOT NULL,
  started_at   TEXT NOT NULL,
  resolved_at  TEXT,
  test         INTEGER NOT NULL DEFAULT 0,
  data         TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_incidents_state ON incidents(state, started_at DESC);
`;

export function openDb(file: string): Db {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}

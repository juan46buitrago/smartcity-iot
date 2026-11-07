import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { logger } from './logger.js';

/**
 * Persistencia ligera del estado interno de los dispositivos (configuración, contadores,
 * energía acumulada, incidentes activos…) para que sobrevivan reinicios del contenedor.
 * Escritura atómica (archivo temporal + rename) y diferida para no castigar el disco.
 */
export class StateStore {
  private data: Record<string, Record<string, unknown>> = {};
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly file: string | null) {
    if (!file) return;
    try {
      this.data = JSON.parse(readFileSync(file, 'utf8'));
      logger.info({ file }, 'Estado de dispositivos restaurado');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') logger.warn({ err: (e as Error).message }, 'Estado ilegible; se inicia limpio');
    }
  }

  get<T>(deviceId: string, key: string): T | undefined {
    return this.data[deviceId]?.[key] as T | undefined;
  }

  set(deviceId: string, key: string, value: unknown): void {
    (this.data[deviceId] ??= {})[key] = value;
    this.scheduleFlush();
  }

  private scheduleFlush() {
    if (!this.file || this.timer) return;
    this.timer = setTimeout(() => this.flush(), 2000);
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.file) return;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.data));
      renameSync(tmp, this.file);
    } catch (e) {
      logger.error({ err: (e as Error).message }, 'No se pudo guardar el estado');
    }
  }
}

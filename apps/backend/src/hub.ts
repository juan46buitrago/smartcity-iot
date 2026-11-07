import { EventEmitter } from 'node:events';

/** Eventos que el backend difunde a la interfaz por WebSocket. */
export type HubEvent =
  | { type: 'telemetry'; data: unknown }
  | { type: 'status'; data: unknown }
  | { type: 'config'; data: unknown }
  | { type: 'command'; data: unknown }
  | { type: 'alert'; data: unknown }
  | { type: 'incident'; data: unknown };

export class Hub extends EventEmitter {
  publish(ev: HubEvent): void {
    this.emit('event', ev);
  }
  subscribe(fn: (ev: HubEvent) => void): () => void {
    this.on('event', fn);
    return () => this.off('event', fn);
  }
}

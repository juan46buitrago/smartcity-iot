import type { DevState } from '../components/ui';
import { isOnline } from './live';
import type { DeviceView } from './types';

export function deviceState(d: DeviceView | undefined): DevState {
  const s = d?.live.status;
  if (!s) return 'unknown';
  if (!isOnline(d)) return 'offline';
  if (s.state === 'stopped') return 'stopped';
  if (s.state === 'degraded' || s.state === 'error') return 'degraded';
  return 'online';
}

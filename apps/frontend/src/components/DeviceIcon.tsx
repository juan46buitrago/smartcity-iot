import type { DeviceId } from '@scbga/shared';
import { Car, CloudSun, Cpu, Database, Droplets, Lamp, MapPin, SquareParking, Siren, Thermometer, Volume2, Wind } from 'lucide-react';
import type { DeviceView } from '../lib/types';
import { cx } from './ui';

const ICONS: Record<DeviceId, typeof Car> = {
  DEV01: Thermometer,
  DEV02: Wind,
  DEV03: Volume2,
  DEV04: Siren,
  DEV05: Car,
  DEV06: MapPin,
  DEV07: Lamp,
  DEV08: SquareParking,
  DEV09: Droplets,
  DEV10: CloudSun,
  DEV11: Cpu,
  DEV12: Database,
};

export const CATEGORY_LABEL: Record<string, string> = { ambiente: 'Ambiente', movilidad: 'Movilidad', energia: 'Energía', agua: 'Agua', clima: 'Clima' };


export function DeviceIcon({ id, className }: { id: DeviceId; className?: string }) {
  const Icon = ICONS[id];
  return <Icon className={className} aria-hidden strokeWidth={1.75} />;
}

/**
 * Glifo de dispositivo: el icono indica la categoría; el color se reserva para el estado.
 */
export function DeviceGlyph({ device, size = 'md', className }: { device: Pick<DeviceView, 'id' | 'category'>; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const box = size === 'sm' ? 'size-8' : size === 'lg' ? 'size-14' : 'size-10';
  const icon = size === 'sm' ? 'size-4' : size === 'lg' ? 'size-7' : 'size-5';
  return (
    <span className={cx(box, 'grid shrink-0 place-items-center rounded-[5px] border border-line bg-surface-2 text-ink-2', className)}>
      <DeviceIcon id={device.id} className={icon} />
    </span>
  );
}

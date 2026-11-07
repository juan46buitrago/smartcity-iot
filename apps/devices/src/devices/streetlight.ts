/**
 * DEV07 — Gemelo digital de un circuito de alumbrado LED.
 * La luz ambiente se calcula con la posición solar real de Bucaramanga; en modo `auto`
 * enciende con histéresis bajo el umbral y atenúa en la madrugada. Potencia y energía
 * son calculadas (no medidas).
 */
import { clamp, normal, type Rng } from '../core/random.js';
import { bogotaTime } from '../core/time.js';
import { VirtualDevice, type DeviceDeps, type Sample } from '../core/VirtualDevice.js';
import { ambientLux, solarElevationDeg } from '../sim/solar.js';

export class StreetLight extends VirtualDevice {
  private on = false;
  private energyKwh: number;
  private lastAt: number | null = null;
  private cloud = 0.4;

  constructor(deps: DeviceDeps, private readonly rng: Rng) {
    super('DEV07', deps);
    this.energyKwh = deps.store.get<number>('DEV07', 'energy_kwh') ?? 0;
  }

  protected override async sample(now: Date): Promise<Sample> {
    const { lat, lon } = this.spec.location;
    this.cloud = clamp(this.cloud + normal(this.rng, 0, 0.03), 0, 1);
    const lux = ambientLux(solarElevationDeg(now, lat, lon), this.cloud);
    const onLux = this.param<number>('on_lux');

    let level: number;
    if (this.config.mode === 'manual') {
      level = this.param<number>('manual_level');
      this.on = level > 0;
    } else {
      if (!this.on && lux < onLux) this.on = true;
      else if (this.on && lux > onLux * 1.5) this.on = false;
      const { hour } = bogotaTime(now);
      level = this.on ? (hour >= 23 || hour < 5 ? this.param<number>('night_dim_pct') : 100) : 0;
    }

    const lamps = this.param<number>('lamps');
    const watts = this.param<number>('lamp_watts');
    // Driver LED: ~8 % de pérdidas fijas cuando está encendido; 1 W de reposo por luminaria.
    const power = level > 0 ? lamps * watts * (0.08 + 0.92 * (level / 100)) : lamps * 1;
    const dtH = this.lastAt === null ? 0 : Math.min(900, (now.getTime() - this.lastAt) / 1000) / 3600;
    this.lastAt = now.getTime();
    this.energyKwh += (power * dtH) / 1000;
    this.store.set(this.id, 'energy_kwh', this.energyKwh);

    return { variables: { ambient_lux: lux, light_level: level, power_w: power, energy_kwh: this.energyKwh } };
  }
}

/** Elevación solar aproximada (NOAA simplificado), en grados. Suficiente para el gemelo de alumbrado. */
export function solarElevationDeg(d: Date, lat: number, lon: number): number {
  const rad = Math.PI / 180;
  const jd = d.getTime() / 86400000 + 2440587.5;
  const n = jd - 2451545.0;
  const L = (280.46 + 0.9856474 * n) % 360;
  const g = ((357.528 + 0.9856003 * n) % 360) * rad;
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad;
  const eps = (23.439 - 0.0000004 * n) * rad;
  const decl = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
  const gmst = (18.697374558 + 24.06570982441908 * n) % 24;
  const lst = gmst * 15 * rad + lon * rad;
  const ha = lst - ra;
  const latR = lat * rad;
  return Math.asin(Math.sin(latR) * Math.sin(decl) + Math.cos(latR) * Math.cos(decl) * Math.cos(ha)) / rad;
}

/** Iluminancia ambiente aproximada (lux) a partir de la elevación solar y nubosidad (0–1). */
export function ambientLux(elevDeg: number, cloud = 0.3): number {
  const urbanGlow = 2;
  if (elevDeg > 0) return urbanGlow + 120000 * Math.pow(Math.sin((elevDeg * Math.PI) / 180), 1.15) * (1 - 0.75 * cloud);
  if (elevDeg > -6) return urbanGlow + 400 * Math.pow(10, elevDeg / 3) * (1 - 0.5 * cloud);
  return urbanGlow;
}

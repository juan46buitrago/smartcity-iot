import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export type RoadClass = 'motorway' | 'trunk' | 'primary' | 'secondary';

export interface RoadSegment {
  id: string;
  road_name: string;
  road_class: RoadClass;
  lanes: number;
  free_speed_kmh: number;
  length_m: number;
  mid: [number, number];
  geometry: [number, number][];
  osm_way: number;
}

export interface RoadNetwork {
  generated_at: string;
  source: string;
  license: string;
  segments: RoadSegment[];
  gps_route: [number, number][];
}

let cached: RoadNetwork | null = null;

/** Red vial real (OSM) generada por infra/scripts/build-road-segments.mjs. */
export function loadRoadNetwork(): RoadNetwork {
  if (cached) return cached;
  const file = fileURLToPath(new URL('../data/bga-road-segments.json', import.meta.url));
  cached = JSON.parse(readFileSync(file, 'utf8')) as RoadNetwork;
  return cached;
}

const toRad = (d: number) => (d * Math.PI) / 180;
export function haversineM(a: [number, number], b: [number, number]): number {
  const dLat = toRad(b[0] - a[0]);
  const dLon = toRad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

/** Punto a una fracción f (0–1) de la longitud de una polilínea. */
export function pointAlong(line: [number, number][], f: number): [number, number] {
  if (line.length === 1) return line[0]!;
  const lens: number[] = [];
  let total = 0;
  for (let i = 1; i < line.length; i++) {
    const l = haversineM(line[i - 1]!, line[i]!);
    lens.push(l);
    total += l;
  }
  let target = Math.min(1, Math.max(0, f)) * total;
  for (let i = 0; i < lens.length; i++) {
    const l = lens[i]!;
    if (target <= l || i === lens.length - 1) {
      const t = l === 0 ? 0 : Math.min(1, target / l);
      const a = line[i]!;
      const b = line[i + 1]!;
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
    target -= l;
  }
  return line[line.length - 1]!;
}

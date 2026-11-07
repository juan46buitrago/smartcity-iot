/**
 * Catálogo de los 10 dispositivos de SmartCityBGA.
 *
 * Es la fuente única de verdad para backend, simuladores y frontend:
 * variables, unidades, ubicación, procedencia, modos, intervalos y parámetros controlables.
 * Las coordenadas marcadas como "aprox." son ubicaciones representativas en Bucaramanga.
 */

export const DEVICE_IDS = [
  'DEV01', 'DEV02', 'DEV03', 'DEV04', 'DEV05',
  'DEV06', 'DEV07', 'DEV08', 'DEV09', 'DEV10',
] as const;
export type DeviceId = (typeof DEVICE_IDS)[number];

export const SOURCE_TYPES = ['simulated', 'digital_twin', 'api', 'dataset'] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export type DeviceCategory = 'ambiente' | 'movilidad' | 'energia' | 'agua' | 'clima';

export interface GeoLocation {
  lat: number;
  lon: number;
  name: string;
}

export interface VariableSpec {
  key: string;
  label: string;
  unit: string | null;
  kind: 'number' | 'string';
  decimals?: number;
  /** Si admite umbrales de alerta. */
  thresholdable?: boolean;
  /** Si admite calibración (offset). */
  calibratable?: boolean;
}

export interface ParamSpec {
  key: string;
  label: string;
  type: 'number' | 'boolean' | 'enum';
  default: number | boolean | string;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  options?: readonly string[];
  help?: string;
}

export interface Threshold {
  warn_high?: number;
  crit_high?: number;
  warn_low?: number;
  crit_low?: number;
}

export const COMMAND_ACTIONS = [
  'power',
  'set_interval',
  'set_mode',
  'set_params',
  'set_thresholds',
  'calibrate',
  'restart',
  'inject_test_incident',
] as const;
export type CommandAction = (typeof COMMAND_ACTIONS)[number];

export interface DeviceSpec {
  id: DeviceId;
  name: string;
  category: DeviceCategory;
  source_type: SourceType;
  description: string;
  location: GeoLocation;
  mobile?: boolean;
  variables: VariableSpec[];
  modes: readonly string[];
  default_mode: string;
  interval: { min: number; max: number; default: number };
  provenance: { provider: string; synthetic: boolean; notes: string };
  actions: readonly CommandAction[];
  params: ParamSpec[];
  default_thresholds: Record<string, Threshold>;
}

const COMMON: CommandAction[] = ['power', 'set_interval', 'set_mode', 'set_params', 'set_thresholds', 'restart'];

export const DEVICE_CATALOG: Record<DeviceId, DeviceSpec> = {
  DEV01: {
    id: 'DEV01',
    name: 'Estación ambiental',
    category: 'ambiente',
    source_type: 'digital_twin',
    description:
      'Gemelo digital de una estación de temperatura y humedad. Sigue la línea base real de Open-Meteo y añade dinámica local, ruido de sensor y calibración.',
    location: { lat: 7.1194, lon: -73.1222, name: 'Parque Santander (aprox.)' },
    variables: [
      { key: 'temperature', label: 'Temperatura', unit: '°C', kind: 'number', decimals: 1, thresholdable: true, calibratable: true },
      { key: 'humidity', label: 'Humedad relativa', unit: '%', kind: 'number', decimals: 0, thresholdable: true, calibratable: true },
    ],
    modes: ['twin', 'manual'],
    default_mode: 'twin',
    interval: { min: 2, max: 300, default: 10 },
    provenance: { provider: 'Gemelo digital SmartCityBGA (línea base: Open-Meteo)', synthetic: true, notes: 'Valores sintéticos derivados de una línea base real.' },
    actions: [...COMMON, 'calibrate'],
    params: [
      { key: 'noise_amplitude', label: 'Ruido del sensor', type: 'number', default: 0.3, min: 0, max: 3, step: 0.1, unit: '°C' },
      { key: 'manual_temperature', label: 'Temperatura (modo manual)', type: 'number', default: 24, min: -5, max: 45, step: 0.5, unit: '°C' },
      { key: 'manual_humidity', label: 'Humedad (modo manual)', type: 'number', default: 70, min: 0, max: 100, step: 1, unit: '%' },
    ],
    default_thresholds: { temperature: { warn_high: 30, crit_high: 33 }, humidity: { warn_low: 30 } },
  },
  DEV02: {
    id: 'DEV02',
    name: 'Monitor de calidad del aire',
    category: 'ambiente',
    source_type: 'api',
    description: 'Consulta la API de calidad del aire de Open-Meteo (modelo CAMS) para Cabecera del Llano.',
    location: { lat: 7.1121, lon: -73.1095, name: 'Parque San Pío, Cabecera (aprox.)' },
    variables: [
      { key: 'us_aqi', label: 'Índice AQI (EE. UU.)', unit: 'AQI', kind: 'number', decimals: 0, thresholdable: true },
      { key: 'pm2_5', label: 'PM2.5', unit: 'µg/m³', kind: 'number', decimals: 1, thresholdable: true },
      { key: 'pm10', label: 'PM10', unit: 'µg/m³', kind: 'number', decimals: 1, thresholdable: true },
    ],
    modes: ['normal'],
    default_mode: 'normal',
    interval: { min: 300, max: 3600, default: 900 },
    provenance: { provider: 'Open-Meteo Air Quality API (CAMS)', synthetic: false, notes: 'Datos de modelo atmosférico, no de estación terrestre.' },
    actions: ['power', 'set_interval', 'set_thresholds', 'restart'],
    params: [],
    default_thresholds: { us_aqi: { warn_high: 100, crit_high: 150 }, pm2_5: { warn_high: 37, crit_high: 55 } },
  },
  DEV03: {
    id: 'DEV03',
    name: 'Sensor de ruido',
    category: 'ambiente',
    source_type: 'simulated',
    description: 'Sonómetro simulado con perfil horario urbano y eventos acústicos.',
    location: { lat: 7.12259, lon: -73.12837, name: 'Av. Quebrada Seca con Carrera 15' },
    variables: [{ key: 'noise_db', label: 'Nivel de ruido', unit: 'dB(A)', kind: 'number', decimals: 1, thresholdable: true, calibratable: true }],
    modes: ['normal', 'evento', 'silencio'],
    default_mode: 'normal',
    interval: { min: 2, max: 300, default: 10 },
    provenance: { provider: 'Simulador SmartCityBGA', synthetic: true, notes: 'Perfil horario sintético.' },
    actions: [...COMMON, 'calibrate'],
    params: [
      { key: 'base_offset_db', label: 'Ajuste base', type: 'number', default: 0, min: -15, max: 15, step: 0.5, unit: 'dB' },
      { key: 'event_boost_db', label: 'Incremento en modo evento', type: 'number', default: 14, min: 0, max: 30, step: 1, unit: 'dB' },
    ],
    default_thresholds: { noise_db: { warn_high: 70, crit_high: 80 } },
  },
  DEV04: {
    id: 'DEV04',
    name: 'Monitor de incidentes viales',
    category: 'movilidad',
    source_type: 'simulated',
    description:
      'Simulación probabilística de incidentes sobre la red vial real de Bucaramanga (OpenStreetMap). Datos sintéticos: no son reportes reales.',
    location: { lat: 7.1186, lon: -73.1265, name: 'Centro de control de movilidad (virtual)' },
    variables: [
      { key: 'active_incidents', label: 'Incidentes activos', unit: null, kind: 'number', decimals: 0, thresholdable: true },
      { key: 'congestion_index', label: 'Índice de congestión', unit: '%', kind: 'number', decimals: 0, thresholdable: true },
      { key: 'network_speed_kmh', label: 'Velocidad media de red', unit: 'km/h', kind: 'number', decimals: 1, thresholdable: true },
    ],
    modes: ['normal'],
    default_mode: 'normal',
    interval: { min: 10, max: 300, default: 30 },
    provenance: { provider: 'SmartCityBGA traffic simulator (red vial © OpenStreetMap)', synthetic: true, notes: 'Incidentes sintéticos generados por modelo probabilístico.' },
    actions: ['power', 'set_interval', 'set_params', 'set_thresholds', 'restart', 'inject_test_incident'],
    params: [
      { key: 'intensity', label: 'Intensidad de la simulación', type: 'number', default: 1, min: 0, max: 3, step: 0.1, help: 'Multiplicador de la tasa de incidentes.' },
      { key: 'base_rate_per_km_day', label: 'Tasa base (incidentes/km·día)', type: 'number', default: 0.15, min: 0, max: 1, step: 0.01 },
      { key: 'max_concurrent', label: 'Máximo de incidentes simultáneos', type: 'number', default: 3, min: 1, max: 10, step: 1 },
      { key: 'cooldown_min', label: 'Enfriamiento por segmento', type: 'number', default: 45, min: 0, max: 240, step: 5, unit: 'min' },
      { key: 'rain_sensitivity', label: 'Sensibilidad a la lluvia', type: 'number', default: 1, min: 0, max: 2, step: 0.1 },
    ],
    default_thresholds: { active_incidents: { warn_high: 3, crit_high: 5 }, congestion_index: { warn_high: 60, crit_high: 80 } },
  },
  DEV05: {
    id: 'DEV05',
    name: 'Detector de vehículos',
    category: 'movilidad',
    source_type: 'simulated',
    description: 'Lazo inductivo virtual. Comparte el modelo de tráfico con DEV04: los incidentes cercanos reducen flujo y velocidad.',
    location: { lat: 7.12139, lon: -73.11663, name: 'Av. Carrera 27 con Av. Calle 36' },
    variables: [
      { key: 'vehicles_per_min', label: 'Vehículos por minuto', unit: 'veh/min', kind: 'number', decimals: 0, thresholdable: true },
      { key: 'avg_speed_kmh', label: 'Velocidad media', unit: 'km/h', kind: 'number', decimals: 1, thresholdable: true },
    ],
    modes: ['normal'],
    default_mode: 'normal',
    interval: { min: 2, max: 300, default: 10 },
    provenance: { provider: 'Simulador SmartCityBGA', synthetic: true, notes: 'Flujo sintético según perfil horario.' },
    actions: COMMON,
    params: [{ key: 'demand_factor', label: 'Factor de demanda', type: 'number', default: 1, min: 0.1, max: 3, step: 0.1 }],
    default_thresholds: { avg_speed_kmh: { warn_low: 15, crit_low: 8 } },
  },
  DEV06: {
    id: 'DEV06',
    name: 'Rastreador GPS',
    category: 'movilidad',
    source_type: 'api',
    mobile: true,
    description:
      'Ubicación de un vehículo. Fuente gpsmobile.co (solo con autorización) o ruta simulada sobre vías reales. Solo se conservan posición, velocidad, estado y hora.',
    location: { lat: 7.1122, lon: -73.1051, name: 'Vehículo en ruta' },
    variables: [
      { key: 'lat', label: 'Latitud', unit: '°', kind: 'number', decimals: 6 },
      { key: 'lon', label: 'Longitud', unit: '°', kind: 'number', decimals: 6 },
      { key: 'speed_kmh', label: 'Velocidad', unit: 'km/h', kind: 'number', decimals: 0, thresholdable: true },
      { key: 'state', label: 'Estado', unit: null, kind: 'string' },
    ],
    modes: ['normal'],
    default_mode: 'normal',
    interval: { min: 30, max: 600, default: 60 },
    provenance: { provider: 'gpsmobile.co o ruta simulada', synthetic: false, notes: 'La procedencia real se indica en cada mensaje.' },
    actions: ['power', 'set_interval', 'set_params', 'set_thresholds', 'restart'],
    params: [{ key: 'source', label: 'Fuente', type: 'enum', default: 'simulated_route', options: ['simulated_route', 'gpsmobile'] }],
    default_thresholds: { speed_kmh: { warn_high: 60, crit_high: 80 } },
  },
  DEV07: {
    id: 'DEV07',
    name: 'Alumbrado público',
    category: 'energia',
    source_type: 'digital_twin',
    description: 'Gemelo digital de un circuito de alumbrado LED. Calcula la luz ambiente con la posición solar real de Bucaramanga.',
    location: { lat: 7.126, lon: -73.118, name: 'Parque de Los Niños (aprox.)' },
    variables: [
      { key: 'ambient_lux', label: 'Luz ambiente', unit: 'lx', kind: 'number', decimals: 0 },
      { key: 'light_level', label: 'Nivel de iluminación', unit: '%', kind: 'number', decimals: 0 },
      { key: 'power_w', label: 'Potencia', unit: 'W', kind: 'number', decimals: 0, thresholdable: true },
      { key: 'energy_kwh', label: 'Energía acumulada', unit: 'kWh', kind: 'number', decimals: 3 },
    ],
    modes: ['auto', 'manual'],
    default_mode: 'auto',
    interval: { min: 2, max: 300, default: 10 },
    provenance: { provider: 'Gemelo digital SmartCityBGA (modelo solar)', synthetic: true, notes: 'Consumo calculado, no medido.' },
    actions: COMMON,
    params: [
      { key: 'manual_level', label: 'Nivel manual', type: 'number', default: 100, min: 0, max: 100, step: 5, unit: '%' },
      { key: 'lamps', label: 'Luminarias en el circuito', type: 'number', default: 40, min: 1, max: 500, step: 1 },
      { key: 'lamp_watts', label: 'Potencia por luminaria', type: 'number', default: 120, min: 10, max: 400, step: 5, unit: 'W' },
      { key: 'on_lux', label: 'Umbral de encendido', type: 'number', default: 40, min: 1, max: 500, step: 1, unit: 'lx' },
      { key: 'night_dim_pct', label: 'Atenuación de madrugada', type: 'number', default: 60, min: 10, max: 100, step: 5, unit: '%' },
    ],
    default_thresholds: { power_w: { warn_high: 5000 } },
  },
  DEV08: {
    id: 'DEV08',
    name: 'Parqueadero inteligente',
    category: 'movilidad',
    source_type: 'simulated',
    description: 'Parqueadero con llegadas y salidas estocásticas según la hora del día.',
    location: { lat: 7.0996, lon: -73.1072, name: 'Parqueadero C.C. Cacique (aprox.)' },
    variables: [
      { key: 'occupied', label: 'Ocupados', unit: 'espacios', kind: 'number', decimals: 0 },
      { key: 'free_spaces', label: 'Libres', unit: 'espacios', kind: 'number', decimals: 0, thresholdable: true },
      { key: 'occupancy_pct', label: 'Ocupación', unit: '%', kind: 'number', decimals: 0, thresholdable: true },
    ],
    modes: ['normal', 'evento', 'cerrado'],
    default_mode: 'normal',
    interval: { min: 2, max: 300, default: 10 },
    provenance: { provider: 'Simulador SmartCityBGA', synthetic: true, notes: 'Ocupación sintética.' },
    actions: COMMON,
    params: [
      { key: 'capacity', label: 'Capacidad', type: 'number', default: 320, min: 10, max: 2000, step: 10, unit: 'espacios' },
      { key: 'demand_factor', label: 'Factor de demanda', type: 'number', default: 1, min: 0.1, max: 3, step: 0.1 },
    ],
    default_thresholds: { occupancy_pct: { warn_high: 85, crit_high: 95 } },
  },
  DEV09: {
    id: 'DEV09',
    name: 'Sensor de nivel de agua',
    category: 'agua',
    source_type: 'dataset',
    description: 'Nivel de río de la estación automática IDEAM MAJADAS (datos abiertos, datos.gov.co). Publicación con ~1 día de retraso.',
    location: { lat: 7.160278, lon: -73.093056, name: 'Estación IDEAM MAJADAS [23197700]' },
    variables: [
      { key: 'water_level', label: 'Nivel del río', unit: 'm', kind: 'number', decimals: 2, thresholdable: true },
      { key: 'risk', label: 'Riesgo', unit: null, kind: 'string' },
    ],
    modes: ['normal'],
    default_mode: 'normal',
    interval: { min: 600, max: 7200, default: 1800 },
    provenance: { provider: 'IDEAM vía datos.gov.co (dataset bdmn-sqnh)', synthetic: false, notes: 'Observaciones reales; los umbrales de riesgo son ilustrativos.' },
    actions: ['power', 'set_interval', 'set_thresholds', 'restart'],
    params: [],
    default_thresholds: { water_level: { warn_high: 2.0, crit_high: 3.0 } },
  },
  DEV10: {
    id: 'DEV10',
    name: 'Estación meteorológica',
    category: 'clima',
    source_type: 'api',
    description: 'Condiciones meteorológicas actuales de la API Open-Meteo para la zona de la UIS.',
    location: { lat: 7.14, lon: -73.1205, name: 'Universidad Industrial de Santander (aprox.)' },
    variables: [
      { key: 'wind_speed', label: 'Velocidad del viento', unit: 'km/h', kind: 'number', decimals: 1, thresholdable: true },
      { key: 'wind_direction', label: 'Dirección del viento', unit: '°', kind: 'number', decimals: 0 },
      { key: 'pressure', label: 'Presión superficial', unit: 'hPa', kind: 'number', decimals: 1, thresholdable: true },
      { key: 'precipitation', label: 'Precipitación (15 min)', unit: 'mm', kind: 'number', decimals: 1, thresholdable: true },
      { key: 'temperature', label: 'Temperatura', unit: '°C', kind: 'number', decimals: 1, thresholdable: true },
    ],
    modes: ['normal'],
    default_mode: 'normal',
    interval: { min: 300, max: 3600, default: 600 },
    provenance: { provider: 'Open-Meteo Forecast API', synthetic: false, notes: 'Modelo meteorológico con resolución de 15 min.' },
    actions: ['power', 'set_interval', 'set_thresholds', 'restart'],
    params: [],
    default_thresholds: { wind_speed: { warn_high: 40, crit_high: 60 }, precipitation: { warn_high: 5, crit_high: 15 } },
  },
};

export function isDeviceId(v: string): v is DeviceId {
  return (DEVICE_IDS as readonly string[]).includes(v);
}

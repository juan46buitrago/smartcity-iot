/**
 * Cliente de Open-Meteo (sin clave). Licencia de datos CC BY 4.0 — atribución: Open-Meteo.com.
 * Caché en memoria para no repetir llamadas dentro del TTL (respeta el límite de uso gratuito).
 */
import { fetchJson } from '../core/http.js';
import { fromBogotaLocal } from '../core/time.js';

const CACHE_TTL_MS = 5 * 60_000;
const cache = new Map<string, { at: number; data: unknown }>();

async function cached<T>(url: string): Promise<T> {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data as T;
  const data = await fetchJson<T>(url);
  cache.set(url, { at: Date.now(), data });
  return data;
}

export interface WeatherNow {
  observed_at: Date;
  temperature: number;
  humidity: number;
  pressure: number;
  wind_speed: number;
  wind_direction: number;
  precipitation: number;
}

interface ForecastResp {
  current?: {
    time: string;
    temperature_2m: number;
    relative_humidity_2m: number;
    surface_pressure: number;
    wind_speed_10m: number;
    wind_direction_10m: number;
    precipitation: number;
  };
}

export async function currentWeather(lat: number, lon: number): Promise<WeatherNow> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    '&current=temperature_2m,relative_humidity_2m,surface_pressure,wind_speed_10m,wind_direction_10m,precipitation' +
    '&timezone=America%2FBogota';
  const c = (await cached<ForecastResp>(url)).current;
  if (!c || typeof c.temperature_2m !== 'number') throw new Error('Respuesta de Open-Meteo sin datos actuales');
  return {
    observed_at: fromBogotaLocal(c.time),
    temperature: c.temperature_2m,
    humidity: c.relative_humidity_2m,
    pressure: c.surface_pressure,
    wind_speed: c.wind_speed_10m,
    wind_direction: c.wind_direction_10m,
    precipitation: c.precipitation,
  };
}

export interface AirQualityNow {
  observed_at: Date;
  us_aqi: number;
  pm2_5: number;
  pm10: number;
}

interface AqResp {
  current?: { time: string; us_aqi: number; pm2_5: number; pm10: number };
}

export async function currentAirQuality(lat: number, lon: number): Promise<AirQualityNow> {
  const url =
    `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}` +
    '&current=us_aqi,pm2_5,pm10&timezone=America%2FBogota';
  const c = (await cached<AqResp>(url)).current;
  if (!c || typeof c.us_aqi !== 'number') throw new Error('Respuesta de calidad del aire sin datos actuales');
  return { observed_at: fromBogotaLocal(c.time), us_aqi: c.us_aqi, pm2_5: c.pm2_5, pm10: c.pm10 };
}

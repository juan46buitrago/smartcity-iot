import { MapPin } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { fmtNum } from '../lib/format';
import { Card } from './ui';

/**
 * Ilustración de cada dispositivo IoT: qué es físicamente y dónde está.
 * Dibujos esquemáticos en el lenguaje visual de la app (línea fina, verde señal para lo «activo»).
 */
const L = { stroke: 'var(--ink-2)', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' } as const;
const F = 'var(--surface-3)';
const A = 'var(--accent)';

const Skyline = () => (
  <g fill="var(--surface-2)" stroke="var(--line)" strokeWidth="1.5">
    <rect x="8" y="78" width="26" height="50" />
    <rect x="38" y="60" width="22" height="68" />
    <rect x="170" y="70" width="28" height="58" />
    <rect x="202" y="86" width="30" height="42" />
  </g>
);
const Ground = () => <line x1="0" y1="128" x2="240" y2="128" stroke="var(--line-strong)" strokeWidth="2" />;
const Pole = ({ x = 120, top = 40 }: { x?: number; top?: number }) => <line x1={x} y1={top} x2={x} y2="128" {...L} strokeWidth={4} />;
const Waves = ({ cx, cy, r = [14, 24, 34], rot = 0 }: { cx: number; cy: number; r?: number[]; rot?: number }) => (
  <g transform={`rotate(${rot} ${cx} ${cy})`} stroke={A} strokeWidth="2.5" fill="none" strokeLinecap="round">
    {r.map((k, i) => (
      <path key={k} d={`M${cx + k * 0.7} ${cy - k * 0.7}A${k} ${k} 0 0 1 ${cx + k * 0.7} ${cy + k * 0.7}`} opacity={1 - i * 0.28} />
    ))}
  </g>
);
const Road = () => (
  <g>
    <rect x="0" y="104" width="240" height="24" fill="var(--surface-3)" />
    <line x1="0" y1="116" x2="240" y2="116" stroke="var(--ink-3)" strokeWidth="2" strokeDasharray="12 10" />
  </g>
);
const Car = ({ x = 40, y = 96, c = A }: { x?: number; y?: number; c?: string }) => (
  <g transform={`translate(${x} ${y})`}>
    <path d="M0 22v-8c0-3 2-5 5-6l10-1 8-8h24l10 9h12c4 0 6 2 6 6v8z" fill={F} stroke="var(--ink-2)" strokeWidth="2" strokeLinejoin="round" />
    <circle cx="16" cy="24" r="6" fill="var(--bg)" stroke="var(--ink-2)" strokeWidth="2" />
    <circle cx="52" cy="24" r="6" fill="var(--bg)" stroke="var(--ink-2)" strokeWidth="2" />
    <rect x="26" y="2" width="22" height="8" rx="2" fill={c} opacity="0.35" />
  </g>
);

const ART: Record<string, ReactNode> = {
  // Garita meteorológica con termómetro
  DEV01: (
    <g>
      <Skyline />
      <Ground />
      <line x1="96" y1="106" x2="96" y2="128" {...L} strokeWidth={4} />
      <line x1="144" y1="106" x2="144" y2="128" {...L} strokeWidth={4} />
      <rect x="86" y="58" width="68" height="48" rx="4" fill={F} stroke="var(--ink-2)" strokeWidth="2" />
      {[68, 78, 88, 98].map((y) => (
        <line key={y} x1="92" y1={y} x2="148" y2={y} stroke="var(--ink-3)" strokeWidth="2" />
      ))}
      <path d="M82 58l38-14 38 14z" fill="var(--surface-2)" stroke="var(--ink-2)" strokeWidth="2" strokeLinejoin="round" />
      <g transform="translate(186 40)">
        <rect x="0" y="0" width="12" height="46" rx="6" fill="none" stroke="var(--ink-2)" strokeWidth="2" />
        <circle cx="6" cy="54" r="10" fill={A} />
        <rect x="3.5" y="14" width="5" height="40" fill={A} />
      </g>
    </g>
  ),
  // Monitor de aire: caja con partículas
  DEV02: (
    <g>
      <Skyline />
      <Ground />
      <Pole top={60} />
      <rect x="92" y="46" width="56" height="40" rx="6" fill={F} stroke="var(--ink-2)" strokeWidth="2" />
      <circle cx="108" cy="66" r="7" fill="none" stroke={A} strokeWidth="2.5" />
      <rect x="120" y="58" width="20" height="4" rx="2" fill="var(--ink-3)" />
      <rect x="120" y="68" width="14" height="4" rx="2" fill="var(--ink-3)" />
      {[[164, 52, 4], [178, 40, 3], [190, 60, 5], [172, 74, 3], [204, 48, 3], [60, 56, 4], [48, 70, 3], [72, 40, 3]].map(([x, y, r]) => (
        <circle key={`${x}${y}`} cx={x} cy={y} r={r} fill={A} opacity="0.55" />
      ))}
    </g>
  ),
  // Sensor de ruido: micrófono y ondas
  DEV03: (
    <g>
      <Skyline />
      <Ground />
      <Pole top={64} />
      <rect x="104" y="40" width="32" height="30" rx="14" fill={F} stroke="var(--ink-2)" strokeWidth="2" />
      {[48, 55, 62].map((y) => (
        <line key={y} x1="110" y1={y} x2="130" y2={y} stroke="var(--ink-3)" strokeWidth="2" />
      ))}
      <Waves cx={140} cy={55} />
      <g transform="translate(240 0) scale(-1 1)">
        <Waves cx={140} cy={55} />
      </g>
      <rect x="8" y="104" width="224" height="0" />
    </g>
  ),
  // Monitor de incidentes viales: cono y triángulo
  DEV04: (
    <g>
      <Skyline />
      <Road />
      <Car x={30} y={92} />
      <path d="M150 70l24 -42 24 42z" fill="var(--warn-soft)" stroke="var(--warn)" strokeWidth="3" strokeLinejoin="round" />
      <line x1="174" y1="42" x2="174" y2="56" stroke="var(--warn)" strokeWidth="3.5" strokeLinecap="round" />
      <circle cx="174" cy="63" r="2.2" fill="var(--warn)" />
      <path d="M150 112l8-24h8l8 24z" fill="var(--warn)" opacity="0.85" />
      <rect x="146" y="112" width="36" height="5" rx="2" fill="var(--ink-3)" />
    </g>
  ),
  // Detector de vehículos: lazo inductivo bajo el asfalto
  DEV05: (
    <g>
      <Skyline />
      <Road />
      <rect x="88" y="104" width="64" height="24" rx="3" fill="none" stroke={A} strokeWidth="2.5" strokeDasharray="5 4" />
      <Car x={92} y={86} />
      <path d="M120 60v-14m0 0l-6 7m6-7l6 7" fill="none" stroke={A} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <text x="188" y="70" fill="var(--ink-3)" fontSize="11" fontFamily="var(--font-mono)">+1</text>
    </g>
  ),
  // Rastreador GPS: bus con pin y señal
  DEV06: (
    <g>
      <Skyline />
      <Road />
      <g transform="translate(66 74)">
        <rect x="0" y="0" width="108" height="40" rx="8" fill={F} stroke="var(--ink-2)" strokeWidth="2" />
        {[10, 34, 58, 82].map((x) => (
          <rect key={x} x={x} y="7" width="16" height="12" rx="2" fill={A} opacity="0.35" />
        ))}
        <circle cx="24" cy="42" r="7" fill="var(--bg)" stroke="var(--ink-2)" strokeWidth="2" />
        <circle cx="84" cy="42" r="7" fill="var(--bg)" stroke="var(--ink-2)" strokeWidth="2" />
      </g>
      <path d="M120 28a10 10 0 0 1 10 10c0 8-10 20-10 20s-10-12-10-20a10 10 0 0 1 10-10z" fill={A} />
      <circle cx="120" cy="38" r="3.5" fill="var(--bg)" />
      <ellipse cx="120" cy="64" rx="12" ry="3" fill={A} opacity="0.3" />
    </g>
  ),
  // Alumbrado público: farola con cono de luz
  DEV07: (
    <g>
      <Skyline />
      <Ground />
      <path d="M120 128V50q0-14 16-14h26" {...L} strokeWidth={4} />
      <path d="M154 34h22l-4 10h-14z" fill={F} stroke="var(--ink-2)" strokeWidth="2" strokeLinejoin="round" />
      <path d="M156 44l-22 84h62l-18-84z" fill={A} opacity="0.16" />
      <ellipse cx="165" cy="46" rx="9" ry="3" fill={A} />
    </g>
  ),
  // Parqueadero inteligente: cartel P con autos
  DEV08: (
    <g>
      <Skyline />
      <Ground />
      <rect x="40" y="50" width="160" height="78" rx="4" fill={F} stroke="var(--ink-2)" strokeWidth="2" />
      <rect x="100" y="22" width="40" height="30" rx="5" fill={A} />
      <text x="120" y="45" textAnchor="middle" fill="var(--accent-ink)" fontSize="26" fontWeight="800" fontFamily="var(--font-display)">P</text>
      {[54, 98, 142].map((x, i) => (
        <g key={x}>
          <line x1={x - 4} y1="78" x2={x - 4} y2="128" stroke="var(--ink-3)" strokeWidth="2" />
          {i < 2 && <rect x={x + 2} y="96" width="34" height="22" rx="6" fill={A} opacity="0.35" stroke="var(--ink-2)" strokeWidth="2" />}
        </g>
      ))}
    </g>
  ),
  // Nivel de agua: río con regla limnimétrica
  DEV09: (
    <g>
      <Skyline />
      <path d="M0 98q30-10 60 0t60 0 60 0 60 0v30H0z" fill={A} opacity="0.28" />
      <path d="M0 110q30-10 60 0t60 0 60 0 60 0" fill="none" stroke={A} strokeWidth="2.5" opacity="0.7" />
      <rect x="150" y="28" width="16" height="100" rx="2" fill={F} stroke="var(--ink-2)" strokeWidth="2" />
      {[40, 54, 68, 82, 96].map((y) => (
        <line key={y} x1="150" y1={y} x2={y % 28 === 12 ? 160 : 156} y2={y} stroke="var(--ink-2)" strokeWidth="2" />
      ))}
      <line x1="140" y1="98" x2="176" y2="98" stroke="var(--info)" strokeWidth="2.5" strokeDasharray="4 3" />
    </g>
  ),
  // Estación meteorológica: anemómetro, veleta y pluviómetro
  DEV10: (
    <g>
      <Skyline />
      <Ground />
      <Pole top={36} />
      <g transform="translate(120 36)">
        {[0, 120, 240].map((a) => (
          <g key={a} transform={`rotate(${a})`}>
            <line x1="0" y1="0" x2="0" y2="-20" stroke="var(--ink-2)" strokeWidth="2.5" />
            <path d="M-6 -20a6 6 0 0 1 12 0z" fill={A} />
          </g>
        ))}
        <circle r="4" fill="var(--ink-2)" />
      </g>
      <path d="M96 76h48l10 5-10 5H96z" fill={F} stroke="var(--ink-2)" strokeWidth="2" strokeLinejoin="round" />
      <path d="M170 128v-34h22v34" fill={F} stroke="var(--ink-2)" strokeWidth="2" strokeLinejoin="round" />
      <path d="M170 94l11-8 11 8" fill="none" stroke="var(--ink-2)" strokeWidth="2" strokeLinejoin="round" />
      <rect x="170" y="112" width="22" height="16" fill={A} opacity="0.3" />
    </g>
  ),
  // ESP32: placa con chip, sensor y relé
  DEV11: (
    <g>
      <Ground />
      <rect x="40" y="30" width="160" height="92" rx="8" fill="var(--surface-2)" stroke="var(--ink-2)" strokeWidth="2" />
      <rect x="62" y="48" width="54" height="40" rx="4" fill={F} stroke="var(--ink-2)" strokeWidth="2" />
      <text x="89" y="73" textAnchor="middle" fill={A} fontSize="11" fontWeight="700" fontFamily="var(--font-mono)">ESP32</text>
      {[54, 66, 78, 90, 102].map((x) => (
        <g key={x}>
          <line x1={x + 8} y1="48" x2={x + 8} y2="40" stroke="var(--ink-3)" strokeWidth="2" />
          <line x1={x + 8} y1="88" x2={x + 8} y2="96" stroke="var(--ink-3)" strokeWidth="2" />
        </g>
      ))}
      <rect x="136" y="46" width="44" height="26" rx="3" fill="var(--bg)" stroke="var(--ink-2)" strokeWidth="2" />
      <circle cx="148" cy="59" r="5" fill={A} opacity="0.6" />
      <rect x="160" y="54" width="14" height="10" rx="2" fill="var(--surface-3)" stroke="var(--ink-3)" strokeWidth="1.5" />
      <rect x="136" y="82" width="44" height="26" rx="3" fill={F} stroke="var(--ink-2)" strokeWidth="2" />
      <circle cx="190" cy="40" r="4" fill={A} className="live-dot" style={{ color: A }} />
      <path d="M62 104h58" stroke={A} strokeWidth="2.5" strokeLinecap="round" strokeDasharray="2 6" />
    </g>
  ),
  // Estación histórica: archivo de datos
  DEV12: (
    <g>
      <Ground />
      <ellipse cx="86" cy="46" rx="34" ry="11" fill={F} stroke="var(--ink-2)" strokeWidth="2" />
      <path d="M52 46v24c0 6 15 11 34 11s34-5 34-11V46" fill={F} stroke="var(--ink-2)" strokeWidth="2" />
      <path d="M52 70v24c0 6 15 11 34 11s34-5 34-11V70" fill={F} stroke="var(--ink-2)" strokeWidth="2" />
      <path d="M52 94v14c0 6 15 11 34 11s34-5 34-11V94" fill={F} stroke="var(--ink-2)" strokeWidth="2" />
      <polyline points="136,98 152,78 166,88 184,52 204,66" fill="none" stroke={A} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <line x1="132" y1="112" x2="212" y2="112" stroke="var(--ink-3)" strokeWidth="2" />
    </g>
  ),
};

export function DeviceIllustration({ id, className }: { id: string; className?: string }) {
  return (
    <svg viewBox="0 0 240 140" role="img" aria-label={`Ilustración de ${id}`} className={className}>
      {ART[id] ?? <Ground />}
    </svg>
  );
}

/** Tarjeta «qué es y dónde está» de un dispositivo, con acceso al mapa centrado en él. */
export function DeviceScene({ id, kind, description, place, lat, lon }: { id: string; kind: string; description: string; place: string; lat: number; lon: number }) {
  return (
    <Card className="rise overflow-hidden" style={{ ['--i' as string]: 1 }}>
      <div className="grid gap-0 sm:grid-cols-[minmax(0,260px)_1fr]">
        <div className="border-b border-line bg-surface-2 p-3 sm:border-r sm:border-b-0">
          <DeviceIllustration id={id} className="h-auto w-full" />
        </div>
        <div className="flex flex-col justify-center gap-2 px-5 py-4">
          <p className="label">Qué representa</p>
          <p className="text-[14.5px] text-ink-2">{kind}</p>
          <p className="label mt-2">Dónde está</p>
          <p className="flex items-start gap-1.5 text-[14.5px]">
            <MapPin className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
            <span>
              {place} · <span className="code">{fmtNum(lat, 4)}, {fmtNum(lon, 4)}</span>
            </span>
          </p>
          <Link to={`/mapa?dev=${id}`} className="mt-1 inline-flex w-fit text-[13.5px] font-semibold text-accent underline-offset-2 hover:underline">
            Ver en el mapa →
          </Link>
          <p className="sr-only">{description}</p>
        </div>
      </div>
    </Card>
  );
}

/** Qué equipo físico representa cada dispositivo y de dónde salen sus datos (sin presentar lo simulado como medido). */
export const DEVICE_KIND: Record<string, string> = {
  DEV01: 'Gemelo digital de una caseta meteorológica con termómetro e higrómetro. Sigue la línea base real de Open-Meteo.',
  DEV02: 'Monitor de calidad del aire (AQI). Sus datos vienen del modelo CAMS vía Open-Meteo, no de un sensor físico en el parque.',
  DEV03: 'Sonómetro: un micrófono sobre poste que mide decibeles. Aquí está simulado con un perfil horario urbano.',
  DEV04: 'Vigilante de la vía simulado sobre calles reales de OpenStreetMap. Los incidentes son sintéticos, no reportes reales.',
  DEV05: 'Lazo inductivo bajo el asfalto que cuenta vehículos. Es virtual y comparte el modelo de tráfico con DEV04.',
  DEV06: 'Rastreador GPS de un vehículo: posición real (con autorización) o una ruta simulada sobre vías reales.',
  DEV07: 'Gemelo digital de un circuito de alumbrado LED; la luz ambiente sale de la posición solar real de Bucaramanga.',
  DEV08: 'Parqueadero con llegadas y salidas simuladas según la hora del día.',
  DEV09: 'Regla de nivel del río. Datos reales de la estación automática IDEAM MAJADAS, con cerca de un día de retraso.',
  DEV10: 'Estación meteorológica. Muestra las condiciones actuales de Open-Meteo para la zona de la UIS.',
  DEV11: 'Placa ESP32 con sensor DHT22, fotorresistencia y relé. Firmware real, ejecutado en Wokwi o en un ESP32 físico.',
  DEV12: 'Archivo histórico: reproduce un dataset ERA5 de noviembre de 2025 como referencia comparable con DEV01 y DEV10.',
};

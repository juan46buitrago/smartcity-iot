/**
 * Voz de Nodo (TTS) con la Web Speech API del navegador: sin servidor, sin costo y sin enviar texto a terceros.
 * Elige una voz en español (es-CO si existe), limpia el formato antes de leer y avisa cuándo habla.
 */
import { useSyncExternalStore } from 'react';

const KEY = 'scbga.voz';
const supported = typeof window !== 'undefined' && 'speechSynthesis' in window;

let enabled = false;
let speaking = false;
try {
  enabled = supported && localStorage.getItem(KEY) === '1';
} catch {
  /* sin almacenamiento */
}
const subs = new Set<() => void>();
let snap = { enabled, speaking, supported };
const refresh = () => {
  snap = { enabled, speaking, supported };
  subs.forEach((f) => f());
};

function pickVoice(): SpeechSynthesisVoice | undefined {
  const vs = window.speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith('es'));
  return vs.find((v) => /es[-_]CO/i.test(v.lang)) ?? vs.find((v) => /natural|online/i.test(v.name)) ?? vs.find((v) => /es[-_](MX|US|419)/i.test(v.lang)) ?? vs[0];
}

/** Quita viñetas, asteriscos y emojis para que la voz lea solo palabras. */
export function plainForSpeech(text: string) {
  return text
    .replace(/[*_`#>]/g, '')
    .replace(/^\s*[•\-–]\s*/gm, '')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/\s*\n+\s*/g, '. ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function speak(text: string) {
  if (!supported || !enabled) return;
  const t = plainForSpeech(text).slice(0, 600);
  if (!t) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(t);
  const v = pickVoice();
  if (v) u.voice = v;
  u.lang = v?.lang ?? 'es-CO';
  u.rate = 1.03;
  u.pitch = 1.08;
  u.onstart = () => {
    speaking = true;
    refresh();
  };
  u.onend = u.onerror = () => {
    speaking = false;
    refresh();
  };
  window.speechSynthesis.speak(u);
}

export function stopSpeaking() {
  if (!supported) return;
  window.speechSynthesis.cancel();
  speaking = false;
  refresh();
}

export function setVoiceEnabled(v: boolean) {
  enabled = v && supported;
  try {
    localStorage.setItem(KEY, enabled ? '1' : '0');
  } catch {
    /* sin almacenamiento */
  }
  if (!enabled) stopSpeaking();
  else refresh();
}

export function useSpeech() {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => {
        subs.delete(f);
      };
    },
    () => snap,
  );
}

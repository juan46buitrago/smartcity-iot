import type { NodoMood } from '../components/Nodo';
import { useAssistant } from './assistant';
import { useLive } from './live';
import { useSpeech } from './speech';

/** Humor de Nodo según lo que pasa: piensa al consultar, habla al leer en voz alta, se alarma con alertas abiertas. */
export function useNodoMood(): { mood: NodoMood; alerts: number } {
  const { busy } = useAssistant();
  const { speaking } = useSpeech();
  const { alerts } = useLive();
  const open = alerts.filter((a) => a.status === 'abierta').length;
  const mood: NodoMood = busy ? 'thinking' : speaking ? 'talking' : open > 0 ? 'alert' : 'idle';
  return { mood, alerts: open };
}

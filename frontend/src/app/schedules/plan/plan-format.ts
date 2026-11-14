import { PlanEvent } from '../schedule.model';

/** HH:MM dans le fuseau de la maison (l'ISO du backend porte déjà cet offset). */
export function planTime(ev: PlanEvent): string {
  return ev.time.slice(11, 16);
}

export function planActionLabel(ev: PlanEvent): string {
  if (ev.mode === 'solar') {
    return ev.action === 'close' ? 'Fermeture BSO' : 'Ouverture BSO';
  }
  switch (ev.action) {
    case 'open': return 'Ouverture';
    case 'close': return 'Fermeture';
    default: return `Niveau ${ev.level ?? '?'}%`;
  }
}

export function planDevicesLabel(ev: PlanEvent): string {
  const n = ev.device_names.length;
  if (n === 0) return 'Aucun volet';
  return n <= 3 ? ev.device_names.join(', ') : `${n} volets`;
}

export function localIsoDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

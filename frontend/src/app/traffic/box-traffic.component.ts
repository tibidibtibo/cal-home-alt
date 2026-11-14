import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { UiCardComponent, UiButtonComponent, UiBadgeComponent } from '../ui';
import {
  DeviceService,
  BoxQueueSnapshot,
  BoxQueueItem,
  BoxActiveItem,
  BoxHistoryItem,
  BoxQueueStats,
} from '../devices/device.service';
import { Subscription } from 'rxjs';

const EMPTY_STATS: BoxQueueStats = {
  queued_count: 0,
  in_progress: 0,
  last_response_ms: null,
  last_ok: null,
  avg_response_ms: null,
  min_response_ms: null,
  max_response_ms: null,
  total_requests: 0,
  total_errors: 0,
  min_interval_ms: 400,
};

@Component({
  selector: 'app-box-traffic',
  standalone: true,
  imports: [CommonModule, UiCardComponent, UiButtonComponent, UiBadgeComponent],
  templateUrl: './box-traffic.component.html',
  styles: [`
    .page-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; flex-wrap: wrap; margin-bottom: 1.5rem; }
    .page-title { margin: 0; font-size: 1.5rem; font-weight: 700; color: var(--color-text); }
    .subtitle { margin: 0.25rem 0 0; font-size: 0.85rem; color: var(--color-text-muted); }
    .page-actions { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }

    .kpi-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1rem; margin-bottom: 1.5rem; }
    .kpi-card {
      padding: 1rem 1.2rem; border-radius: var(--radius-lg, 0.75rem);
      border: 1px solid var(--color-border, #e5e7eb); background: var(--color-surface, #fff);
      display: flex; flex-direction: column; gap: 0.35rem;
    }
    .kpi-label { font-size: 0.78rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--color-text-muted); display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; }
    .kpi-value { font-size: 1.75rem; font-weight: 700; color: var(--color-text); font-variant-numeric: tabular-nums; line-height: 1.15; }
    .kpi-value small { font-size: 0.95rem; font-weight: 600; color: var(--color-text-muted); }
    .kpi-sub { font-size: 0.78rem; color: var(--color-text-muted); font-variant-numeric: tabular-nums; }

    .section-gap { margin-bottom: 1.5rem; display: block; }

    .active-banner {
      display: flex; justify-content: space-between; align-items: center; gap: 1rem; flex-wrap: wrap;
      padding: 0.85rem 1rem; margin-bottom: 1rem; border-radius: var(--radius-md, 0.5rem);
      border: 1px solid var(--color-primary, #6366f1); background: rgba(var(--color-primary-rgb, 99, 102, 241), 0.08);
    }
    .active-main { display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap; }
    .pulse-dot {
      width: 0.65rem; height: 0.65rem; border-radius: 50%; background: var(--color-primary, #6366f1);
      box-shadow: 0 0 0 4px rgba(var(--color-primary-rgb, 99, 102, 241), 0.2);
    }
    .active-meta { display: flex; align-items: center; gap: 1rem; font-size: 0.85rem; color: var(--color-text-muted); font-variant-numeric: tabular-nums; }

    .idle-box {
      padding: 1.5rem 1rem; text-align: center; color: var(--color-text-muted); font-size: 0.9rem;
      border: 1px dashed var(--color-border, #d1d5db); border-radius: var(--radius-md, 0.5rem);
    }

    .table-wrap { overflow-x: auto; }
    .traffic-table { width: 100%; border-collapse: collapse; font-size: 0.85rem; font-variant-numeric: tabular-nums; }
    .traffic-table th, .traffic-table td { padding: 0.6rem 0.75rem; text-align: left; border-bottom: 1px solid var(--color-border, #e5e7eb); vertical-align: middle; }
    .traffic-table th { color: var(--color-text-muted); font-weight: 600; text-transform: uppercase; font-size: 0.73rem; letter-spacing: 0.03em; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 0.8rem; }
    .muted { color: var(--color-text-muted); }

    .duration-cell { display: flex; align-items: center; gap: 0.6rem; min-width: 140px; }
    .duration-bar-bg { flex: 1; max-width: 90px; height: 6px; border-radius: 999px; background: var(--color-border, #e5e7eb); overflow: hidden; }
    .duration-bar-fill { height: 100%; border-radius: 999px; background: var(--color-primary, #6366f1); }
    .duration-bar-fill--warn { background: #f59e0b; }
    .duration-bar-fill--err { background: #dc2626; }
    .error-text { color: var(--color-danger, #dc2626); font-size: 0.78rem; display: block; margin-top: 0.15rem; }
  `]
})
export class BoxTrafficComponent implements OnInit, OnDestroy {
  queued: BoxQueueItem[] = [];
  active: BoxActiveItem | null = null;
  history: BoxHistoryItem[] = [];
  stats: BoxQueueStats = { ...EMPTY_STATS };
  loading = false;

  private subs = new Subscription();
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private deviceService: DeviceService,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.deviceService.startSSE();
    this.subs.add(
      this.deviceService.getBoxQueue().subscribe(snap => {
        if (snap) {
          this.applySnapshot(snap);
        }
      })
    );
    this.refresh();
    // Rafraîchit les compteurs d'attente / temps écoulé toutes les secondes (lecture mémoire côté backend, zéro appel à la box).
    this.pollTimer = setInterval(() => {
      this.deviceService.loadBoxQueue().subscribe({ error: () => {} });
    }, 1000);
  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  refresh(): void {
    this.loading = true;
    this.deviceService.loadBoxQueue().subscribe({
      next: snap => {
        this.applySnapshot(snap);
        this.loading = false;
        this.cdr.detectChanges();
      },
      error: () => {
        this.loading = false;
        this.cdr.detectChanges();
      },
    });
  }

  clearHistory(): void {
    this.deviceService.clearBoxQueueHistory().subscribe();
  }

  private applySnapshot(snap: BoxQueueSnapshot): void {
    this.queued = snap.queued ?? [];
    this.active = snap.active ?? null;
    this.history = snap.history ?? [];
    this.stats = snap.stats ?? { ...EMPTY_STATS };
    this.cdr.detectChanges();
  }

  formatOp(op: string): string {
    switch (op) {
      case 'getObjects': return 'Lecture état (getObjects)';
      case 'OPEN': return 'Ouverture (OPEN)';
      case 'CLOSE': return 'Fermeture (CLOSE)';
      case 'STOP': return 'Arrêt (STOP)';
      case 'LEVEL': return 'Position (LEVEL)';
      case 'TILT': return 'Inclinaison (TILT)';
      case 'ping': return 'Ping HTTP';
      case 'test': return 'Test connexion';
      default: return op;
    }
  }

  formatTime(iso: string | null | undefined): string {
    if (!iso) return '—';
    const d = new Date(iso);
    return isNaN(d.getTime()) ? iso : d.toLocaleTimeString('fr-FR', { hour12: false });
  }

  getResponseBadgeType(ms: number | null, ok: boolean | null = true): 'success' | 'warning' | 'error' | 'neutral' {
    if (ok === false) return 'error';
    if (ms === null) return 'neutral';
    if (ms < 500) return 'success';
    if (ms <= 1500) return 'warning';
    return 'error';
  }

  getResponseLabel(ms: number | null, ok: boolean | null = true): string {
    if (ok === false) return 'Erreur';
    if (ms === null) return 'Aucune mesure';
    if (ms < 500) return 'Rapide';
    if (ms <= 1500) return 'Modéré';
    return 'Lent';
  }

  getBarWidth(ms: number): number {
    const ref = Math.max(this.stats.max_response_ms || 1000, 500);
    return Math.min(100, Math.max(6, Math.round((ms / ref) * 100)));
  }
}

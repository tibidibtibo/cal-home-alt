import { Component, Input, Output, EventEmitter, Optional, OnChanges, OnDestroy, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { UiButtonComponent, UiBadgeComponent } from '../../ui';
import { DeviceState } from '../../devices/device.model';
import { DeviceService } from '../../devices/device.service';
import { NotificationService } from '../../shared/notification.service';

const MOVE_TIMEOUT_MS = 90000;

@Component({
  selector: 'app-shutter-panel',
  standalone: true,
  imports: [CommonModule, UiButtonComponent, UiBadgeComponent],
  templateUrl: './shutter-panel.component.html',
  styles: [`
    .panel-overlay {
      position: fixed; inset: 0;
      background: rgba(0, 0, 0, 0.45); z-index: 1000;
      display: flex; align-items: center; justify-content: center;
      padding: 1rem;
    }
    .panel-content {
      width: 100%; max-width: 440px; max-height: 90vh; overflow-y: auto;
      box-sizing: border-box;
      background: var(--color-background, #fff);
      border: 1px solid var(--color-border, #e5e7eb);
      border-radius: var(--radius-lg, 0.75rem);
      box-shadow: 0 12px 36px rgba(0, 0, 0, 0.22);
      padding: 1.5rem; display: flex; flex-direction: column; gap: 1.25rem;
    }
    .panel-header { display: flex; justify-content: space-between; align-items: center; gap: 0.75rem; }
    .panel-title { margin: 0; font-size: 1.15rem; font-weight: 700; color: var(--color-text); }
    .header-actions { display: inline-flex; align-items: center; gap: 0.35rem; }
    .icon-btn {
      display: inline-flex; align-items: center; justify-content: center;
      width: 2rem; height: 2rem; border: 1px solid var(--color-border, #d1d5db);
      border-radius: var(--radius-md, 0.5rem); background: transparent;
      color: var(--color-text-muted); cursor: pointer; font-size: 0.85rem;
      transition: color 0.15s, border-color 0.15s, background 0.15s;
    }
    .icon-btn:hover:not(:disabled) { color: var(--color-primary); border-color: var(--color-primary); background: rgba(var(--color-primary-rgb, 99, 102, 241), 0.08); }
    .icon-btn:disabled { opacity: 0.45; cursor: not-allowed; }
    .shutter-controls { display: flex; flex-direction: column; gap: 1.15rem; }
    .status-block { display: flex; flex-direction: column; gap: 0.3rem; }
    .level-row { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; }
    .level-value { font-size: 1.9rem; font-weight: 700; line-height: 1; color: var(--color-text); font-variant-numeric: tabular-nums; }
    .level-value small { font-size: 1rem; font-weight: 600; color: var(--color-text-muted); }
    .moving {
      display: inline-flex; align-items: center; gap: 0.35rem; min-height: 1.1rem;
      font-size: 0.78rem; line-height: 1.1rem; color: var(--color-primary);
      visibility: hidden;
    }
    .moving--on { visibility: visible; }
    .ctrl-row { display: flex; flex-direction: column; gap: 0.5rem; }
    .ctrl-label { font-size: 0.8rem; color: var(--color-text-muted); font-weight: 500; }
    .action-buttons { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.6rem; }
    .act {
      display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.35rem;
      height: 3.6rem; padding: 0; font: inherit; font-size: 0.82rem; font-weight: 600;
      color: var(--color-text); background: var(--color-surface-alt);
      border: 1px solid var(--color-border); border-radius: var(--radius-lg); cursor: pointer;
      box-shadow: var(--shadow-sm);
      transition: transform 0.12s, box-shadow 0.12s, color 0.15s, border-color 0.15s, background 0.15s, opacity 0.15s;
    }
    .act i { font-size: 1rem; }
    .act--move:hover:not(:disabled) {
      color: var(--color-primary); border-color: var(--color-primary);
      background: rgba(var(--color-primary-rgb), 0.1); transform: translateY(-1px); box-shadow: var(--shadow-md);
    }
    .act--stop { color: var(--color-error); background: var(--color-error-bg); border-color: transparent; }
    .act--stop:hover:not(:disabled) { border-color: var(--color-error); transform: translateY(-1px); box-shadow: var(--shadow-md); }
    .act--stop-live { background: var(--color-error); color: #fff; animation: stop-pulse 1.4s ease-in-out infinite; }
    .act--stop-live:hover:not(:disabled) { border-color: transparent; }
    .act:active:not(:disabled) { transform: translateY(0) scale(0.97); box-shadow: var(--shadow-sm); }
    .act:focus-visible, .chip:focus-visible, .icon-btn:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
    .act:disabled { opacity: 0.4; cursor: not-allowed; box-shadow: none; }
    @keyframes stop-pulse {
      0%, 100% { box-shadow: 0 0 0 0 rgba(198, 40, 40, 0.45); }
      50% { box-shadow: 0 0 0 6px rgba(198, 40, 40, 0); }
    }
    .presets { display: flex; flex-wrap: wrap; gap: 0.5rem; }
    .chip {
      display: inline-flex; align-items: center; gap: 0.35rem;
      padding: 0.4rem 0.85rem; font: inherit; font-size: 0.82rem; font-weight: 600;
      border-radius: 999px; cursor: pointer;
      border: 1px solid var(--color-border);
      background: var(--color-surface-alt); color: var(--color-text);
      transition: transform 0.12s, color 0.15s, border-color 0.15s, background 0.15s, opacity 0.15s;
    }
    .chip:hover:not(:disabled) { color: var(--color-primary); border-color: var(--color-primary); background: rgba(var(--color-primary-rgb), 0.1); transform: translateY(-1px); }
    .chip:active:not(:disabled) { transform: scale(0.97); }
    .chip:disabled { opacity: 0.4; cursor: not-allowed; }
    .chip--sun { color: var(--color-warning); background: var(--color-warning-bg); border-color: transparent; }
    .chip--sun:hover:not(:disabled) { color: var(--color-warning); border-color: var(--color-warning); background: var(--color-warning-bg); }
    .chip--fav { border-style: dashed; }
    input[type=range] { width: 100%; accent-color: var(--color-primary); cursor: pointer; height: 1.5rem; margin: 0; }
    input[type=range]:disabled { cursor: not-allowed; opacity: 0.6; }
  `]
})
export class ShutterPanelComponent implements OnChanges, OnDestroy {
  @Input() shutter: DeviceState | null = null;
  @Output() close = new EventEmitter<void>();

  dragLevel: number | null = null;
  private pending = 0;
  private epoch = 0;
  refreshing = false;
  targetLevel: number | null = null;
  private moveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private deviceService: DeviceService,
    private notif: NotificationService,
    @Optional() private router: Router | null,
  ) {}

  /** Une commande est en cours d'envoi. */
  get busy(): boolean {
    return this.pending > 0;
  }

  /** Action en cours (envoi ou mouvement) : tout est bloqué, sauf Stop. */
  get locked(): boolean {
    return this.busy || this.moving;
  }

  get level(): number {
    return this.dragLevel ?? this.shutter?.level ?? 0;
  }

  get sunLevel(): number {
    return this.shutter?.sun_level ?? 25;
  }

  get moving(): boolean {
    return this.targetLevel !== null && this.shutter?.level !== this.targetLevel;
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['shutter']) {
      if (!this.shutter) {
        this.dragLevel = null;
        this.clearMove();
      } else if (this.targetLevel !== null && this.shutter.level === this.targetLevel) {
        this.clearMove();
      }
    }
  }

  ngOnDestroy(): void {
    if (this.moveTimer) clearTimeout(this.moveTimer);
  }

  onOpen(): void { if (this.shutter) this.send(this.deviceService.open(this.shutter.id), 100, 'ouvrir'); }
  onStop(): void { if (this.shutter) this.send(this.deviceService.stop(this.shutter.id), null, 'arrêter', true); }
  onClose(): void { if (this.shutter) this.send(this.deviceService.close(this.shutter.id), 0, 'fermer'); }
  setLevel(level: number): void { if (this.shutter) this.send(this.deviceService.setLevel(this.shutter.id, level), level, 'régler'); }

  onLevelInput(event: Event): void {
    this.dragLevel = (event.target as HTMLInputElement).valueAsNumber;
  }

  onLevelChange(event: Event): void {
    if (this.shutter) {
      const level = (event.target as HTMLInputElement).valueAsNumber;
      this.dragLevel = null;
      this.setLevel(level);
    }
  }

  onTiltChange(event: Event): void {
    if (this.shutter) {
      const angle = (event.target as HTMLInputElement).valueAsNumber;
      this.deviceService.setTilt(this.shutter.id, angle).subscribe({
        error: () => this.notif.error(this.shutter!.name, "Impossible de régler l'inclinaison."),
      });
    }
  }

  onRefresh(): void {
    if (!this.shutter || this.refreshing) return;
    this.refreshing = true;
    this.deviceService.refresh().subscribe({
      next: (res) => {
        this.refreshing = false;
        this.dragLevel = null;
        if (!res.box_reachable) {
          this.notif.warning('Box injoignable', "Impossible de récupérer le statut réel depuis la box.");
        }
      },
      error: () => {
        this.refreshing = false;
        this.notif.error(this.shutter?.name ?? 'Volet', "Impossible d'actualiser le statut.");
      },
    });
  }

  goToConfig(): void {
    if (!this.shutter?.db_id || !this.router) return;
    const dbId = this.shutter.db_id;
    this.close.emit();
    this.router.navigate(['/shutter-config'], { queryParams: { edit: dbId } });
  }

  getStatusType(): 'success' | 'warning' | 'info' {
    const lvl = this.shutter?.level ?? 0;
    if (lvl === 100) return 'success';
    if (lvl === 0) return 'warning';
    return 'info';
  }

  getStatusLabel(): string {
    const lvl = this.shutter?.level ?? 0;
    if (lvl === 100) return 'Ouvert';
    if (lvl === 0) return 'Fermé';
    return 'Entrouvert';
  }

  private send(request: ReturnType<DeviceService['open']>, target: number | null, verb: string, isStop = false): void {
    if (!this.shutter || (this.locked && !isStop)) return;
    if (isStop) this.epoch++;
    const myEpoch = this.epoch;
    this.pending++;
    const name = this.shutter.name;
    const currentLevel = this.shutter.level;
    request.subscribe({
      next: () => {
        this.pending--;
        this.clearMove();
        if (target !== null && target !== currentLevel && myEpoch === this.epoch) {
          this.targetLevel = target;
          this.moveTimer = setTimeout(() => this.clearMove(), MOVE_TIMEOUT_MS);
        }
      },
      error: () => {
        this.pending--;
        this.notif.error(name, `Impossible de ${verb} : la box n'a pas répondu.`);
      },
    });
  }

  private clearMove(): void {
    this.targetLevel = null;
    if (this.moveTimer) { clearTimeout(this.moveTimer); this.moveTimer = null; }
  }
}

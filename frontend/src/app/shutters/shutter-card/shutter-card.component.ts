import { Component, EventEmitter, Input, OnChanges, OnDestroy, Output, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { UiCardComponent, UiBadgeComponent } from '../../ui';
import { DeviceState } from '../../devices/device.model';
import { DeviceService } from '../../devices/device.service';
import { NotificationService } from '../../shared/notification.service';
import { RoomOption } from '../shutter-config.model';

/** Au-delà, on arrête d'annoncer un mouvement en cours (volet bloqué, commande perdue…). */
const MOVE_TIMEOUT_MS = 90000;

@Component({
  selector: 'app-shutter-card',
  standalone: true,
  imports: [CommonModule, RouterLink, UiCardComponent, UiBadgeComponent],
  templateUrl: './shutter-card.component.html',
  styles: [`
    .shutter-controls { display: flex; flex-direction: column; gap: 0.9rem; }
    .level-row { display: flex; align-items: baseline; justify-content: space-between; gap: 0.5rem; }
    .level-value { font-size: 1.9rem; font-weight: 700; line-height: 1; color: var(--color-text); font-variant-numeric: tabular-nums; }
    .level-value small { font-size: 1rem; font-weight: 600; color: var(--color-text-muted); }
    .head-actions { display: inline-flex; align-items: center; gap: 0.5rem; }
    .gear { color: var(--color-text-muted); font-size: 0.95rem; padding: 0.25rem; border-radius: 6px; text-decoration: none; }
    .gear:hover { color: var(--color-primary); }
    .gear:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
    .moving { font-size: 0.78rem; color: var(--color-primary); display: inline-flex; align-items: center; gap: 0.35rem; }
    input[type=range] { width: 100%; accent-color: var(--color-primary); cursor: pointer; height: 1.5rem; margin: 0; }
    input[type=range]:disabled { cursor: not-allowed; opacity: 0.6; }
    .actions { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.5rem; }
    .act {
      display: inline-flex; align-items: center; justify-content: center; gap: 0.4rem;
      min-height: 2.5rem; padding: 0.4rem 0.5rem; font: inherit; font-size: 0.85rem; font-weight: 600;
      border: 1px solid var(--color-border, #d1d5db); border-radius: var(--radius-md, 0.5rem);
      background: var(--color-surface, #fff); color: var(--color-text); cursor: pointer; transition: background 0.15s, border-color 0.15s;
    }
    .act:hover:not(:disabled) { border-color: var(--color-primary); background: rgba(var(--color-primary-rgb, 99, 102, 241), 0.08); }
    .act:focus-visible, .chip:focus-visible, input[type=range]:focus-visible, select:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
    .act:disabled { opacity: 0.55; cursor: wait; }
    .act--stop { color: var(--color-danger, #dc2626); }
    .presets { display: flex; gap: 0.4rem; flex-wrap: wrap; align-items: center; }
    .presets-label { font-size: 0.75rem; color: var(--color-text-muted); margin-right: 0.15rem; }
    .chip {
      padding: 0.2rem 0.65rem; font: inherit; font-size: 0.78rem; font-weight: 600; border-radius: 999px; cursor: pointer;
      border: 1px solid var(--color-border, #d1d5db); background: transparent; color: var(--color-text-muted);
    }
    .chip:hover:not(:disabled) { color: var(--color-primary); border-color: var(--color-primary); }
    .chip:disabled { opacity: 0.45; cursor: not-allowed; }
    .chip--sun { color: #d97706; border-color: rgba(217, 119, 6, 0.4); }
    .chip--sun:hover:not(:disabled) { color: #b45309; border-color: #d97706; }
    .tilt-row { display: flex; flex-direction: column; gap: 0.25rem; }
    .label { font-size: 0.78rem; color: var(--color-text-muted); font-weight: 500; }
    .next-action { font-size: 0.75rem; color: var(--color-text-muted); display: flex; gap: 0.4rem; align-items: baseline; }
    .assign { display: flex; flex-direction: column; gap: 0.25rem; padding-top: 0.6rem; border-top: 1px dashed var(--color-border, #d1d5db); }
    .assign select {
      padding: 0.4rem 0.6rem; font: inherit; font-size: 0.85rem; border: 1px solid var(--color-border, #d1d5db);
      border-radius: 6px; background: var(--color-surface, #fff); color: var(--color-text);
    }
  `]
})
export class ShutterCardComponent implements OnChanges, OnDestroy {
  @Input() shutter!: DeviceState;
  /** Pièces proposées pour classer un volet « non assigné » (liste vide : pas de sélecteur). */
  @Input() rooms: RoomOption[] = [];
  @Output() roomAssigned = new EventEmitter<{ shutter: DeviceState; roomId: number }>();

  /** Niveau affiché pendant que le curseur est tiré (avant l'envoi). */
  dragLevel: number | null = null;
  /** Commande en cours d'envoi au serveur. */
  busy = false;
  /** Niveau visé par la dernière commande, tant que le volet n'y est pas arrivé. */
  targetLevel: number | null = null;
  private moveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private deviceService: DeviceService, private notif: NotificationService) {}

  get level(): number {
    return this.dragLevel ?? this.shutter.level ?? 0;
  }

  get sunLevel(): number {
    return this.shutter.sun_level ?? 25;
  }

  get moving(): boolean {
    return this.targetLevel !== null && this.shutter.level !== this.targetLevel;
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['shutter'] && this.targetLevel !== null && this.shutter.level === this.targetLevel) {
      this.clearMove();
    }
  }

  ngOnDestroy(): void {
    if (this.moveTimer) clearTimeout(this.moveTimer);
  }

  open(): void { this.send(this.deviceService.open(this.shutter.id), 100, 'ouvrir'); }
  close(): void { this.send(this.deviceService.close(this.shutter.id), 0, 'fermer'); }
  stop(): void { this.send(this.deviceService.stop(this.shutter.id), null, 'arrêter'); }
  setLevel(level: number): void { this.send(this.deviceService.setLevel(this.shutter.id, level), level, 'régler'); }

  onSliderInput(event: Event): void {
    this.dragLevel = (event.target as HTMLInputElement).valueAsNumber;
  }

  onSliderChange(event: Event): void {
    const level = (event.target as HTMLInputElement).valueAsNumber;
    this.dragLevel = null;
    this.setLevel(level);
  }

  onTiltChange(event: Event): void {
    const angle = (event.target as HTMLInputElement).valueAsNumber;
    this.deviceService.setTilt(this.shutter.id, angle).subscribe({
      error: () => this.notif.error(this.shutter.name, "Impossible de régler l'inclinaison."),
    });
  }

  onAssign(event: Event): void {
    const roomId = Number((event.target as HTMLSelectElement).value);
    if (roomId) this.roomAssigned.emit({ shutter: this.shutter, roomId });
  }

  getStatusType(): 'success' | 'warning' | 'info' {
    if (this.shutter.level === 100) return 'success';
    if (this.shutter.level === 0) return 'warning';
    return 'info';
  }

  getStatusLabel(): string {
    if (this.shutter.level === 100) return 'Ouvert';
    if (this.shutter.level === 0) return 'Fermé';
    return 'Entrouvert';
  }

  private send(request: ReturnType<DeviceService['open']>, target: number | null, verb: string): void {
    if (this.busy) return;
    this.busy = true;
    request.subscribe({
      next: () => {
        this.busy = false;
        this.clearMove();
        if (target !== null && target !== this.shutter.level) {
          this.targetLevel = target;
          this.moveTimer = setTimeout(() => this.clearMove(), MOVE_TIMEOUT_MS);
        }
      },
      error: () => {
        this.busy = false;
        this.notif.error(this.shutter.name, `Impossible de ${verb} : la box n'a pas répondu.`);
      },
    });
  }

  private clearMove(): void {
    this.targetLevel = null;
    if (this.moveTimer) { clearTimeout(this.moveTimer); this.moveTimer = null; }
  }
}

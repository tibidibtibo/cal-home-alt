import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { UiCardComponent, UiButtonComponent, UiAlertComponent } from '../../ui';
import { ShutterConfigService } from '../shutter-config.service';
import { ShutterConfig, RoomOption } from '../shutter-config.model';
import { DeviceService } from '../../devices/device.service';
import { DeviceState } from '../../devices/device.model';
import { NotificationService } from '../../shared/notification.service';
import { first } from 'rxjs';

@Component({
  selector: 'app-shutter-config',
  standalone: true,
  imports: [CommonModule, RouterLink, FormsModule, UiCardComponent, UiButtonComponent, UiAlertComponent],
  templateUrl: './shutter-config.component.html',
  styles: [`
    .back-link { display: inline-block; margin-bottom: 0.75rem; font-size: 0.85rem; color: var(--color-text-muted); text-decoration: none; }
    .back-link:hover { color: var(--color-primary); }
    .page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; }
    .page-title { margin: 0; font-size: 1.5rem; font-weight: 700; color: var(--color-text); }

    .configs-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 1.25rem; }

    .info-block { display: flex; flex-direction: column; gap: 0.75rem; }
    .info-row { display: flex; justify-content: space-between; align-items: center; font-size: 0.9rem; }
    .info-label { font-weight: 500; color: var(--color-text-muted); }
    .info-value { font-weight: 600; color: var(--color-text); }
    .api-id-value { font-family: monospace; font-size: 0.72rem; color: var(--color-text-muted); font-weight: 400; opacity: 0.7; word-break: break-all; text-align: right; max-width: 60%; }

    .card-color-strip { height: 3px; border-radius: 2px; margin-bottom: 0.75rem; }

    .footer-actions { display: flex; gap: 0.5rem; justify-content: flex-end; }

    .modal-backdrop {
      position: fixed; inset: 0; background: rgba(0,0,0,0.4);
      display: flex; align-items: center; justify-content: center; z-index: 1000;
    }
    .modal-box {
      background: var(--color-background); border-radius: var(--radius-lg, 0.75rem);
      padding: 1.5rem; max-width: 480px; width: 90%; box-shadow: 0 8px 32px rgba(0,0,0,0.2);
    }
    .modal-title { font-size: 1.1rem; font-weight: 700; margin: 0 0 1rem; color: var(--color-text); }
    .modal-actions { display: flex; gap: 0.5rem; justify-content: flex-end; margin-top: 1rem; }

    .edit-form { display: flex; flex-direction: column; gap: 0.75rem; }
    .form-group { display: flex; flex-direction: column; gap: 0.3rem; }
    .form-group label { font-size: 0.82rem; font-weight: 600; color: var(--color-text-muted); }
    .form-group input[type=text] {
      padding: 0.45rem 0.65rem;
      border: 1px solid var(--color-border, #d1d5db);
      border-radius: var(--radius-md, 0.5rem);
      font-size: 0.9rem; font-family: inherit;
      background: var(--color-background); color: var(--color-text);
    }
    .room-select {
      padding: 0.45rem 0.65rem; border: 1px solid var(--color-border, #d1d5db);
      border-radius: var(--radius-md, 0.5rem); font-size: 0.9rem; font-family: inherit;
      background: var(--color-background); color: var(--color-text);
    }
    input[type=range] { width: 100%; accent-color: var(--color-primary); cursor: pointer; }

    .compass-display { display: flex; align-items: center; gap: 1rem; margin-top: 0.25rem; }
    .compass-label { font-size: 1.4rem; font-weight: 800; color: var(--color-primary); min-width: 2.5rem; }

    .color-picker-row { display: flex; align-items: center; gap: 0.75rem; }
    .color-input { width: 2.5rem; height: 2.5rem; padding: 0; border: 1px solid var(--color-border); border-radius: var(--radius-md); cursor: pointer; background: none; }
    .color-value { font-family: monospace; font-size: 0.85rem; color: var(--color-text-muted); }
    .color-clear { background: none; border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: 0.2rem 0.5rem; cursor: pointer; color: var(--color-text-muted); font-size: 1rem; }
    .color-clear:hover { color: var(--color-primary); border-color: var(--color-primary); }
    .pct-input {
      width: 4.5rem; padding: 0.3rem 0.5rem; border: 1px solid var(--color-border, #d1d5db);
      border-radius: var(--radius-md, 0.5rem); font-size: 0.9rem; font-family: inherit;
      background: var(--color-background); color: var(--color-text); text-align: center;
    }
    .favorites-row { display: flex; gap: 0.75rem; }
    .fav-input-row { display: flex; align-items: center; gap: 0.35rem; }

    .live-list { display: flex; flex-direction: column; gap: 0.5rem; max-height: 300px; overflow-y: auto; margin: 0.75rem 0; }
    .live-item {
      display: flex; justify-content: space-between; align-items: center;
      padding: 0.6rem 0.75rem; border: 1px solid var(--color-border);
      border-radius: var(--radius-md); cursor: pointer; transition: all 0.15s;
      background: var(--color-surface);
    }
    .live-item:hover { border-color: var(--color-primary); background: rgba(var(--color-primary-rgb), 0.05); }
    .live-item.selected { border-color: var(--color-primary); background: rgba(var(--color-primary-rgb), 0.1); }
    .live-item-name { font-weight: 600; font-size: 0.9rem; }
    .live-item-id { font-size: 0.75rem; color: var(--color-text-muted); font-family: monospace; }

    .dissociated-section { margin-top: 2rem; opacity: 0.65; }
    .dissociated-label { font-size: 0.82rem; font-weight: 600; color: var(--color-text-muted); margin: 0 0 0.75rem; text-transform: uppercase; letter-spacing: 0.04em; }

    @media (max-width: 480px) { .configs-grid { grid-template-columns: 1fr; } }
  `]
})
export class ShutterConfigComponent implements OnInit {
  configs: ShutterConfig[] = [];
  rooms: RoomOption[] = [];
  loaded = false;
  editRoomId: number | null = null;
  liveShutters: DeviceState[] = [];
  editingId: number | null = null;
  editName = '';
  editApiName = '';
  editOrientation = 180;
  editColor = '#6366f1';
  editSunLevel = 25;
  editP1Level: number | null = null;
  editP2Level: number | null = null;
  saving = false;

  reassociateId: number | null = null;
  selectedApiId: string | null = null;
  showDissociated = false;

  readonly compassLabels = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];

  private get liveApiIds(): Set<string> {
    return new Set(this.liveShutters.map(s => s.api_id).filter(Boolean) as string[]);
  }

  get associatedConfigs(): ShutterConfig[] {
    if (this.liveShutters.length === 0) return this.configs;
    const ids = this.liveApiIds;
    return this.configs.filter(c => ids.has(c.api_id));
  }

  get dissociatedConfigs(): ShutterConfig[] {
    if (this.liveShutters.length === 0) return [];
    const ids = this.liveApiIds;
    return this.configs.filter(c => !ids.has(c.api_id));
  }

  constructor(
    private configService: ShutterConfigService,
    private deviceService: DeviceService,
    private notif: NotificationService,
    private cdr: ChangeDetectorRef,
    private route: ActivatedRoute,
  ) {}

  ngOnInit(): void {
    this.load();
    this.configService.getRooms().subscribe(r => { this.rooms = r; this.cdr.detectChanges(); });
    this.deviceService.getDevices().pipe(first(s => s.length > 0)).subscribe(s => this.liveShutters = s);
  }

  load(): void {
    this.configService.getConfigs().subscribe(c => {
      this.configs = c;
      this.loaded = true;
      // Arrivée depuis l'engrenage d'une carte (?edit=<id>) : on ouvre directement la modale de ce volet
      const wanted = Number(this.route.snapshot.queryParamMap.get('edit'));
      const target = wanted ? c.find(x => x.id === wanted) : undefined;
      if (target && this.editingId === null) this.startEdit(target);
      this.cdr.detectChanges();
    });
  }

  startEdit(c: ShutterConfig): void {
    this.editingId = c.id;
    this.editName = c.custom_name || '';
    this.editApiName = c.api_name;
    this.editOrientation = c.orientation;
    this.editColor = c.color || '#6366f1';
    this.editRoomId = c.room_id ?? null;
    this.editSunLevel = c.sun_level ?? 25;
    this.editP1Level = c.p1_level ?? null;
    this.editP2Level = c.p2_level ?? null;
  }

  cancelEdit(): void {
    if (this.saving) return;
    this.editingId = null;
  }

  private clampPct(v: number | null | undefined): number | null {
    if (v === null || v === undefined || Number.isNaN(Number(v))) return null;
    return Math.max(0, Math.min(100, Math.round(Number(v))));
  }

  saveEdit(): void {
    if (this.editingId === null || this.saving) return;
    this.saving = true;
    const id = this.editingId;
    const name = this.editName.trim() || null;
    const sunLevel = this.clampPct(this.editSunLevel) ?? 25;
    const p1Level = this.clampPct(this.editP1Level);
    const p2Level = this.clampPct(this.editP2Level);
    this.configService.updateConfig(id, name, this.editOrientation, this.editColor, this.editRoomId, sunLevel, p1Level, p2Level).subscribe({
      next: updated => {
        const idx = this.configs.findIndex(x => x.id === id);
        if (idx > -1) this.configs[idx] = updated;
        this.saving = false;
        this.editingId = null;
        this.cdr.detectChanges();
        this.notif.success('Volet mis à jour', `"${updated.custom_name || updated.api_name}" enregistré.`);
      },
      error: () => {
        this.saving = false;
        this.notif.error('Erreur', 'Impossible de sauvegarder.');
      }
    });
  }

  openReassociate(c: ShutterConfig): void {
    this.reassociateId = c.id;
    this.selectedApiId = null;
  }

  confirmReassociate(): void {
    if (!this.reassociateId || !this.selectedApiId) return;
    this.configService.reassociate(this.reassociateId, this.selectedApiId).subscribe({
      next: updated => {
        const idx = this.configs.findIndex(x => x.id === this.reassociateId);
        if (idx > -1) this.configs[idx] = updated;
        this.reassociateId = null;
        this.selectedApiId = null;
        this.cdr.detectChanges();
        this.notif.success('Association mise à jour', `"${updated.custom_name || updated.api_name}" ré-associé.`);
      },
      error: err => {
        this.reassociateId = null;
        this.cdr.detectChanges();
        this.notif.error('Erreur', err?.error?.detail || 'Erreur lors de la ré-association.');
      }
    });
  }

  compassDirection(deg: number): string {
    return this.compassLabels[Math.round(deg / 45) % 8];
  }

  get cardCount(): number {
    return new Set(this.rooms.map(r => r.card_id)).size;
  }

  roomName(c: ShutterConfig): string {
    const r = this.rooms.find(x => x.id === c.room_id);
    return r ? r.name : 'Non assigné';
  }

  displayName(c: ShutterConfig): string {
    return c.custom_name || c.api_name;
  }

}

import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { UiButtonComponent, UiBadgeComponent } from '../../ui';
import { DeviceService } from '../../devices/device.service';
import { DeviceState } from '../../devices/device.model';
import { ShutterCardComponent } from '../shutter-card/shutter-card.component';
import { ShutterConfigService } from '../shutter-config.service';
import { RoomOption } from '../shutter-config.model';
import { NotificationService } from '../../shared/notification.service';
import { Subscription } from 'rxjs';

interface RoomGroup {
  name: string;
  unassigned: boolean;
  shutters: DeviceState[];
}

type Filter = 'all' | 'open' | 'closed';

const UNASSIGNED = 'Non assignés';

@Component({
  selector: 'app-shutter-list',
  standalone: true,
  imports: [CommonModule, RouterLink, ShutterCardComponent, UiButtonComponent, UiBadgeComponent],
  templateUrl: './shutter-list.component.html',
  styles: [`
    .page-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; flex-wrap: wrap; margin-bottom: 1rem; }
    .page-title { margin: 0; font-size: 1.5rem; font-weight: 700; color: var(--color-text); }
    .subtitle { margin: 0.25rem 0 0; font-size: 0.85rem; color: var(--color-text-muted); }
    .page-actions { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
    .config-link { font-size: 0.85rem; color: var(--color-text-muted); text-decoration: none; white-space: nowrap; }
    .config-link:hover { color: var(--color-primary); }
    .confirm-box { display: inline-flex; align-items: center; gap: 0.4rem; padding: 0.2rem 0.2rem 0.2rem 0.75rem; border: 1px solid var(--color-warning, #f59e0b); border-radius: var(--radius-md, 0.5rem); font-size: 0.85rem; }

    .toolbar { display: flex; justify-content: space-between; align-items: center; gap: 0.75rem; flex-wrap: wrap; margin-bottom: 1.5rem; }
    .filters { display: inline-flex; border: 1px solid var(--color-border, #d1d5db); border-radius: var(--radius-md, 0.5rem); overflow: hidden; }
    .filters button { padding: 0.4rem 0.9rem; font: inherit; font-size: 0.85rem; border: 0; background: transparent; color: var(--color-text-muted); cursor: pointer; }
    .filters button + button { border-left: 1px solid var(--color-border, #d1d5db); }
    .filters button[aria-pressed=true] { background: var(--color-primary); color: #fff; }
    .filters button:focus-visible { outline: 2px solid var(--color-primary); outline-offset: -2px; }
    .last-poll { font-size: 0.75rem; color: var(--color-text-muted); white-space: nowrap; }

    .room-section { margin-bottom: 2rem; }
    .room-head { display: flex; justify-content: space-between; align-items: center; gap: 0.75rem; margin-bottom: 0.75rem; padding-bottom: 0.5rem; border-bottom: 1px solid var(--color-border); }
    .room-title { margin: 0; font-size: 0.85rem; font-weight: 600; color: var(--color-text-muted); text-transform: uppercase; letter-spacing: 0.06em; }
    .room-title .count { font-weight: 400; margin-left: 0.4rem; text-transform: none; letter-spacing: 0; }
    .room-actions { display: inline-flex; gap: 0.25rem; }
    .room-actions button { padding: 0.25rem 0.6rem; font: inherit; font-size: 0.78rem; border: 1px solid var(--color-border, #d1d5db); border-radius: 999px; background: transparent; color: var(--color-text-muted); cursor: pointer; }
    .room-actions button:hover { color: var(--color-primary); border-color: var(--color-primary); }
    .shutters-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 1rem; }

    .hint { display: flex; gap: 0.75rem; align-items: flex-start; padding: 0.75rem 1rem; margin-bottom: 1rem; border-radius: var(--radius-md, 0.5rem); background: rgba(var(--color-primary-rgb, 99, 102, 241), 0.08); font-size: 0.85rem; color: var(--color-text); }
    .hint a { color: var(--color-primary); font-weight: 600; }

    .skeleton { height: 15rem; border-radius: var(--radius-lg, 0.75rem); background: linear-gradient(90deg, var(--color-surface, #f3f4f6) 25%, rgba(127,127,127,0.12) 50%, var(--color-surface, #f3f4f6) 75%); background-size: 200% 100%; animation: shimmer 1.4s infinite linear; }
    @keyframes shimmer { from { background-position: 200% 0; } to { background-position: -200% 0; } }
    @media (prefers-reduced-motion: reduce) { .skeleton { animation: none; } }

    .empty { text-align: center; padding: 3rem 1rem; color: var(--color-text-muted); }
    .empty i { font-size: 2.5rem; margin-bottom: 0.75rem; display: block; }
    .empty h2 { margin: 0 0 0.5rem; font-size: 1.1rem; color: var(--color-text); }

    .link-btn { display: inline-block; padding: 0.5rem 1rem; border-radius: var(--radius-md, 0.5rem); background: var(--color-primary); color: #fff; text-decoration: none; font-weight: 600; }
    .sensors { display: flex; flex-wrap: wrap; gap: 0.5rem; }
    .sensor { display: inline-flex; align-items: center; gap: 0.5rem; padding: 0.4rem 0.75rem; border: 1px solid var(--color-border, #d1d5db); border-radius: 999px; font-size: 0.85rem; }
  `]
})
export class ShutterListComponent implements OnInit, OnDestroy {
  rooms: RoomGroup[] = [];
  sensors: DeviceState[] = [];
  roomOptions: RoomOption[] = [];
  loaded = false;
  totalShutters = 0;
  openCount = 0;
  closedCount = 0;
  filter: Filter = 'all';
  lastPoll: Date | null = null;
  refreshing = false;
  confirmCloseAll = false;
  private all: DeviceState[] = [];
  private subs = new Subscription();
  private confirmTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private deviceService: DeviceService,
    private configService: ShutterConfigService,
    private notif: NotificationService,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.deviceService.startSSE();
    this.subs.add(this.deviceService.isLoaded().subscribe(l => { this.loaded = l; this.cdr.detectChanges(); }));
    this.subs.add(this.deviceService.getDevices().subscribe(devices => {
      this.all = devices;
      this.rebuild();
      this.cdr.detectChanges();
    }));
    this.subs.add(this.deviceService.getStatus().subscribe(s => {
      if (s.lastPoll) this.lastPoll = s.lastPoll;
      this.cdr.detectChanges();
    }));
    this.loadRooms();
  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
    if (this.confirmTimer) clearTimeout(this.confirmTimer);
  }

  setFilter(f: Filter): void {
    this.filter = f;
    this.rebuild();
  }

  /** Comptage et regroupement par pièce (volets uniquement ; les capteurs sont listés à part). */
  private rebuild(): void {
    const shutters = this.all.filter(d => d.type === 'shutter' || d.type === 'custom_api');
    this.sensors = this.all.filter(d => d.type === 'sensor');
    this.totalShutters = shutters.length;
    this.openCount = shutters.filter(s => (s.level ?? 0) > 0).length;
    this.closedCount = this.totalShutters - this.openCount;

    const visible = shutters.filter(s =>
      this.filter === 'all' ? true : this.filter === 'open' ? (s.level ?? 0) > 0 : (s.level ?? 0) === 0);

    const byRoom = new Map<string, DeviceState[]>();
    for (const s of visible) {
      const key = s.room_name ?? UNASSIGNED;
      if (!byRoom.has(key)) byRoom.set(key, []);
      byRoom.get(key)!.push(s);
    }
    this.rooms = [...byRoom.entries()]
      .sort(([a], [b]) => {
        if (a === UNASSIGNED) return 1;
        if (b === UNASSIGNED) return -1;
        return a.localeCompare(b, 'fr');
      })
      .map(([name, list]) => ({ name, unassigned: name === UNASSIGNED, shutters: list }));
  }

  get hasUnassigned(): boolean {
    return this.rooms.some(r => r.unassigned);
  }

  private loadRooms(): void {
    this.configService.getRooms().subscribe({
      next: r => { this.roomOptions = r; this.cdr.detectChanges(); },
      error: () => { /* le classement rapide est facultatif */ },
    });
  }

  onAssign(e: { shutter: DeviceState; roomId: number }): void {
    if (!e.shutter.db_id) return;
    this.deviceService.setRoom(e.shutter.db_id, e.roomId).subscribe({
      next: () => this.notif.success('Volet classé', `« ${e.shutter.name} » est rangé dans sa pièce.`),
      error: () => this.notif.error('Erreur', 'Impossible de classer ce volet.'),
    });
  }

  openRoom(room: RoomGroup): void { this.commandAll(room.shutters, 'open'); }
  closeRoom(room: RoomGroup): void { this.commandAll(room.shutters, 'close'); }

  /** « Tout fermer » demande une confirmation en deux temps (une fausse manœuvre fermerait toute la maison). */
  onCloseAll(): void {
    if (!this.confirmCloseAll) {
      this.confirmCloseAll = true;
      this.confirmTimer = setTimeout(() => { this.confirmCloseAll = false; this.cdr.detectChanges(); }, 5000);
      return;
    }
    this.cancelCloseAll();
    this.commandAll(this.all.filter(d => d.type === 'shutter' || d.type === 'custom_api'), 'close');
  }

  cancelCloseAll(): void {
    this.confirmCloseAll = false;
    if (this.confirmTimer) { clearTimeout(this.confirmTimer); this.confirmTimer = null; }
  }

  private commandAll(shutters: DeviceState[], action: 'open' | 'close'): void {
    let failed = 0;
    let pending = shutters.length;
    for (const s of shutters) {
      this.deviceService[action](s.id).subscribe({
        error: () => failed++,
        complete: () => {
          if (--pending === 0 && failed > 0) {
            this.notif.error('Commande partielle', `${failed} volet(s) n'ont pas répondu.`);
          }
        },
      });
    }
  }

  onRefresh(): void {
    this.refreshing = true;
    this.deviceService.refresh().subscribe({
      next: (result) => {
        if (result.last_poll) this.lastPoll = new Date(result.last_poll);
        this.refreshing = false;
        this.cdr.detectChanges();
      },
      error: () => {
        this.refreshing = false;
        this.notif.error('Actualisation', 'Impossible de joindre le serveur.');
        this.cdr.detectChanges();
      }
    });
  }
}

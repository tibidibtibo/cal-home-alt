import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { Router, RouterLink } from '@angular/router';
import { forkJoin, of } from 'rxjs';
import { HouseService, RoomRef } from './house.service';
import { SettingsService } from '../settings/settings.service';
import { ShutterConfigService } from '../shutters/shutter-config.service';
import { ShutterConfig } from '../shutters/shutter-config.model';
import { UiAlertComponent, UiBadgeComponent, UiButtonComponent } from '../ui';

interface ShutterRow {
  id: number;
  apiName: string;
  name: string;
  roomId: number | null;
  orientation: number;
  color: string | null;
}

/** Assistant de première configuration : maison, box, localisation, pièces, volets. Chaque étape s'enregistre en avançant. */
@Component({
  selector: 'app-setup-wizard',
  standalone: true,
  imports: [FormsModule, RouterLink, UiAlertComponent, UiBadgeComponent, UiButtonComponent],
  templateUrl: './setup-wizard.component.html',
  styles: [`
    .wizard { max-width: 44rem; margin: 0 auto; padding: 1.5rem 1rem 3rem; }
    .wizard__head { display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin-bottom: 1rem; }
    .wizard__brand { display: flex; align-items: center; gap: 0.6rem; font-weight: 700; font-size: 1.1rem; }
    .steps { display: flex; gap: 0.25rem; list-style: none; padding: 0; margin: 0 0 1.5rem; overflow-x: auto; }
    .steps li { flex: 1 0 auto; display: flex; align-items: center; gap: 0.4rem; padding: 0.4rem 0.6rem; font-size: 0.8rem; color: var(--color-text-muted); border-bottom: 3px solid var(--color-border); white-space: nowrap; }
    .steps li.done { border-bottom-color: var(--color-success); color: var(--color-text); }
    .steps li.current { border-bottom-color: var(--color-primary); color: var(--color-primary); font-weight: 600; }
    .panel { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: 1.5rem; box-shadow: var(--shadow-sm); }
    .panel h1 { font-size: 1.3rem; }
    .lead { color: var(--color-text-muted); margin-bottom: 1.25rem; }
    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 0 1rem; }
    .form-group input, .form-group select { width: 100%; }
    .actions { display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; margin-top: 1.5rem; flex-wrap: wrap; }
    .actions__right { display: flex; gap: 0.5rem; margin-left: auto; }
    .chips { display: flex; flex-wrap: wrap; gap: 0.4rem; margin: 0.5rem 0 1rem; }
    .chip { padding: 0.25rem 0.7rem; font-size: 0.8rem; border: 1px dashed var(--color-border); border-radius: 999px; background: none; color: var(--color-text-muted); }
    .chip:hover:not(:disabled) { border-color: var(--color-primary); color: var(--color-primary); }
    .add-row { display: flex; gap: 0.5rem; }
    .add-row input { flex: 1; }
    .room-list { list-style: none; padding: 0; margin: 1rem 0 0; display: flex; flex-direction: column; gap: 0.4rem; }
    .room-list li { display: flex; justify-content: space-between; align-items: center; padding: 0.5rem 0.75rem; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-surface-alt); }
    .shutter-rows { display: flex; flex-direction: column; gap: 0.75rem; }
    .shutter-row { display: grid; grid-template-columns: 1.4fr 1fr 1fr; gap: 0.5rem; align-items: end; padding: 0.75rem; border: 1px solid var(--color-border); border-radius: var(--radius-md); }
    .shutter-row label { display: block; margin-bottom: 0.2rem; font-size: 0.75rem; color: var(--color-text-muted); }
    .shutter-row input, .shutter-row select { width: 100%; }
    .shutter-row .api-name { grid-column: 1 / -1; font-size: 0.78rem; color: var(--color-text-muted); }
    .summary { list-style: none; padding: 0; margin: 1rem 0; display: flex; flex-direction: column; gap: 0.5rem; }
    .summary li { display: flex; justify-content: space-between; gap: 1rem; padding: 0.5rem 0; border-bottom: 1px solid var(--color-border); }
    @media (max-width: 600px) { .grid-2, .shutter-row { grid-template-columns: 1fr; } }
  `],
})
export class SetupWizardComponent implements OnInit {
  private house = inject(HouseService);
  private settings = inject(SettingsService);
  private shutters = inject(ShutterConfigService);
  private router = inject(Router);

  readonly steps = ['Maison', 'Box', 'Localisation', 'Pièces', 'Volets', 'Terminé'];
  readonly orientations = [
    { label: 'Nord', value: 0 }, { label: 'Nord-Est', value: 45 }, { label: 'Est', value: 90 }, { label: 'Sud-Est', value: 135 },
    { label: 'Sud', value: 180 }, { label: 'Sud-Ouest', value: 225 }, { label: 'Ouest', value: 270 }, { label: 'Nord-Ouest', value: 315 },
  ];
  readonly roomSuggestions = ['Salon', 'Cuisine', 'Chambre', 'Bureau', 'Salle de bain', 'Entrée'];

  readonly step = signal(0);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly info = signal('');
  readonly alreadyDone = this.house.completed;

  houseName = '';

  boxHost = '';
  boxMac = '';
  boxLogin = '';
  boxPassword = '';
  boxPasswordSet = false;
  boxOk = signal(false);

  latitude = 48.8566;
  longitude = 2.3522;
  timezone = 'Europe/Paris';
  sunTimes = signal<{ sunrise: string; sunset: string } | null>(null);

  rooms = signal<RoomRef[]>([]);
  newRoom = '';

  rows = signal<ShutterRow[]>([]);
  boxUnreachable = signal(false);

  ngOnInit(): void {
    this.house.load().subscribe({
      next: h => { this.houseName = h.name; },
      error: () => this.error.set('Impossible de joindre le serveur.'),
    });
    this.settings.getBoxConfig().subscribe(c => { this.boxHost = c.host; this.boxMac = c.mac; });
    this.settings.getCalypsCreds().subscribe(c => { this.boxLogin = c.login; this.boxPasswordSet = c.password_set; });
    this.settings.getLocationConfig().subscribe(l => {
      this.latitude = l.latitude;
      this.longitude = l.longitude;
      this.timezone = l.timezone;
      try { this.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || l.timezone; } catch { /* navigateur ancien */ }
    });
    this.loadRooms();
  }

  // --- Navigation ---

  back(): void {
    this.clear();
    this.step.update(s => Math.max(0, s - 1));
  }

  skip(): void {
    this.clear();
    this.goTo(this.step() + 1);
  }

  next(): void {
    this.clear();
    switch (this.step()) {
      case 0: return this.saveHouse();
      case 1: return this.saveBox();
      case 2: return this.saveLocation();
      case 3: return this.goTo(4);
      case 4: return this.saveShutters();
    }
  }

  private goTo(step: number): void {
    this.step.set(step);
    if (step === 3) this.loadRooms();
    if (step === 4) this.discoverShutters();
  }

  private clear(): void {
    this.error.set('');
    this.info.set('');
  }

  private fail(err: unknown, fallback: string): void {
    this.busy.set(false);
    const e = err as HttpErrorResponse;
    this.error.set(e?.status === 0 ? 'Impossible de joindre le serveur.' : (e?.error?.detail ?? fallback));
  }

  // --- 1. Maison ---

  private saveHouse(): void {
    if (!this.houseName.trim()) { this.error.set('Donnez un nom à votre maison.'); return; }
    this.busy.set(true);
    this.house.saveName(this.houseName).subscribe({
      next: () => { this.busy.set(false); this.goTo(1); },
      error: e => this.fail(e, 'Enregistrement impossible.'),
    });
  }

  // --- 2. Box ---

  private saveBox(): void {
    if (!this.boxHost.trim()) { this.error.set('Indiquez l\'adresse IP de la box (visible dans votre routeur ou l\'application Calyps\'HOME).'); return; }
    if (!this.boxLogin.trim()) { this.error.set('Indiquez l\'e-mail de votre compte Calyps\'HOME.'); return; }
    if (!this.boxPassword && !this.boxPasswordSet) { this.error.set('Indiquez le mot de passe de votre compte Calyps\'HOME.'); return; }
    this.busy.set(true);
    this.settings.updateBoxConfig(this.boxHost, this.boxMac).subscribe({
      next: () => this.settings.updateCalypsCreds(this.boxLogin, this.boxPassword).subscribe({
        next: () => {
          this.boxPasswordSet = true;
          this.boxPassword = '';
          this.settings.testBoxPing().subscribe({
            next: () => this.settings.testBoxConnection().subscribe({
              next: () => { this.busy.set(false); this.boxOk.set(true); this.goTo(2); },
              error: e => this.fail(e, 'La box ne répond pas avec ces identifiants.'),
            }),
            error: e => this.fail(e, 'La box est injoignable à cette adresse.'),
          });
        },
        error: e => this.fail(e, 'Enregistrement impossible.'),
      }),
      error: e => this.fail(e, 'Enregistrement impossible.'),
    });
  }

  // --- 3. Localisation ---

  useMyPosition(): void {
    this.clear();
    if (!navigator.geolocation) { this.error.set('La géolocalisation n\'est pas disponible dans ce navigateur : saisissez les coordonnées.'); return; }
    navigator.geolocation.getCurrentPosition(
      pos => {
        this.latitude = Math.round(pos.coords.latitude * 10000) / 10000;
        this.longitude = Math.round(pos.coords.longitude * 10000) / 10000;
      },
      () => this.error.set('Position refusée ou indisponible : saisissez les coordonnées à la main.'),
      { timeout: 10000 },
    );
  }

  private saveLocation(): void {
    this.busy.set(true);
    this.settings.updateLocationConfig(Number(this.latitude), Number(this.longitude), this.timezone).subscribe({
      next: () => {
        this.busy.set(false);
        this.settings.getSunTimes().subscribe({ next: t => this.sunTimes.set(t), error: () => this.sunTimes.set(null) });
        this.goTo(3);
      },
      error: e => this.fail(e, 'Coordonnées invalides.'),
    });
  }

  // --- 4. Pièces ---

  loadRooms(): void {
    this.house.getRooms().subscribe({ next: r => this.rooms.set(r), error: () => this.rooms.set([]) });
  }

  addRoom(name = this.newRoom): void {
    name = name.trim();
    if (!name) return;
    this.clear();
    this.busy.set(true);
    this.house.addRoom(name).subscribe({
      next: () => { this.busy.set(false); this.newRoom = ''; this.loadRooms(); },
      error: e => this.fail(e, 'Ajout impossible.'),
    });
  }

  deleteRoom(room: RoomRef): void {
    this.house.deleteRoom(room.id).subscribe({ next: () => this.loadRooms(), error: e => this.fail(e, 'Suppression impossible.') });
  }

  // --- 5. Volets ---

  private discoverShutters(): void {
    this.busy.set(true);
    this.boxUnreachable.set(false);
    this.house.refreshDevices().subscribe({
      next: r => { this.boxUnreachable.set(!r.box_reachable); this.loadShutters(); },
      error: () => { this.boxUnreachable.set(true); this.loadShutters(); },
    });
  }

  private loadShutters(): void {
    this.shutters.getConfigs().subscribe({
      next: configs => {
        this.rows.set(configs.filter((c: ShutterConfig) => !c.api_id.startsWith('custom-')).map(c => ({
          id: c.id, apiName: c.api_name, name: c.custom_name ?? '', roomId: c.room_id, orientation: c.orientation ?? 180, color: c.color,
        })));
        this.loadRooms();
        this.busy.set(false);
      },
      error: e => this.fail(e, 'Impossible de lister les volets.'),
    });
  }

  private saveShutters(): void {
    this.busy.set(true);
    const calls = this.rows().map(r => this.shutters.updateConfig(r.id, r.name.trim() || null, Number(r.orientation), r.color, r.roomId));
    forkJoin(calls.length ? calls : [of(null)]).subscribe({
      next: () => this.house.autoplace().subscribe({
        next: () => { this.busy.set(false); this.goTo(5); },
        error: e => this.fail(e, 'Placement sur le plan impossible.'),
      }),
      error: e => this.fail(e, 'Enregistrement des volets impossible.'),
    });
  }

  // --- 6. Terminé ---

  roomCount(): number { return this.rooms().length; }
  placedCount(): number { return this.rows().filter(r => r.roomId != null).length; }

  finish(target: '/plan' | '/home'): void {
    this.busy.set(true);
    this.house.complete().subscribe({
      next: () => this.router.navigate([target]),
      error: e => this.fail(e, 'Impossible de terminer la configuration.'),
    });
  }
}

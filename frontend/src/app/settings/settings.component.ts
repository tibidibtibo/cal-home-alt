import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { UiCardComponent, UiBadgeComponent, UiButtonComponent, UiAlertComponent } from '../ui';
import { SettingsService, NotificationConfig, BoxConfig, CalypsCredsConfig, LocationConfig, SmtpConfig } from './settings.service';
import { Observable } from 'rxjs';
import { NotificationService } from '../shared/notification.service';
import { AuthService } from '../auth/auth.service';
import { HouseService } from '../setup/house.service';

export type SettingsTab = 'box' | 'notifications' | 'devices' | 'security' | 'about';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, UiCardComponent, UiBadgeComponent, UiButtonComponent, UiAlertComponent],
  templateUrl: './settings.component.html',
  styles: [`
    .settings-tabs { display: flex; justify-content: flex-start; gap: 0.25rem; overflow-x: auto; overflow-y: hidden; margin-bottom: 1.5rem; border-bottom: 1px solid var(--color-border, #e5e7eb); }
    .settings-tab { display: inline-flex; align-items: center; gap: 0.5rem; padding: 0.7rem 1rem; font: inherit; font-size: 0.9rem; font-weight: 500; white-space: nowrap; background: none; border: 0; border-bottom: 2px solid transparent; margin-bottom: -1px; color: var(--color-text-muted); cursor: pointer; }
    .settings-tab:hover { color: var(--color-text); }
    .settings-tab[aria-selected=true] { color: var(--color-primary); border-bottom-color: var(--color-primary); font-weight: 600; }
    .settings-tab:focus-visible { outline: 2px solid var(--color-primary); outline-offset: -2px; }
    .user-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.4rem; }
    .user-list li { display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; font-size: 0.875rem; }
    .link { background: none; border: 0; padding: 0; font: inherit; color: var(--color-primary); text-decoration: underline; cursor: pointer; }
    .hint { font-size: 0.78rem; color: var(--color-text-muted); }
    .settings-layout { display: flex; flex-direction: row; flex-wrap: wrap; gap: 1.5rem; align-items: flex-start; }
    .settings-layout > * { flex: 1 1 320px; min-width: 0; }
    @media (max-width: 640px) { .settings-layout { flex-direction: column; } .settings-layout > * { flex: none; width: 100%; } }
    .info-rows { display: flex; flex-direction: column; gap: 0.75rem; }
    .info-row { display: flex; justify-content: space-between; align-items: center; font-size: 0.9rem; }
    .info-label { font-weight: 500; color: var(--color-text); }
    .about-text { font-size: 0.875rem; color: var(--color-text-muted); display: flex; flex-direction: column; gap: 0.25rem; }
    .config-form { display: flex; flex-direction: column; gap: 0.75rem; margin-top: 1rem; padding-top: 1rem; border-top: 1px solid var(--color-border, #e5e7eb); }
    .form-group { display: flex; flex-direction: column; gap: 0.25rem; }
    .form-group label { font-size: 0.8rem; font-weight: 500; color: var(--color-text-muted); }
    .form-group input, .form-group select { padding: 0.4rem 0.6rem; border: 1px solid var(--color-border, #d1d5db); border-radius: 6px; font-size: 0.875rem; background: var(--color-surface, #fff); color: var(--color-text); }
    .form-actions { display: flex; align-items: center; gap: 0.5rem; margin-top: 0.25rem; flex-wrap: wrap; }
    .form-actions-divider { width: 1px; height: 1.5rem; background: var(--color-border, #e5e7eb); margin: 0 0.25rem; }
  `]
})
export class SettingsComponent implements OnInit {
  readonly tabs: { id: SettingsTab; label: string; icon: string }[] = [
    { id: 'box', label: 'Box & localisation', icon: 'fa-solid fa-network-wired' },
    { id: 'notifications', label: 'Notifications', icon: 'fa-solid fa-bell' },
    { id: 'devices', label: 'Appareils', icon: 'fa-solid fa-microchip' },
    { id: 'security', label: 'Sécurité & accès', icon: 'fa-solid fa-lock' },
    { id: 'about', label: 'À propos', icon: 'fa-solid fa-circle-info' },
  ];
  tab: SettingsTab = 'box';
  private loadedTabs = new Set<SettingsTab>();
  private pending = 0;
  loadError = false;

  config: NotificationConfig | null = null;
  loading = false;

  selectedChannel = 'none';

  boxConfig: BoxConfig | null = null;
  boxHost = '';
  boxMac = '';

  calypsCreds: CalypsCredsConfig | null = null;
  credsLogin = '';
  credsPassword = '';

  locationConfig: LocationConfig | null = null;
  sunTimes: { sunrise: string; sunset: string } | null = null;
  latitude = 0;
  longitude = 0;
  timezone = '';

  smtpConfig: SmtpConfig | null = null;
  smtpHost = '';
  smtpPort = 587;
  smtpUser = '';
  smtpPassword = '';
  smtpFrom = '';
  smtpEmailTo = '';

  pollInterval = 300;
  houseName = '';

  currentPassword = '';
  newPassword = '';
  confirmNewPassword = '';

  allowedUsers: string[] = [];
  newUserName = '';
  newUserPassword = '';
  currentUser = '';
  customDevices: any[] = [];
  newCustomName = '';
  newCustomUrl = '';
  newCustomType = 'shutter';

  constructor(
    private settingsService: SettingsService,
    private notif: NotificationService,
    private cdr: ChangeDetectorRef,
    private auth: AuthService,
    private house: HouseService,
  ) {
    this.currentUser = this.auth.getUser()?.name ?? '';
  }

  ngOnInit(): void {
    this.selectTab(this.tab);
  }

  /** Les données d'un onglet ne sont demandées qu'à sa première ouverture (la page ne lance plus 9 requêtes d'un coup). */
  selectTab(tab: SettingsTab): void {
    this.tab = tab;
    if (this.loadedTabs.has(tab)) return;
    this.loadedTabs.add(tab);
    this.loadTab(tab);
  }

  retryTab(): void {
    this.loadError = false;
    this.loadedTabs.delete(this.tab);
    this.selectTab(this.tab);
  }

  onTabKey(event: KeyboardEvent, index: number): void {
    const last = this.tabs.length - 1;
    const next = event.key === 'ArrowRight' ? (index + 1 > last ? 0 : index + 1)
      : event.key === 'ArrowLeft' ? (index - 1 < 0 ? last : index - 1) : -1;
    if (next < 0) return;
    event.preventDefault();
    this.selectTab(this.tabs[next].id);
    (event.currentTarget as HTMLElement).parentElement?.querySelectorAll<HTMLElement>('[role=tab]')[next]?.focus();
  }

  /** Lance les requêtes d'un onglet ; `loading` retombe quand toutes sont terminées, `loadError` si l'une a échoué. */
  private loadTab(tab: SettingsTab): void {
    const done = () => { if (--this.pending === 0) { this.loading = false; } this.cdr.detectChanges(); };
    const fail = () => { this.loadError = true; done(); };
    const run = <T>(obs: Observable<T>, next: (v: T) => void) => {
      this.pending++;
      this.loading = true;
      obs.subscribe({ next: v => { next(v); done(); }, error: fail });
    };

    switch (tab) {
      case 'box':
        run(this.house.load(), (h) => { this.houseName = h.name; });
        run(this.settingsService.getBoxConfig(), (boxConfig) => {
          this.boxConfig = boxConfig;
          this.boxHost = boxConfig.host;
          this.boxMac = boxConfig.mac;
        });
        run(this.settingsService.getCalypsCreds(), (creds) => { this.calypsCreds = creds; this.credsLogin = creds.login; });
        run(this.settingsService.getLocationConfig(), (loc) => {
          this.locationConfig = loc;
          this.latitude = loc.latitude;
          this.longitude = loc.longitude;
          this.timezone = loc.timezone;
        });
        this.loadSunTimes();
        run(this.settingsService.getPollInterval(), (r) => { this.pollInterval = r.interval; });
        break;
      case 'notifications':
        run(this.settingsService.getNotificationConfig(), (config) => { this.config = config; this.selectedChannel = config.channel; });
        run(this.settingsService.getSmtpConfig(), (smtp) => {
          this.smtpConfig = smtp;
          this.smtpHost = smtp.host;
          this.smtpPort = smtp.port;
          this.smtpUser = smtp.user;
          this.smtpFrom = smtp.from_addr;
          this.smtpEmailTo = smtp.email_to;
        });
        break;
      case 'devices':
        this.loadCustomDevices();
        break;
      case 'security':
        this.loadAllowedUsers();
        break;
    }
  }

  loadAllowedUsers(): void {
    this.settingsService.getAllowedUsers().subscribe({
      next: (users) => { this.allowedUsers = users; this.cdr.detectChanges(); }
    });
  }

  addUser(): void {
    if (!this.newUserName || !this.newUserPassword) return;
    const name = this.newUserName;
    this.settingsService.addAllowedUser(name, this.newUserPassword).subscribe({
      next: () => {
        this.notif.success('Utilisateurs', `Compte ${name} créé.`);
        this.newUserName = '';
        this.newUserPassword = '';
        this.loadAllowedUsers();
      },
      error: (err) => this.notif.error('Utilisateurs', err.error?.detail || 'Erreur lors de la création.')
    });
  }

  removeUser(username: string): void {
    if (!confirm(`Supprimer le compte ${username} ?`)) return;
    this.settingsService.removeAllowedUser(username).subscribe({
      next: () => {
        this.notif.success('Utilisateurs', `Compte ${username} supprimé.`);
        this.loadAllowedUsers();
      },
      error: (err) => this.notif.error('Utilisateurs', err.error?.detail || 'Erreur lors de la suppression.')
    });
  }

  loadCustomDevices(): void {
    this.settingsService.getRegisteredDevices().subscribe({
      next: devices => {
        this.customDevices = devices.filter(d => d.type === 'custom_api' || (d.api_id && d.api_id.startsWith('custom-')));
        this.cdr.detectChanges();
      },
      error: () => { this.loadError = true; this.cdr.detectChanges(); },
    });
  }

  addCustomDevice(): void {
    if (!this.newCustomName || !this.newCustomUrl) return;
    this.settingsService.createCustomDevice(this.newCustomName, this.newCustomUrl, this.newCustomType).subscribe({
      next: () => {
        this.notif.success('Appareils', `Appareil ${this.newCustomName} ajouté.`);
        this.newCustomName = '';
        this.newCustomUrl = '';
        this.loadCustomDevices();
      },
      error: (err) => this.notif.error('Appareils', err.error?.detail || 'Erreur lors de l\'ajout.')
    });
  }

  deleteCustomDevice(dbId: number): void {
    if (!confirm('Supprimer cet appareil ?')) return;
    this.settingsService.deleteCustomDevice(dbId).subscribe({
      next: () => {
        this.notif.success('Appareils', 'Appareil supprimé.');
        this.loadCustomDevices();
      },
      error: (err) => this.notif.error('Appareils', err.error?.detail || 'Erreur lors de la suppression.')
    });
  }

  saveChannel(): void {
    this.settingsService.updateChannel(this.selectedChannel).subscribe({
      next: () => { if (this.config) { this.config.channel = this.selectedChannel; } this.cdr.detectChanges(); }
    });
  }

  saveHouseName(): void {
    this.house.saveName(this.houseName).subscribe({
      next: () => this.notif.success('Maison', 'Nom enregistré.'),
      error: (err) => this.notif.error('Maison', err.error?.detail || 'Erreur lors de la sauvegarde.', { duration: 0 })
    });
  }

  saveBoxConfig(): void {
    this.settingsService.updateBoxConfig(this.boxHost, this.boxMac).subscribe({
      next: () => {
        this.notif.success('Box Calyps\'HOME', 'Configuration IP sauvegardée.');
        if (this.boxConfig) { this.boxConfig.host = this.boxHost; this.boxConfig.mac = this.boxMac; }
        this.cdr.detectChanges();
      },
      error: () => this.notif.error('Box Calyps\'HOME', 'Erreur lors de la sauvegarde.', { duration: 0 })
    });
  }

  saveCalypsCreds(): void {
    this.settingsService.updateCalypsCreds(this.credsLogin, this.credsPassword).subscribe({
      next: () => {
        this.notif.success('Identifiants', 'Identifiants Calyps\'HOME sauvegardés.');
        this.credsPassword = '';
        if (this.calypsCreds) { this.calypsCreds.login = this.credsLogin; this.calypsCreds.password_set = true; }
        this.cdr.detectChanges();
      },
      error: () => this.notif.error('Identifiants', 'Erreur lors de la sauvegarde.', { duration: 0 })
    });
  }

  /** Lever/coucher du jour calculés pour la localisation courante (aide à vérifier les coordonnées). Non bloquant. */
  private loadSunTimes(): void {
    this.settingsService.getSunTimes().subscribe({
      next: t => { this.sunTimes = t; this.cdr.detectChanges(); },
      error: () => { this.sunTimes = null; }
    });
  }

  saveLocationConfig(): void {
    this.settingsService.updateLocationConfig(this.latitude, this.longitude, this.timezone).subscribe({
      next: () => {
        this.notif.success('Localisation', 'Configuration sauvegardée.');
        if (this.locationConfig) {
          this.locationConfig.latitude = this.latitude;
          this.locationConfig.longitude = this.longitude;
          this.locationConfig.timezone = this.timezone;
        }
        this.loadSunTimes();
        this.cdr.detectChanges();
      },
      error: () => this.notif.error('Localisation', 'Erreur lors de la sauvegarde.', { duration: 0 })
    });
  }

  saveSmtpConfig(): void {
    this.settingsService.updateSmtpConfig(
      this.smtpHost, this.smtpPort, this.smtpUser,
      this.smtpPassword, this.smtpFrom, this.smtpEmailTo
    ).subscribe({
      next: () => {
        this.notif.success('SMTP', 'Configuration sauvegardée.');
        this.smtpPassword = '';
        if (this.smtpConfig) {
          this.smtpConfig.host = this.smtpHost;
          this.smtpConfig.port = this.smtpPort;
          this.smtpConfig.user = this.smtpUser;
          this.smtpConfig.from_addr = this.smtpFrom;
          this.smtpConfig.email_to = this.smtpEmailTo;
          this.smtpConfig.password_set = this.smtpConfig.password_set || !!this.smtpPassword;
        }
        this.cdr.detectChanges();
      },
      error: () => this.notif.error('SMTP', 'Erreur lors de la sauvegarde.', { duration: 0 })
    });
  }

  savePollInterval(): void {
    this.settingsService.updatePollInterval(this.pollInterval).subscribe({
      next: () => this.notif.success('Polling', 'Intervalle sauvegardé.'),
      error: () => this.notif.error('Polling', 'Erreur lors de la sauvegarde.', { duration: 0 })
    });
  }

  testNotification(): void {
    this.settingsService.testNotification().subscribe({
      next: () => this.notif.success('Notification', 'Notification envoyée avec succès !'),
      error: (err: HttpErrorResponse) => {
        const detail = err.error?.detail ?? 'Envoi échoué.';
        this.notif.error('Notification', detail, { duration: 0 });
      }
    });
  }

  testBoxPing(): void {
    this.settingsService.testBoxPing().subscribe({
      next: () => this.notif.success('Connexion box', 'Box joignable (IP OK).'),
      error: (err: HttpErrorResponse) => {
        const detail = err.error?.detail ?? 'Connexion échouée.';
        this.notif.error('Connexion box', detail, { duration: 0 });
      }
    });
  }

  testBoxConnection(): void {
    this.settingsService.testBoxConnection().subscribe({
      next: () => this.notif.success('Identifiants', 'Identifiants valides — données reçues.'),
      error: (err: HttpErrorResponse) => {
        const detail = err.error?.detail ?? 'Connexion échouée.';
        this.notif.error('Identifiants', detail, { duration: 0 });
      }
    });
  }

  changePassword(): void {
    if (this.newPassword !== this.confirmNewPassword) {
      this.notif.error('Mot de passe', 'Les mots de passe ne correspondent pas.', { duration: 0 });
      return;
    }
    this.settingsService.changePassword(this.currentPassword, this.newPassword).subscribe({
      next: () => {
        this.notif.success('Mot de passe', 'Mot de passe modifié avec succès.');
        this.currentPassword = '';
        this.newPassword = '';
        this.confirmNewPassword = '';
        this.cdr.detectChanges();
      },
      error: (err: HttpErrorResponse) => {
        const detail = err.error?.detail ?? 'Erreur lors du changement de mot de passe.';
        this.notif.error('Mot de passe', detail, { duration: 0 });
      }
    });
  }
}

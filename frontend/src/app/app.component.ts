import { Component, OnDestroy, OnInit } from '@angular/core';
import { AsyncPipe, DatePipe } from '@angular/common';
import { RouterOutlet, Router, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';
import { AppHeaderComponent, AppFooterComponent } from './ui';
import { HouseService } from './setup/house.service';
import { DeviceService, LiveStatus } from './devices/device.service';
import { Observable } from 'rxjs';
import { AuthService } from './auth/auth.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    RouterOutlet,
    AppHeaderComponent,
    AppFooterComponent,
    AsyncPipe,
    DatePipe,
  ],
  templateUrl: './app.component.html',
  styles: [`
    :host { display: flex; flex-direction: column; min-height: 100dvh; }
    .app-layout { flex: 1; max-width: 1400px; margin: 0 auto; padding: 2rem 1.5rem 3rem; width: 100%; }
    .app-layout--bare { max-width: none; margin: 0; padding: 0; }
    .status-bar { display: flex; align-items: center; gap: 0.6rem; padding: 0.5rem 1.5rem; font-size: 0.85rem; border-bottom: 1px solid var(--color-border, #e5e7eb); }
    .status-bar--warn { background: rgba(245, 158, 11, 0.14); color: var(--color-text); }
    .status-bar--error { background: rgba(220, 38, 38, 0.12); color: var(--color-text); }
    .status-bar i { opacity: 0.8; }
  `]
})
export class AppComponent implements OnInit, OnDestroy {
  readonly status$: Observable<LiveStatus> = this.deviceService.getStatus();
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  /** Écrans sans en-tête ni pied de page : connexion, création du compte, assistant de configuration. */
  get isLoginRoute(): boolean {
    return ['/login', '/welcome', '/setup'].some(p => this.router.url.startsWith(p));
  }

  get appName(): string {
    return this.house.name() || 'Cal-Home Alt';
  }

  get user() {
    return this.authService.getUser();
  }

  get navItems() {
    if (!this.authService.isAuthenticated()) return [];
    return this._navItems;
  }

  private _navItems = [
    { label: 'Accueil', href: '/home', icon: 'fa-solid fa-house' },
    { label: 'Plan', href: '/plan', icon: 'fa-solid fa-map' },
    { label: 'Volets', href: '/list', icon: 'fa-solid fa-list' },
    { label: 'Automatisations', href: '/schedules', icon: 'fa-solid fa-clock' },
    { label: 'Trafic Box', href: '/traffic', icon: 'fa-solid fa-gauge-high' },
    { label: 'Paramètres', href: '/settings', icon: 'fa-solid fa-gear' },
    { label: 'Logs', href: '/logs', icon: 'fa-solid fa-list-ul' },
  ];

  constructor(
    private deviceService: DeviceService,
    private router: Router,
    readonly authService: AuthService,
    private house: HouseService,
  ) {}

  ngOnInit(): void {
    this.refreshTimer = setInterval(() => this.authService.refreshIfNeeded(), 30 * 60 * 1000);
    this.router.events.pipe(
      filter(e => e instanceof NavigationEnd)
    ).subscribe(() => {
      if (this.authService.isAuthenticated()) {
        this.authService.refreshIfNeeded();
        if (this.house.completed() === null) this.house.load().subscribe({ error: () => {} });
        this.deviceService.startSSE();
      } else {
        this.house.reset();
        this.deviceService.destroy();
      }
    });
  }

  ngOnDestroy(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
  }
}

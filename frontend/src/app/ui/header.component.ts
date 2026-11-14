import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

export interface NavItem { label: string; href: string; icon: string; }

/** Barre supérieure : marque, navigation (menu repliable sur mobile) et compte connecté. */
@Component({
  selector: 'app-header',
  standalone: true,
  imports: [RouterLink, RouterLinkActive],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="app-header">
      <a class="app-header__brand" routerLink="/home">
        <img src="assets/logo.svg" alt="" width="28" height="28" />
        <span>{{ appName() }}</span>
      </a>
      @if (nav().length) {
        <button type="button" class="app-header__toggle" [attr.aria-expanded]="open()" aria-controls="main-nav"
                aria-label="Menu" (click)="open.set(!open())">
          <i class="fa-solid fa-bars" aria-hidden="true"></i>
        </button>
        <nav id="main-nav" class="app-header__nav" [class.is-open]="open()" aria-label="Navigation principale">
          @for (item of nav(); track item.href) {
            <a [routerLink]="item.href" routerLinkActive="is-active" (click)="open.set(false)">
              <i [class]="item.icon" aria-hidden="true"></i><span>{{ item.label }}</span>
            </a>
          }
        </nav>
      }
      @if (user(); as u) {
        <div class="app-header__user">
          <span class="app-header__username"><i class="fa-solid fa-user" aria-hidden="true"></i> {{ u.name }}</span>
          <button type="button" class="ui-btn ui-btn--ghost ui-btn--sm" (click)="logout.emit()">
            <i class="fa-solid fa-right-from-bracket" aria-hidden="true"></i> Déconnexion
          </button>
        </div>
      }
    </header>
  `,
})
export class AppHeaderComponent {
  readonly appName = input<string>('Cal-Home Alt');
  readonly nav = input<NavItem[]>([]);
  readonly user = input<{ name: string } | null>(null);
  readonly logout = output<void>();
  readonly open = signal(false);
}

import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-footer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<footer class="app-footer">Cal-Home Alt — projet indépendant et bénévole, non affilié à Calyps'HOME ni à Profalux · aucune garantie, à vos risques et périls</footer>`,
})
export class AppFooterComponent {}

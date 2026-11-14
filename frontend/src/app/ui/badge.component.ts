import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export type UiTone = 'primary' | 'success' | 'warning' | 'error' | 'info' | 'neutral';

/** Pastille de statut. */
@Component({
  selector: 'ui-badge',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span [class]="classes()"><ng-content /></span>`,
})
export class UiBadgeComponent {
  readonly type = input<UiTone | string>('neutral');
  readonly pill = input<boolean>(false);
  readonly classes = computed(() => `ui-badge ui-badge--${this.type()}${this.pill() ? ' ui-badge--pill' : ''}`);
}

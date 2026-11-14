import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

const ICONS: Record<string, string> = {
  info: 'fa-solid fa-circle-info',
  success: 'fa-solid fa-circle-check',
  warning: 'fa-solid fa-triangle-exclamation',
  error: 'fa-solid fa-circle-xmark',
};

/** Bandeau d'information, d'avertissement ou d'erreur. */
@Component({
  selector: 'ui-alert',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div [class]="classes()" [attr.role]="type() === 'error' || type() === 'warning' ? 'alert' : 'status'">
      <i [class]="icon()" aria-hidden="true"></i>
      <div class="ui-alert__content">
        @if (title()) { <strong class="ui-alert__title">{{ title() }}</strong> }
        <div><ng-content /></div>
      </div>
    </div>
  `,
})
export class UiAlertComponent {
  readonly type = input<'info' | 'success' | 'warning' | 'error' | string>('info');
  readonly title = input<string>('');
  readonly classes = computed(() => `ui-alert ui-alert--${this.type()}`);
  readonly icon = computed(() => ICONS[this.type()] ?? ICONS['info']);
}

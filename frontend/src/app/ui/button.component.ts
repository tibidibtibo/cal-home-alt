import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

/** Bouton. `(clicked)` n'est émis que s'il est actif. */
@Component({
  selector: 'ui-button',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button type="button" [class]="classes()" [disabled]="disabled() || loading()" [attr.title]="title() || null"
            [attr.aria-label]="title() || null" (click)="clicked.emit($event)">
      @if (loading()) { <i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i> }
      @else if (icon()) { <i [class]="icon()" aria-hidden="true"></i> }
      <ng-content />
    </button>
  `,
})
export class UiButtonComponent {
  readonly variant = input<'primary' | 'secondary' | 'ghost' | 'success' | 'warning' | 'error' | string>('primary');
  readonly size = input<'sm' | 'md' | 'lg'>('md');
  readonly icon = input<string>('');
  readonly title = input<string>('');
  readonly disabled = input<boolean>(false);
  readonly loading = input<boolean>(false);
  readonly clicked = output<MouseEvent>();
  readonly classes = computed(() => `ui-btn ui-btn--${this.variant()} ui-btn--${this.size()}`);
}

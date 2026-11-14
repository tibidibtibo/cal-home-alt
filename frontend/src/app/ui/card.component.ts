import { Component, input } from '@angular/core';

/** Carte de contenu : titre optionnel (avec icône) et corps projeté. */
@Component({
  selector: 'ui-card',
  standalone: true,
  template: `
    <section class="ui-card">
      @if (heading()) {
        <header class="ui-card__header">
          @if (icon()) { <i [class]="icon()" aria-hidden="true"></i> }
          <h2 class="ui-card__title">{{ heading() }}</h2>
        </header>
      }
      <div class="ui-card__body"><ng-content /></div>
      <footer class="ui-card__footer"><ng-content select="[slot=footer]" /></footer>
    </section>
  `,
})
export class UiCardComponent {
  readonly heading = input<string>('');
  readonly icon = input<string>('');
}

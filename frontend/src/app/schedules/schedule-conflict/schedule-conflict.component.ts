import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { UiAlertComponent } from '../../ui';
import { ScheduleConflict } from '../schedule.model';

@Component({
  selector: 'app-schedule-conflict',
  standalone: true,
  imports: [CommonModule, UiAlertComponent],
  template: `
    @if (conflicts.length > 0) {
      <div [class.inline-conflict]="inline">
        <ui-alert type="warning" [title]="inline ? 'Risque de conflit' : 'Conflits détectés entre les règles actives'">
          <ul class="conflict-list">
            @for (c of conflicts; track c.device_id + '-' + c.description) {
              <li>
                <strong>{{ c.shutter_name || 'Volet #' + c.device_id }}</strong>: {{ c.description }}
                @if (!inline) {
                  <div class="rules-hint">Règles concernées : {{ c.schedule_names.join(', ') }}</div>
                }
              </li>
            }
          </ul>
        </ui-alert>
      </div>
    } @else if (inline && showSuccess) {
      <ui-alert type="success">Aucun conflit détecté avec vos autres règles actives.</ui-alert>
    }
  `,
  styles: [`
    .conflict-list { margin: 0.5rem 0 0; padding-left: 1.25rem; }
    .conflict-list li { margin-bottom: 0.5rem; font-size: 0.875rem; color: var(--color-text); }
    .rules-hint { font-size: 0.75rem; color: var(--color-text-muted); margin-top: 0.15rem; }
    .inline-conflict { margin-top: 1rem; }
  `]
})
export class ScheduleConflictComponent {
  @Input() conflicts: ScheduleConflict[] = [];
  @Input() inline = false;
  @Input() showSuccess = false;
}

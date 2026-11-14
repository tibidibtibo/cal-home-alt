import { Component, Input } from '@angular/core';
import { PlanEvent } from '../schedule.model';
import { planActionLabel, planDevicesLabel, planTime } from './plan-format';

/** Liste chronologique d'événements d'un planning ; `now` (ms) grise ceux déjà passés. */
@Component({
  selector: 'app-plan-events',
  standalone: true,
  template: `
    @if (events.length === 0) {
      <p class="empty">{{ emptyText }}</p>
    } @else {
      <ul class="events">
        @for (ev of events; track ev.schedule_id + ev.time + ev.action) {
          <li class="event" [class.close]="ev.action === 'close'" [class.open]="ev.action === 'open'"
              [class.level]="ev.action === 'level'" [class.done]="isDone(ev)">
            <span class="time">{{ time(ev) }}</span>
            <i class="icon fa-solid"
               [class.fa-chevron-down]="ev.action === 'close'"
               [class.fa-chevron-up]="ev.action === 'open'"
               [class.fa-sliders]="ev.action === 'level'"></i>
            <span class="what">
              <span class="label">{{ label(ev) }}</span>
              <span class="meta">{{ ev.schedule_name }} · {{ devices(ev) }}</span>
            </span>
            @if (isDone(ev)) { <i class="check fa-solid fa-check" title="Passé"></i> }
          </li>
        }
      </ul>
    }
  `,
  styles: [`
    .events { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.5rem; }
    .event {
      display: flex; align-items: center; gap: 0.75rem; padding: 0.55rem 0.8rem;
      border: 1px solid var(--color-border); border-radius: var(--radius-md);
      background: var(--color-surface); border-left-width: 4px;
    }
    .event.close { border-left-color: #dc2626; }
    .event.open { border-left-color: #16a34a; }
    .event.level { border-left-color: #2563eb; }
    .event.done { opacity: 0.5; }
    .time { font-family: monospace; font-size: 1.05rem; font-weight: 700; min-width: 3.4rem; color: var(--color-text); }
    .icon { width: 1rem; text-align: center; color: var(--color-text-muted); }
    .event.close .icon { color: #dc2626; }
    .event.open .icon { color: #16a34a; }
    .what { display: flex; flex-direction: column; min-width: 0; flex: 1; }
    .label { font-weight: 600; color: var(--color-text); }
    .meta { font-size: 0.8rem; color: var(--color-text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .check { color: #16a34a; }
    .empty { margin: 0; color: var(--color-text-muted); font-style: italic; font-size: 0.9rem; }
  `]
})
export class PlanEventsComponent {
  @Input() events: PlanEvent[] = [];
  @Input() now: number | null = null;
  @Input() emptyText = 'Aucune programmation.';

  time = planTime;
  label = planActionLabel;
  devices = planDevicesLabel;

  isDone(ev: PlanEvent): boolean {
    return this.now !== null && Date.parse(ev.time) <= this.now;
  }
}

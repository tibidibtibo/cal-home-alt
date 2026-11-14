import { Component, DestroyRef, OnDestroy, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { BehaviorSubject, combineLatest, of } from 'rxjs';
import { catchError, switchMap, tap } from 'rxjs/operators';
import { UiCardComponent } from '../../ui';
import { ScheduleService } from '../schedule.service';
import { DayPlan } from '../schedule.model';
import { PlanEventsComponent } from './plan-events.component';
import { localIsoDate } from './plan-format';

/**
 * Planning d'un jour (aujourd'hui par défaut) construit par le backend à partir des règles ACTIVES.
 * Se recharge à chaque changement de la liste des règles (activation, désactivation, édition, suppression).
 */
@Component({
  selector: 'app-day-plan',
  standalone: true,
  imports: [FormsModule, UiCardComponent, PlanEventsComponent],
  template: `
    <ui-card [heading]="isToday ? 'Planning du jour' : 'Planning du ' + selectedDate" icon="fa-solid fa-calendar-day">
      <div class="header">
        @if (plan) {
          <div class="sun-times">
            <span class="sun-item"><i class="fa-solid fa-arrow-up"></i> Lever {{ plan.sunrise }}</span>
            <span class="sun-item"><i class="fa-solid fa-arrow-down"></i> Coucher {{ plan.sunset }}</span>
            @if (plan.holiday) { <span class="sun-item"><i class="fa-solid fa-flag"></i> {{ plan.holiday }}</span> }
          </div>
        }
        <input type="date" [ngModel]="selectedDate" (ngModelChange)="onDate($event)">
      </div>

      @if (error) { <p class="msg error">{{ error }}</p> }
      @else if (!plan) { <p class="msg">Chargement…</p> }
      @else {
        <app-plan-events [events]="plan.events" [now]="isToday ? now : null"
          emptyText="Aucune programmation active ce jour-là."></app-plan-events>
      }
    </ui-card>
  `,
  styles: [`
    .header { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 1rem; }
    .sun-times { display: flex; gap: 1rem; flex-wrap: wrap; }
    .sun-item { font-size: 0.9rem; font-weight: 600; color: var(--color-text-muted); display: flex; align-items: center; gap: 0.35rem; }
    .sun-item i { color: #f59e0b; }
    input[type=date] {
      padding: 0.4rem 0.6rem; border: 1px solid var(--color-border); border-radius: var(--radius-md);
      font-size: 0.875rem; background: var(--color-background); color: var(--color-text);
    }
    .msg { margin: 0; font-size: 0.9rem; color: var(--color-text-muted); }
    .msg.error { color: var(--color-error, #dc2626); }
  `]
})
export class DayPlanComponent implements OnInit, OnDestroy {
  private readonly scheduleService = inject(ScheduleService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly date$ = new BehaviorSubject<string>(localIsoDate(new Date()));
  private timer: ReturnType<typeof setInterval> | null = null;

  plan: DayPlan | null = null;
  error = '';
  now = Date.now();

  get selectedDate(): string { return this.date$.value; }
  get isToday(): boolean { return this.selectedDate === localIsoDate(new Date(this.now)); }

  ngOnInit(): void {
    this.timer = setInterval(() => (this.now = Date.now()), 30_000);
    // schedules$ émet à chaque (dés)activation / édition / suppression : le planning suit.
    combineLatest([this.scheduleService.schedules$, this.date$]).pipe(
      tap(() => (this.error = '')),
      switchMap(([, date]) => this.scheduleService.getPlan(date || undefined).pipe(
        catchError(err => {
          this.error = err?.error?.detail || 'Impossible de charger le planning.';
          return of(null);
        })
      )),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(plan => { if (plan) this.plan = plan; });
  }

  ngOnDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  onDate(value: string): void {
    if (value) this.date$.next(value);
  }
}

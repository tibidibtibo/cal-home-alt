import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { UiCardComponent } from '../ui';
import { ScheduleService } from '../schedules/schedule.service';
import { DayPlan, PlanEvent } from '../schedules/schedule.model';
import { PlanEventsComponent } from '../schedules/plan/plan-events.component';
import { localIsoDate, planActionLabel, planDevicesLabel, planTime } from '../schedules/plan/plan-format';

/** Accueil : prochaine programmation (aujourd'hui ou demain) + planning complet de demain. */
@Component({
  selector: 'app-home',
  standalone: true,
  imports: [RouterLink, UiCardComponent, PlanEventsComponent],
  template: `
    <div class="page-header">
      <h1 class="page-title">Accueil</h1>
      <a class="link" routerLink="/schedules"><i class="fa-solid fa-clock"></i> Gérer les automatisations</a>
    </div>

    @if (error) { <p class="error">{{ error }}</p> }

    <div class="grid">
      <ui-card heading="Prochaine programmation" icon="fa-solid fa-forward-step">
        @if (!loaded) {
          <p class="muted">Chargement…</p>
        } @else if (nextGroup.length === 0) {
          <p class="muted">Aucune programmation à venir. Activez une règle dans
            <a routerLink="/schedules">Automatisations</a>.</p>
        } @else {
          <div class="next-when">
            <span class="next-time">{{ time(nextGroup[0]) }}</span>
            <span class="next-rel">{{ relative(nextGroup[0]) }}</span>
          </div>
          @for (ev of nextGroup; track ev.schedule_id + ev.action) {
            <div class="next-what" [class.close]="ev.action === 'close'" [class.open]="ev.action === 'open'">
              <i class="fa-solid"
                 [class.fa-chevron-down]="ev.action === 'close'"
                 [class.fa-chevron-up]="ev.action === 'open'"
                 [class.fa-sliders]="ev.action === 'level'"></i>
              <strong>{{ label(ev) }}</strong>
              <span class="muted">{{ ev.schedule_name }} · {{ devices(ev) }}</span>
            </div>
          }
        }
      </ui-card>

      <ui-card heading="Demain" icon="fa-solid fa-calendar-day">
        @if (!loaded) {
          <p class="muted">Chargement…</p>
        } @else if (tomorrow) {
          <p class="sub">
            {{ dayLabel(tomorrow.date) }} · <i class="fa-solid fa-arrow-up sun"></i> {{ tomorrow.sunrise }}
            <i class="fa-solid fa-arrow-down sun"></i> {{ tomorrow.sunset }}
            @if (tomorrow.holiday) { · {{ tomorrow.holiday }} }
          </p>
          <app-plan-events [events]="tomorrow.events" emptyText="Aucune programmation active demain."></app-plan-events>
        }
      </ui-card>
    </div>
  `,
  styles: [`
    .page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; flex-wrap: wrap; gap: 0.5rem; }
    .page-title { margin: 0; font-size: 1.5rem; font-weight: 700; color: var(--color-text); }
    .link { color: var(--color-primary, #4f46e5); text-decoration: none; font-weight: 600; font-size: 0.9rem; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 1.25rem; align-items: start; }
    .muted { color: var(--color-text-muted); font-size: 0.9rem; }
    p.muted { margin: 0; }
    .error { color: var(--color-error, #dc2626); }
    .next-when { display: flex; align-items: baseline; gap: 0.9rem; flex-wrap: wrap; margin-bottom: 0.75rem; }
    .next-time { font-family: monospace; font-size: 2.6rem; font-weight: 700; line-height: 1; color: var(--color-text); }
    .next-rel { font-size: 1rem; color: var(--color-text-muted); font-weight: 600; }
    .next-what { display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; padding: 0.3rem 0; }
    .next-what.close i { color: #dc2626; }
    .next-what.open i { color: #16a34a; }
    .sub { margin: 0 0 0.9rem; font-size: 0.9rem; color: var(--color-text-muted); font-weight: 600; text-transform: capitalize; }
    .sun { color: #f59e0b; margin-left: 0.35rem; }
  `]
})
export class HomeComponent implements OnInit, OnDestroy {
  private readonly scheduleService = inject(ScheduleService);
  private timer: ReturnType<typeof setInterval> | null = null;
  private loadedDay = '';

  today: DayPlan | null = null;
  tomorrow: DayPlan | null = null;
  nextGroup: PlanEvent[] = [];
  loaded = false;
  error = '';
  private now = Date.now();

  time = planTime;
  label = planActionLabel;
  devices = planDevicesLabel;

  ngOnInit(): void {
    this.load();
    // Rafraîchit le décompte chaque 30 s, recharge les plannings toutes les 5 min et au changement de jour.
    let ticks = 0;
    this.timer = setInterval(() => {
      this.now = Date.now();
      ticks++;
      if (ticks % 10 === 0 || localIsoDate(new Date()) !== this.loadedDay) this.load();
      else this.computeNext();
    }, 30_000);
  }

  ngOnDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private load(): void {
    const now = new Date();
    const day = localIsoDate(now);
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    forkJoin([this.scheduleService.getPlan(day), this.scheduleService.getPlan(localIsoDate(next))]).subscribe({
      next: ([today, tomorrow]) => {
        this.today = today;
        this.tomorrow = tomorrow;
        this.loadedDay = day;
        this.loaded = true;
        this.error = '';
        this.now = Date.now();
        this.computeNext();
      },
      error: err => {
        this.error = err?.error?.detail || 'Impossible de charger les programmations.';
        this.loaded = true;
      }
    });
  }

  /** Prochain événement futur (aujourd'hui puis demain) + ceux qui partent à la même minute. */
  private computeNext(): void {
    const upcoming = [...(this.today?.events ?? []), ...(this.tomorrow?.events ?? [])]
      .filter(ev => Date.parse(ev.time) > this.now)
      .sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
    this.nextGroup = upcoming.length ? upcoming.filter(ev => ev.time === upcoming[0].time) : [];
  }

  relative(ev: PlanEvent): string {
    const mins = Math.max(0, Math.ceil((Date.parse(ev.time) - this.now) / 60_000));
    const sameDay = ev.time.slice(0, 10) === this.today?.date;
    if (mins < 60) return `dans ${mins} min`;
    const text = `dans ${Math.floor(mins / 60)} h ${String(mins % 60).padStart(2, '0')}`;
    return sameDay ? text : `${text} · demain`;
  }

  dayLabel(isoDate: string): string {
    const [y, m, d] = isoDate.split('-').map(Number);
    return new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(y, m - 1, d));
  }
}

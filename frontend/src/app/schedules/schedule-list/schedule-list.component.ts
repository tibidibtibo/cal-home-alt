import { Component, OnInit } from '@angular/core';
import { CommonModule, AsyncPipe } from '@angular/common';
import { UiCardComponent, UiBadgeComponent, UiButtonComponent } from '../../ui';
import { ScheduleService } from '../schedule.service';
import { Schedule, ScheduleConflict } from '../schedule.model';
import { Observable } from 'rxjs';
import { ScheduleFormComponent } from '../schedule-form/schedule-form.component';
import { ScheduleConflictComponent } from '../schedule-conflict/schedule-conflict.component';
import { DayPlanComponent } from '../plan/day-plan.component';

@Component({
  selector: 'app-schedule-list',
  standalone: true,
  imports: [
    CommonModule,
    AsyncPipe,
    ScheduleFormComponent,
    ScheduleConflictComponent,
    DayPlanComponent,
    UiCardComponent,
    UiBadgeComponent,
    UiButtonComponent
  ],
  templateUrl: './schedule-list.component.html',
  styles: [`
    .page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; }
    .page-title { margin: 0; font-size: 1.5rem; font-weight: 700; color: var(--color-text); }
    .form-section { margin-bottom: 1.5rem; }
    .conflicts-section { margin-bottom: 1.5rem; }
    .plan-section { margin-bottom: 1.5rem; }
    .schedules-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 1.25rem; }

    .info-block { display: flex; flex-direction: column; gap: 0.75rem; }
    .info-row { display: flex; justify-content: space-between; align-items: center; font-size: 0.9rem; }
    .info-label { font-weight: 500; color: var(--color-text-muted); }
    .info-value { font-weight: 600; color: var(--color-text); }

    .action-block { display: flex; justify-content: space-between; align-items: center; width: 100%; gap: 0.5rem; }
    .main-actions { display: flex; gap: 0.5rem; }
    .toggle-action { margin-left: auto; }

    @media (max-width: 480px) {
      .schedules-grid { grid-template-columns: 1fr; }
      .action-block { flex-direction: column; align-items: stretch; }
      .main-actions { justify-content: space-between; }
      .toggle-action { margin-left: 0; margin-top: 0.5rem; }
      .toggle-action ui-button { width: 100%; }
    }
  `]
})
export class ScheduleListComponent implements OnInit {
  schedules$: Observable<Schedule[]>;
  conflicts$: Observable<ScheduleConflict[]>;
  showForm = false;
  editingSchedule: Schedule | null = null;

  constructor(private scheduleService: ScheduleService) {
    this.schedules$ = this.scheduleService.schedules$;
    this.conflicts$ = this.scheduleService.conflicts$;
  }

  ngOnInit(): void {
    this.scheduleService.loadSchedules().subscribe();
    this.scheduleService.loadConflicts().subscribe();
  }

  toggle(s: Schedule): void {
    this.scheduleService.toggleSchedule(s.id, !s.enabled).subscribe();
  }

  delete(id: number): void {
    if (confirm('Supprimer cette règle ?')) {
      this.scheduleService.deleteSchedule(id).subscribe();
    }
  }

  openForm(s: Schedule | null = null): void {
    this.editingSchedule = s;
    this.showForm = true;
  }

  onFormSaved(): void {
    this.showForm = false;
    this.editingSchedule = null;
    this.scheduleService.loadConflicts().subscribe();
  }

  getModeLabel(mode: string): string {
    switch (mode) {
      case 'fixed': return 'Fixe';
      case 'presence': return 'Soleil';
      case 'solar': return 'Solaire';
      case 'absence': return 'Absence';
      default: return mode;
    }
  }

  getActionLabel(s: Schedule): string {
    switch (s.action) {
      case 'open': return 'Ouvrir';
      case 'close': return 'Fermer';
      case 'level': return `Niveau ${s.level}%`;
      default: return s.action;
    }
  }

  getDaysLabel(days: string | undefined): string {
    if (!days) return '—';
    const dayMap: Record<string, string> = {
      '1': 'Lun', '2': 'Mar', '3': 'Mer', '4': 'Jeu', '5': 'Ven', '6': 'Sam', '7': 'Dim'
    };
    return days.split(',').map(d => dayMap[d] || d).join(', ');
  }
}

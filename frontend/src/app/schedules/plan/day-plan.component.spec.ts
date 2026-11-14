import { TestBed } from '@angular/core/testing';
import { BehaviorSubject, of } from 'rxjs';
import { DayPlanComponent } from './day-plan.component';
import { ScheduleService } from '../schedule.service';
import { DayPlan, Schedule } from '../schedule.model';

const plan = (names: string[]): DayPlan => ({
  date: '2026-11-13', sunrise: '07:30', sunset: '17:00', day_type: 'weekday', holiday: null,
  events: names.map((n, i) => ({
    time: `2026-11-13T17:2${i}:00+01:00`, action: 'close', level: null, schedule_id: i + 1,
    schedule_name: n, mode: 'presence', device_ids: ['0'], device_names: ['Salon'],
  })),
});

describe('DayPlanComponent', () => {
  it('reloads the plan whenever the schedules change (enable/disable)', () => {
    const schedules$ = new BehaviorSubject<Schedule[]>([]);
    const svc = jasmine.createSpyObj('ScheduleService', ['getPlan']);
    svc.schedules$ = schedules$;
    svc.getPlan.and.returnValues(of(plan(['Soir'])), of(plan([])));
    TestBed.configureTestingModule({ imports: [DayPlanComponent], providers: [{ provide: ScheduleService, useValue: svc }] });

    const fixture = TestBed.createComponent(DayPlanComponent);
    fixture.detectChanges();
    expect(svc.getPlan).toHaveBeenCalledTimes(1);
    expect(fixture.nativeElement.textContent).toContain('Soir');

    schedules$.next([{ id: 1, enabled: false } as Schedule]);   // règle désactivée
    fixture.detectChanges();
    expect(svc.getPlan).toHaveBeenCalledTimes(2);
    expect(fixture.nativeElement.textContent).not.toContain('Soir');
    expect(fixture.nativeElement.textContent).toContain('Aucune programmation active');
  });
});

import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { HomeComponent } from './home.component';
import { ScheduleService } from '../schedules/schedule.service';
import { DayPlan, PlanEvent } from '../schedules/schedule.model';
import { localIsoDate } from '../schedules/plan/plan-format';

const ev = (day: string, hhmm: string, name: string): PlanEvent => ({
  time: `${day}T${hhmm}:00+01:00`, action: 'close', level: null, schedule_id: 1,
  schedule_name: name, mode: 'presence', device_ids: ['0'], device_names: ['Salon'],
});
const plan = (day: string, events: PlanEvent[]): DayPlan =>
  ({ date: day, sunrise: '07:30', sunset: '17:00', day_type: 'weekday', holiday: null, events });

describe('HomeComponent', () => {
  function setup(todayEvents: (d: string) => PlanEvent[], tomorrowEvents: (d: string) => PlanEvent[]) {
    const svc = jasmine.createSpyObj('ScheduleService', ['getPlan']);
    svc.getPlan.and.callFake((day: string) => {
      const today = localIsoDate(new Date());
      return of(plan(day, day === today ? todayEvents(day) : tomorrowEvents(day)));
    });
    TestBed.configureTestingModule({ imports: [HomeComponent], providers: [provideRouter([]), { provide: ScheduleService, useValue: svc }] });
    const fixture = TestBed.createComponent(HomeComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('picks tomorrow\'s first event when nothing is left today', () => {
    const f = setup(d => [ev(d, '00:00', 'Passé')], d => [ev(d, '08:00', 'Matin')]);
    expect(f.componentInstance.nextGroup.map(e => e.schedule_name)).toEqual(['Matin']);
    expect(f.nativeElement.textContent).toContain('demain');
  });

  it('shows an empty state when no schedule is active', () => {
    const f = setup(() => [], () => []);
    expect(f.componentInstance.nextGroup).toEqual([]);
    expect(f.nativeElement.textContent).toContain('Aucune programmation à venir');
  });
});

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ScheduleListComponent } from './schedule-list.component';
import { ScheduleService } from '../schedule.service';
import { of } from 'rxjs';

describe('ScheduleListComponent', () => {
  let component: ScheduleListComponent;
  let fixture: ComponentFixture<ScheduleListComponent>;
  let scheduleServiceSpy: jasmine.SpyObj<ScheduleService>;

  beforeEach(async () => {
    scheduleServiceSpy = jasmine.createSpyObj('ScheduleService', ['loadSchedules', 'loadConflicts', 'deleteSchedule', 'toggleSchedule', 'getPlan']);
    scheduleServiceSpy.loadSchedules.and.returnValue(of([]));
    scheduleServiceSpy.loadConflicts.and.returnValue(of([]));
    scheduleServiceSpy.toggleSchedule.and.returnValue(of({ enabled: false }));
    scheduleServiceSpy.deleteSchedule.and.returnValue(of(void 0));
    scheduleServiceSpy.getPlan.and.returnValue(of({ date: '2026-11-13', sunrise: '07:30', sunset: '17:00', day_type: 'weekday', holiday: null, events: [] }));
    scheduleServiceSpy.schedules$ = of([]) as any;
    scheduleServiceSpy.conflicts$ = of([]) as any;

    await TestBed.configureTestingModule({
      imports: [ScheduleListComponent],
      providers: [
        { provide: ScheduleService, useValue: scheduleServiceSpy }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(ScheduleListComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should toggle schedule', () => {
    const s = { id: '1', enabled: true } as any;
    component.toggle(s);
    expect(scheduleServiceSpy.toggleSchedule).toHaveBeenCalledWith('1' as any, false);
  });

  it('should delete schedule after confirmation', () => {
    spyOn(window, 'confirm').and.returnValue(true);
    component.delete(1);
    expect(scheduleServiceSpy.deleteSchedule).toHaveBeenCalledWith(1);
  });

  it('should NOT delete schedule if NOT confirmed', () => {
    spyOn(window, 'confirm').and.returnValue(false);
    component.delete(1);
    expect(scheduleServiceSpy.deleteSchedule).not.toHaveBeenCalled();
  });

  it('should open form', () => {
    component.openForm();
    expect(component.showForm).toBeTrue();
    expect(component.editingSchedule).toBeNull();

    const s = { id: '1' } as any;
    component.openForm(s);
    expect(component.editingSchedule).toBe(s);
  });

  it('should handle form saved', () => {
    component.showForm = true;
    component.onFormSaved();
    expect(component.showForm).toBeFalse();
    expect(scheduleServiceSpy.loadConflicts).toHaveBeenCalled();
  });

  it('should get mode labels', () => {
    expect(component.getModeLabel('fixed')).toBe('Fixe');
    expect(component.getModeLabel('presence')).toBe('Soleil');
    expect(component.getModeLabel('absence')).toBe('Absence');
    expect(component.getModeLabel('solar')).toBe('Solaire');
    expect(component.getModeLabel('unknown')).toBe('unknown');
  });
});

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ScheduleFormComponent } from './schedule-form.component';
import { ScheduleService } from '../schedule.service';
import { DeviceService } from '../../devices/device.service';
import { of } from 'rxjs';
import { ReactiveFormsModule } from '@angular/forms';
import { Schedule } from '../schedule.model';

describe('ScheduleFormComponent', () => {
  let component: ScheduleFormComponent;
  let fixture: ComponentFixture<ScheduleFormComponent>;
  let scheduleServiceSpy: jasmine.SpyObj<ScheduleService>;
  let deviceServiceSpy: jasmine.SpyObj<DeviceService>;

  beforeEach(async () => {
    scheduleServiceSpy = jasmine.createSpyObj('ScheduleService', ['createSchedule', 'updateSchedule', 'loadConflicts', 'getSunTimes']);
    scheduleServiceSpy.getSunTimes.and.returnValue(of({ sunrise: '08:00', sunset: '17:30', timezone: 'Europe/Paris' }));
    deviceServiceSpy = jasmine.createSpyObj('DeviceService', ['getDevices']);
    deviceServiceSpy.getDevices.and.returnValue(of([{ id: '0', name: 'S1', room: 'R1' } as any]));

    await TestBed.configureTestingModule({
      imports: [ScheduleFormComponent, ReactiveFormsModule],
      providers: [
        { provide: ScheduleService, useValue: scheduleServiceSpy },
        { provide: DeviceService, useValue: deviceServiceSpy }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(ScheduleFormComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should navigate through steps', () => {
    scheduleServiceSpy.loadConflicts.and.returnValue(of([]));
    expect(component.step).toBe(1);
    component.nextStep();
    expect(component.step).toBe(2);
    component.nextStep();
    expect(component.step).toBe(3);
    expect(scheduleServiceSpy.loadConflicts).toHaveBeenCalled();
    component.prevStep();
    expect(component.step).toBe(2);
  });

  it('should toggle shutters', () => {
    component.toggleShutter('0');
    expect(component.form.value.device_ids).toContain('0');
    component.toggleShutter('0');
    expect(component.form.value.device_ids).not.toContain('0');
  });

  it('should save new schedule', () => {
    scheduleServiceSpy.createSchedule.and.returnValue(of({ id: '1' } as any));
    component.form.patchValue({ name: 'New', mode: 'fixed', device_ids: ['0'], action: 'open' });
    component.save();
    expect(scheduleServiceSpy.createSchedule).toHaveBeenCalled();
  });

  it('should update existing schedule', () => {
    const existing: Schedule = { id: 1, name: 'Old', mode: 'fixed', enabled: true, device_ids: ['0'], action: 'open', params: {}, created_at: '' };
    component.schedule = existing;
    component.ngOnInit();
    scheduleServiceSpy.updateSchedule.and.returnValue(of({ id: '1' } as any));
    component.form.patchValue({ name: 'Updated' });
    component.save();
    expect(scheduleServiceSpy.updateSchedule).toHaveBeenCalled();
  });

  it('should handle different modes in save', () => {
    scheduleServiceSpy.createSchedule.and.returnValue(of({ id: '1' } as any));

    // Valid state for save
    component.form.patchValue({ name: 'Test', device_ids: ['0'] });

    // Presence
    component.form.patchValue({ mode: 'presence', sun_event: 'sunrise', offset_dir: 'after', offset_abs: 10 });
    component.save();
    expect(scheduleServiceSpy.createSchedule.calls.mostRecent().args[0].params).toEqual({ sun_event: 'sunrise', offset_min: 10 });

    // Solar
    component.form.patchValue({ mode: 'solar', azimuth_min: 10, azimuth_max: 20, altitude_min: 5 });
    component.save();

    // Level action
    component.form.patchValue({ action: 'level', level: 42 });
    component.save();

    expect(scheduleServiceSpy.createSchedule).toHaveBeenCalledTimes(3);
  });

  it('computes signed offset and preview time for sunset', () => {
    component.form.patchValue({ mode: 'presence', sun_event: 'sunset', offset_dir: 'before', offset_abs: 15 });
    expect(component.offsetMin).toBe(-15);
    expect(component.presencePreview).toBe('17:15');
    component.form.patchValue({ offset_dir: 'at', offset_abs: 15 });
    expect(component.offsetMin).toBe(0);
    expect(component.presencePreview).toBe('17:30');
    component.form.patchValue({ offset_dir: 'after', offset_abs: 45 });
    expect(component.presencePreview).toBe('18:15');
  });

  it('builds absence payload and previews today by day type', () => {
    scheduleServiceSpy.createSchedule.and.returnValue(of({ id: '1' } as any));
    component.form.patchValue({ name: 'Absence', device_ids: ['0'], mode: 'absence', open_weekday: '08:00', open_weekend: '09:30', close_offset_min: 10 });
    component.sunTimes = { sunrise: '07:50', sunset: '17:30', timezone: 'Europe/Paris', day_type: 'weekday', holiday: null };
    expect(component.absencePreview).toEqual({ open: '08:00', close: '17:40', dayLabel: 'jour de semaine' });
    component.sunTimes = { ...component.sunTimes, day_type: 'holiday', holiday: 'Noël' };
    expect(component.absencePreview?.open).toBe('09:30');
    expect(component.absencePreview?.dayLabel).toContain('Noël');
    component.save();
    const payload = scheduleServiceSpy.createSchedule.calls.mostRecent().args[0];
    expect(payload.mode).toBe('absence');
    expect(payload.params).toEqual({ open_weekday: '08:00', open_weekend: '09:30', close_offset_min: 10 });
  });
});

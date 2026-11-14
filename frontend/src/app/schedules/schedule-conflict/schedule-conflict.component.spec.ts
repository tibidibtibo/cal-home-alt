import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ScheduleConflictComponent } from './schedule-conflict.component';

describe('ScheduleConflictComponent', () => {
  let component: ScheduleConflictComponent;
  let fixture: ComponentFixture<ScheduleConflictComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ScheduleConflictComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(ScheduleConflictComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should display conflicts when provided', () => {
    component.conflicts = [{
      device_id: '1',
      shutter_name: 'Salon',
      schedule_ids: [1, 2],
      schedule_names: ['Matin', 'Soir'],
      description: 'Conflit test'
    }];
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.conflict-list')?.textContent).toContain('Salon');
    expect(compiled.querySelector('.conflict-list')?.textContent).toContain('Conflit test');
  });

  it('should show success message in inline mode when no conflicts', () => {
    component.inline = true;
    component.showSuccess = true;
    component.conflicts = [];
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('ui-alert[type="success"]')).toBeTruthy();
  });
});

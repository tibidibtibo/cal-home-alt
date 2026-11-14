import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ShutterCardComponent } from './shutter-card.component';
import { DeviceService } from '../../devices/device.service';
import { of, throwError } from 'rxjs';
import { provideRouter } from '@angular/router';
import { NotificationService } from '../../shared/notification.service';
import { DeviceState } from '../../devices/device.model';

describe('ShutterCardComponent', () => {
  let component: ShutterCardComponent;
  let fixture: ComponentFixture<ShutterCardComponent>;
  let deviceServiceSpy: jasmine.SpyObj<DeviceService>;
  let notifSpy: jasmine.SpyObj<NotificationService>;

  const mockShutter: DeviceState = {
    id: '0', name: 'S1', type: 'shutter', level: 50, status: 'middle', is_closed: false, has_tilt: true, tilt_angle: 0
  };

  beforeEach(async () => {
    notifSpy = jasmine.createSpyObj('NotificationService', ['error', 'success']);
    deviceServiceSpy = jasmine.createSpyObj('DeviceService', ['open', 'close', 'stop', 'setLevel', 'setTilt']);
    deviceServiceSpy.open.and.returnValue(of(void 0));
    deviceServiceSpy.close.and.returnValue(of(void 0));
    deviceServiceSpy.stop.and.returnValue(of(void 0));
    deviceServiceSpy.setLevel.and.returnValue(of(void 0));
    deviceServiceSpy.setTilt.and.returnValue(of(void 0));

    await TestBed.configureTestingModule({
      imports: [ShutterCardComponent],
      providers: [
        provideRouter([]),
        { provide: DeviceService, useValue: deviceServiceSpy },
        { provide: NotificationService, useValue: notifSpy },
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(ShutterCardComponent);
    component = fixture.componentInstance;
    component.shutter = mockShutter;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should call open() on service', () => {
    component.open();
    expect(deviceServiceSpy.open).toHaveBeenCalledWith('0');
  });

  it('should call close() on service', () => {
    component.close();
    expect(deviceServiceSpy.close).toHaveBeenCalledWith('0');
  });

  it('should call stop() on service', () => {
    component.stop();
    expect(deviceServiceSpy.stop).toHaveBeenCalledWith('0');
  });

  it('should call setLevel on service', () => {
    const event = { target: { valueAsNumber: 75 } } as any;
    component.onSliderChange(event);
    expect(deviceServiceSpy.setLevel).toHaveBeenCalledWith('0', 75);
  });

  it('should call setTilt on service', () => {
    const event = { target: { valueAsNumber: 45 } } as any;
    component.onTiltChange(event);
    expect(deviceServiceSpy.setTilt).toHaveBeenCalledWith('0', 45);
  });

  it('should return correct status labels and types', () => {
    component.shutter.level = 100;
    expect(component.getStatusType()).toBe('success');
    expect(component.getStatusLabel()).toBe('Ouvert');

    component.shutter.level = 0;
    expect(component.getStatusType()).toBe('warning');
    expect(component.getStatusLabel()).toBe('Fermé');

    component.shutter.level = 50;
    expect(component.getStatusType()).toBe('info');
    expect(component.getStatusLabel()).toBe('Entrouvert');
  });

  it('should show the dragged level before sending it', () => {
    component.onSliderInput({ target: { valueAsNumber: 30 } } as any);
    expect(component.level).toBe(30);
    expect(deviceServiceSpy.setLevel).not.toHaveBeenCalled();
  });

  it('should announce a movement until the target level is reached', () => {
    component.open();
    expect(component.moving).toBeTrue();
    expect(component.targetLevel).toBe(100);
    component.shutter = { ...mockShutter, level: 100 };
    component.ngOnChanges({ shutter: {} as any });
    expect(component.moving).toBeFalse();
    expect(component.targetLevel).toBeNull();
  });

  it('should notify when a command fails and release the buttons', () => {
    deviceServiceSpy.close.and.returnValue(throwError(() => new Error('502')));
    component.close();
    expect(notifSpy.error).toHaveBeenCalled();
    expect(component.busy).toBeFalse();
    expect(component.moving).toBeFalse();
  });

  it('should emit the chosen room for an unassigned shutter', () => {
    const spy = jasmine.createSpy('assigned');
    component.roomAssigned.subscribe(spy);
    component.onAssign({ target: { value: '4' } } as any);
    expect(spy).toHaveBeenCalledWith({ shutter: component.shutter, roomId: 4 });
    spy.calls.reset();
    component.onAssign({ target: { value: '' } } as any);
    expect(spy).not.toHaveBeenCalled();
  });
});

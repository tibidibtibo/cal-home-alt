import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ShutterListComponent } from './shutter-list.component';
import { DeviceService } from '../../devices/device.service';
import { ShutterConfigService } from '../shutter-config.service';
import { NotificationService } from '../../shared/notification.service';
import { of, BehaviorSubject } from 'rxjs';
import { ShutterCardComponent } from '../shutter-card/shutter-card.component';

describe('ShutterListComponent', () => {
  let component: ShutterListComponent;
  let fixture: ComponentFixture<ShutterListComponent>;
  let deviceServiceSpy: jasmine.SpyObj<DeviceService>;
  let configServiceSpy: jasmine.SpyObj<ShutterConfigService>;
  let notifSpy: jasmine.SpyObj<NotificationService>;
  let loaded$: BehaviorSubject<boolean>;

  beforeEach(async () => {
    loaded$ = new BehaviorSubject<boolean>(true);
    deviceServiceSpy = jasmine.createSpyObj('DeviceService', ['getDevices', 'isLoaded', 'getStatus', 'close', 'open', 'setRoom', 'startSSE', 'refresh']);
    deviceServiceSpy.getDevices.and.returnValue(of([
      { id: '0', name: 'Baie vitrée', type: 'shutter', level: 100, room_name: 'Salon', db_id: 1 } as any,
      { id: '1', name: 'Unknown', type: 'shutter', level: 0, db_id: 2 } as any,
      { id: '2', name: 'Porte', type: 'sensor', is_closed: true } as any,
    ]));
    deviceServiceSpy.isLoaded.and.returnValue(loaded$);
    deviceServiceSpy.getStatus.and.returnValue(of({ live: true, failed: false, boxReachable: true, lastPoll: null }));
    deviceServiceSpy.close.and.returnValue(of(void 0));
    deviceServiceSpy.open.and.returnValue(of(void 0));
    deviceServiceSpy.setRoom.and.returnValue(of({ ok: true }));
    configServiceSpy = jasmine.createSpyObj('ShutterConfigService', ['getRooms']);
    configServiceSpy.getRooms.and.returnValue(of([{ id: 1, name: 'Salon', card_id: 1, card_name: 'Maison' }]));
    notifSpy = jasmine.createSpyObj('NotificationService', ['error', 'success']);

    await TestBed.configureTestingModule({
      imports: [ShutterListComponent, ShutterCardComponent],
      providers: [
        provideRouter([]),
        { provide: DeviceService, useValue: deviceServiceSpy },
        { provide: ShutterConfigService, useValue: configServiceSpy },
        { provide: NotificationService, useValue: notifSpy },
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(ShutterListComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should group shutters by room and list sensors apart', () => {
    expect(component.rooms.length).toBe(2);
    expect(component.rooms[0].name).toBe('Salon');
    expect(component.rooms[1].name).toBe('Non assignés');
    expect(component.rooms[1].unassigned).toBeTrue();
    expect(component.sensors.length).toBe(1);
  });

  it('should summarize open and closed shutters', () => {
    expect(component.totalShutters).toBe(2);
    expect(component.openCount).toBe(1);
    expect(component.closedCount).toBe(1);
  });

  it('should filter by state', () => {
    component.setFilter('open');
    expect(component.rooms.map(r => r.name)).toEqual(['Salon']);
    component.setFilter('closed');
    expect(component.rooms.map(r => r.name)).toEqual(['Non assignés']);
  });

  it('should ask for confirmation before closing everything', fakeAsync(() => {
    component.onCloseAll();
    expect(component.confirmCloseAll).toBeTrue();
    expect(deviceServiceSpy.close).not.toHaveBeenCalled();
    component.onCloseAll();
    expect(deviceServiceSpy.close).toHaveBeenCalledTimes(2);   // volets uniquement, pas le capteur
    expect(component.confirmCloseAll).toBeFalse();
    tick(5000);
  }));

  it('should drop the confirmation after a delay', fakeAsync(() => {
    component.onCloseAll();
    tick(5000);
    expect(component.confirmCloseAll).toBeFalse();
  }));

  it('should close only the shutters of a room', () => {
    component.closeRoom(component.rooms[0]);
    expect(deviceServiceSpy.close).toHaveBeenCalledOnceWith('0');
  });

  it('should classify a shutter in a room', () => {
    component.onAssign({ shutter: { id: '1', name: 'Unknown', db_id: 2 } as any, roomId: 1 });
    expect(deviceServiceSpy.setRoom).toHaveBeenCalledWith(2, 1);
    expect(notifSpy.success).toHaveBeenCalled();
  });

  it('should show skeletons while the first state is loading', () => {
    loaded$.next(false);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.skeleton').length).toBe(4);
  });

  it('should unsubscribe on destroy', () => {
    const subs = (component as any).subs;
    spyOn(subs, 'unsubscribe');
    component.ngOnDestroy();
    expect(subs.unsubscribe).toHaveBeenCalled();
  });
});

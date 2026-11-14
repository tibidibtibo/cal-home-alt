import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ShutterPanelComponent } from './shutter-panel.component';
import { DeviceService } from '../../devices/device.service';
import { of } from 'rxjs';

describe('ShutterPanelComponent', () => {
  let component: ShutterPanelComponent;
  let fixture: ComponentFixture<ShutterPanelComponent>;
  let deviceServiceSpy: jasmine.SpyObj<DeviceService>;

  beforeEach(async () => {
    deviceServiceSpy = jasmine.createSpyObj('DeviceService', ['open', 'close', 'stop', 'setLevel', 'setTilt', 'refresh']);
    deviceServiceSpy.setLevel.and.returnValue(of(undefined));
    deviceServiceSpy.refresh.and.returnValue(of({ ok: true, box_reachable: true, last_poll: null }));

    await TestBed.configureTestingModule({
      imports: [ShutterPanelComponent],
      providers: [
        { provide: DeviceService, useValue: deviceServiceSpy }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(ShutterPanelComponent);
    component = fixture.componentInstance;
    component.shutter = {
      id: '0',
      name: 'S1',
      type: 'shutter',
      level: 50,
      status: 'middle',
      is_closed: false,
      has_tilt: false,
      sun_level: 30,
      p1_level: 40,
      p2_level: null,
    };
    fixture.detectChanges();
  });

  it('should create as a modal dialog', () => {
    expect(component).toBeTruthy();
    const dialog: HTMLElement | null = fixture.nativeElement.querySelector('[role="dialog"]');
    expect(dialog).toBeTruthy();
  });

  it('should call refresh when clicking the refresh button', () => {
    const refreshBtn: HTMLButtonElement | null = fixture.nativeElement.querySelector('button[aria-label="Actualiser le statut réel"]');
    expect(refreshBtn).toBeTruthy();
    refreshBtn!.click();
    expect(deviceServiceSpy.refresh).toHaveBeenCalled();
  });

  it('should trigger 25%, 50%, 75%, sun mode and configured favorites', () => {
    const chips: HTMLButtonElement[] = Array.from(fixture.nativeElement.querySelectorAll('.presets .chip'));
    expect(chips.length).toBe(6);

    chips[0].click(); // 25%
    expect(deviceServiceSpy.setLevel).toHaveBeenCalledWith('0', 25);

    chips[3].click(); // Mode soleil (30%)
    expect(deviceServiceSpy.setLevel).toHaveBeenCalledWith('0', 30);

    chips[4].click(); // P1 (40%)
    expect(deviceServiceSpy.setLevel).toHaveBeenCalledWith('0', 40);

    expect(chips[5].disabled).toBeTrue(); // P2 not configured
  });
});

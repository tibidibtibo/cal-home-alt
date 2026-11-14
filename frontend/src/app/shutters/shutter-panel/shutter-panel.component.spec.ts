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

  const chips = (): HTMLButtonElement[] => Array.from(fixture.nativeElement.querySelectorAll('.presets .chip'));
  const actions = (): HTMLButtonElement[] => Array.from(fixture.nativeElement.querySelectorAll('.action-buttons .act'));

  /** Simule la remontée de l'état réel par la box : le volet a atteint sa cible. */
  function reachTarget(level: number): void {
    component.shutter = { ...component.shutter!, level };
    component.ngOnChanges({ shutter: {} as any });
    fixture.detectChanges();
  }

  it('should trigger 25%, 50%, 75%, sun mode and configured favorites', () => {
    expect(chips().length).toBe(6);
    expect(chips()[5].disabled).toBeTrue(); // P2 not configured

    chips()[0].click(); // 25%
    expect(deviceServiceSpy.setLevel).toHaveBeenCalledWith('0', 25);
    reachTarget(25);

    chips()[3].click(); // Mode soleil (30%)
    expect(deviceServiceSpy.setLevel).toHaveBeenCalledWith('0', 30);
    reachTarget(30);

    chips()[4].click(); // P1 (40%)
    expect(deviceServiceSpy.setLevel).toHaveBeenCalledWith('0', 40);
  });

  it('should lock every control except Stop while a movement is in progress', () => {
    expect(component.locked).toBeFalse();
    chips()[0].click(); // 25% : cible différente du niveau actuel (50)
    fixture.detectChanges();

    expect(component.locked).toBeTrue();
    expect(chips().every(c => c.disabled)).toBeTrue();
    const [open, stop, close] = actions();
    expect(open.disabled).toBeTrue();
    expect(close.disabled).toBeTrue();
    expect(stop.disabled).toBeFalse();
    expect(fixture.nativeElement.querySelector('input[type=range]').disabled).toBeTrue();
    expect(fixture.nativeElement.querySelector('button[aria-label="Actualiser le statut réel"]').disabled).toBeTrue();

    chips()[1].click(); // ignoré : verrouillé
    expect(deviceServiceSpy.setLevel).toHaveBeenCalledTimes(1);

    reachTarget(25);
    expect(component.locked).toBeFalse();
    expect(chips()[1].disabled).toBeFalse();
  });

  it('should keep the Stop button usable and unlock the panel once stopped', () => {
    deviceServiceSpy.stop.and.returnValue(of(undefined));
    chips()[0].click();
    fixture.detectChanges();
    expect(component.locked).toBeTrue();

    actions()[1].click();
    fixture.detectChanges();
    expect(deviceServiceSpy.stop).toHaveBeenCalledWith('0');
    expect(component.locked).toBeFalse();
    expect(actions()[0].disabled).toBeFalse();
  });

  it('should keep a constant layout: the status line is always rendered', () => {
    const line = (): HTMLElement => fixture.nativeElement.querySelector('.moving');
    expect(line()).toBeTruthy();
    expect(line().classList.contains('moving--on')).toBeFalse();
    chips()[0].click();
    fixture.detectChanges();
    expect(line()).toBeTruthy();
    expect(line().classList.contains('moving--on')).toBeTrue();
    expect(line().textContent).toContain('25%');
  });
});

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BoxTrafficComponent } from './box-traffic.component';
import { DeviceService, BoxQueueSnapshot } from '../devices/device.service';
import { BehaviorSubject, of } from 'rxjs';

describe('BoxTrafficComponent', () => {
  let component: BoxTrafficComponent;
  let fixture: ComponentFixture<BoxTrafficComponent>;
  let deviceServiceSpy: jasmine.SpyObj<DeviceService>;
  let queue$: BehaviorSubject<BoxQueueSnapshot | null>;

  const sampleSnapshot: BoxQueueSnapshot = {
    queued: [
      { id: 3, op: 'CLOSE', target: 'id-2', target_name: 'Cuisine', args: null, queued_at: '2026-11-12T23:00:01', waiting_ms: 180 },
    ],
    active: {
      id: 2,
      op: 'OPEN',
      target: 'id-1',
      target_name: 'Salon',
      args: null,
      phase: 'http',
      queued_at: '2026-11-12T23:00:00',
      started_at: '2026-11-12T23:00:00',
      wait_ms: 400,
      elapsed_ms: 120,
    },
    stats: {
      queued_count: 1,
      in_progress: 1,
      last_response_ms: 210,
      last_ok: true,
      avg_response_ms: 210,
      min_response_ms: 210,
      max_response_ms: 210,
      total_requests: 1,
      total_errors: 0,
      min_interval_ms: 400,
    },
    history: [
      {
        id: 1,
        op: 'getObjects',
        target: '192.168.1.50',
        args: null,
        queued_at: '2026-11-12T22:59:58',
        started_at: '2026-11-12T22:59:58',
        finished_at: '2026-11-12T22:59:58',
        wait_ms: 0,
        duration_ms: 210,
        ok: true,
        error: null,
      },
    ],
  };

  beforeEach(async () => {
    queue$ = new BehaviorSubject<BoxQueueSnapshot | null>(sampleSnapshot);
    deviceServiceSpy = jasmine.createSpyObj('DeviceService', [
      'startSSE',
      'getBoxQueue',
      'loadBoxQueue',
      'clearBoxQueueHistory',
    ]);
    deviceServiceSpy.getBoxQueue.and.returnValue(queue$);
    deviceServiceSpy.loadBoxQueue.and.returnValue(of(sampleSnapshot));
    deviceServiceSpy.clearBoxQueueHistory.and.returnValue(of({ ok: true }));

    await TestBed.configureTestingModule({
      imports: [BoxTrafficComponent],
      providers: [{ provide: DeviceService, useValue: deviceServiceSpy }],
    }).compileComponents();

    fixture = TestBed.createComponent(BoxTrafficComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    component.ngOnDestroy();
  });

  it('should create and display active, queued, and response time stats', () => {
    expect(component).toBeTruthy();
    expect(component.active?.target_name).toBe('Salon');
    expect(component.queued.length).toBe(1);
    expect(component.stats.last_response_ms).toBe(210);
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-testid="active-request"]')?.textContent).toContain('Salon');
    expect(el.querySelector('[data-testid="queued-table"]')?.textContent).toContain('Cuisine');
    expect(el.querySelector('[data-testid="history-table"]')?.textContent).toContain('210 ms');
  });

  it('should clear history on button action', () => {
    component.clearHistory();
    expect(deviceServiceSpy.clearBoxQueueHistory).toHaveBeenCalled();
  });
});

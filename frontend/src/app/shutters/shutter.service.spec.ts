import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { DeviceService } from '../devices/device.service';
import { DeviceState } from '../devices/device.model';

describe('DeviceService', () => {
  let service: DeviceService;
  let httpMock: HttpTestingController;

  const mockShutters: DeviceState[] = [
    { id: '0', name: 'S1', type: 'shutter', level: 50, status: 'middle', is_closed: false, has_tilt: false }
  ];

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [DeviceService]
    });
    service = TestBed.inject(DeviceService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    service.destroy();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should load shutters and update BehaviorSubject', () => {
    service.loadDevices().subscribe((shutters: any) => {
      expect(shutters).toEqual(mockShutters);
    });

    const req = httpMock.expectOne('/api/devices');
    expect(req.request.method).toBe('GET');
    req.flush(mockShutters);

    service.getDevices().subscribe((shutters: any) => {
      expect(shutters).toEqual(mockShutters);
    });
  });

  it('should send open command', () => {
    service.open('0').subscribe();
    const req = httpMock.expectOne('/api/devices/0/open');
    expect(req.request.method).toBe('POST');
    req.flush({});
  });

  it('should send close command', () => {
    service.close('0').subscribe();
    const req = httpMock.expectOne('/api/devices/0/close');
    expect(req.request.method).toBe('POST');
    req.flush({});
  });

  it('should send stop command', () => {
    service.stop('0').subscribe();
    const req = httpMock.expectOne('/api/devices/0/stop');
    expect(req.request.method).toBe('POST');
    req.flush({});
  });

  it('should set level', () => {
    service.setLevel('0', 75).subscribe();
    const req = httpMock.expectOne('/api/devices/0/level');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ level: 75 });
    req.flush({});
  });

  it('should set tilt', () => {
    service.setTilt('0', 45).subscribe();
    const req = httpMock.expectOne('/api/devices/0/tilt');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ angle: 45 });
    req.flush({});
  });

  function flushTicket(ticket = 'tkt') {
    httpMock.expectOne('/api/auth/sse-ticket').flush({ ticket });
  }

  it('should start SSE with a single-use ticket (never the JWT) and handle messages', fakeAsync(() => {
    const mockEventSource: any = jasmine.createSpyObj('EventSource', ['close', 'addEventListener']);
    (window as any).EventSource = jasmine.createSpy().and.returnValue(mockEventSource);

    service.startSSE();

    httpMock.expectOne('/api/devices').flush(mockShutters);
    flushTicket('tkt 1');

    expect((window as any).EventSource).toHaveBeenCalledWith('/api/events?ticket=tkt%201');

    mockEventSource.onopen();
    mockEventSource.onmessage({ data: JSON.stringify([{ id: '1', name: 'S2' }]) });
    tick();

    let latest: any;
    service.getDevices().subscribe(s => latest = s);
    expect(latest[0].id).toBe('1');

    let status: any;
    service.getStatus().subscribe(s => status = s);
    expect(status.live).toBeTrue();

    service.destroy();
  }));

  it('should update box status from named "status" events', fakeAsync(() => {
    const mockEventSource: any = jasmine.createSpyObj('EventSource', ['close', 'addEventListener']);
    (window as any).EventSource = jasmine.createSpy().and.returnValue(mockEventSource);
    service.startSSE();
    httpMock.expectOne('/api/devices').flush(mockShutters);
    flushTicket();

    const [name, handler] = mockEventSource.addEventListener.calls.mostRecent().args;
    expect(name).toBe('status');
    handler({ data: JSON.stringify({ box_reachable: false, last_poll: '2026-01-01T10:00:00' }) });

    let status: any;
    service.getStatus().subscribe(s => status = s);
    expect(status.boxReachable).toBeFalse();
    expect(status.lastPoll instanceof Date).toBeTrue();
    service.destroy();
  }));

  it('should poll as a fallback and reconnect with a new ticket after an SSE error', fakeAsync(() => {
    const mockEventSource: any = jasmine.createSpyObj('EventSource', ['close', 'addEventListener']);
    (window as any).EventSource = jasmine.createSpy().and.returnValue(mockEventSource);

    service.startSSE();
    httpMock.expectOne('/api/devices').flush(mockShutters);
    flushTicket();

    mockEventSource.onerror(new Event('error'));
    let status: any;
    service.getStatus().subscribe(s => status = s);
    expect(status.failed).toBeTrue();

    tick(1000);                       // première attente de reconnexion
    flushTicket('tkt2');
    expect((window as any).EventSource).toHaveBeenCalledTimes(2);

    tick(29000);                      // 30 s après la coupure, le polling de secours relit l'état
    httpMock.expectOne('/api/devices').flush([{ id: 2, name: 'S3' }]);
    service.destroy();
  }));

  it('should classify a device in a room', () => {
    service.setRoom(7, 3).subscribe();
    const req = httpMock.expectOne('/api/devices/7/room');
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ room_id: 3 });
    req.flush({ ok: true });
  });
});

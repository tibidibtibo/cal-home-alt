import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { ScheduleService } from './schedule.service';
import { Schedule } from './schedule.model';

describe('ScheduleService', () => {
  let service: ScheduleService;
  let httpMock: HttpTestingController;

  const mockSchedules: Schedule[] = [
    { id: 1, name: 'R1', mode: 'fixed', enabled: true, device_ids: ['0'], action: 'open', params: {}, created_at: '2023-01-01' }
  ];

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [ScheduleService]
    });
    service = TestBed.inject(ScheduleService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should load schedules', () => {
    service.loadSchedules().subscribe(s => {
      expect(s).toEqual(mockSchedules);
    });
    const req = httpMock.expectOne('/api/schedules');
    req.flush(mockSchedules);
    expect(service.schedules$.value).toEqual(mockSchedules);
  });

  it('should create schedule and reload', () => {
    const newSched = { name: 'New' };
    service.createSchedule(newSched).subscribe();

    const req = httpMock.expectOne('/api/schedules');
    expect(req.request.method).toBe('POST');
    req.flush({ id: 2, ...newSched });

    // Reload call
    const reloadReq = httpMock.expectOne('/api/schedules');
    reloadReq.flush(mockSchedules);
  });

  it('should update schedule', () => {
    service.updateSchedule(1, { name: 'U' }).subscribe();
    const req = httpMock.expectOne('/api/schedules/1');
    expect(req.request.method).toBe('PUT');
    req.flush({});
    const reloadReq = httpMock.expectOne('/api/schedules');
    reloadReq.flush([]);
  });

  it('should delete schedule', () => {
    service.deleteSchedule(1).subscribe();
    const req = httpMock.expectOne('/api/schedules/1');
    expect(req.request.method).toBe('DELETE');
    req.flush({});
    const reloadReq = httpMock.expectOne('/api/schedules');
    reloadReq.flush([]);
  });

  it('should toggle schedule', () => {
    service.toggleSchedule(1, false).subscribe();
    const req = httpMock.expectOne('/api/schedules/1/toggle');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ enabled: false });
    req.flush({ enabled: false });
    const reloadReq = httpMock.expectOne('/api/schedules');
    reloadReq.flush([]);
  });

  it('should load conflicts', () => {
    service.loadConflicts().subscribe(conflicts => {
      expect(conflicts).toEqual([]);
    });
    const req = httpMock.expectOne('/api/schedules/conflicts');
    req.flush([]);
    expect(service.conflicts$.value).toEqual([]);
  });
});

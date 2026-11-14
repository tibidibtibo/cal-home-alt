import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, tap } from 'rxjs';
import { Schedule, ScheduleConflict, DayPlan, SunTimes } from './schedule.model';

@Injectable({ providedIn: 'root' })
export class ScheduleService {
  private readonly baseUrl = '/api/schedules';
  schedules$ = new BehaviorSubject<Schedule[]>([]);
  conflicts$ = new BehaviorSubject<ScheduleConflict[]>([]);

  constructor(private http: HttpClient) {}

  loadSchedules(): Observable<Schedule[]> {
    return this.http.get<Schedule[]>(this.baseUrl).pipe(
      tap(schedules => this.schedules$.next(schedules))
    );
  }

  createSchedule(s: Partial<Schedule>): Observable<Schedule> {
    return this.http.post<Schedule>(this.baseUrl, s).pipe(
      tap(() => this.loadSchedules().subscribe())
    );
  }

  updateSchedule(id: number, s: Partial<Schedule>): Observable<Schedule> {
    return this.http.put<Schedule>(`${this.baseUrl}/${id}`, s).pipe(
      tap(() => this.loadSchedules().subscribe())
    );
  }

  deleteSchedule(id: number): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/${id}`).pipe(
      tap(() => this.loadSchedules().subscribe())
    );
  }

  toggleSchedule(id: number, enabled: boolean): Observable<{enabled: boolean}> {
    return this.http.patch<{enabled: boolean}>(`${this.baseUrl}/${id}/toggle`, { enabled }).pipe(
      tap(() => this.loadSchedules().subscribe())
    );
  }

  loadConflicts(): Observable<ScheduleConflict[]> {
    return this.http.get<ScheduleConflict[]>(`${this.baseUrl}/conflicts`).pipe(
      tap(conflicts => this.conflicts$.next(conflicts))
    );
  }

  getSunTimes(): Observable<SunTimes> {
    return this.http.get<SunTimes>('/api/sun/times');
  }

  /** Planning d'un jour (règles actives uniquement), `date` = YYYY-MM-DD (défaut : aujourd'hui). */
  getPlan(date?: string): Observable<DayPlan> {
    return this.http.get<DayPlan>('/api/plan', { params: date ? { date } : {} });
  }
}

import { Injectable, NgZone } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, interval, Subscription } from 'rxjs';
import { tap } from 'rxjs/operators';
import { DeviceState } from './device.model';

export interface RefreshResult {
  ok: boolean;
  box_reachable: boolean;
  last_poll: string | null;
}

/** État de la liaison temps réel (SSE) et de la box, pour l'affichage global. */
export interface LiveStatus {
  /** Flux temps réel connecté. */
  live: boolean;
  /** Connexion perdue ou refusée (faux pendant la toute première connexion). */
  failed: boolean;
  /** null tant que le serveur ne l'a pas indiqué. */
  boxReachable: boolean | null;
  lastPoll: Date | null;
}

export interface BoxQueueItem {
  id: number;
  op: string;
  target: string | null;
  target_name?: string;
  args: string | null;
  queued_at: string;
  waiting_ms: number;
}

export interface BoxActiveItem {
  id: number;
  op: string;
  target: string | null;
  target_name?: string;
  args: string | null;
  phase: 'throttling' | 'http';
  queued_at: string;
  started_at: string | null;
  wait_ms: number;
  elapsed_ms: number;
}

export interface BoxHistoryItem {
  id: number;
  op: string;
  target: string | null;
  target_name?: string;
  args: string | null;
  queued_at: string;
  started_at: string;
  finished_at: string;
  wait_ms: number;
  duration_ms: number;
  ok: boolean;
  error: string | null;
}

export interface BoxQueueStats {
  queued_count: number;
  in_progress: number;
  last_response_ms: number | null;
  last_ok: boolean | null;
  avg_response_ms: number | null;
  min_response_ms: number | null;
  max_response_ms: number | null;
  total_requests: number;
  total_errors: number;
  min_interval_ms: number;
}

export interface BoxQueueSnapshot {
  queued: BoxQueueItem[];
  active: BoxActiveItem | null;
  stats: BoxQueueStats;
  history: BoxHistoryItem[];
  box_reachable?: boolean | null;
  last_poll?: string | null;
}

const MAX_RETRY_MS = 30000;
const FALLBACK_POLL_MS = 30000;

@Injectable({ providedIn: 'root' })
export class DeviceService {
  private readonly baseUrl = '/api/devices';
  private devices$ = new BehaviorSubject<DeviceState[]>([]);
  private loaded$ = new BehaviorSubject<boolean>(false);
  private status$ = new BehaviorSubject<LiveStatus>({ live: false, failed: false, boxReachable: null, lastPoll: null });
  private boxQueue$ = new BehaviorSubject<BoxQueueSnapshot | null>(null);
  private eventSource: EventSource | null = null;
  private pollingSub: Subscription | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retries = 0;
  private running = false;

  constructor(private http: HttpClient, private ngZone: NgZone) {}

  getDevices(): Observable<DeviceState[]> {
    return this.devices$.asObservable();
  }

  /** false jusqu'à la première réponse du serveur (sert à distinguer « chargement » de « aucun volet »). */
  isLoaded(): Observable<boolean> {
    return this.loaded$.asObservable();
  }

  getStatus(): Observable<LiveStatus> {
    return this.status$.asObservable();
  }

  getBoxQueue(): Observable<BoxQueueSnapshot | null> {
    return this.boxQueue$.asObservable();
  }

  loadBoxQueue(): Observable<BoxQueueSnapshot> {
    return this.http.get<BoxQueueSnapshot>('/api/box/queue').pipe(
      tap(snap => this.boxQueue$.next(snap))
    );
  }

  clearBoxQueueHistory(): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>('/api/box/queue/history').pipe(
      tap(() => this.loadBoxQueue().subscribe({ error: () => {} }))
    );
  }

  loadDevices(): Observable<DeviceState[]> {
    return this.http.get<DeviceState[]>(this.baseUrl).pipe(
      tap(devices => this.setDevices(devices))
    );
  }

  open(id: string): Observable<void> {
    return this.http.post<void>(`${this.baseUrl}/${id}/open`, {});
  }

  close(id: string): Observable<void> {
    return this.http.post<void>(`${this.baseUrl}/${id}/close`, {});
  }

  stop(id: string): Observable<void> {
    return this.http.post<void>(`${this.baseUrl}/${id}/stop`, {});
  }

  setLevel(id: string, level: number): Observable<void> {
    return this.http.post<void>(`${this.baseUrl}/${id}/level`, { level });
  }

  setTilt(id: string, angle: number): Observable<void> {
    return this.http.post<void>(`${this.baseUrl}/${id}/tilt`, { angle });
  }

  /** Classe un appareil dans une pièce (null = non classé). */
  setRoom(dbId: number, roomId: number | null): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`${this.baseUrl}/${dbId}/room`, { room_id: roomId });
  }

  updatePlacement(dbId: number, cardId: number | null, x: number | null, y: number | null): Observable<void> {
    return this.http.put<void>(`${this.baseUrl}/${dbId}/placement`, { card_id: cardId, x, y });
  }

  refresh(): Observable<RefreshResult> {
    return this.http.post<RefreshResult>('/api/refresh', {}).pipe(
      tap(() => this.loadDevices().subscribe())
    );
  }

  /** Démarre le temps réel : état initial, puis flux SSE (ticket à usage unique, reconnexion avec attente croissante). */
  startSSE(): void {
    if (this.running) return;
    this.running = true;
    this.loadDevices().subscribe({ error: () => { /* le flux ou le polling prendront le relais */ } });
    this.connect();
  }

  destroy(): void {
    this.running = false;
    this.closeSource();
    this.stopPolling();
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
    this.retries = 0;
    this.patchStatus({ live: false, failed: false });
  }

  private setDevices(devices: DeviceState[]): void {
    this.devices$.next(devices);
    this.loaded$.next(true);
  }

  private patchStatus(patch: Partial<LiveStatus>): void {
    this.status$.next({ ...this.status$.value, ...patch });
  }

  private connect(): void {
    if (!this.running) return;
    // EventSource ne peut pas envoyer d'en-tête Authorization : on échange le jeton contre un ticket d'une minute, à usage unique.
    this.http.post<{ ticket: string }>('/api/auth/sse-ticket', {}).subscribe({
      next: ({ ticket }) => this.openSource(ticket),
      error: () => this.onDisconnected(),
    });
  }

  private openSource(ticket: string): void {
    if (!this.running) return;
    this.closeSource();
    const es = new EventSource(`/api/events?ticket=${encodeURIComponent(ticket)}`);
    this.eventSource = es;

    es.onopen = () => this.ngZone.run(() => {
      this.retries = 0;
      this.stopPolling();
      this.patchStatus({ live: true, failed: false });
    });

    es.onmessage = (event) => this.ngZone.run(() => {
      try {
        this.setDevices(JSON.parse(event.data));
      } catch (e) {
        console.error('Error parsing SSE data', e);
      }
    });

    es.addEventListener('box_queue', (event) => this.ngZone.run(() => {
      try {
        this.boxQueue$.next(JSON.parse((event as MessageEvent).data));
      } catch (e) {
        console.error('Error parsing SSE box_queue', e);
      }
    }));

    es.addEventListener('status', (event) => this.ngZone.run(() => {
      try {
        const s = JSON.parse((event as MessageEvent).data);
        this.patchStatus({ boxReachable: typeof s.box_reachable === 'boolean' ? s.box_reachable : null, lastPoll: s.last_poll ? new Date(s.last_poll) : null });
      } catch (e) {
        console.error('Error parsing SSE status', e);
      }
    }));

    // Le ticket est consommé : en cas d'erreur on ne laisse pas le navigateur rejouer l'URL, on en redemande un.
    es.onerror = () => this.ngZone.run(() => {
      this.closeSource();
      this.onDisconnected();
    });
  }

  private onDisconnected(): void {
    if (!this.running) return;
    this.patchStatus({ live: false, failed: true });
    this.startPolling();
    const delay = Math.min(1000 * 2 ** this.retries, MAX_RETRY_MS);
    this.retries++;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => this.connect(), delay);
  }

  private closeSource(): void {
    if (this.eventSource) {
      this.eventSource.onopen = this.eventSource.onmessage = this.eventSource.onerror = null;
      this.eventSource.close();
      this.eventSource = null;
    }
  }

  /** Secours quand le flux est coupé : relecture périodique de l'état. */
  private startPolling(): void {
    if (this.pollingSub) return;
    this.pollingSub = interval(FALLBACK_POLL_MS).subscribe(() =>
      this.loadDevices().subscribe({ error: () => { /* on réessaiera au prochain tour */ } })
    );
  }

  private stopPolling(): void {
    this.pollingSub?.unsubscribe();
    this.pollingSub = null;
  }
}

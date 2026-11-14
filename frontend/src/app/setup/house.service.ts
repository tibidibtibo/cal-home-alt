import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';

export interface House { name: string; setup_completed: boolean; }
export interface RoomRef { id: number; name: string; card_id: number; card_name: string; }

/** Nom de la maison, état de l'assistant de configuration, et appels propres à l'assistant. */
@Injectable({ providedIn: 'root' })
export class HouseService {
  private http = inject(HttpClient);

  /** null tant que le serveur n'a pas répondu. */
  readonly name = signal<string>('');
  readonly completed = signal<boolean | null>(null);

  load(): Observable<House> {
    return this.http.get<House>('/api/settings/house').pipe(tap(h => this.apply(h)));
  }

  saveName(name: string): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>('/api/settings/house', { name }).pipe(tap(() => this.name.set(name.trim())));
  }

  complete(): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>('/api/setup/complete', {}).pipe(tap(() => this.completed.set(true)));
  }

  /** À la déconnexion : le prochain compte rechargera l'état depuis le serveur. */
  reset(): void {
    this.name.set('');
    this.completed.set(null);
  }

  getRooms(): Observable<RoomRef[]> {
    return this.http.get<RoomRef[]>('/api/rooms');
  }

  addRoom(name: string): Observable<{ id: number; name: string }> {
    return this.http.post<{ id: number; name: string }>('/api/setup/rooms', { name });
  }

  deleteRoom(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`/api/rooms/${id}`);
  }

  autoplace(): Observable<{ placed: number }> {
    return this.http.post<{ placed: number }>('/api/setup/autoplace', {});
  }

  refreshDevices(): Observable<{ ok: boolean; box_reachable: boolean }> {
    return this.http.post<{ ok: boolean; box_reachable: boolean }>('/api/refresh', {});
  }

  private apply(h: House): void {
    this.name.set(h.name);
    this.completed.set(h.setup_completed);
  }
}

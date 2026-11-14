import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ShutterConfig, RoomOption } from './shutter-config.model';

@Injectable({ providedIn: 'root' })
export class ShutterConfigService {
  private readonly baseUrl = '/api/shutter-config';

  constructor(private http: HttpClient) {}

  getConfigs(): Observable<ShutterConfig[]> {
    return this.http.get<ShutterConfig[]>(this.baseUrl);
  }

  getRooms(): Observable<RoomOption[]> {
    return this.http.get<RoomOption[]>('/api/rooms');
  }

  updateConfig(
    id: number,
    custom_name: string | null,
    orientation: number,
    color: string | null,
    room_id: number | null,
    sun_level?: number,
    p1_level?: number | null,
    p2_level?: number | null,
  ): Observable<ShutterConfig> {
    return this.http.put<ShutterConfig>(`${this.baseUrl}/${id}`, {
      custom_name,
      orientation,
      color,
      room_id,
      sun_level,
      p1_level,
      p2_level,
    });
  }

  reassociate(id: number, api_id: string): Observable<ShutterConfig> {
    return this.http.post<ShutterConfig>(`${this.baseUrl}/${id}/reassociate`, { api_id });
  }
}

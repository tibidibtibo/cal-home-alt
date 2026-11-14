import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface NotificationConfig {
  channel: string;
  email_enabled: boolean;
  smtp_configured: boolean;
}

export interface BoxConfig {
  host: string;
  mac: string;
}

export interface CalypsCredsConfig {
  login: string;
  password_set: boolean;
}

export interface LocationConfig {
  latitude: number;
  longitude: number;
  timezone: string;
}

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  from_addr: string;
  email_to: string;
  password_set: boolean;
}

@Injectable({ providedIn: 'root' })
export class SettingsService {
  constructor(private http: HttpClient) {}

  getNotificationConfig(): Observable<NotificationConfig> {
    return this.http.get<NotificationConfig>('/api/notifications/config');
  }

  testNotification(): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>('/api/notifications/test', {});
  }

  updateChannel(channel: string): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>('/api/notifications/channel', { channel });
  }

  getBoxConfig(): Observable<BoxConfig> {
    return this.http.get<BoxConfig>('/api/box/config');
  }

  updateBoxConfig(host: string, mac: string): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>('/api/box/config', { host, mac });
  }

  getCalypsCreds(): Observable<CalypsCredsConfig> {
    return this.http.get<CalypsCredsConfig>('/api/box/credentials');
  }

  updateCalypsCreds(login: string, password: string): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>('/api/box/credentials', { login, password });
  }

  testBoxPing(): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>('/api/box/ping', {});
  }

  testBoxConnection(): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>('/api/box/test', {});
  }

  changePassword(currentPassword: string, newPassword: string): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>('/api/auth/change-password', {
      current_password: currentPassword,
      new_password: newPassword,
    });
  }

  getLocationConfig(): Observable<LocationConfig> {
    return this.http.get<LocationConfig>('/api/settings/location');
  }

  updateLocationConfig(latitude: number, longitude: number, timezone: string): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>('/api/settings/location', { latitude, longitude, timezone });
  }

  getSunTimes(): Observable<{ sunrise: string; sunset: string; timezone: string }> {
    return this.http.get<{ sunrise: string; sunset: string; timezone: string }>('/api/sun/times');
  }

  getPollInterval(): Observable<{ interval: number }> {
    return this.http.get<{ interval: number }>('/api/settings/poll-interval');
  }

  updatePollInterval(interval: number): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>('/api/settings/poll-interval', { interval });
  }

  getSmtpConfig(): Observable<SmtpConfig> {
    return this.http.get<SmtpConfig>('/api/notifications/smtp');
  }

  updateSmtpConfig(host: string, port: number, user: string, password: string, fromAddr: string, emailTo: string): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>('/api/notifications/smtp', {
      host, port, user, password, from_addr: fromAddr, email_to: emailTo,
    });
  }

  getAllowedUsers(): Observable<string[]> {
    return this.http.get<string[]>('/api/auth/users');
  }

  addAllowedUser(username: string, password: string): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>('/api/auth/users', { username, password });
  }

  removeAllowedUser(username: string): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`/api/auth/users/${encodeURIComponent(username)}`);
  }

  /** Appareils enregistrés en base (dont les appareils « Custom API »). */
  getRegisteredDevices(): Observable<any[]> {
    return this.http.get<any[]>('/api/shutter-config');
  }

  createCustomDevice(name: string, url: string, type: string): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>('/api/devices/custom', { name, url, type });
  }

  updateCustomDevice(dbId: number, name: string, url: string, type: string): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`/api/devices/custom/${dbId}`, { name, url, type });
  }

  deleteCustomDevice(dbId: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`/api/devices/custom/${dbId}`);
  }
}

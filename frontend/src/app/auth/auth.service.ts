import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Router } from '@angular/router';

const TOKEN_KEY = 'calhome_token';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private http = inject(HttpClient);
  private router = inject(Router);

  getToken(): string | null {
    return localStorage.getItem(TOKEN_KEY);
  }

  isAuthenticated(): boolean {
    const token = this.getToken();
    if (!token) return false;
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      return payload.exp * 1000 > Date.now();
    } catch {
      return false;
    }
  }

  /** Utilisateur déduit du jeton (`sub` = nom d'utilisateur). */
  getUser(): { name: string } | null {
    const token = this.getToken();
    if (!token || !this.isAuthenticated()) return null;
    try {
      const name = JSON.parse(atob(token.split('.')[1])).sub as string;
      return name ? { name } : null;
    } catch {
      return null;
    }
  }

  /** Prolonge la session quand il reste moins de 8 h de validité (évite la déconnexion en plein usage). */
  refreshIfNeeded(): void {
    const token = this.getToken();
    if (!token || !this.isAuthenticated()) return;
    try {
      const exp = JSON.parse(atob(token.split('.')[1])).exp * 1000;
      if (exp - Date.now() > 8 * 3600 * 1000) return;
    } catch {
      return;
    }
    this.http.post<{ token: string }>('/api/auth/refresh', {}).subscribe({
      next: (res) => this.storeToken(res.token),
      error: () => { /* l'intercepteur déconnecte si la session est vraiment terminée */ },
    });
  }

  storeToken(token: string): void {
    localStorage.setItem(TOKEN_KEY, token);
  }

  /** `setup_required` : aucun compte n'existe encore, il faut créer le premier. */
  getStatus(): Observable<{ setup_required: boolean }> {
    return this.http.get<{ setup_required: boolean }>('/api/auth/status');
  }

  login(username: string, password: string): Observable<{ token: string }> {
    return this.http.post<{ token: string }>('/api/auth/login', { username, password });
  }

  /** Premier lancement : crée le compte administrateur. */
  createFirstAccount(username: string, password: string): Observable<{ token: string }> {
    return this.http.post<{ token: string }>('/api/auth/setup', { username, password });
  }

  logout(): void {
    localStorage.removeItem(TOKEN_KEY);
    this.router.navigate(['/login']);
  }
}

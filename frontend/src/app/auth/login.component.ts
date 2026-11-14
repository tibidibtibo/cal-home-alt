import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { AuthService } from './auth.service';
import { UiAlertComponent } from '../ui';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule, UiAlertComponent],
  template: `
    <div class="auth-screen">
      <form class="auth-box" (ngSubmit)="submit()" #f="ngForm">
        <img src="assets/logo.svg" alt="" width="56" height="56" />
        <h1>Cal-Home Alt</h1>
        <p class="auth-tagline">Connectez-vous pour piloter la maison.</p>
        @if (error) { <ui-alert type="error">{{ error }}</ui-alert> }
        <div class="form-group">
          <label for="username">Nom d'utilisateur</label>
          <input id="username" name="username" type="text" autocomplete="username" required [(ngModel)]="username" autofocus />
        </div>
        <div class="form-group">
          <label for="password">Mot de passe</label>
          <input id="password" name="password" type="password" autocomplete="current-password" required [(ngModel)]="password" />
        </div>
        <button type="submit" class="ui-btn ui-btn--primary" [disabled]="loading || !f.valid">
          @if (loading) { <i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i> } Se connecter
        </button>
      </form>
    </div>
  `,
})
export class LoginComponent implements OnInit {
  private auth = inject(AuthService);
  private router = inject(Router);

  username = '';
  password = '';
  error = '';
  loading = false;

  ngOnInit(): void {
    if (this.auth.isAuthenticated()) {
      this.router.navigate(['/home']);
      return;
    }
    // Premier lancement : aucun compte, on propose d'en créer un.
    this.auth.getStatus().subscribe({
      next: (s) => { if (s.setup_required) this.router.navigate(['/welcome']); },
      error: () => { this.error = 'Impossible de joindre le serveur.'; },
    });
  }

  submit(): void {
    this.loading = true;
    this.error = '';
    this.auth.login(this.username, this.password).subscribe({
      next: (res) => {
        this.auth.storeToken(res.token);
        this.router.navigate(['/home']);
      },
      error: (err: HttpErrorResponse) => {
        this.loading = false;
        this.error = err.status === 0 ? 'Impossible de joindre le serveur.' : (err.error?.detail ?? 'Connexion impossible.');
      },
    });
  }
}

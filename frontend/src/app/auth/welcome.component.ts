import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { AuthService } from './auth.service';
import { UiAlertComponent } from '../ui';

/** Premier lancement : création du compte administrateur. */
@Component({
  selector: 'app-welcome',
  standalone: true,
  imports: [FormsModule, UiAlertComponent],
  template: `
    <div class="auth-screen">
      <form class="auth-box" (ngSubmit)="submit()" #f="ngForm">
        <img src="assets/logo.svg" alt="" width="56" height="56" />
        <h1>Bienvenue</h1>
        <p class="auth-tagline">Créez votre compte. Il servira à vous connecter à cette application ; il n'est stocké que sur cet ordinateur.</p>
        @if (error) { <ui-alert type="error">{{ error }}</ui-alert> }
        <div class="form-group">
          <label for="username">Nom d'utilisateur</label>
          <input id="username" name="username" type="text" autocomplete="username" required minlength="3" maxlength="32"
                 [(ngModel)]="username" autofocus />
          <span class="form-hint">3 à 32 caractères : lettres, chiffres, point, tiret, souligné.</span>
        </div>
        <div class="form-group">
          <label for="password">Mot de passe</label>
          <input id="password" name="password" type="password" autocomplete="new-password" required minlength="8" maxlength="72"
                 [(ngModel)]="password" />
          <span class="form-hint">8 caractères minimum.</span>
        </div>
        <div class="form-group">
          <label for="confirm">Confirmer le mot de passe</label>
          <input id="confirm" name="confirm" type="password" autocomplete="new-password" required [(ngModel)]="confirm" />
        </div>
        <button type="submit" class="ui-btn ui-btn--primary" [disabled]="loading || !f.valid">
          @if (loading) { <i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i> } Créer mon compte
        </button>
        <p class="form-hint auth-legal">Projet indépendant et bénévole, non affilié à Calyps'HOME ni à Profalux. Fourni sans aucune garantie, à vos risques
          et périls. En créant un compte, vous acceptez ces conditions (voir DISCLAIMER.md).</p>
      </form>
    </div>
  `,
})
export class WelcomeComponent implements OnInit {
  private auth = inject(AuthService);
  private router = inject(Router);

  username = '';
  password = '';
  confirm = '';
  error = '';
  loading = false;

  ngOnInit(): void {
    // Un compte existe déjà : cette page n'a plus lieu d'être.
    this.auth.getStatus().subscribe({
      next: (s) => { if (!s.setup_required) this.router.navigate(['/login']); },
      error: () => { this.error = 'Impossible de joindre le serveur.'; },
    });
  }

  submit(): void {
    if (this.password !== this.confirm) {
      this.error = 'Les mots de passe ne correspondent pas.';
      return;
    }
    this.loading = true;
    this.error = '';
    this.auth.createFirstAccount(this.username, this.password).subscribe({
      next: (res) => {
        this.auth.storeToken(res.token);
        this.router.navigate(['/setup']);   // l'assistant de configuration prend le relais
      },
      error: (err: HttpErrorResponse) => {
        this.loading = false;
        this.error = err.status === 0 ? 'Impossible de joindre le serveur.' : (err.error?.detail ?? 'Création impossible.');
      },
    });
  }
}

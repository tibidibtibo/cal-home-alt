import { Routes } from '@angular/router';
import { HomeComponent } from './home/home.component';
import { FloorplanComponent } from './floorplan/floorplan.component';
import { ShutterListComponent } from './shutters/shutter-list/shutter-list.component';
import { ShutterConfigComponent } from './shutters/shutter-config/shutter-config.component';
import { ScheduleListComponent } from './schedules/schedule-list/schedule-list.component';
import { SettingsComponent } from './settings/settings.component';
import { LogsComponent } from './logs/logs.component';
import { BoxTrafficComponent } from './traffic/box-traffic.component';
import { LoginComponent } from './auth/login.component';
import { WelcomeComponent } from './auth/welcome.component';
import { SetupWizardComponent } from './setup/setup-wizard.component';
import { authGuard, setupGuard } from './auth/auth.guard';

const app = [authGuard, setupGuard];

export const routes: Routes = [
  { path: '', redirectTo: 'home', pathMatch: 'full' },
  { path: 'login', component: LoginComponent },
  { path: 'welcome', component: WelcomeComponent },
  { path: 'setup', component: SetupWizardComponent, canActivate: [authGuard] },
  { path: 'home', component: HomeComponent, canActivate: app },
  { path: 'plan', component: FloorplanComponent, canActivate: app },
  { path: 'list', component: ShutterListComponent, canActivate: app },
  { path: 'shutter-config', component: ShutterConfigComponent, canActivate: app },
  { path: 'schedules', component: ScheduleListComponent, canActivate: app },
  { path: 'traffic', component: BoxTrafficComponent, canActivate: app },
  { path: 'settings', component: SettingsComponent, canActivate: app },
  { path: 'logs', component: LogsComponent, canActivate: app },
  { path: '**', redirectTo: 'home' },
];

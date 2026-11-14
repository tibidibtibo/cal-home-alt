import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SettingsComponent } from './settings.component';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

describe('SettingsComponent', () => {
  let component: SettingsComponent;
  let fixture: ComponentFixture<SettingsComponent>;
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SettingsComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(SettingsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  function flushBoxTab() {
    http.expectOne('/api/settings/house').flush({ name: 'Chez nous', setup_completed: true });
    http.expectOne('/api/box/config').flush({ host: '192.168.1.50', mac: '' });
    http.expectOne('/api/box/credentials').flush({ login: 'me', password_set: true });
    http.expectOne('/api/settings/location').flush({ latitude: 1, longitude: 2, timezone: 'Europe/Paris' });
    http.expectOne('/api/settings/poll-interval').flush({ interval: 300 });
    http.expectOne('/api/sun/times').flush({ sunrise: '08:00', sunset: '17:00', timezone: 'Europe/Paris' });
  }

  it('should create and only load the first tab', () => {
    expect(component).toBeTruthy();
    expect(component.loading).toBeTrue();
    flushBoxTab();
    expect(component.loading).toBeFalse();
    expect(component.boxHost).toBe('192.168.1.50');
    http.expectNone('/api/notifications/config');
    http.expectNone('/api/auth/users');
  });

  it('should lazy-load a tab once, on first opening', () => {
    flushBoxTab();
    component.selectTab('notifications');
    http.expectOne('/api/notifications/config').flush({ channel: 'email', email_enabled: true, smtp_configured: true });
    http.expectOne('/api/notifications/smtp').flush({ host: 'h', port: 587, user: '', from_addr: '', email_to: '', password_set: false });
    expect(component.selectedChannel).toBe('email');

    component.selectTab('box');
    component.selectTab('notifications');
    http.expectNone('/api/notifications/config');   // déjà chargé
  });

  it('should load the house name with the box tab', () => {
    flushBoxTab();
    expect(component.houseName).toBe('Chez nous');
  });

  it('should load users in the security tab', () => {
    flushBoxTab();
    component.selectTab('security');
    http.expectOne('/api/auth/users').flush(['alice', 'bob']);
    expect(component.allowedUsers).toEqual(['alice', 'bob']);
  });

  it('should report a load error and retry the tab', () => {
    http.expectOne('/api/settings/house').flush({ name: '', setup_completed: true });
    http.expectOne('/api/box/config').flush('boom', { status: 500, statusText: 'err' });
    http.expectOne('/api/box/credentials').flush({ login: 'me', password_set: true });
    http.expectOne('/api/settings/location').flush({ latitude: 1, longitude: 2, timezone: 'UTC' });
    http.expectOne('/api/settings/poll-interval').flush({ interval: 300 });
    http.expectOne('/api/sun/times').flush({ sunrise: '08:00', sunset: '17:00', timezone: 'UTC' });
    expect(component.loadError).toBeTrue();
    expect(component.loading).toBeFalse();

    component.retryTab();
    expect(component.loadError).toBeFalse();
    flushBoxTab();
    expect(component.boxHost).toBe('192.168.1.50');
  });

  it('should encode the user name when removing a user', () => {
    flushBoxTab();
    spyOn(window, 'confirm').and.returnValue(true);
    component.removeUser('a b');
    http.expectOne('/api/auth/users/a%20b').flush({ ok: true });
    http.expectOne('/api/auth/users').flush([]);   // rechargement de la liste
  });
});

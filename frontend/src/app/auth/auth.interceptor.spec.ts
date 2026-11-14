import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { authInterceptor } from './auth.interceptor';
import { AuthService } from './auth.service';

describe('authInterceptor', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;
  let authSpy: jasmine.SpyObj<AuthService>;

  beforeEach(() => {
    authSpy = jasmine.createSpyObj('AuthService', ['getToken', 'storeToken', 'logout']);
    authSpy.getToken.and.returnValue('tok-1');

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: authSpy },
      ],
    });

    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('attaches the Bearer token to protected auth routes', () => {
    for (const url of ['/api/auth/users', '/api/auth/refresh', '/api/auth/sse-ticket', '/api/auth/login-history', '/api/auth/status-all']) {
      http.get(url).subscribe();
      const req = httpMock.expectOne(url);
      expect(req.request.headers.get('Authorization')).toBe('Bearer tok-1');
      req.flush({});
    }
  });

  it('does not attach the Bearer token to public auth routes', () => {
    for (const url of ['/api/auth/login', '/api/auth/status', '/api/auth/setup', '/api/auth/status?x=1']) {
      http.get(url).subscribe();
      const req = httpMock.expectOne(url);
      expect(req.request.headers.has('Authorization')).toBeFalse();
      req.flush({});
    }
  });

  it('refreshes and retries on 401, and logs out if the refresh fails', () => {
    let errored = false;
    http.get('/api/auth/users').subscribe({ error: () => { errored = true; } });

    const initial = httpMock.expectOne('/api/auth/users');
    initial.flush({ detail: 'Not authenticated' }, { status: 401, statusText: 'Unauthorized' });

    const refresh = httpMock.expectOne('/api/auth/refresh');
    refresh.flush({ detail: 'Expired' }, { status: 401, statusText: 'Unauthorized' });

    expect(authSpy.logout).toHaveBeenCalled();
    expect(errored).toBeTrue();
  });
});

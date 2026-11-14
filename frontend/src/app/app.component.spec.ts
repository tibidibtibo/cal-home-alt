import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AppComponent } from './app.component';
import { DeviceService } from './devices/device.service';
import { of } from 'rxjs';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Router } from '@angular/router';
import { AuthService } from './auth/auth.service';

describe('AppComponent', () => {
  let component: AppComponent;
  let fixture: ComponentFixture<AppComponent>;
  let deviceServiceSpy: jasmine.SpyObj<DeviceService>;

  beforeEach(async () => {
    deviceServiceSpy = jasmine.createSpyObj('DeviceService', ['startSSE', 'destroy', 'loadDevices', 'getDevices', 'getStatus']);
    deviceServiceSpy.getStatus.and.returnValue(of({ live: true, failed: false, boxReachable: true, lastPoll: null }));
    deviceServiceSpy.loadDevices.and.returnValue(of([]));
    deviceServiceSpy.getDevices.and.returnValue(of([]));

    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: DeviceService, useValue: deviceServiceSpy },
        { provide: AuthService, useValue: { isAuthenticated: () => true, getUser: () => null, logout: () => {}, refreshIfNeeded: () => {} } },
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(AppComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create the app', () => {
    expect(component).toBeTruthy();
  });

  it('should call startSSE after navigation when authenticated', async () => {
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/');
    expect(deviceServiceSpy.startSSE).toHaveBeenCalled();
  });
});

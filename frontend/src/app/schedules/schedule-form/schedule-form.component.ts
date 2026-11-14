import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { UiCardComponent, UiBadgeComponent, UiButtonComponent, UiAlertComponent } from '../../ui';
import { ScheduleService } from '../schedule.service';
import { Schedule, ScheduleConflict, SunTimes } from '../schedule.model';
import { DeviceService } from '../../devices/device.service';
import { DeviceState } from '../../devices/device.model';
import { first } from 'rxjs';
@Component({
  selector: 'app-schedule-form',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    UiCardComponent,
    UiBadgeComponent,
    UiButtonComponent,
    UiAlertComponent,
  ],
  templateUrl: './schedule-form.component.html',
  styles: [`
    :host { display: block; width: 100%; }
    .step-indicator { display: flex; gap: 0.5rem; margin-bottom: 1.5rem; flex-wrap: wrap; }
    .form-step { display: flex; flex-direction: column; gap: 1.25rem; }

    .form-group { display: flex; flex-direction: column; gap: 0.35rem; }
    .form-group label { font-size: 0.85rem; font-weight: 600; color: var(--color-text); }

    input[type=text], input[type=number], input[type=time], select {
      width: 100%; padding: 0.6rem 0.75rem;
      border: 1px solid var(--color-border, #d1d5db);
      border-radius: var(--radius-md, 0.5rem);
      font-size: 0.95rem; font-family: inherit;
      background: var(--color-background, #fff);
      color: var(--color-text, #111827);
    }
    input[type=range] { width: 100%; accent-color: var(--color-primary); cursor: pointer; }

    .shutter-selector {
      border: 1px solid var(--color-border, #d1d5db);
      border-radius: var(--radius-md, 0.5rem);
      padding: 0.75rem;
      background: var(--color-surface, #f9fafb);
    }
    .shutter-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
      gap: 0.75rem;
      max-height: 250px;
      overflow-y: auto;
      margin-top: 0.75rem;
      padding-right: 0.5rem;
    }
    .shutter-check {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      font-size: 0.9rem;
      cursor: pointer;
      padding: 0.5rem;
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      background: var(--color-background);
      transition: all 0.2s;
    }
    .shutter-check:hover { border-color: var(--color-primary); }
    .shutter-check.selected { border-color: var(--color-primary); background: rgba(var(--color-primary-rgb), 0.05); }
    .shutter-check input[type=checkbox] { width: 1.1rem; height: 1.1rem; flex-shrink: 0; accent-color: var(--color-primary); cursor: pointer; }
    .shutter-check .shutter-name { font-weight: 500; }
    .shutter-check .shutter-room { font-size: 0.75rem; color: var(--color-text-muted); }

    .shutter-actions { display: flex; gap: 1rem; margin-bottom: 0.5rem; }
    .shutter-actions button { background: none; border: none; color: var(--color-primary); font-size: 0.8rem; font-weight: 600; cursor: pointer; padding: 0; text-decoration: underline; }

    .action-selector { display: flex; gap: 0.5rem; flex-wrap: wrap; }
    .level-row { display: flex; align-items: center; gap: 1rem; margin-top: 0.75rem; padding: 0.75rem; background: var(--color-surface); border-radius: var(--radius-md); }
    .level-row input[type=range] { flex: 1; }
    .level-value { font-size: 1rem; font-weight: 700; color: var(--color-primary); min-width: 3rem; text-align: right; }

    .day-selector { display: flex; gap: 0.5rem; flex-wrap: wrap; }
    .day-btn {
      padding: 0.6rem 0.8rem;
      font-size: 0.85rem;
      font-weight: 600;
      border: 1px solid var(--color-border, #d1d5db);
      border-radius: var(--radius-md, 0.5rem);
      background: var(--color-background, #fff);
      color: var(--color-text-muted, #6b7280);
      cursor: pointer;
      transition: all 0.2s;
      flex: 1;
      min-width: 60px;
      text-align: center;
    }
    .day-btn.active { background: var(--color-primary); border-color: var(--color-primary); color: #fff; }
    .day-btn:hover:not(.active) { border-color: var(--color-primary); color: var(--color-primary); }

    .summary-block {
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      padding: 1.25rem;
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }
    .summary-row { display: flex; justify-content: space-between; border-bottom: 1px solid var(--color-border); padding-bottom: 0.5rem; font-size: 0.95rem; }
    .summary-row:last-child { border-bottom: none; padding-bottom: 0; }
    .summary-label { font-weight: 500; color: var(--color-text-muted); }
    .summary-value { font-weight: 600; color: var(--color-text); text-align: right; }
    .summary-shutters { font-size: 0.85rem; color: var(--color-text-muted); line-height: 1.4; margin-top: 0.25rem; }

    .footer-actions { display: flex; justify-content: flex-end; gap: 0.75rem; margin-top: 1.5rem; padding-top: 1.5rem; border-top: 1px solid var(--color-border); }

    .bso-section-label {
      font-size: 0.78rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--color-text-muted);
      margin-top: 0.5rem;
      margin-bottom: -0.25rem;
    }
    .correction-field label { color: var(--color-warning, #b45309); }

    @media (max-width: 600px) {
      .shutter-grid { grid-template-columns: 1fr; }
      .summary-row { flex-direction: column; gap: 0.25rem; }
      .summary-value { text-align: left; }
    }
  `]
})
export class ScheduleFormComponent implements OnInit {
  @Input() schedule: Schedule | null = null;
  @Output() cancel = new EventEmitter<void>();
  @Output() saved = new EventEmitter<Schedule>();

  readonly dayLabels = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
  readonly modeNames: Record<string, string> = {
    fixed: 'Horaire fixe',
    presence: 'Lever / coucher du soleil',
    absence: 'Simulation de présence (absence)',
    solar: 'Protection solaire (BSO)'
  };
  readonly compassLabels = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];

  step = 1;
  form!: FormGroup;
  shutters: DeviceState[] = [];
  conflicts: ScheduleConflict[] = [];
  sunTimes: SunTimes | null = null;

  constructor(
    private fb: FormBuilder,
    private scheduleService: ScheduleService,
    private deviceService: DeviceService
  ) {}

  ngOnInit(): void {
    this.deviceService.getDevices().pipe(first(s => s.length > 0)).subscribe(s => this.shutters = s);
    this.scheduleService.getSunTimes().subscribe({ next: t => this.sunTimes = t, error: () => this.sunTimes = null });
    const offset: number = this.schedule?.params?.offset_min ?? 0;
    this.form = this.fb.group({
      name: [this.schedule?.name || '', Validators.required],
      mode: [this.schedule?.mode || 'fixed', Validators.required],
      device_ids: [this.schedule?.device_ids || [], Validators.required],
      action: [this.schedule?.action || 'open', Validators.required],
      level: [this.schedule?.level ?? 100],
      time: [this.schedule?.params?.time || '08:00'],
      days: [this.parseDays(this.schedule?.params?.days)],
      sun_event: [this.schedule?.params?.sun_event || 'sunrise'],
      open_weekday: [this.schedule?.params?.open_weekday || '08:00'],
      open_weekend: [this.schedule?.params?.open_weekend || '09:30'],
      close_offset_min: [this.schedule?.params?.close_offset_min ?? 10, [Validators.min(-720), Validators.max(720)]],
      offset_dir: [offset < 0 ? 'before' : offset > 0 ? 'after' : 'at'],
      offset_abs: [Math.abs(offset), [Validators.min(0), Validators.max(720)]],
      azimuth_min: [this.schedule?.params?.azimuth_min || 180],
      azimuth_max: [this.schedule?.params?.azimuth_max || 270],
      altitude_min: [this.schedule?.params?.altitude_min || 30],
      // BSO params (orientation is now per-shutter in DB)
      half_angle: [this.schedule?.params?.half_angle ?? 60],
      altitude_min_bso: [this.schedule?.params?.altitude_min ?? 20],
      close_level: [this.schedule?.params?.close_level ?? 0],
      open_level: [this.schedule?.params?.open_level ?? 100],
      azimuth_offset: [this.schedule?.params?.azimuth_offset ?? 0],
      altitude_offset: [this.schedule?.params?.altitude_offset ?? 0],
    });
  }

  get isStepValid(): boolean {
    if (this.step === 1) {
      return !!this.form.value.name?.trim() && this.form.value.device_ids.length > 0;
    }
    if (this.step === 2 && this.form.value.mode === 'fixed') {
      return !!this.form.value.time && this.form.value.days.length > 0;
    }
    if (this.step === 2 && this.form.value.mode === 'absence') {
      return !!this.form.value.open_weekday && !!this.form.value.open_weekend && this.form.controls['close_offset_min'].valid;
    }
    return true;
  }

  /** Décalage signé en minutes : négatif = avant l'événement, positif = après. */
  get offsetMin(): number {
    const { offset_dir, offset_abs } = this.form.value;
    const abs = Math.max(0, Math.min(720, Math.round(Number(offset_abs) || 0)));
    return offset_dir === 'before' ? -abs : offset_dir === 'after' ? abs : 0;
  }

  /** Heure d'exécution prévue aujourd'hui (HH:MM) pour l'événement + décalage choisis, ou null si inconnue. */
  get presencePreview(): string | null {
    if (!this.sunTimes) return null;
    const base = this.form.value.sun_event === 'sunset' ? this.sunTimes.sunset : this.sunTimes.sunrise;
    const [h, m] = base.split(':').map(Number);
    const total = (((h * 60 + m + this.offsetMin) % 1440) + 1440) % 1440;
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  }

  private addMinutes(hhmm: string, delta: number): string {
    const [h, m] = hhmm.split(':').map(Number);
    const total = (((h * 60 + m + delta) % 1440) + 1440) % 1440;
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  }

  /** Mode absence : heures d'ouverture / fermeture prévues aujourd'hui, ou null si le coucher est inconnu. */
  get absencePreview(): { open: string; close: string; dayLabel: string } | null {
    if (!this.sunTimes) return null;
    const off = this.sunTimes.day_type && this.sunTimes.day_type !== 'weekday';
    const dayLabel = this.sunTimes.day_type === 'holiday' ? `jour férié (${this.sunTimes.holiday})`
      : this.sunTimes.day_type === 'weekend' ? 'week-end' : 'jour de semaine';
    const delta = Math.round(Number(this.form.value.close_offset_min) || 0);
    return {
      open: off ? this.form.value.open_weekend : this.form.value.open_weekday,
      close: this.addMinutes(this.sunTimes.sunset, delta),
      dayLabel,
    };
  }

  get closeOffsetLabel(): string {
    const o = Math.round(Number(this.form.value.close_offset_min) || 0);
    return o === 0 ? 'au coucher du soleil' : o > 0 ? `${o} min après le coucher du soleil` : `${-o} min avant le coucher du soleil`;
  }

  get offsetLabel(): string {
    const o = this.offsetMin;
    return o === 0 ? 'à l\'heure exacte' : o < 0 ? `${-o} min avant` : `${o} min après`;
  }

  get modeName(): string {
    return this.modeNames[this.form.value.mode] || this.form.value.mode;
  }

  get selectedShutterNames(): string {
    const ids: string[] = this.form.value.device_ids;
    return this.shutters.filter(s => ids.includes(s.id)).map(s => s.name).join(', ') || '—';
  }

  get availableActions(): { value: string, label: string }[] {
    const ids: string[] = this.form.value.device_ids;
    const selectedDevices = this.shutters.filter(s => ids.includes(s.id));
    const types = new Set(selectedDevices.map(d => d.type));

    if (types.has('shutter')) {
      return [
        { value: 'open', label: 'Ouvrir' },
        { value: 'close', label: 'Fermer' },
        { value: 'level', label: 'Niveau précis' }
      ];
    } else if (types.has('custom_api')) {
      return [
        { value: 'on', label: 'Allumer' },
        { value: 'off', label: 'Éteindre' },
        { value: 'toggle', label: 'Inverser' }
      ];
    }
    return [
      { value: 'notify', label: 'Notifier uniquement' }
    ];
  }

  get devicesByType(): { type: string, devices: DeviceState[] }[] {
    const groups = new Map<string, DeviceState[]>();
    this.shutters.forEach(d => {
      const list = groups.get(d.type) || [];
      list.push(d);
      groups.set(d.type, list);
    });
    return Array.from(groups.entries()).map(([type, devices]) => ({ type, devices }));
  }

  nextStep(): void {
    if (this.step < 3) this.step++;
    if (this.step === 3) this.checkConflicts();
  }

  prevStep(): void {
    if (this.step > 1) this.step--;
  }

  toggleShutter(id: string): void {
    const ids = [...this.form.value.device_ids];
    const index = ids.indexOf(id);
    if (index > -1) ids.splice(index, 1);
    else ids.push(id);
    this.form.patchValue({ device_ids: ids });
  }

  selectAllShutters(): void {
    this.form.patchValue({ device_ids: this.shutters.map(s => s.id) });
  }

  clearShutters(): void {
    this.form.patchValue({ device_ids: [] });
  }

  toggleDay(d: number): void {
    const days = [...this.form.value.days];
    const i = days.indexOf(d);
    if (i > -1) days.splice(i, 1); else days.push(d);
    this.form.patchValue({ days: days.sort((a, b) => a - b) });
  }

  checkConflicts(): void {
    this.scheduleService.loadConflicts().subscribe(conflicts => {
      this.conflicts = conflicts.filter(c => this.form.value.device_ids.includes(c.device_id));
    });
  }

  save(): void {
    if (this.form.invalid) return;
    const val = this.form.value;
    const payload: Partial<Schedule> = {
      name: val.name, mode: val.mode, device_ids: val.device_ids,
      action: val.action, level: val.action === 'level' ? val.level : undefined, params: {}
    };
    if (val.mode === 'fixed') payload.params = { time: val.time, days: (val.days as number[]).join(',') };
    else if (val.mode === 'presence') payload.params = { sun_event: val.sun_event, offset_min: this.offsetMin };
    else if (val.mode === 'absence') {
      payload.action = 'open';   // placeholder : le scheduler ouvre le matin et ferme le soir selon l'événement
      payload.level = undefined;
      payload.params = {
        open_weekday: val.open_weekday,
        open_weekend: val.open_weekend,
        close_offset_min: Math.round(Number(val.close_offset_min) || 0),
      };
    }
    else if (val.mode === 'solar') {
      payload.action = 'level';
      payload.params = {
        half_angle: val.half_angle,
        altitude_min: val.altitude_min_bso,
        close_level: val.close_level,
        open_level: val.open_level,
        azimuth_offset: val.azimuth_offset,
        altitude_offset: val.altitude_offset,
      };
    }

    if (this.schedule) {
      this.scheduleService.updateSchedule(this.schedule.id, payload).subscribe(s => this.saved.emit(s));
    } else {
      this.scheduleService.createSchedule(payload).subscribe(s => this.saved.emit(s));
    }
  }

  compassDirection(degrees: number): string {
    return this.compassLabels[Math.round(degrees / 45) % 8];
  }

  private parseDays(val: any): number[] {
    if (!val) return [1, 2, 3, 4, 5];
    if (typeof val === 'string') return val.split(',').map(Number).filter(n => n >= 1 && n <= 7);
    if (Array.isArray(val)) return val;
    return [1, 2, 3, 4, 5];
  }
}

export type ScheduleMode = 'fixed' | 'presence' | 'solar' | 'absence';
export type ScheduleAction = 'open' | 'close' | 'level';

export interface Schedule {
  id: number;
  name: string;
  mode: ScheduleMode;
  enabled: boolean;
  device_ids: string[];
  action: ScheduleAction;
  level?: number;
  params: any;
  created_at: string;
}

export interface ScheduleConflict {
  device_id: string;
  shutter_name: string;
  schedule_ids: number[];
  schedule_names: string[];
  description: string;
}

export interface SunTimes {
  sunrise: string;   // HH:MM
  sunset: string;    // HH:MM
  timezone: string;
  day_type?: 'weekday' | 'weekend' | 'holiday';
  holiday?: string | null;
}

export interface PlanEvent {
  time: string;                 // ISO 8601 avec offset du fuseau configuré
  action: ScheduleAction;
  level: number | null;
  schedule_id: number;
  schedule_name: string;
  mode: ScheduleMode;
  device_ids: string[];
  device_names: string[];
}

export interface DayPlan {
  date: string;                 // YYYY-MM-DD
  sunrise: string;              // HH:MM
  sunset: string;               // HH:MM
  day_type: 'weekday' | 'weekend' | 'holiday';
  holiday: string | null;
  events: PlanEvent[];
}

export interface DeviceState {
  id: string;
  api_id?: string;
  api_name?: string;
  db_id?: number;
  name: string;
  type: 'shutter' | 'sensor' | 'camera' | 'custom_api' | 'unknown';
  room_id?: number;
  room_name?: string;
  card_id?: number;
  x?: number;
  y?: number;
  level?: number;       // 0–100
  tilt_angle?: number;
  has_tilt?: boolean;
  status?: string;
  is_closed?: boolean;
  orientation?: number;
  sun_level?: number;
  p1_level?: number | null;
  p2_level?: number | null;
  next_action?: {
    time: string;
    action: string;
    schedule_name: string;
  };
}

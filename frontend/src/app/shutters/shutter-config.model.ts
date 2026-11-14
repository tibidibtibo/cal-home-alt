export interface ShutterConfig {
  id: number;
  api_id: string;
  api_name: string;
  custom_name: string | null;
  orientation: number;
  color: string | null;
  room_id: number | null;
  sun_level?: number;
  p1_level?: number | null;
  p2_level?: number | null;
}

export interface RoomOption {
  id: number;
  name: string;
  card_id: number;
  card_name: string;
}

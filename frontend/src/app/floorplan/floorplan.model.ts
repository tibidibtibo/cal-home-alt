export interface Card {
  id: number;
  name: string;
  view_box: string;
  north_angle: number;
}

export interface Room {
  id: number;
  card_id: number;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface EquipmentMarker {
  id: string;
  device_id?: string;
  x: number;
  y: number;
  name?: string;
  status?: string;
  orientation?: number;
}

export interface FloorplanData {
  card: Card;
  rooms: Room[];
  devices: any[];
  all_cards: Card[];
}

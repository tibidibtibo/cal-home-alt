import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { FloorplanData, Card, Room } from './floorplan.model';

@Injectable({ providedIn: 'root' })
export class FloorplanService {
  private readonly url = '/api/floorplan';

  constructor(private http: HttpClient) {}

  getFloorplan(cardId?: number): Observable<FloorplanData> {
    const url = cardId ? `${this.url}?card_id=${cardId}` : this.url;
    return this.http.get<FloorplanData>(url);
  }


  // Cards
  getCards(): Observable<Card[]> {
    return this.http.get<Card[]>('/api/cards');
  }

  createCard(card: Partial<Card>): Observable<Card> {
    return this.http.post<Card>('/api/cards', card);
  }

  updateCard(card: Card): Observable<Card> {
    return this.http.put<Card>(`/api/cards/${card.id}`, card);
  }

  deleteCard(id: number): Observable<void> {
    return this.http.delete<void>(`/api/cards/${id}`);
  }

  // Rooms
  createRoom(room: Partial<Room>): Observable<Room> {
    return this.http.post<Room>('/api/rooms', room);
  }

  updateRoom(room: Room): Observable<Room> {
    return this.http.put<Room>(`/api/rooms/${room.id}`, room);
  }

  deleteRoom(id: number): Observable<void> {
    return this.http.delete<void>(`/api/rooms/${id}`);
  }
}

import { Component, OnInit, OnDestroy, ElementRef, ViewChild, ChangeDetectorRef, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DeviceService } from '../devices/device.service';
import { DeviceState } from '../devices/device.model';
import { ShutterPanelComponent } from '../shutters/shutter-panel/shutter-panel.component';
import { FloorplanService } from './floorplan.service';
import { FloorplanData, Room, EquipmentMarker } from './floorplan.model';
import { Subscription, forkJoin } from 'rxjs';

interface DragState {
  type: 'room-move' | 'room-resize' | 'equipment-move';
  id: string;
  offsetX: number;
  offsetY: number;
}

@Component({
  selector: 'app-floorplan',
  standalone: true,
  imports: [CommonModule, FormsModule, ShutterPanelComponent],
  templateUrl: './floorplan.component.html',
  styleUrls: ['./floorplan.component.scss']
})
export class FloorplanComponent implements OnInit, OnDestroy {
  @ViewChild('svgEl') svgEl!: ElementRef<SVGSVGElement>;

  floorplan: FloorplanData | null = null;
  private originalFloorplan = '';
  shutters: DeviceState[] = [];
  selectedShutter: DeviceState | null = null;

  editMode = false;
  placingShutterId: string | null = null;
  renamingRoomId: number | null = null;
  renameValue = '';
  saving = false;
  saveError = false;
  gridSize = 20;
  /** Facteur d'agrandissement des éléments d'interface du SVG (poignées, marqueurs, textes) quand le plan est réduit à l'écran (mobile). 1 = taille normale. */
  uiScale = 1;

  creatingCard = false;
  newCardName = '';
  renamingCardMode = false;
  renameCardValue = '';

  private readonly GRID_SIZES = [10, 20, 40, 80];
  private dragState: DragState | null = null;
  private subs: Subscription[] = [];

  constructor(
    private floorplanService: FloorplanService,
    private deviceService: DeviceService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.loadFloorplan();

    const sub = this.deviceService.getDevices().subscribe(shutters => {
      this.shutters = shutters;
      if (this.selectedShutter) {
        this.selectedShutter = shutters.find(s => s.id === this.selectedShutter?.id) || null;
      }
      this.syncMarkers();
      this.cdr.detectChanges();
    });
    this.subs.push(sub);
  }

  loadFloorplan(cardId?: number): void {
    this.floorplanService.getFloorplan(cardId).subscribe(data => {
      this.floorplan = data;
      this.cdr.detectChanges();
      this.updateUiScale();
    });
  }

  /** Mesure le plan affiché : sur petit écran le viewBox est réduit, on grossit donc les éléments tactiles pour qu'ils restent utilisables. */
  @HostListener('window:resize')
  @HostListener('window:orientationchange')
  updateUiScale(): void {
    const svg = this.svgEl?.nativeElement;
    const vbWidth = Number((this.floorplan?.card.view_box ?? '').split(' ')[2]);
    const width = svg?.getBoundingClientRect().width ?? 0;
    const next = width > 0 && vbWidth > 0 ? Math.min(2.6, Math.max(1, Math.round((vbWidth / width) * 10) / 10)) : 1;
    if (next !== this.uiScale) {
      this.uiScale = next;
      this.cdr.detectChanges();
    }
  }

  /** Taille des textes : grossit moins vite que les poignées. */
  get textScale(): number {
    return Math.max(1, Math.round(this.uiScale * 6) / 10);
  }

  /** Garde les marqueurs du plan à jour avec le temps réel (niveau, pièce, position…). Jamais pendant l'édition : on écraserait les déplacements en cours. */
  private syncMarkers(): void {
    if (!this.floorplan || this.editMode || this.saving) return;
    const cardId = this.floorplan.card.id;
    this.floorplan.devices = this.shutters.filter(s => s.card_id === cardId && s.x != null && s.y != null);
  }

  onCardChange(cardId: number): void {
    this.loadFloorplan(cardId);
  }

  ngOnDestroy(): void {
    this.subs.forEach(s => s.unsubscribe());
  }

  // --- Getters ---

  /** Volets absents du plan affiché (y compris ceux qu'on vient de retirer en édition, avant sauvegarde). */
  get unplacedShutters(): DeviceState[] {
    if (!this.floorplan) return [];
    const placed = new Set(this.floorplan.devices.map(d => d.device_id ?? d.id));
    return this.shutters.filter(s => !placed.has(s.id));
  }

  getShutter(id: string): DeviceState | undefined {
    return this.shutters.find(s => s.id === id);
  }

  /** Angle du nord sur le plan, en degrés, sens horaire (SVG), normalisé dans ]-180, 180]. */
  get northAngle(): number {
    const raw = this.floorplan?.card.north_angle ?? 0;
    const mod = ((raw % 360) + 360) % 360;
    return mod > 180 ? mod - 360 : mod;
  }

  get compassX(): number {
    const vb = (this.floorplan?.card.view_box ?? '0 0 900 600').split(' ').map(Number);
    return (vb[0] ?? 0) + (vb[2] ?? 900) - 36 * this.uiScale;
  }

  get compassY(): number {
    const vb = (this.floorplan?.card.view_box ?? '0 0 900 600').split(' ').map(Number);
    return (vb[1] ?? 0) + 36 * this.uiScale;
  }

  getArrowAngle(eq: EquipmentMarker): number {
    const orientation = eq.orientation ?? this.getShutter(eq.device_id ?? eq.id)?.orientation;
    if (orientation == null) return 0;
    // Le plan est fixe ; le nord est incliné de northAngle (horaire) sur l'écran.
    // Un cap réel B s'affiche donc à B + northAngle.
    return ((orientation + this.northAngle) % 360 + 360) % 360;
  }

  hasOrientation(eq: EquipmentMarker): boolean {
    return (eq.orientation ?? this.getShutter(eq.device_id ?? eq.id)?.orientation) != null;
  }

  setNorthAngle(value: number): void {
    if (!this.floorplan) return;
    const clamped = Math.max(-180, Math.min(180, Math.round(Number(value) || 0)));
    this.floorplan.card.north_angle = clamped;
    this.cdr.detectChanges();
  }

  // --- Grid ---

  cycleGridSize(): void {
    const idx = this.GRID_SIZES.indexOf(this.gridSize);
    this.gridSize = this.GRID_SIZES[(idx + 1) % this.GRID_SIZES.length];
  }

  get gridPath(): string {
    return `M ${this.gridSize} 0 L 0 0 0 ${this.gridSize}`;
  }

  private snap(v: number): number {
    return Math.round(v / this.gridSize) * this.gridSize;
  }

  // --- SVG coordinate conversion ---

  private toSvgPoint(event: MouseEvent): { x: number; y: number } {
    const svg = this.svgEl.nativeElement;
    const pt = svg.createSVGPoint();
    pt.x = event.clientX;
    pt.y = event.clientY;
    const { x, y } = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    return { x: Math.round(x), y: Math.round(y) };
  }

  // --- Edit mode ---

  enterEditMode(): void {
    if (!this.floorplan) return;
    setTimeout(() => this.updateUiScale());
    this.syncMarkers();
    this.originalFloorplan = JSON.stringify(this.floorplan);
    this.editMode = true;
    this.saveError = false;
  }

  cancelEdit(): void {
    this.floorplan = JSON.parse(this.originalFloorplan);
    this.editMode = false;
    this.placingShutterId = null;
    this.renamingRoomId = null;
    this.creatingCard = false;
    this.renamingCardMode = false;
    this.dragState = null;
    this.saveError = false;
  }

  saveEdit(): void {
    if (!this.floorplan) return;
    this.saving = true;
    this.saveError = false;

    // We need to save all modified rooms and card info
    const tasks: any[] = [];

    // Save card info (north angle, etc.)
    tasks.push(this.floorplanService.updateCard(this.floorplan.card));

    // Delete rooms removed during edit (present in snapshot, absent now)
    const currentIds = new Set(this.floorplan.rooms.map(r => r.id));
    const originalRooms: Room[] = this.originalFloorplan
      ? (JSON.parse(this.originalFloorplan).rooms ?? [])
      : [];
    originalRooms
      .filter(r => r.id >= 0 && !currentIds.has(r.id))
      .forEach(r => tasks.push(this.floorplanService.deleteRoom(r.id)));

    // Save equipment: moved markers get their new position, removed ones go back to "unplaced"
    const cardId = this.floorplan.card.id;
    const originalDevices: any[] = this.originalFloorplan
      ? (JSON.parse(this.originalFloorplan).devices ?? [])
      : [];
    const originalById = new Map(originalDevices.map(d => [d.id, d]));
    const currentDeviceIds = new Set(this.floorplan.devices.map(d => d.id));
    this.floorplan.devices.forEach(d => {
      const before = originalById.get(d.id);
      if (d.db_id != null && (!before || before.x !== d.x || before.y !== d.y)) {
        tasks.push(this.deviceService.updatePlacement(d.db_id, cardId, d.x, d.y));
      }
    });
    originalDevices
      .filter(d => d.db_id != null && !currentDeviceIds.has(d.id))
      .forEach(d => tasks.push(this.deviceService.updatePlacement(d.db_id, null, null, null)));

    // Save rooms
    this.floorplan.rooms.forEach(r => {
      if (r.id < 0) { // New room
        tasks.push(this.floorplanService.createRoom(r));
      } else {
        tasks.push(this.floorplanService.updateRoom(r));
      }
    });

    forkJoin(tasks).subscribe({
      next: () => {
        this.saving = false;
        this.editMode = false;
        this.loadFloorplan(this.floorplan!.card.id);
      },
      error: () => {
        this.saving = false;
        this.saveError = true;
        this.cdr.detectChanges();
      }
    });
  }

  // --- Rooms ---

  addRoom(): void {
    if (!this.floorplan) return;
    this.floorplan.rooms = [...this.floorplan.rooms, {
      id: -Date.now(), // Temporary negative ID
      card_id: this.floorplan.card.id,
      name: 'Nouvelle pièce',
      x: 100, y: 100,
      width: 200, height: 150
    }];
  }

  deleteRoom(id: number, event: MouseEvent): void {
    event.stopPropagation();
    if (!this.floorplan) return;
    this.floorplan.rooms = this.floorplan.rooms.filter(r => r.id !== id);
  }

  startRename(roomId: number, name: string, event: Event): void {
    if (!this.editMode) return;
    event.stopPropagation();
    this.renamingRoomId = roomId;
    this.renameValue = name;
    setTimeout(() => {
      document.querySelector<HTMLInputElement>('.rename-overlay input')?.focus();
    });
  }

  confirmRename(): void {
    if (!this.floorplan || this.renamingRoomId === null) return;
    const trimmed = this.renameValue.trim();
    if (trimmed) {
      this.floorplan.rooms = this.floorplan.rooms.map(r =>
        r.id === this.renamingRoomId ? { ...r, name: trimmed } : r
      );
    }
    this.renamingRoomId = null;
  }

  // --- Equipment ---

  deleteEquipment(id: string, event: MouseEvent): void {
    event.stopPropagation();
    if (!this.floorplan) return;
    this.floorplan.devices = this.floorplan.devices.filter(e => e.id !== id);
  }

  startPlacement(shutterId: string): void {
    this.placingShutterId = shutterId;
  }

  cancelPlacement(): void {
    this.placingShutterId = null;
  }

  onSvgClick(event: MouseEvent): void {
    if (this.placingShutterId === null || !this.floorplan) return;
    const raw = this.toSvgPoint(event);
    const x = this.snap(raw.x);
    const y = this.snap(raw.y);

    const device = this.shutters.find(s => s.id === this.placingShutterId);
    if (device && device.db_id != null) {
      // Local jusqu'à « Sauvegarder » (comme les autres modifications) : « Annuler » rétablit le plan d'origine.
      this.floorplan.devices = [...this.floorplan.devices, { ...device, card_id: this.floorplan.card.id, x, y }];
    }

    this.placingShutterId = null;
  }

  onEquipmentClick(eq: EquipmentMarker, event: MouseEvent): void {
    if (this.editMode) return;
    event.stopPropagation();
    this.selectedShutter = this.getShutter(eq.device_id ?? eq.id) || null;
    this.cdr.detectChanges();
  }

  // --- Drag handlers ---

  onRoomMouseDown(event: MouseEvent, room: Room): void {
    if (!this.editMode || this.renamingRoomId) return;
    event.preventDefault();
    event.stopPropagation();
    const pt = this.toSvgPoint(event);
    this.dragState = {
      type: 'room-move', id: String(room.id),
      offsetX: pt.x - room.x, offsetY: pt.y - room.y
    };
    this.capturePointer(event);
  }

  onResizeMouseDown(event: MouseEvent, room: Room): void {
    if (!this.editMode) return;
    event.preventDefault();
    event.stopPropagation();
    const pt = this.toSvgPoint(event);
    this.dragState = {
      type: 'room-resize', id: String(room.id),
      offsetX: pt.x - (room.x + room.width),
      offsetY: pt.y - (room.y + room.height)
    };
    this.capturePointer(event);
  }

  onEquipmentMouseDown(event: MouseEvent, eq: EquipmentMarker): void {
    if (!this.editMode) return;
    event.preventDefault();
    event.stopPropagation();
    const pt = this.toSvgPoint(event);
    this.dragState = {
      type: 'equipment-move', id: eq.id,
      offsetX: pt.x - eq.x, offsetY: pt.y - eq.y
    };
    this.capturePointer(event);
  }

  onSvgMouseMove(event: MouseEvent): void {
    if (!this.dragState || !this.floorplan) return;
    const pt = this.toSvgPoint(event);
    const { type, id, offsetX, offsetY } = this.dragState;

    if (type === 'room-move') {
      const room = this.floorplan.rooms.find(r => r.id === +id);
      if (room) { room.x = this.snap(pt.x - offsetX); room.y = this.snap(pt.y - offsetY); }
    } else if (type === 'room-resize') {
      const room = this.floorplan.rooms.find(r => r.id === +id);
      if (room) {
        room.width = Math.max(this.gridSize, this.snap(pt.x - offsetX - room.x));
        room.height = Math.max(this.gridSize, this.snap(pt.y - offsetY - room.y));
      }
    } else if (type === 'equipment-move') {
      const eq = this.floorplan.devices.find(e => e.id === id);
      if (eq) { eq.x = this.snap(pt.x - offsetX); eq.y = this.snap(pt.y - offsetY); }
    }
  }

  onSvgMouseUp(): void {
    this.dragState = null;
  }

  /** Garde le pointeur sur le SVG pendant un glissement : sans cela, au toucher, le geste est interrompu dès que le doigt quitte le marqueur. */
  private capturePointer(event: MouseEvent): void {
    const id = (event as PointerEvent).pointerId;
    if (id === undefined) return;
    try { this.svgEl.nativeElement.setPointerCapture(id); } catch { /* pointeur inconnu : sans effet */ }
  }

  onRenameInput(event: Event): void {
    this.renameValue = (event.target as HTMLInputElement).value;
  }

  // --- Card management ---

  startCreateCard(): void {
    this.creatingCard = true;
    this.newCardName = '';
    this.renamingCardMode = false;
    setTimeout(() => document.querySelector<HTMLInputElement>('.card-name-input')?.focus());
  }

  cancelCreateCard(): void {
    this.creatingCard = false;
  }

  cancelRenameCard(): void {
    this.renamingCardMode = false;
  }

  confirmCreateCard(): void {
    const name = this.newCardName.trim();
    if (!name) { this.creatingCard = false; return; }
    this.floorplanService.createCard({
      name,
      view_box: this.floorplan?.card.view_box ?? '0 0 900 600',
      north_angle: 0
    }).subscribe({
      next: (card) => {
        this.creatingCard = false;
        this.editMode = false;
        this.loadFloorplan(card.id);
      },
      error: () => { this.creatingCard = false; }
    });
  }

  startRenameCard(): void {
    if (!this.floorplan) return;
    this.renamingCardMode = true;
    this.renameCardValue = this.floorplan.card.name;
    this.creatingCard = false;
    setTimeout(() => document.querySelector<HTMLInputElement>('.card-name-input')?.focus());
  }

  confirmRenameCard(): void {
    if (!this.floorplan) return;
    const name = this.renameCardValue.trim();
    if (name) {
      this.floorplan.card = { ...this.floorplan.card, name };
      this.floorplan.all_cards = this.floorplan.all_cards.map(c =>
        c.id === this.floorplan!.card.id ? { ...c, name } : c
      );
    }
    this.renamingCardMode = false;
  }

  deleteCard(): void {
    if (!this.floorplan || this.floorplan.all_cards.length <= 1) return;
    if (!confirm(`Supprimer la carte "${this.floorplan.card.name}" ?`)) return;
    const id = this.floorplan.card.id;
    const other = this.floorplan.all_cards.find(c => c.id !== id);
    this.floorplanService.deleteCard(id).subscribe({
      next: () => {
        this.editMode = false;
        this.loadFloorplan(other?.id);
      }
    });
  }
}

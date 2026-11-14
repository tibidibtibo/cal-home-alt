import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FloorplanComponent } from './floorplan.component';
import { DeviceService } from '../devices/device.service';
import { FloorplanService } from './floorplan.service';
import { FloorplanData } from './floorplan.model';
import { of, throwError } from 'rxjs';

// Même forme que ce que renvoie /api/floorplan : les appareils du plan sont les appareils temps réel placés sur la carte.
const LIVE_SHUTTER: any = { id: '0', name: 'Baie vitrée', type: 'shutter', level: 50, has_tilt: false, status: 'middle', is_closed: false, card_id: 1, db_id: 1, x: 100, y: 100 };

const MOCK_FLOORPLAN: FloorplanData = {
  card: { id: 1, name: 'Test', view_box: '0 0 900 600', north_angle: 0 },
  rooms: [{ id: 1, card_id: 1, name: 'Salon', x: 50, y: 50, width: 200, height: 150 }],
  devices: [LIVE_SHUTTER],
  all_cards: [],
};

describe('FloorplanComponent', () => {
  let component: FloorplanComponent;
  let fixture: ComponentFixture<FloorplanComponent>;
  let floorplanSpy: jasmine.SpyObj<FloorplanService>;
  let shutterSpy: jasmine.SpyObj<DeviceService>;

  beforeEach(async () => {
    floorplanSpy = jasmine.createSpyObj('FloorplanService', ['getFloorplan', 'updateCard', 'createRoom', 'updateRoom', 'deleteRoom']);
    floorplanSpy.deleteRoom.and.returnValue(of(undefined));
    floorplanSpy.getFloorplan.and.callFake(() => of(JSON.parse(JSON.stringify(MOCK_FLOORPLAN))));
    floorplanSpy.updateCard.and.returnValue(of(MOCK_FLOORPLAN.card));
    floorplanSpy.updateRoom.and.returnValue(of(MOCK_FLOORPLAN.rooms[0]));

    shutterSpy = jasmine.createSpyObj('DeviceService', ['getDevices', 'updatePlacement']);
    shutterSpy.getDevices.and.returnValue(of([LIVE_SHUTTER]));

    await TestBed.configureTestingModule({
      imports: [FloorplanComponent],
      providers: [
        { provide: FloorplanService, useValue: floorplanSpy },
        { provide: DeviceService, useValue: shutterSpy },
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(FloorplanComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should load floorplan on init', () => {
    expect(floorplanSpy.getFloorplan).toHaveBeenCalled();
    expect(component.floorplan).toEqual(MOCK_FLOORPLAN);
  });

  it('should enter edit mode', () => {
    component.enterEditMode();
    expect(component.editMode).toBeTrue();
  });

  it('should cancel edit and restore original', () => {
    component.enterEditMode();
    component.addRoom();
    expect(component.floorplan!.rooms.length).toBe(2);
    component.cancelEdit();
    expect(component.editMode).toBeFalse();
    expect(component.floorplan!.rooms.length).toBe(1);
  });

  it('should add a room', () => {
    component.enterEditMode();
    component.addRoom();
    expect(component.floorplan!.rooms.length).toBe(2);
    expect(component.floorplan!.rooms[1].name).toBe('Nouvelle pièce');
  });

  it('should delete a room', () => {
    component.enterEditMode();
    const event = new MouseEvent('click');
    spyOn(event, 'stopPropagation');
    component.deleteRoom(1, event);
    expect(component.floorplan!.rooms.length).toBe(0);
  });

  it('should save floorplan and exit edit mode', (done) => {
    component.enterEditMode();
    component.saveEdit();
    setTimeout(() => {
      expect(floorplanSpy.updateCard).toHaveBeenCalled();
      expect(component.editMode).toBeFalse();
      done();
    }, 100);
  });

  it('should call deleteRoom API for rooms removed before save', (done) => {
    component.enterEditMode();
    component.deleteRoom(1, new MouseEvent('click'));
    component.saveEdit();
    setTimeout(() => {
      expect(floorplanSpy.deleteRoom).toHaveBeenCalledWith(1);
      done();
    }, 100);
  });

  it('should persist moved and removed equipment on save', (done) => {
    shutterSpy.updatePlacement.and.returnValue(of(undefined));
    component.shutters = [
      { ...LIVE_SHUTTER },
      { ...LIVE_SHUTTER, id: '1', name: 'B', db_id: 2, x: 200, y: 200 },
    ];
    component.enterEditMode();
    component.floorplan!.devices[0].x = 140;                 // A déplacé
    component.deleteEquipment('1', new MouseEvent('click')); // B retiré
    component.saveEdit();
    setTimeout(() => {
      expect(shutterSpy.updatePlacement).toHaveBeenCalledWith(1, component.floorplan!.card.id, 140, 100);
      expect(shutterSpy.updatePlacement).toHaveBeenCalledWith(2, null, null, null);
      done();
    }, 100);
  });

  it('should show error on save failure', (done) => {
    floorplanSpy.updateCard.and.returnValue(throwError(() => new Error('fail')));
    component.enterEditMode();
    component.saveEdit();
    setTimeout(() => {
      expect(component.saveError).toBeTrue();
      expect(component.editMode).toBeTrue();
      done();
    }, 100);
  });

  it('should return unplaced shutters', () => {
    expect(component.unplacedShutters.length).toBe(0);
  });

  it('should adapt shutter arrow angles relative to northAngle while rotating compass to northAngle', () => {
    component.floorplan!.devices = [
      { ...LIVE_SHUTTER, id: 'top', x: 100, y: 50, orientation: 20 },
      { ...LIVE_SHUTTER, id: 'bottom', x: 100, y: 200, orientation: 200 },
      { ...LIVE_SHUTTER, id: 'wrap', x: 150, y: 50, orientation: 10 },
    ];
    component.setNorthAngle(-20);

    expect(component.northAngle).toBe(-20);
    expect(component.getArrowAngle(component.floorplan!.devices[0])).toBe(0);
    expect(component.getArrowAngle(component.floorplan!.devices[1])).toBe(180);
    expect(component.getArrowAngle(component.floorplan!.devices[2])).toBe(350);

    const arrows = fixture.nativeElement.querySelectorAll('.orientation-arrow');
    expect(arrows.length).toBe(3);
    expect(arrows[0].getAttribute('transform')).toBe('translate(100,50) rotate(0)');
    expect(arrows[1].getAttribute('transform')).toBe('translate(100,200) rotate(180)');
    expect(arrows[2].getAttribute('transform')).toBe('translate(150,50) rotate(350)');

    const compassRotor = fixture.nativeElement.querySelector('.compass-indicator > g');
    expect(compassRotor.getAttribute('transform')).toBe('rotate(-20)');
  });

  it('should normalize a stored north angle above 180 to a negative angle', () => {
    component.floorplan!.card.north_angle = 340;
    expect(component.northAngle).toBe(-20);
  });

  it('should open shutter control modal when clicking a shutter on the plan', () => {
    const marker: HTMLElement = fixture.nativeElement.querySelector('.equipment-marker');
    expect(marker).toBeTruthy();
    marker.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fixture.detectChanges();

    expect(component.selectedShutter?.id).toBe(LIVE_SHUTTER.id);
    const panelTitle: HTMLElement | null = fixture.nativeElement.querySelector('app-shutter-panel .panel-title');
    expect(panelTitle?.textContent?.trim()).toBe('Baie vitrée');
  });
});

import { BaseDevice } from '../base.js';
export class ElegooMars4 extends BaseDevice {
  constructor(app, slot) {
    super(app, slot, { id: 'elegoo', name: 'ELEGOO Mars 4', kind: 'Resin-Drucker (MSLA)' });
    this.view('overview', 'Übersicht', [0, 600, 800], [0, 150, 0]);
  }
}

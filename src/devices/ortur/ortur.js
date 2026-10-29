import { BaseDevice } from '../base.js';
export class OrturLM3 extends BaseDevice {
  constructor(app, slot) {
    super(app, slot, { id: 'ortur', name: 'Ortur Laser Master 3', kind: 'Diodenlaser 10 W' });
    this.view('overview', 'Übersicht', [0, 700, 900], [0, 0, 0]);
  }
}

import { MATERIALS, materialById, FW_VERSION } from './firmware.js';

// ---------------------------------------------------------------------------
// MK4S 3.5" LCD user interface (480 x 320), operated by the rotary knob only.
// ---------------------------------------------------------------------------

const W = 480;
const H = 320;
const HEAD = 34;
const FOOT = 46;
const ORANGE = '#f0612a';
const GREY = '#8f959c';
const DARK = '#1c1e21';
const FONT = 'Inter, "Segoe UI", Roboto, Arial, sans-serif';

const STR = {
  de: {
    home: 'HOME', print: 'Drucken', preheat: 'Vorheizen', filament: 'Filament', control: 'Steuerung', settings: 'Einstellungen', info: 'Info',
    ret: 'Zurück', printing: 'DRUCKEN', tune: 'Tune', pause: 'Pause', resume: 'Fortsetzen', stop: 'Stopp', reprint: 'Erneut', homeBtn: 'Home',
    remaining: 'Restzeit', printTime: 'Druckzeit', endAt: 'Ende um', pausing: 'Pausiere …', paused: 'Pausiert', resuming: 'Setze fort …', stopping: 'Stoppe …',
    finished: 'Druck beendet', stopped: 'Druck gestoppt', noUsb: 'Kein USB-Laufwerk', insertUsb: 'Bitte USB-Stick einstecken', noFiles: 'Keine druckbaren Dateien',
    printBtn: 'Drucken', back: 'Zurück', material: 'Material', filUsed: 'Filament', estTime: 'Druckzeit', layer: 'Schicht',
    cooldown: 'Abkühlen', loadFil: 'Filament laden', unloadFil: 'Filament entladen', changeFil: 'Filament wechseln', purgeFil: 'Filament spülen',
    moveAxis: 'Achse bewegen', temperature: 'Temperatur', autoHome: 'Auto Home', disableMotors: 'Motoren deaktivieren', calib: 'Kalibrierungen & Tests',
    moveX: 'X bewegen', moveY: 'Y bewegen', moveZ: 'Z bewegen', moveE: 'E bewegen', nozzle: 'Düse', bed: 'Heizbett', nozzleTemp: 'Düsentemperatur', bedTemp: 'Heizbetttemperatur', fanSpeed: 'Bauteillüfter',
    printSpeed: 'Druckgeschwindigkeit', flow: 'Flussfaktor', fsensor: 'Filamentsensor', stealth: 'Stealth-Modus', sound: 'Tonmodus', language: 'Sprache', timeFormat: 'Zeitformat',
    hardware: 'Hardware', fwUpdate: 'FW-Update', system: 'System', factoryReset: 'Werkseinstellungen', sensorInfo: 'Sensor-Info', versionInfo: 'Versions-Info', stats: 'Druckstatistik', network: 'Netzwerkstatus',
    on: 'An', off: 'Aus', loud: 'Laut', once: 'Einmal', silent: 'Leise', assist: 'Assistent',
    preheating: 'Vorheizen', insert: 'Filament einführen', insertHint: 'Filament von oben in den Nextruder einführen, bis der Sensor es erkennt.',
    loading: 'Lade bis zur Düse', purging: 'Spülen', ramming: 'Ramming', unloading: 'Entladen', colorCorrect: 'Ist die Farbe korrekt?', yes: 'Ja', no: 'Nein', purgeMore: 'Weiter spülen',
    removeFilament: 'Filament aus dem Extruder ziehen und dann Weiter drücken.', continue: 'Weiter', ok: 'OK', noFilament: 'Kein Filament geladen.',
    homing: 'Referenzfahrt', probing: 'Mesh Bed Leveling', heatingNozzle: 'Heize Düse', heatingBed: 'Heize Heizbett', absorbing: 'Wärmeaufnahme', busy: 'Bitte warten …',
    wrongPrinter: 'Der G-Code wurde für einen anderen Drucker geslict ({x}). Trotzdem drucken?', wrongNozzle: 'Der G-Code erwartet eine andere Düse ({x} mm). Trotzdem drucken?',
    filNotLoaded: 'Es ist kein Filament geladen. Jetzt laden?', warning: 'Warnung', question: 'Frage', error: 'Fehler',
    usbRemoved: 'USB-Laufwerk getrennt! Der Druck wurde pausiert. Stecke den Stick wieder ein und setze fort.',
    fanTest: 'Lüftertest', xyTest: 'XY-Achsentest', zAlign: 'Z-Ausrichtung', loadcellTest: 'Wägezellentest', zTest: 'Z-Achsentest', heaterTest: 'Heizungstest', gearsCal: 'Getriebe-Kalibrierung', fsCal: 'Filamentsensor-Kalibr.',
    testRunning: 'Test läuft …', testPassed: 'Test bestanden', tapNozzle: 'Tippe jetzt auf die Düse!', resetDone: 'Einstellungen zurückgesetzt.',
    fwUpToDate: 'Keine neuere Firmware auf dem USB-Stick gefunden.', firmware: 'Firmware', bootloader: 'Bootloader', serial: 'Seriennummer', buddy: 'Buddy-Board',
    totalPrintTime: 'Gesamte Druckzeit', totalFilament: 'Filament gesamt', printsDone: 'Drucke', notConnected: 'Nicht verbunden', heatbreak: 'Heatbreak', board: 'Board', mcu: 'MCU', loadcell: 'Wägezelle', inputV: 'Eingangsspannung', fsensorState: 'Filamentsensor',
    detected: 'erkannt', notDetected: 'nicht erkannt', autoload: 'Filament erkannt. Welches Material möchtest du laden?', coldExtr: 'Kaltextrusion verhindert', heaterTimeout: 'Heizungs-Timeout',
    cancelObject: 'Objekt abbrechen', tuneTitle: 'TUNE', stopQ: 'Druck wirklich abbrechen?'
  },
  en: {
    home: 'HOME', print: 'Print', preheat: 'Preheat', filament: 'Filament', control: 'Control', settings: 'Settings', info: 'Info',
    ret: 'Return', printing: 'PRINTING', tune: 'Tune', pause: 'Pause', resume: 'Resume', stop: 'Stop', reprint: 'Reprint', homeBtn: 'Home',
    remaining: 'Remaining Time', printTime: 'Printing Time', endAt: 'Print will end', pausing: 'Pausing …', paused: 'Paused', resuming: 'Resuming …', stopping: 'Stopping …',
    finished: 'Print finished', stopped: 'Print stopped', noUsb: 'No USB drive', insertUsb: 'Please insert a USB drive', noFiles: 'No printable files',
    printBtn: 'Print', back: 'Back', material: 'Material', filUsed: 'Filament', estTime: 'Print Time', layer: 'Layer',
    cooldown: 'Cooldown', loadFil: 'Load Filament', unloadFil: 'Unload Filament', changeFil: 'Change Filament', purgeFil: 'Purge Filament',
    moveAxis: 'Move Axis', temperature: 'Temperature', autoHome: 'Auto Home', disableMotors: 'Disable Motors', calib: 'Calibrations & Tests',
    moveX: 'Move X', moveY: 'Move Y', moveZ: 'Move Z', moveE: 'Move E', nozzle: 'Nozzle', bed: 'Heatbed', nozzleTemp: 'Nozzle Temperature', bedTemp: 'Heatbed Temperature', fanSpeed: 'Print Fan Speed',
    printSpeed: 'Print Speed', flow: 'Flow Factor', fsensor: 'Filament Sensor', stealth: 'Stealth Mode', sound: 'Sound Mode', language: 'Language', timeFormat: 'Time Format',
    hardware: 'Hardware', fwUpdate: 'FW Update', system: 'System', factoryReset: 'Factory Reset', sensorInfo: 'Sensor Info', versionInfo: 'Version Info', stats: 'Print Statistics', network: 'Network Status',
    on: 'On', off: 'Off', loud: 'Loud', once: 'Once', silent: 'Silent', assist: 'Assist',
    preheating: 'Preheating', insert: 'Insert filament', insertHint: 'Insert the filament into the Nextruder until the sensor detects it.',
    loading: 'Loading to nozzle', purging: 'Purging', ramming: 'Ramming', unloading: 'Unloading', colorCorrect: 'Is color correct?', yes: 'Yes', no: 'No', purgeMore: 'Purge more',
    removeFilament: 'Remove the filament from the extruder and press Continue.', continue: 'Continue', ok: 'OK', noFilament: 'No filament loaded.',
    homing: 'Homing', probing: 'Mesh bed leveling', heatingNozzle: 'Heating nozzle', heatingBed: 'Heating heatbed', absorbing: 'Absorbing heat', busy: 'Please wait …',
    wrongPrinter: 'This G-code was sliced for another printer ({x}). Print anyway?', wrongNozzle: 'This G-code expects a different nozzle ({x} mm). Print anyway?',
    filNotLoaded: 'Filament is not loaded. Load it now?', warning: 'Warning', question: 'Question', error: 'Error',
    usbRemoved: 'USB drive disconnected! The print was paused. Re-insert the drive and resume.',
    fanTest: 'Fan Test', xyTest: 'XY Axis Test', zAlign: 'Z Alignment Calibration', loadcellTest: 'Loadcell Test', zTest: 'Z Axis Test', heaterTest: 'Heater Test', gearsCal: 'Gears Calibration', fsCal: 'Filament Sensor Calibration',
    testRunning: 'Test running …', testPassed: 'Test passed', tapNozzle: 'Tap the nozzle now!', resetDone: 'Settings were reset.',
    fwUpToDate: 'No newer firmware found on the USB drive.', firmware: 'Firmware', bootloader: 'Bootloader', serial: 'Serial Number', buddy: 'Buddy Board',
    totalPrintTime: 'Total Print Time', totalFilament: 'Total Filament', printsDone: 'Prints', notConnected: 'Not connected', heatbreak: 'Heatbreak', board: 'Board', mcu: 'MCU', loadcell: 'Loadcell', inputV: 'Input Voltage', fsensorState: 'Filament Sensor',
    detected: 'detected', notDetected: 'not detected', autoload: 'Filament detected. Which material do you want to load?', coldExtr: 'Cold extrusion prevented', heaterTimeout: 'Heater timeout',
    cancelObject: 'Cancel Object', tuneTitle: 'TUNE', stopQ: 'Really stop the print?'
  }
};

function fmtDur(s) {
  s = Math.max(0, Math.round(s));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  return `${s}s`;
}

// --------------------------------------------------------------- icons
function icon(ctx, name, x, y, s, color = '#fff', lw = 2) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s / 24, s / 24);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = (lw * 24) / s;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const P = new Path2D();
  switch (name) {
    case 'print':
      ctx.strokeRect(3, 3, 18, 18);
      ctx.beginPath();
      ctx.moveTo(3, 7);
      ctx.lineTo(21, 7);
      ctx.moveTo(10, 7);
      ctx.lineTo(10, 11);
      ctx.lineTo(14, 11);
      ctx.lineTo(14, 7);
      ctx.moveTo(12, 11);
      ctx.lineTo(12, 13);
      ctx.moveTo(6, 18);
      ctx.lineTo(18, 18);
      ctx.moveTo(8, 16);
      ctx.lineTo(16, 16);
      ctx.stroke();
      break;
    case 'preheat':
      ctx.beginPath();
      ctx.moveTo(10, 4);
      ctx.arc(12, 4, 2, Math.PI, 0);
      ctx.lineTo(14, 14);
      ctx.arc(12, 17, 3.6, -Math.PI / 2 + 0.55, Math.PI * 1.5 - 0.55);
      ctx.closePath();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(12, 17, 1.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(17, 6);
      ctx.lineTo(20, 6);
      ctx.moveTo(17, 9);
      ctx.lineTo(20, 9);
      ctx.moveTo(17, 12);
      ctx.lineTo(20, 12);
      ctx.stroke();
      break;
    case 'filament':
      ctx.beginPath();
      ctx.arc(12, 12, 9, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(12, 12, 3, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(12, 12, 6, 0.3, 2.6);
      ctx.stroke();
      break;
    case 'control':
      ctx.beginPath();
      ctx.moveTo(12, 2);
      ctx.lineTo(12, 22);
      ctx.moveTo(2, 12);
      ctx.lineTo(22, 12);
      ctx.moveTo(9, 5);
      ctx.lineTo(12, 2);
      ctx.lineTo(15, 5);
      ctx.moveTo(9, 19);
      ctx.lineTo(12, 22);
      ctx.lineTo(15, 19);
      ctx.moveTo(5, 9);
      ctx.lineTo(2, 12);
      ctx.lineTo(5, 15);
      ctx.moveTo(19, 9);
      ctx.lineTo(22, 12);
      ctx.lineTo(19, 15);
      ctx.stroke();
      break;
    case 'settings': {
      ctx.beginPath();
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        const r = i % 2 ? 7 : 9.5;
        ctx.lineTo(12 + Math.cos(a) * r, 12 + Math.sin(a) * r);
      }
      ctx.closePath();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(12, 12, 3, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case 'info':
      ctx.beginPath();
      ctx.arc(12, 12, 9.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(12, 11);
      ctx.lineTo(12, 17);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(12, 7.5, 1.2, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'back':
      ctx.beginPath();
      ctx.moveTo(10, 6);
      ctx.lineTo(4, 12);
      ctx.lineTo(10, 18);
      ctx.moveTo(4, 12);
      ctx.lineTo(16, 12);
      ctx.arc(16, 16, 4, -Math.PI / 2, Math.PI / 2);
      ctx.stroke();
      break;
    case 'folder':
      ctx.beginPath();
      ctx.moveTo(3, 6);
      ctx.lineTo(9, 6);
      ctx.lineTo(11, 8);
      ctx.lineTo(21, 8);
      ctx.lineTo(21, 19);
      ctx.lineTo(3, 19);
      ctx.closePath();
      ctx.stroke();
      break;
    case 'nozzle':
      ctx.beginPath();
      ctx.moveTo(6, 3);
      ctx.lineTo(18, 3);
      ctx.lineTo(18, 11);
      ctx.lineTo(14, 16);
      ctx.lineTo(13, 21);
      ctx.lineTo(11, 21);
      ctx.lineTo(10, 16);
      ctx.lineTo(6, 11);
      ctx.closePath();
      ctx.stroke();
      break;
    case 'bed':
      ctx.strokeRect(3, 14, 18, 5);
      ctx.beginPath();
      for (const x of [7, 12, 17]) {
        ctx.moveTo(x, 11);
        ctx.bezierCurveTo(x - 2, 9, x + 2, 7, x, 4);
      }
      ctx.stroke();
      break;
    case 'speed':
      ctx.beginPath();
      ctx.arc(12, 14, 9, Math.PI, 0);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(12, 14);
      ctx.lineTo(17, 8);
      ctx.stroke();
      break;
    case 'z':
      ctx.font = `800 18px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Z', 12, 13);
      break;
    case 'usb':
      ctx.beginPath();
      ctx.moveTo(12, 21);
      ctx.lineTo(12, 4);
      ctx.moveTo(9, 7);
      ctx.lineTo(12, 3);
      ctx.lineTo(15, 7);
      ctx.moveTo(12, 16);
      ctx.lineTo(6, 12);
      ctx.lineTo(6, 9);
      ctx.moveTo(12, 13);
      ctx.lineTo(18, 10);
      ctx.lineTo(18, 7);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(12, 20, 2, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'tune':
      ctx.beginPath();
      ctx.moveTo(5, 6);
      ctx.lineTo(19, 6);
      ctx.moveTo(5, 12);
      ctx.lineTo(19, 12);
      ctx.moveTo(5, 18);
      ctx.lineTo(19, 18);
      ctx.stroke();
      ctx.fillRect(13, 4, 3, 4);
      ctx.fillRect(7, 10, 3, 4);
      ctx.fillRect(15, 16, 3, 4);
      break;
    case 'pause':
      ctx.fillRect(6, 4, 4, 16);
      ctx.fillRect(14, 4, 4, 16);
      break;
    case 'resume':
      ctx.beginPath();
      ctx.moveTo(7, 4);
      ctx.lineTo(19, 12);
      ctx.lineTo(7, 20);
      ctx.closePath();
      ctx.fill();
      break;
    case 'stop':
      ctx.fillRect(5, 5, 14, 14);
      break;
    case 'reprint':
      ctx.beginPath();
      ctx.arc(12, 12, 8, -Math.PI * 0.3, Math.PI * 1.5);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(15, 2);
      ctx.lineTo(19, 5);
      ctx.lineTo(15, 8);
      ctx.stroke();
      break;
    case 'house':
      ctx.beginPath();
      ctx.moveTo(3, 12);
      ctx.lineTo(12, 4);
      ctx.lineTo(21, 12);
      ctx.moveTo(6, 10);
      ctx.lineTo(6, 20);
      ctx.lineTo(18, 20);
      ctx.lineTo(18, 10);
      ctx.stroke();
      break;
    case 'warning':
      ctx.beginPath();
      ctx.moveTo(12, 3);
      ctx.lineTo(22, 20);
      ctx.lineTo(2, 20);
      ctx.closePath();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(12, 9);
      ctx.lineTo(12, 14);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(12, 17, 1, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'question':
      ctx.beginPath();
      ctx.arc(12, 12, 9.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.font = `800 14px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('?', 12, 12.5);
      break;
    case 'arrowDown':
      ctx.beginPath();
      ctx.moveTo(12, 3);
      ctx.lineTo(12, 20);
      ctx.moveTo(6, 14);
      ctx.lineTo(12, 20);
      ctx.lineTo(18, 14);
      ctx.stroke();
      break;
    default:
      ctx.beginPath();
      ctx.arc(12, 12, 3, 0, Math.PI * 2);
      ctx.fill();
  }
  void P;
  ctx.restore();
}

// --------------------------------------------------------------- screens
class Screen {
  constructor(title, iconName) {
    this.title = title;
    this.icon = iconName;
  }
  rotate() {}
  press() {}
  draw() {}
}

class HomeScreen extends Screen {
  constructor() {
    super('home', 'house');
    this.sel = 0;
    this.tiles = [
      { key: 'print', icon: 'print' },
      { key: 'preheat', icon: 'preheat' },
      { key: 'filament', icon: 'filament' },
      { key: 'control', icon: 'control' },
      { key: 'settings', icon: 'settings' },
      { key: 'info', icon: 'info' }
    ];
  }
  rotate(ui, n) {
    this.sel = (this.sel + n + this.tiles.length * 10) % this.tiles.length;
  }
  press(ui) {
    const k = this.tiles[this.sel].key;
    ui.push(ui.buildMenu(k));
  }
  draw(ui, ctx) {
    const cols = 3;
    const tw = 140;
    const th = 104;
    const gx = (W - cols * tw) / (cols + 1);
    const y0 = HEAD + 14;
    this.tiles.forEach((t, i) => {
      const cx = gx + (i % cols) * (tw + gx);
      const cy = y0 + Math.floor(i / cols) * (th + 12);
      const sel = i === this.sel;
      ctx.fillStyle = sel ? ORANGE : DARK;
      roundRect(ctx, cx, cy, tw, th, 10);
      ctx.fill();
      icon(ctx, t.icon, cx + tw / 2 - 22, cy + 14, 44, '#fff', 2.4);
      ctx.fillStyle = '#fff';
      ctx.font = `600 16px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(ui.t(t.key), cx + tw / 2, cy + th - 14);
    });
  }
}

class MenuScreen extends Screen {
  constructor(title, iconName, items) {
    super(title, iconName);
    this.items = items;
    this.sel = 0;
    this.scroll = 0;
    this.editing = null;
  }
  visible() {
    return this.items.filter((it) => !it.hidden || !it.hidden());
  }
  rotate(ui, n) {
    if (this.editing) {
      const sp = this.editing.spin;
      let v = this.editing.temp + n * (sp.step || 1);
      v = Math.max(sp.min, Math.min(sp.max, v));
      v = Math.round(v / (sp.step || 1)) * (sp.step || 1);
      this.editing.temp = +v.toFixed(3);
      if (sp.live) sp.set(this.editing.temp, ui);
      return;
    }
    const vis = this.visible();
    this.sel = Math.max(0, Math.min(vis.length - 1, this.sel + n));
  }
  press(ui) {
    const vis = this.visible();
    const it = vis[this.sel];
    if (!it) return;
    if (this.editing) {
      if (!it.spin.live) it.spin.set(this.editing.temp, ui);
      this.editing = null;
      return;
    }
    if (it.enabled && !it.enabled()) {
      ui.beepError();
      return;
    }
    if (it.back) return ui.pop();
    if (it.submenu) return ui.push(it.submenu());
    if (it.spin) {
      this.editing = it;
      it.temp = it.spin.get();
      return;
    }
    if (it.toggle) {
      it.toggle.set(!it.toggle.get(), ui);
      return;
    }
    if (it.cycle) {
      const opts = it.cycle.options;
      const cur = opts.indexOf(it.cycle.get());
      it.cycle.set(opts[(cur + 1) % opts.length], ui);
      return;
    }
    if (it.action) it.action(ui);
  }
  draw(ui, ctx) {
    const vis = this.visible();
    const rowH = 40;
    const area = H - HEAD - FOOT;
    const rows = Math.floor(area / rowH);
    if (this.sel < this.scroll) this.scroll = this.sel;
    if (this.sel >= this.scroll + rows) this.scroll = this.sel - rows + 1;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, HEAD, W, area);
    ctx.clip();
    for (let r = 0; r < rows + 1; r++) {
      const i = this.scroll + r;
      const it = vis[i];
      if (!it) break;
      const y = HEAD + 2 + r * rowH;
      const sel = i === this.sel;
      const disabled = it.enabled && !it.enabled();
      if (sel) {
        ctx.fillStyle = this.editing === it ? '#3a3d42' : ORANGE;
        ctx.fillRect(0, y, W - 8, rowH - 2);
      }
      const ic = it.back ? 'back' : it.icon;
      if (ic) icon(ctx, ic, 12, y + 8, 22, disabled ? '#555' : '#fff', 2);
      ctx.fillStyle = disabled ? '#5c6066' : '#fff';
      ctx.font = `500 17px ${FONT}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      const label = it.back ? ui.t('ret') : typeof it.label === 'function' ? it.label(ui) : ui.t(it.label);
      ctx.fillText(ellipsize(ctx, label, 300), 44, y + rowH / 2);
      // right side value
      let val = null;
      if (it.spin) {
        const v = this.editing === it ? it.temp : it.spin.get();
        val = it.spin.fmt ? it.spin.fmt(v, ui) : `${v}`;
      } else if (it.toggle) val = it.toggle.get() ? ui.t('on') : ui.t('off');
      else if (it.cycle) val = it.cycle.fmt ? it.cycle.fmt(it.cycle.get(), ui) : it.cycle.get();
      else if (it.value) val = it.value(ui);
      if (val !== null && val !== undefined) {
        ctx.textAlign = 'right';
        if (this.editing === it) {
          ctx.fillStyle = ORANGE;
          const tw = ctx.measureText(val).width + 18;
          roundRect(ctx, W - 22 - tw, y + 6, tw + 8, rowH - 14, 5);
          ctx.fill();
          ctx.fillStyle = '#fff';
        } else ctx.fillStyle = sel ? '#fff' : '#c6cbd1';
        ctx.fillText(val, W - 22, y + rowH / 2);
      } else if (it.submenu) {
        ctx.fillStyle = sel ? '#fff' : GREY;
        ctx.textAlign = 'right';
        ctx.fillText('›', W - 22, y + rowH / 2);
      }
    }
    ctx.restore();
    // scrollbar
    if (vis.length > rows) {
      const sbH = (area * rows) / vis.length;
      const sbY = HEAD + (area - sbH) * (this.scroll / Math.max(1, vis.length - rows));
      ctx.fillStyle = '#3a3d42';
      ctx.fillRect(W - 5, HEAD, 3, area);
      ctx.fillStyle = '#9aa0a6';
      ctx.fillRect(W - 5, sbY, 3, sbH);
    }
  }
}

class FileBrowser extends Screen {
  constructor() {
    super('print', 'print');
    this.sel = 0;
    this.scroll = 0;
  }
  list(ui) {
    return ui.dev.usb.inserted ? ui.dev.usb.files.filter((f) => f.printable) : [];
  }
  rotate(ui, n) {
    const l = this.list(ui);
    this.sel = Math.max(0, Math.min(l.length, this.sel + n));
  }
  press(ui) {
    if (this.sel === 0) return ui.pop();
    const f = this.list(ui)[this.sel - 1];
    if (f) ui.push(new PreviewScreen(f));
  }
  draw(ui, ctx) {
    const l = this.list(ui);
    const rowH = 46;
    const area = H - HEAD - FOOT;
    const rows = Math.floor(area / rowH);
    const total = l.length + 1;
    if (this.sel >= total) this.sel = total - 1;
    if (this.sel < this.scroll) this.scroll = this.sel;
    if (this.sel >= this.scroll + rows) this.scroll = this.sel - rows + 1;
    for (let r = 0; r < rows; r++) {
      const i = this.scroll + r;
      if (i >= total) break;
      const y = HEAD + 2 + r * rowH;
      const sel = i === this.sel;
      if (sel) {
        ctx.fillStyle = ORANGE;
        ctx.fillRect(0, y, W - 8, rowH - 2);
      }
      ctx.font = `500 16px ${FONT}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      if (i === 0) {
        icon(ctx, 'back', 14, y + 11, 22);
        ctx.fillStyle = '#fff';
        ctx.fillText(ui.t('ret'), 60, y + rowH / 2);
        continue;
      }
      const f = l[i - 1];
      // thumbnail
      ctx.fillStyle = '#26292d';
      ctx.fillRect(8, y + 4, 44, rowH - 10);
      if (f.thumbImg && f.thumbImg.complete !== false) {
        try {
          drawContain(ctx, f.thumbImg, 8, y + 4, 44, rowH - 10);
        } catch {
          /* not decoded yet */
        }
      }
      ctx.fillStyle = '#fff';
      ctx.fillText(ellipsize(ctx, f.name, 300), 60, y + rowH / 2 - 7);
      ctx.fillStyle = sel ? '#ffe2d6' : GREY;
      ctx.font = `400 12px ${FONT}`;
      const meta = [f.meta?.time ? fmtDur(f.meta.time) : null, f.meta?.material, sizeStr(f.size)].filter(Boolean).join('  ·  ');
      ctx.fillText(meta, 60, y + rowH / 2 + 11);
    }
    if (!ui.dev.usb.inserted || l.length === 0) {
      ctx.fillStyle = GREY;
      ctx.font = `500 16px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText(ui.dev.usb.inserted ? ui.t('noFiles') : ui.t('noUsb'), W / 2, HEAD + 130);
      if (!ui.dev.usb.inserted) {
        ctx.font = `400 13px ${FONT}`;
        ctx.fillText(ui.t('insertUsb'), W / 2, HEAD + 154);
      }
    }
  }
}

class PreviewScreen extends Screen {
  constructor(file) {
    super('print', 'print');
    this.file = file;
    this.sel = 0;
  }
  rotate(ui, n) {
    this.sel = Math.max(0, Math.min(1, this.sel + n));
  }
  press(ui) {
    if (this.sel === 1) return ui.pop();
    ui.startPrintFlow(this.file);
  }
  draw(ui, ctx) {
    const f = this.file;
    ctx.fillStyle = '#26292d';
    const tw = 248;
    const th = 137;
    const tx = 16;
    const ty = HEAD + 26;
    ctx.fillRect(tx, ty, tw, th);
    if (f.thumbImg) {
      try {
        drawContain(ctx, f.thumbImg, tx, ty, tw, th);
      } catch {
        /* ignore */
      }
    }
    ctx.fillStyle = '#fff';
    ctx.font = `600 15px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(ellipsize(ctx, f.name, W - 32), 16, HEAD + 12);
    const rows = [
      [ui.t('estTime'), f.meta?.time ? fmtDur(f.meta.time) : '—'],
      [ui.t('material'), f.meta?.material || '—'],
      [ui.t('filUsed'), f.meta?.filamentM ? `${f.meta.filamentM.toFixed(2)} m` : '—'],
      ['', f.meta?.filamentG ? `${f.meta.filamentG.toFixed(1)} g` : '']
    ];
    rows.forEach(([k, v], i) => {
      ctx.fillStyle = GREY;
      ctx.font = `400 13px ${FONT}`;
      ctx.fillText(k, 280, HEAD + 40 + i * 34);
      ctx.fillStyle = '#fff';
      ctx.font = `600 16px ${FONT}`;
      ctx.fillText(v, 280, HEAD + 56 + i * 34);
    });
    // buttons
    const bw = 140;
    const by = H - FOOT - 62;
    [
      ['printBtn', 'print'],
      ['back', 'back']
    ].forEach(([k, ic], i) => {
      const bx = W / 2 - bw - 10 + i * (bw + 20);
      const sel = this.sel === i;
      ctx.fillStyle = sel ? ORANGE : DARK;
      roundRect(ctx, bx, by, bw, 50, 8);
      ctx.fill();
      icon(ctx, ic, bx + 16, by + 13, 24);
      ctx.fillStyle = '#fff';
      ctx.font = `600 16px ${FONT}`;
      ctx.textAlign = 'left';
      ctx.fillText(ui.t(k), bx + 52, by + 26);
    });
  }
}

class PrintScreen extends Screen {
  constructor() {
    super('printing', 'print');
    this.sel = 0;
  }
  buttons(ui) {
    const fw = ui.fw;
    if (fw.mode === 'finished' || fw.mode === 'stopped') return [
      { k: 'reprint', ic: 'reprint', act: () => ui.reprint() },
      { k: 'homeBtn', ic: 'house', act: () => ui.leavePrint() }
    ];
    const paused = fw.mode === 'paused';
    return [
      { k: 'tune', ic: 'tune', act: () => ui.push(ui.buildTune()) },
      { k: paused ? 'resume' : 'pause', ic: paused ? 'resume' : 'pause', act: () => (paused ? fw.resume() : fw.pause()), enabled: () => fw.mode === 'printing' || fw.mode === 'paused' },
      { k: 'stop', ic: 'stop', act: () => ui.confirm(ui.t('stopQ'), () => fw.stop()), enabled: () => fw.mode !== 'stopping' }
    ];
  }
  rotate(ui, n) {
    const b = this.buttons(ui);
    this.sel = Math.max(0, Math.min(b.length - 1, this.sel + n));
  }
  press(ui) {
    const b = this.buttons(ui)[this.sel];
    if (!b) return;
    if (b.enabled && !b.enabled()) return ui.beepError();
    b.act();
  }
  draw(ui, ctx) {
    const fw = ui.fw;
    const job = fw.job || fw.lastJob;
    const f = job?.file;
    ctx.fillStyle = '#fff';
    ctx.font = `600 15px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(ellipsize(ctx, f ? f.name : '', W - 30), W / 2, HEAD + 14);
    // thumbnail
    const tx = 14;
    const ty = HEAD + 30;
    const tw = 216;
    const th = 120;
    ctx.fillStyle = '#26292d';
    ctx.fillRect(tx, ty, tw, th);
    if (f?.thumbImg) {
      try {
        drawContain(ctx, f.thumbImg, tx, ty, tw, th);
      } catch {
        /* ignore */
      }
    }
    // status text
    let status = '';
    if (fw.mode === 'pausing') status = ui.t('pausing');
    else if (fw.mode === 'paused') status = ui.t('paused');
    else if (fw.mode === 'resuming') status = ui.t('resuming');
    else if (fw.mode === 'stopping') status = ui.t('stopping');
    else if (fw.mode === 'finished') status = ui.t('finished');
    else if (fw.mode === 'stopped') status = ui.t('stopped');
    else if (fw.homingActive) status = ui.t('homing');
    else if (fw.mblActive) status = `${ui.t('probing')}${fw.mblTotal ? ` ${fw.mblDone}/${fw.mblTotal}` : ''}`;
    else if (fw.heatingLabel === 'nozzle') status = `${ui.t('heatingNozzle')} ${Math.round(fw.nozzle.displayTemp)}/${Math.round(fw.nozzle.target)}°C`;
    else if (fw.heatingLabel === 'bed') status = `${ui.t('heatingBed')} ${Math.round(fw.bed.displayTemp)}/${Math.round(fw.bed.target)}°C`;
    else if (fw.message && fw.mode === 'printing' && fw.job && fw.job.layer < 1) status = fw.message;
    if (status) {
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fillRect(tx, ty + th - 24, tw, 24);
      ctx.fillStyle = fw.mode === 'finished' ? '#7ee2a8' : '#ffd2bf';
      ctx.font = `600 12.5px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText(ellipsize(ctx, status, tw - 10), tx + tw / 2, ty + th - 12);
    }
    // times
    const rx = 246;
    const lines = [];
    if (fw.mode === 'finished' || fw.mode === 'stopped') {
      lines.push([ui.t('printTime'), fmtDur(job?.finishedAt ?? job?.elapsed ?? 0)]);
      lines.push([ui.t('filUsed'), f?.meta?.filamentM ? `${f.meta.filamentM.toFixed(2)} m` : '—']);
    } else {
      const rem = fw.remaining;
      lines.push([ui.t('remaining'), fmtDur(rem)]);
      lines.push([ui.t('printTime'), fmtDur(job?.elapsed || 0)]);
      const end = new Date(Date.now() + (rem * 1000) / Math.max(1, ui.dev.app.simSpeed));
      lines.push([ui.t('endAt'), ui.clock(end)]);
    }
    lines.forEach(([k, v], i) => {
      ctx.textAlign = 'left';
      ctx.fillStyle = GREY;
      ctx.font = `400 12.5px ${FONT}`;
      ctx.fillText(k, rx, ty + 8 + i * 40);
      ctx.fillStyle = '#fff';
      ctx.font = `600 19px ${FONT}`;
      ctx.fillText(v, rx, ty + 26 + i * 40);
    });
    // progress
    const pct = fw.mode === 'finished' ? 100 : fw.progress;
    const py = ty + th + 12;
    ctx.fillStyle = '#2b2e33';
    roundRect(ctx, 14, py, W - 100, 10, 5);
    ctx.fill();
    ctx.fillStyle = fw.mode === 'finished' ? '#3fbf7f' : ORANGE;
    roundRect(ctx, 14, py, Math.max(10, ((W - 100) * pct) / 100), 10, 5);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = `700 24px ${FONT}`;
    ctx.textAlign = 'right';
    ctx.fillText(`${Math.floor(pct)}%`, W - 14, py + 6);
    // buttons
    const btns = this.buttons(ui);
    const bw = (W - 28 - (btns.length - 1) * 10) / btns.length;
    const by = py + 22;
    const bh = H - FOOT - by - 6;
    btns.forEach((b, i) => {
      const bx = 14 + i * (bw + 10);
      const sel = this.sel === i;
      const dis = b.enabled && !b.enabled();
      ctx.fillStyle = sel ? ORANGE : DARK;
      roundRect(ctx, bx, by, bw, bh, 8);
      ctx.fill();
      icon(ctx, b.ic, bx + bw / 2 - 40, by + bh / 2 - 11, 22, dis ? '#666' : '#fff');
      ctx.fillStyle = dis ? '#666' : '#fff';
      ctx.font = `600 15px ${FONT}`;
      ctx.textAlign = 'left';
      ctx.fillText(ui.t(b.k), bx + bw / 2 - 10, by + bh / 2);
    });
  }
}

class DialogScreen extends Screen {
  constructor() {
    super('', 'question');
    this.sel = 0;
  }
  rotate(ui, n, prompt) {
    this.sel = Math.max(0, Math.min(prompt.buttons.length - 1, this.sel + n));
  }
  press(ui, prompt) {
    const b = prompt.buttons[this.sel] || prompt.buttons[0];
    this.sel = 0;
    if (prompt.onAnswer) {
      prompt.onAnswer(b.id);
      ui.localPrompt = null;
    } else ui.fw.answerPrompt(b.id);
  }
  draw(ui, ctx, prompt) {
    const ic = prompt.icon || (prompt.title === 'warning' || prompt.title === 'error' ? 'warning' : 'question');
    icon(ctx, ic, W / 2 - 22, HEAD + 16, 44, prompt.title === 'error' ? '#ff6b6b' : ORANGE, 2.4);
    ctx.fillStyle = '#fff';
    ctx.font = `500 17px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const text = ui.t(prompt.text, prompt.vars);
    wrapText(ctx, text, W / 2, HEAD + 92, W - 60, 22);
    const n = prompt.buttons.length;
    const bw = Math.min(170, (W - 40 - (n - 1) * 12) / n);
    const total = n * bw + (n - 1) * 12;
    const by = H - FOOT - 60;
    prompt.buttons.forEach((b, i) => {
      const bx = W / 2 - total / 2 + i * (bw + 12);
      ctx.fillStyle = i === this.sel ? ORANGE : DARK;
      roundRect(ctx, bx, by, bw, 46, 8);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = `600 16px ${FONT}`;
      ctx.fillText(ui.t(b.label), bx + bw / 2, by + 23);
    });
  }
}

class WizardScreen extends Screen {
  draw(ui, ctx, wz) {
    const fw = ui.fw;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (wz.kind === 'insert') {
      icon(ctx, 'arrowDown', W / 2 - 28, HEAD + 18, 56, ORANGE, 3);
      ctx.fillStyle = '#fff';
      ctx.font = `700 22px ${FONT}`;
      ctx.fillText(ui.t('insert'), W / 2, HEAD + 104);
      ctx.fillStyle = '#c6cbd1';
      ctx.font = `400 15px ${FONT}`;
      wrapText(ctx, ui.t('insertHint'), W / 2, HEAD + 138, W - 80, 20);
      return;
    }
    ctx.fillStyle = '#fff';
    ctx.font = `700 22px ${FONT}`;
    ctx.fillText(ui.t(wz.title), W / 2, HEAD + 50);
    const t = fw.nozzle;
    ctx.font = `600 34px ${FONT}`;
    ctx.fillStyle = t.temp < t.target - 3 ? ORANGE : '#fff';
    ctx.fillText(`${Math.round(t.displayTemp)}/${Math.round(t.target)}°C`, W / 2, HEAD + 104);
    let p = wz.progress;
    if (wz.kind === 'heat') p = t.target > 0 ? Math.min(1, (t.temp - 25) / Math.max(1, t.target - 25)) : 0;
    ctx.fillStyle = '#2b2e33';
    roundRect(ctx, 60, HEAD + 150, W - 120, 12, 6);
    ctx.fill();
    ctx.fillStyle = ORANGE;
    roundRect(ctx, 60, HEAD + 150, Math.max(12, (W - 120) * Math.max(0, Math.min(1, p || 0))), 12, 6);
    ctx.fill();
    if (wz.mat) {
      ctx.fillStyle = GREY;
      ctx.font = `500 15px ${FONT}`;
      ctx.fillText(wz.mat, W / 2, HEAD + 190);
    }
  }
}

class BusyScreen extends Screen {
  constructor(text, done) {
    super('', 'info');
    this.text = text;
    this.done = done;
  }
  draw(ui, ctx) {
    ctx.fillStyle = '#fff';
    ctx.font = `600 20px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const txt = typeof this.text === 'function' ? this.text(ui) : ui.t(this.text);
    wrapText(ctx, txt, W / 2, HEAD + 90, W - 60, 26);
    const a = (performance.now() / 600) % (Math.PI * 2);
    ctx.strokeStyle = ORANGE;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(W / 2, HEAD + 170, 18, a, a + 4.2);
    ctx.stroke();
  }
}

// --------------------------------------------------------------- helpers
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function ellipsize(ctx, s, maxW) {
  if (ctx.measureText(s).width <= maxW) return s;
  let lo = 0;
  let hi = s.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(s.slice(0, mid) + '…').width <= maxW) lo = mid;
    else hi = mid - 1;
  }
  return s.slice(0, lo) + '…';
}

function wrapText(ctx, text, x, y, maxW, lh) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(t).width > maxW && cur) {
      lines.push(cur);
      cur = w;
    } else cur = t;
  }
  if (cur) lines.push(cur);
  const y0 = y - ((lines.length - 1) * lh) / 2;
  lines.forEach((l, i) => ctx.fillText(l, x, y0 + i * lh));
}

function drawContain(ctx, img, x, y, w, h) {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  if (!iw || !ih) return;
  const s = Math.min(w / iw, h / ih);
  const dw = iw * s;
  const dh = ih * s;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

function sizeStr(b) {
  if (!b) return '';
  if (b > 1e6) return `${(b / 1e6).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(b / 1e3))} kB`;
}

// --------------------------------------------------------------- UI
export class PrusaLCD {
  constructor(dev) {
    this.dev = dev;
    this.fw = dev.fw;
    this.canvas = document.createElement('canvas');
    this.canvas.width = W * 2;
    this.canvas.height = H * 2;
    this.ctx = this.canvas.getContext('2d');
    this.stack = [new HomeScreen()];
    this.dialog = new DialogScreen();
    this.wizardScreen = new WizardScreen();
    this.localPrompt = null;
    this.lastInput = 0;
    this.redrawTimer = 0;
    this.dirty = true;
    this.lastMode = null;
  }

  t(key, vars) {
    const lang = this.fw.settings.lang;
    let s = STR[lang]?.[key] ?? STR.en[key] ?? key;
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, v);
    return s;
  }

  clock(d = new Date()) {
    if (this.fw.settings.timeFormat === '12h') {
      let h = d.getHours();
      const ap = h >= 12 ? 'PM' : 'AM';
      h = h % 12 || 12;
      return `${h}:${String(d.getMinutes()).padStart(2, '0')} ${ap}`;
    }
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  get top() {
    return this.stack[this.stack.length - 1];
  }

  push(s) {
    this.stack.push(s);
    this.dirty = true;
  }

  pop() {
    if (this.stack.length > 1) this.stack.pop();
    this.dirty = true;
  }

  goHome() {
    this.stack = [new HomeScreen()];
    this.dirty = true;
  }

  beepError() {
    this.dev.sound('error');
  }

  // what is visible right now
  activeLayer() {
    const fw = this.fw;
    if (!fw.powered) return { kind: 'off' };
    if (fw.mode === 'boot') return { kind: 'boot' };
    if (this.localPrompt) return { kind: 'dialog', prompt: this.localPrompt };
    if (fw.prompt) return { kind: 'dialog', prompt: fw.prompt };
    if (fw.wizard) return { kind: 'wizard', wz: fw.wizard };
    return { kind: 'screen', s: this.top };
  }

  rotate(n) {
    this.lastInput = performance.now();
    const L = this.activeLayer();
    if (L.kind === 'dialog') this.dialog.rotate(this, n, L.prompt);
    else if (L.kind === 'screen') L.s.rotate(this, n);
    this.dirty = true;
  }

  press() {
    this.lastInput = performance.now();
    const L = this.activeLayer();
    if (L.kind === 'dialog') this.dialog.press(this, L.prompt);
    else if (L.kind === 'screen') L.s.press(this);
    this.dirty = true;
  }

  confirm(text, yes) {
    this.dialog.sel = 1;
    this.localPrompt = {
      title: 'question',
      text,
      buttons: [{ id: 'yes', label: 'yes' }, { id: 'no', label: 'no' }],
      onAnswer: (id) => {
        if (id === 'yes') yes();
      }
    };
  }

  info(text, title = 'info') {
    this.dialog.sel = 0;
    this.localPrompt = { title, icon: title === 'warning' ? 'warning' : 'info', text, buttons: [{ id: 'ok', label: 'ok' }], onAnswer: () => {} };
  }

  // ---------------------------------------------------------------- flows
  startPrintFlow(file) {
    const fw = this.fw;
    const go = () => {
      if (fw.startPrint(file)) {
        this.stack = [new HomeScreen(), new PrintScreen()];
        this.dirty = true;
      }
    };
    const checks = [];
    const model = file.meta?.printerModel;
    if (model && !['MK4S', 'MK4', 'MK3.9', 'MK3.9S', 'MK4SMMU3', 'MK4MMU3'].includes(model.toUpperCase())) checks.push(['wrongPrinter', { x: model }]);
    if (file.meta?.nozzle && Math.abs(file.meta.nozzle - 0.4) > 0.01) checks.push(['wrongNozzle', { x: file.meta.nozzle }]);
    const next = () => {
      const c = checks.shift();
      if (!c) {
        if (!fw.filament.loaded) {
          this.dialog.sel = 0;
          this.localPrompt = {
            title: 'warning',
            icon: 'warning',
            text: 'filNotLoaded',
            buttons: [{ id: 'yes', label: 'yes' }, { id: 'no', label: 'no' }],
            onAnswer: (id) => {
              if (id === 'yes') {
                const mat = file.meta?.material || 'PLA';
                fw.startTask(fw.taskLoad(mat.split(';')[0]), 'load');
              }
              go();
            }
          };
          return;
        }
        go();
        return;
      }
      this.dialog.sel = 1;
      this.localPrompt = {
        title: 'warning',
        icon: 'warning',
        text: c[0],
        vars: c[1],
        buttons: [{ id: 'yes', label: 'yes' }, { id: 'no', label: 'no' }],
        onAnswer: (id) => {
          if (id === 'yes') setTimeout(next, 0);
        }
      };
    };
    next();
  }

  reprint() {
    const job = this.fw.job || this.fw.lastJob;
    if (!job) return;
    if (!this.dev.usb.inserted || !this.dev.usb.files.includes(job.file)) {
      this.info('noUsb', 'warning');
      return;
    }
    this.fw.clearJob();
    this.startPrintFlow(job.file);
  }

  leavePrint() {
    this.fw.clearJob();
    this.goHome();
  }

  buildMenu(key) {
    const fw = this.fw;
    const dev = this.dev;
    const R = { back: true };
    switch (key) {
      case 'print':
        return new FileBrowser();
      case 'preheat':
        return new MenuScreen('preheat', 'preheat', [
          R,
          ...MATERIALS.map((m) => ({
            label: m.id,
            icon: 'preheat',
            value: () => `${m.nozzle}/${m.bed}°C`,
            action: (ui) => {
              fw.nozzle.setTarget(m.nozzle);
              fw.bed.setTarget(m.bed);
              ui.goHome();
            }
          })),
          {
            label: 'cooldown',
            icon: 'preheat',
            action: (ui) => {
              fw.nozzle.setTarget(0);
              fw.bed.setTarget(0);
              fw.fan = 0;
              ui.goHome();
            }
          }
        ]);
      case 'filament':
        return new MenuScreen('filament', 'filament', [
          R,
          { label: 'loadFil', icon: 'filament', enabled: () => !fw.busy, submenu: () => this.materialPicker((m) => fw.startTask(fw.taskLoad(m), 'load')) },
          { label: 'unloadFil', icon: 'filament', enabled: () => !fw.busy, action: (ui) => { fw.startTask(fw.taskUnload(), 'unload'); ui.goHome(); } },
          { label: 'changeFil', icon: 'filament', enabled: () => !fw.busy, submenu: () => this.materialPicker((m) => { fw.startTask((function* () { yield* fw.taskUnload(); yield* fw.taskLoad(m); })(), 'change'); }) },
          { label: 'purgeFil', icon: 'filament', enabled: () => !fw.busy && fw.filament.loaded, action: (ui) => { const mat = materialById(fw.filament.type); fw.startTask((function* () { if (fw.planner.pos[2] < 40) yield* fw.move(undefined, undefined, 40, 12); yield* fw.taskPreheatFor(mat); fw.wizard = { kind: 'purge', title: 'purging', progress: 0.5 }; yield* fw.purge(30); fw.wizard = null; fw.hooks.dropPurge?.(); })(), 'purge'); ui.goHome(); } }
        ]);
      case 'control':
        return new MenuScreen('control', 'control', [
          R,
          { label: 'moveAxis', icon: 'control', submenu: () => this.moveMenu() },
          { label: 'temperature', icon: 'preheat', submenu: () => this.tempMenu() },
          { label: 'autoHome', icon: 'house', enabled: () => !fw.busy, action: (ui) => { fw.run('G28'); ui.push(new BusyScreen('homing')); this.waitIdle(() => ui.pop()); } },
          { label: 'disableMotors', icon: 'control', action: () => { fw.run('M84'); } },
          { label: 'calib', icon: 'settings', submenu: () => this.calibMenu() }
        ]);
      case 'settings':
        return new MenuScreen('settings', 'settings', [
          R,
          { label: 'fsensor', icon: 'filament', toggle: { get: () => fw.settings.fsensor, set: (v) => (fw.settings.fsensor = v) } },
          { label: 'stealth', icon: 'speed', toggle: { get: () => fw.settings.stealth, set: (v) => { fw.settings.stealth = v; dev.applyStealth(); } } },
          { label: 'sound', icon: 'info', cycle: { options: ['loud', 'once', 'silent', 'assist'], get: () => fw.settings.sound, set: (v) => (fw.settings.sound = v), fmt: (v, ui) => ui.t(v) } },
          { label: 'language', icon: 'info', cycle: { options: ['de', 'en'], get: () => fw.settings.lang, set: (v) => (fw.settings.lang = v), fmt: (v) => (v === 'de' ? 'Deutsch' : 'English') } },
          { label: 'timeFormat', icon: 'info', cycle: { options: ['24h', '12h'], get: () => fw.settings.timeFormat, set: (v) => (fw.settings.timeFormat = v) } },
          { label: 'hardware', icon: 'settings', submenu: () => new MenuScreen('hardware', 'settings', [
            R,
            { label: () => 'Printer Type', value: () => 'MK4S' },
            { label: () => 'Nozzle Diameter', value: () => '0.40 mm' },
            { label: () => 'Nozzle High-flow', value: () => this.t('on') },
            { label: () => 'Nextruder Silicone Sock', value: () => this.t('on') }
          ]) },
          { label: 'fwUpdate', icon: 'usb', action: () => this.info('fwUpToDate') },
          { label: 'factoryReset', icon: 'warning', action: () => this.confirm(this.t('factoryReset') + '?', () => { fw.settings = { fsensor: true, stealth: false, sound: 'loud', lang: 'de', timeFormat: '24h' }; fw.stats = { printTime: 0, filament: 0, prints: 0, x: 0, y: 0, z: 0 }; dev.applyStealth(); this.info('resetDone'); }) }
        ]);
      case 'info':
        return new MenuScreen('info', 'info', [
          R,
          { label: 'sensorInfo', icon: 'info', submenu: () => this.sensorInfo() },
          { label: 'versionInfo', icon: 'info', submenu: () => new MenuScreen('versionInfo', 'info', [
            R,
            { label: 'firmware', value: () => FW_VERSION },
            { label: 'bootloader', value: () => '2.3.4' },
            { label: 'buddy', value: () => 'xBuddy 0.3.4' },
            { label: () => 'xLCD', value: () => '1.2' },
            { label: 'serial', value: () => 'MK4S-SIM-00042' }
          ]) },
          { label: 'stats', icon: 'info', submenu: () => new MenuScreen('stats', 'info', [
            R,
            { label: 'printsDone', value: () => `${fw.stats.prints}` },
            { label: 'totalPrintTime', value: () => fmtDur(fw.stats.printTime) },
            { label: 'totalFilament', value: () => `${(fw.stats.filament / 1000).toFixed(2)} m` },
            { label: () => 'X', value: () => `${(fw.stats.x / 1000).toFixed(1)} m` },
            { label: () => 'Y', value: () => `${(fw.stats.y / 1000).toFixed(1)} m` },
            { label: () => 'Z', value: () => `${(fw.stats.z / 1000).toFixed(2)} m` }
          ]) },
          { label: 'network', icon: 'info', value: () => this.t('notConnected') }
        ]);
      default:
        return new MenuScreen(key, 'info', [R]);
    }
  }

  materialPicker(cb) {
    const items = [{ back: true }];
    for (const m of MATERIALS) {
      items.push({
        label: m.id,
        icon: 'filament',
        value: () => `${m.nozzle}°C`,
        action: (ui) => {
          ui.goHome();
          cb(m.id);
        }
      });
    }
    return new MenuScreen('filament', 'filament', items);
  }

  moveMenu() {
    const fw = this.fw;
    const mk = (axis, label, min, max, step) => ({
      label,
      icon: 'control',
      spin: {
        get: () => +fw.planner.pos[axis].toFixed(axis === 2 ? 2 : 1),
        set: (v) => fw.jogTo(axis, v),
        min,
        max,
        step,
        live: true,
        fmt: (v) => `${(+v).toFixed(axis === 2 ? 2 : 0)} mm`
      }
    });
    return new MenuScreen('moveAxis', 'control', [
      { back: true },
      mk(0, 'moveX', -2, 255, 1),
      mk(1, 'moveY', -4, 212, 1),
      mk(2, 'moveZ', 0, 220, 0.5),
      {
        label: 'moveE',
        icon: 'filament',
        spin: {
          get: () => 0,
          set: (v) => {
            if (!fw.jogTo(3, fw.planner.pos[3] + v)) this.info('coldExtr', 'warning');
          },
          min: -50,
          max: 50,
          step: 1,
          fmt: (v) => `${v} mm`
        }
      }
    ]);
  }

  tempMenu() {
    const fw = this.fw;
    return new MenuScreen('temperature', 'preheat', [
      { back: true },
      { label: 'nozzle', icon: 'nozzle', spin: { get: () => Math.round(fw.nozzle.target), set: (v) => fw.nozzle.setTarget(v), min: 0, max: 290, step: 5, fmt: (v) => `${Math.round(fw.nozzle.displayTemp)}/${v}°C` } },
      { label: 'bed', icon: 'bed', spin: { get: () => Math.round(fw.bed.target), set: (v) => fw.bed.setTarget(v), min: 0, max: 120, step: 5, fmt: (v) => `${Math.round(fw.bed.displayTemp)}/${v}°C` } },
      { label: 'fanSpeed', icon: 'settings', spin: { get: () => Math.round(fw.fan * 100), set: (v) => (fw.fan = v / 100), min: 0, max: 100, step: 10, live: true, fmt: (v) => `${v}%` } },
      { label: 'cooldown', icon: 'preheat', action: () => { fw.nozzle.setTarget(0); fw.bed.setTarget(0); fw.fan = 0; } }
    ]);
  }

  sensorInfo() {
    const fw = this.fw;
    return new MenuScreen('sensorInfo', 'info', [
      { back: true },
      { label: 'nozzle', value: () => `${fw.nozzle.displayTemp.toFixed(1)}°C` },
      { label: 'bed', value: () => `${fw.bed.displayTemp.toFixed(1)}°C` },
      { label: 'heatbreak', value: () => `${(fw.nozzle.ambient + Math.max(0, fw.nozzle.temp - fw.nozzle.ambient) * 0.14 + 4).toFixed(1)}°C` },
      { label: 'board', value: () => `${(31 + fw.bed.duty * 6).toFixed(1)}°C` },
      { label: 'mcu', value: () => `${(38 + fw.nozzle.duty * 3).toFixed(1)}°C` },
      { label: 'loadcell', value: () => `${Math.round(this.dev.loadcellValue())}` },
      { label: 'fsensorState', value: () => (fw.filament.inSensor ? this.t('detected') : this.t('notDetected')) },
      { label: 'inputV', value: () => `${(24.1 - fw.bed.duty * 0.3 - fw.nozzle.duty * 0.05).toFixed(2)} V` }
    ]);
  }

  calibMenu() {
    const fw = this.fw;
    const run = (label, gen) => ({
      label,
      icon: 'settings',
      enabled: () => !fw.busy && !fw.printing,
      action: (ui) => {
        ui.push(new BusyScreen(label));
        fw.startTask(gen(), 'calib');
        this.waitIdle(() => {
          ui.pop();
          ui.info('testPassed');
        });
      }
    });
    const self = this;
    return new MenuScreen('calib', 'settings', [
      { back: true },
      run('fanTest', function* () {
        const f = fw.fan;
        fw.fan = 1;
        yield { time: 5 };
        fw.fan = f;
      }),
      run('xyTest', function* () {
        yield* fw.taskHome({});
        yield* fw.move(250, undefined, undefined, 120);
        yield* fw.move(0, undefined, undefined, 120);
        yield* fw.move(undefined, 210, undefined, 120);
        yield* fw.move(undefined, -4, undefined, 120);
        yield* fw.move(125, 105, undefined, 120);
        yield { empty: true };
      }),
      run('zAlign', function* () {
        yield* fw.move(undefined, undefined, 220, 10);
        yield* fw.move(undefined, undefined, 222, 3);
        yield { empty: true };
        yield { time: 1 };
        yield* fw.move(undefined, undefined, 180, 10);
        yield { empty: true };
      }),
      {
        label: 'loadcellTest',
        icon: 'settings',
        enabled: () => !fw.busy && !fw.printing,
        action: (ui) => {
          ui.push(new BusyScreen('tapNozzle'));
          self.dev.awaitNozzleTap = () => {
            ui.pop();
            ui.info('testPassed');
          };
        }
      },
      run('zTest', function* () {
        yield* fw.move(undefined, undefined, 150, 12);
        yield* fw.move(undefined, undefined, 10, 12);
        yield { empty: true };
      }),
      run('heaterTest', function* () {
        const n = fw.nozzle.target;
        const b = fw.bed.target;
        fw.nozzle.setTarget(Math.max(n, 160));
        fw.bed.setTarget(Math.max(b, 50));
        yield { time: 45 };
        fw.nozzle.setTarget(n);
        fw.bed.setTarget(b);
      }),
      run('gearsCal', function* () {
        for (let i = 0; i < 4; i++) {
          yield* fw.move(undefined, undefined, undefined, 20, i % 2 ? -2 : 2);
        }
        yield { empty: true };
      }),
      run('fsCal', function* () {
        yield { time: 3 };
      })
    ]);
  }

  buildTune() {
    const fw = this.fw;
    return new MenuScreen('tuneTitle', 'tune', [
      { back: true },
      { label: 'changeFil', icon: 'filament', enabled: () => fw.mode === 'printing', action: (ui) => { fw.startTask(fw.taskFilamentChange(), 'm600'); ui.pop(); } },
      { label: 'printSpeed', icon: 'speed', spin: { get: () => fw.feedPct, set: (v) => (fw.feedPct = v), min: 10, max: 255, step: 5, live: true, fmt: (v) => `${v}%` } },
      { label: 'nozzleTemp', icon: 'nozzle', spin: { get: () => Math.round(fw.nozzle.target), set: (v) => fw.nozzle.setTarget(v), min: 0, max: 290, step: 1, fmt: (v) => `${v}°C` } },
      { label: 'bedTemp', icon: 'bed', spin: { get: () => Math.round(fw.bed.target), set: (v) => fw.bed.setTarget(v), min: 0, max: 120, step: 1, fmt: (v) => `${v}°C` } },
      { label: 'fanSpeed', icon: 'settings', spin: { get: () => Math.round(fw.fan * 100), set: (v) => (fw.fan = v / 100), min: 0, max: 100, step: 5, live: true, fmt: (v) => `${v}%` } },
      { label: 'flow', icon: 'filament', spin: { get: () => fw.flowPct, set: (v) => (fw.flowPct = v), min: 50, max: 150, step: 1, live: true, fmt: (v) => `${v}%` } },
      { label: 'stealth', icon: 'speed', toggle: { get: () => fw.settings.stealth, set: (v) => { fw.settings.stealth = v; this.dev.applyStealth(); } } },
      { label: 'sound', icon: 'info', cycle: { options: ['loud', 'once', 'silent', 'assist'], get: () => fw.settings.sound, set: (v) => (fw.settings.sound = v), fmt: (v, ui) => ui.t(v) } },
      { label: 'sensorInfo', icon: 'info', submenu: () => this.sensorInfo() }
    ]);
  }

  waitIdle(cb) {
    const check = () => {
      if (!this.fw.busy) cb();
      else setTimeout(check, 200);
    };
    setTimeout(check, 400);
  }

  // ---------------------------------------------------------------- render
  syncWithFirmware() {
    const fw = this.fw;
    if (fw.mode !== this.lastMode) {
      const m = fw.mode;
      if (m === 'idle' && (this.lastMode === 'boot' || this.lastMode === 'off')) this.goHome();
      if ((m === 'printing' || m === 'finished' || m === 'stopped') && !(this.top instanceof PrintScreen) && !this.stack.some((s) => s instanceof PrintScreen)) {
        this.stack = [new HomeScreen(), new PrintScreen()];
      }
      if ((m === 'finished' || m === 'stopped') && this.stack.some((s) => s instanceof PrintScreen)) {
        while (!(this.top instanceof PrintScreen)) this.stack.pop();
        this.top.sel = 0;
      }
      this.lastMode = m;
      this.dirty = true;
    }
    // menu timeout back to print screen
    if (fw.printing && !(this.top instanceof PrintScreen) && performance.now() - this.lastInput > 30000) {
      while (this.stack.length > 2) this.stack.pop();
      this.dirty = true;
    }
  }

  render(dt) {
    this.syncWithFirmware();
    this.redrawTimer -= dt;
    if (!this.dirty && this.redrawTimer > 0) return false;
    this.redrawTimer = 0.25;
    this.dirty = false;
    const ctx = this.ctx;
    ctx.setTransform(2, 0, 0, 2, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    const L = this.activeLayer();
    if (L.kind === 'off') return true;
    if (L.kind === 'boot') {
      this.drawBoot(ctx);
      return true;
    }
    let title = '';
    let ic = 'house';
    if (L.kind === 'screen') {
      title = this.t(L.s.title);
      ic = L.s.icon;
    } else if (L.kind === 'dialog') {
      title = this.t(L.prompt.title || 'info');
      ic = 'info';
    } else if (L.kind === 'wizard') {
      title = this.t(L.wz.kind === 'unload' ? 'unloadFil' : L.wz.kind === 'heat' ? 'preheating' : 'loadFil');
      ic = 'filament';
    }
    this.drawHeader(ctx, title, ic);
    if (L.kind === 'screen') L.s.draw(this, ctx);
    else if (L.kind === 'dialog') this.dialog.draw(this, ctx, L.prompt);
    else if (L.kind === 'wizard') this.wizardScreen.draw(this, ctx, L.wz);
    this.drawFooter(ctx);
    return true;
  }

  drawBoot(ctx) {
    const p = Math.min(1, 1 - Math.max(0, this.fw.bootTime) / 3.2);
    ctx.fillStyle = ORANGE;
    ctx.font = `800 40px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Original Prusa', W / 2, H / 2 - 30);
    ctx.fillStyle = '#fff';
    ctx.font = `600 22px ${FONT}`;
    ctx.fillText('MK4S', W / 2, H / 2 + 10);
    ctx.fillStyle = '#2b2e33';
    roundRect(ctx, 100, H / 2 + 50, W - 200, 6, 3);
    ctx.fill();
    ctx.fillStyle = ORANGE;
    roundRect(ctx, 100, H / 2 + 50, Math.max(6, (W - 200) * p), 6, 3);
    ctx.fill();
    ctx.fillStyle = GREY;
    ctx.font = `400 12px ${FONT}`;
    ctx.fillText(`Firmware ${FW_VERSION}`, W / 2, H - 24);
  }

  drawHeader(ctx, title, ic) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, HEAD);
    icon(ctx, ic, 10, 6, 22, '#fff', 2);
    ctx.fillStyle = '#fff';
    ctx.font = `600 15px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(title.toUpperCase(), 40, HEAD / 2 + 1);
    ctx.textAlign = 'right';
    ctx.fillText(this.clock(), W - 10, HEAD / 2 + 1);
    if (this.dev.usb.inserted) icon(ctx, 'usb', W - 84, 7, 20, '#fff', 2);
    ctx.fillStyle = '#2a2d31';
    ctx.fillRect(0, HEAD - 1, W, 1);
  }

  drawFooter(ctx) {
    const fw = this.fw;
    const y = H - FOOT;
    ctx.fillStyle = '#0b0c0d';
    ctx.fillRect(0, y, W, FOOT);
    ctx.fillStyle = '#2a2d31';
    ctx.fillRect(0, y, W, 1);
    const tempItem = (h) => {
      const heating = h.target > 0 && h.temp < h.target - 2;
      const cooling = h.target === 0 && h.temp > 40 ? false : h.target > 0 && h.temp > h.target + 3;
      const col = heating ? ORANGE : cooling ? '#5aa9ff' : '#fff';
      return { text: `${Math.round(h.displayTemp)}/${Math.round(h.target)}°C`, col };
    };
    const items = [
      { ic: 'nozzle', ...tempItem(fw.nozzle) },
      { ic: 'bed', ...tempItem(fw.bed) },
      { ic: 'filament', text: fw.filament.loaded ? fw.filament.type : '---', col: '#fff' }
    ];
    if (fw.printing) items.push({ ic: 'speed', text: `${fw.feedPct}%`, col: '#fff' });
    else items.push({ ic: 'z', text: `${fw.logical(2).toFixed(2)}`, col: '#fff' });
    const cw = W / items.length;
    items.forEach((it, i) => {
      const x = i * cw + 10;
      icon(ctx, it.ic, x, y + 12, 22, '#fff', 2);
      ctx.fillStyle = it.col;
      ctx.font = `600 15px ${FONT}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(it.text, x + 28, y + FOOT / 2 + 1);
    });
  }
}

// Site-level HUD (outside of the devices): device tabs, camera views,
// accessory side panel, toasts, help, simulation speed, quality, sound.

export class Hud {
  constructor(app) {
    this.app = app;
    this.el = {
      top: document.getElementById('topbar'),
      tabs: document.getElementById('device-tabs'),
      panel: document.getElementById('side-panel'),
      panelTitle: document.getElementById('panel-title'),
      panelSub: document.getElementById('panel-sub'),
      panelBody: document.getElementById('panel-body'),
      collapse: document.getElementById('panel-collapse'),
      cam: document.getElementById('cam-bar'),
      toasts: document.getElementById('toast-stack'),
      help: document.getElementById('help'),
      speed: document.getElementById('sim-speed'),
      quality: document.getElementById('quality'),
      sound: document.getElementById('sound-toggle'),
      helpBtn: document.getElementById('help-btn')
    };
    this.tabEls = new Map();
    this.statusTimer = 0;
    this.buildTabs();
    this.bindTools();
  }

  show() {
    this.el.top.classList.remove('hidden');
    this.el.panel.classList.remove('hidden');
    this.el.cam.classList.remove('hidden');
    if (window.innerWidth < 760) this.el.panel.classList.add('collapsed');
  }

  buildTabs() {
    for (const d of this.app.devices) {
      const b = document.createElement('button');
      b.className = 'device-tab';
      b.innerHTML = `<span class="dt-name">${d.name}</span><span class="dt-kind">${d.kind}</span><span class="dt-status"><span class="dot"></span><span class="dt-text">Aus</span></span>`;
      b.addEventListener('click', () => this.app.selectDevice(d));
      this.el.tabs.appendChild(b);
      this.tabEls.set(d, b);
    }
  }

  bindTools() {
    const { speed, quality, sound, helpBtn, help, collapse } = this.el;
    speed.addEventListener('change', () => {
      this.app.simSpeed = parseFloat(speed.value);
      this.toast(this.app.simSpeed === 1 ? 'Zeit läuft wieder in Echtzeit.' : `Zeitraffer: ${this.app.simSpeed}× schneller als in echt.`, 'info', 2500);
    });
    quality.addEventListener('change', () => this.app.engine.setQuality(quality.value));
    let muted = false;
    try {
      muted = localStorage.getItem('mw3d-muted') === '1';
    } catch {
      /* ignore */
    }
    const applyMute = () => {
      sound.classList.toggle('muted', muted);
      this.app.audio.setMuted(muted);
    };
    applyMute();
    sound.addEventListener('click', () => {
      this.app.audio.unlock();
      muted = !muted;
      applyMute();
      try {
        localStorage.setItem('mw3d-muted', muted ? '1' : '0');
      } catch {
        /* ignore */
      }
    });
    helpBtn.addEventListener('click', () => this.openHelp());
    help.addEventListener('click', (e) => {
      if (e.target === help || e.target.closest('[data-close]')) this.closeHelp();
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !help.classList.contains('hidden')) this.closeHelp();
    });
    collapse.addEventListener('click', () => {
      this.autoCollapsed = false;
      this.el.panel.classList.toggle('collapsed');
    });
  }

  setPanelCollapsed(c) {
    if (c) {
      if (!this.el.panel.classList.contains('collapsed')) {
        this.autoCollapsed = true;
        this.el.panel.classList.add('collapsed');
      }
    } else if (this.autoCollapsed) {
      this.autoCollapsed = false;
      this.el.panel.classList.remove('collapsed');
    }
  }

  openHelp() {
    this.el.help.classList.remove('hidden');
    this.el.help.querySelector('.modal-close').focus();
  }

  closeHelp() {
    this.el.help.classList.add('hidden');
    this.app.engine.canvas.focus();
  }

  onDeviceChanged(d) {
    for (const [dev, el] of this.tabEls) el.classList.toggle('active', dev === d);
    this.el.panelTitle.textContent = d.name;
    this.el.panelSub.textContent = d.kind;
    this.el.panelBody.innerHTML = '';
    d.buildPanel(this.el.panelBody);
    this.buildCamBar(d);
  }

  buildCamBar(d) {
    const cam = this.el.cam;
    cam.innerHTML = '';
    this.camButtons = [];
    for (const v of d.cameraViews) {
      const b = document.createElement('button');
      b.className = 'cam-btn';
      b.textContent = v.label;
      b.addEventListener('click', () => this.app.flyToView(d, v));
      cam.appendChild(b);
      this.camButtons.push({ b, v });
    }
    const all = document.createElement('button');
    all.className = 'cam-btn';
    all.textContent = 'Werkstatt';
    all.addEventListener('click', () => this.app.overview());
    cam.appendChild(all);
    this.camButtons.push({ b: all, v: null });
  }

  onViewChanged(view) {
    if (!this.camButtons) return;
    for (const { b, v } of this.camButtons) b.classList.toggle('active', v === view);
  }

  update(dt) {
    this.statusTimer -= dt;
    if (this.statusTimer > 0) return;
    this.statusTimer = 0.4;
    for (const [d, el] of this.tabEls) {
      const s = d.status();
      const dot = el.querySelector('.dot');
      dot.className = `dot ${s.state === 'off' ? '' : s.state === 'busy' ? 'busy' : s.state === 'warn' ? 'warn' : s.state === 'err' ? 'err' : 'on'}`;
      const t = el.querySelector('.dt-text');
      if (t.textContent !== s.text) t.textContent = s.text;
    }
    this.app.active?.refreshPanel?.();
  }

  toast(msg, type = 'info', ms = 4200) {
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.innerHTML = msg;
    this.el.toasts.appendChild(t);
    while (this.el.toasts.children.length > 4) this.el.toasts.firstChild.remove();
    setTimeout(() => {
      t.classList.add('out');
      setTimeout(() => t.remove(), 350);
    }, ms);
  }
}

// Unified keyboard / mouse / touch / gamepad input.

const MOVE_KEYS = {
  ArrowUp: [0, 1], KeyW: [0, 1],
  ArrowDown: [0, -1], KeyS: [0, -1],
  ArrowLeft: [-1, 0], KeyA: [-1, 0],
  ArrowRight: [1, 0], KeyD: [1, 0],
};
const FIRE_KEYS = ['Space', 'KeyJ', 'KeyZ'];
const MISSILE_KEYS = ['KeyE', 'KeyK', 'KeyX'];
const BOMB_KEYS = ['KeyQ', 'KeyL', 'KeyC', 'KeyB'];
const PAUSE_KEYS = ['Escape', 'KeyP'];

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set();
    this.mode = matchMedia('(pointer: coarse)').matches ? 'touch' : 'keyboard';
    this.mouse = { x: 0, y: 0, down: false };
    this.drag = { id: null, lastX: 0, lastY: 0, dx: 0, dy: 0 };
    this.touchFire = false;
    this.autofire = false;
    this.gamepad = { x: 0, y: 0, fire: false, prev: [] };
    this.onModeChange = null;
    this._bind();
  }

  _setMode(mode) {
    if (this.mode === mode) return;
    this.mode = mode;
    if (this.onModeChange) this.onModeChange(mode);
  }

  _bind() {
    addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      if (MOVE_KEYS[e.code] || FIRE_KEYS.includes(e.code)) e.preventDefault();
      if (!e.repeat) this.pressed.add(e.code);
      this.keys.add(e.code);
      if (MOVE_KEYS[e.code]) this._setMode('keyboard');
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => {
      this.keys.clear();
      this.mouse.down = false;
      this.touchFire = false;
      this.drag.id = null;
    });

    const c = this.canvas;
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      const r = c.getBoundingClientRect();
      this.mouse.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      this.mouse.y = -(((e.clientY - r.top) / r.height) * 2 - 1);
      if (Math.abs(e.movementX) + Math.abs(e.movementY) > 2) this._setMode('mouse');
    });
    c.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse') return;
      if (e.button === 0) this.mouse.down = true;
      if (e.button === 2) this.pressed.add('Mouse2');
      if (e.button === 1) {
        e.preventDefault();
        this.pressed.add('Mouse1');
      }
    });
    addEventListener('pointerup', (e) => {
      if (e.pointerType === 'mouse' && e.button === 0) this.mouse.down = false;
    });
    c.addEventListener('wheel', (e) => {
      if (this.mode === 'mouse') this.pressed.add('Mouse1');
      e.preventDefault();
    }, { passive: false });

    addEventListener('gamepadconnected', () => this._setMode('gamepad'));
  }

  // Touch controls live in DOM elements provided by the UI layer.
  bindTouch({ steer, fire, missile, bomb }) {
    steer.addEventListener('pointerdown', (e) => {
      if (this.drag.id !== null) return;
      this._setMode('touch');
      this.drag.id = e.pointerId;
      this.drag.lastX = e.clientX;
      this.drag.lastY = e.clientY;
      steer.setPointerCapture(e.pointerId);
    });
    steer.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.drag.id) return;
      this.drag.dx += e.clientX - this.drag.lastX;
      this.drag.dy += e.clientY - this.drag.lastY;
      this.drag.lastX = e.clientX;
      this.drag.lastY = e.clientY;
    });
    const endDrag = (e) => {
      if (e.pointerId === this.drag.id) this.drag.id = null;
    };
    steer.addEventListener('pointerup', endDrag);
    steer.addEventListener('pointercancel', endDrag);

    const hold = (el, on) => {
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this._setMode('touch');
        el.setPointerCapture(e.pointerId);
        el.classList.add('active');
        on(true);
      });
      const off = () => {
        el.classList.remove('active');
        on(false);
      };
      el.addEventListener('pointerup', off);
      el.addEventListener('pointercancel', off);
    };
    hold(fire, (v) => (this.touchFire = v));
    hold(missile, (v) => v && this.pressed.add('TouchMissile'));
    hold(bomb, (v) => v && this.pressed.add('TouchBomb'));
  }

  pollGamepad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = pads && Array.from(pads).find((p) => p && p.connected);
    const gp = this.gamepad;
    if (!pad) {
      gp.x = gp.y = 0;
      gp.fire = false;
      return;
    }
    const dead = (v) => (Math.abs(v) < 0.18 ? 0 : v);
    let x = dead(pad.axes[0] || 0);
    let y = -dead(pad.axes[1] || 0);
    const b = (i) => !!(pad.buttons[i] && pad.buttons[i].pressed);
    if (b(12)) y = 1;
    if (b(13)) y = -1;
    if (b(14)) x = -1;
    if (b(15)) x = 1;
    gp.x = x;
    gp.y = y;
    gp.fire = b(0) || b(7);
    const edge = (i, code) => {
      if (b(i) && !gp.prev[i]) this.pressed.add(code);
    };
    edge(1, 'PadMissile');
    edge(5, 'PadMissile');
    edge(2, 'PadBomb');
    edge(4, 'PadBomb');
    edge(3, 'PadBomb');
    edge(9, 'Escape');
    const any = x !== 0 || y !== 0 || pad.buttons.some((btn) => btn.pressed);
    if (any) this._setMode('gamepad');
    gp.prev = pad.buttons.map((btn) => btn.pressed);
  }

  moveAxis() {
    let x = 0;
    let y = 0;
    for (const code of this.keys) {
      const m = MOVE_KEYS[code];
      if (m) {
        x += m[0];
        y += m[1];
      }
    }
    x += this.gamepad.x;
    y += this.gamepad.y;
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    return { x, y };
  }

  takeDrag() {
    const d = { x: this.drag.dx, y: this.drag.dy, active: this.drag.id !== null };
    this.drag.dx = 0;
    this.drag.dy = 0;
    return d;
  }

  fireHeld() {
    return (
      this.autofire ||
      FIRE_KEYS.some((k) => this.keys.has(k)) ||
      this.mouse.down ||
      this.touchFire ||
      this.gamepad.fire
    );
  }

  missilePressed() {
    return MISSILE_KEYS.some((k) => this.pressed.has(k)) || this.pressed.has('Mouse2') ||
      this.pressed.has('TouchMissile') || this.pressed.has('PadMissile');
  }

  bombPressed() {
    return BOMB_KEYS.some((k) => this.pressed.has(k)) || this.pressed.has('Mouse1') ||
      this.pressed.has('TouchBomb') || this.pressed.has('PadBomb');
  }

  pausePressed() {
    return PAUSE_KEYS.some((k) => this.pressed.has(k));
  }

  endFrame() {
    this.pressed.clear();
  }
}

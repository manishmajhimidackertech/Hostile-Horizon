// The player's jet: movement from any input device, cannons, missiles and bombs.
import { createPlaneModel } from './models.js';
import { getPlane } from './planes.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class Player {
  constructor(game) {
    this.game = game;
    this.obj = null;
    this.planeId = null;
    this.setPlane('hawk');
    this.reset(null);
  }

  setPlane(id) {
    if (id === this.planeId && this.obj) return;
    const plane = getPlane(id);
    const prev = this.obj;
    this.planeId = plane.id;
    this.plane = plane;
    this.obj = createPlaneModel(plane.id, plane.flame);
    if (prev) {
      this.obj.position.copy(prev.position);
      this.obj.rotation.copy(prev.rotation);
      this.obj.visible = prev.visible;
      this.game.scene.remove(prev);
    }
    this.game.scene.add(this.obj);
  }

  reset(stats) {
    this.stats = stats;
    this.x = 0;
    this.y = 0;
    this.vxRel = 0;
    this.vyRel = 0;
    this.hp = stats ? stats.maxHp : 100;
    this.maxHp = this.hp;
    this.invuln = 0;
    this.sinceHit = 99;
    this.fireT = 0;
    this.bombT = 0;
    this.missiles = stats ? stats.missiles : 0;
    this.bombs = stats ? stats.bombs : 0;
    this.alive = true;
    this.obj.visible = true;
    this.obj.rotation.set(0, 0, 0);
  }

  hitTest(x, y, r) {
    // Two small circles along the fuselage: forgiving but fair.
    const r0 = 0.75 + r;
    let dx = x - (this.x + 1);
    let dy = y - this.y;
    if (dx * dx + dy * dy < r0 * r0) return true;
    dx = x - (this.x - 1);
    return dx * dx + dy * dy < r0 * r0;
  }

  hurt(amount) {
    const g = this.game;
    if (!this.alive || this.invuln > 0 || g.state !== 'playing') return;
    if (g.god) {
      // God mode: shrug it off.
      this.invuln = 0.15;
      g.fx.sparks(this.x, this.y, 6, g.scroll);
      return;
    }
    this.hp -= amount;
    this.invuln = 0.7;
    this.sinceHit = 0;
    g.shake(0.6);
    g.audio.play('hurt');
    g.ui.damageFlash();
    g.stats.damageTaken += amount;
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
      this.obj.visible = false;
      g.fx.explosion(this.x, this.y, 2.2, g.scroll);
      g.audio.play('bigExplode');
      g.shake(1.4);
      g.onPlayerDown();
    }
  }

  heal(amount) {
    this.hp = Math.min(this.maxHp, this.hp + amount);
  }

  // Demo flight used behind the menus.
  updateAttract(dt, t) {
    const g = this.game;
    this.x = g.camX - g.halfW * 0.25 + Math.sin(t * 0.4) * 6;
    const ny = 3 + Math.sin(t * 0.7) * 5;
    this.vyRel = (ny - this.y) / Math.max(dt, 1e-3);
    this.y = ny;
    this._pose(dt);
    if (Math.random() < 0.8) g.fx.exhaust(this.x - 2.6, this.y, 0, 0, 1, this.plane.flame);
  }

  update(dt) {
    const g = this.game;
    const input = g.input;
    const s = this.stats;
    if (!this.alive) return;

    const drag = input.takeDrag();
    let wantVx = 0;
    let wantVy = 0;
    const axis = input.moveAxis();
    if (drag.x !== 0 || drag.y !== 0) {
      // Touch: relative drag moves the jet 1:1 (slightly amplified).
      const k = g.worldPerPixel * 1.5;
      const dx = drag.x * k;
      const dy = -drag.y * k;
      const maxStep = s.speed * 1.8 * dt;
      this.x += clamp(dx, -maxStep, maxStep);
      this.y += clamp(dy, -maxStep, maxStep);
      this.vxRel = dx / Math.max(dt, 1e-3) * 0.3;
      this.vyRel = dy / Math.max(dt, 1e-3) * 0.3;
    } else if (axis.x !== 0 || axis.y !== 0) {
      wantVx = axis.x * s.speed;
      wantVy = axis.y * s.speed;
    } else if (input.mode === 'mouse') {
      const tx = g.camX + input.mouse.x * g.halfW;
      const ty = input.mouse.y * g.halfH;
      wantVx = clamp((tx - this.x) * 5, -s.speed, s.speed);
      wantVy = clamp((ty - this.y) * 5, -s.speed, s.speed);
      const len = Math.hypot(wantVx, wantVy);
      if (len > s.speed) {
        wantVx *= s.speed / len;
        wantVy *= s.speed / len;
      }
    }
    if (!(drag.x !== 0 || drag.y !== 0)) {
      const k = Math.min(1, dt * 9);
      this.vxRel += (wantVx - this.vxRel) * k;
      this.vyRel += (wantVy - this.vyRel) * k;
      this.x += this.vxRel * dt;
      this.y += this.vyRel * dt;
    }
    this.x += g.scroll * dt;

    // Stay on screen.
    const rel = clamp(this.x - g.camX, -g.halfW + 3.5, g.halfW - 4);
    this.x = g.camX + rel;
    if (this.y > g.halfH - 4) {
      this.y = g.halfH - 4;
      this.vyRel = Math.min(0, this.vyRel);
    }
    const gy = g.world.groundY(this.x);
    if (this.y < gy + 1.4) {
      this.y = gy + 1.4;
      this.vyRel = Math.max(this.vyRel, 10);
      if (this.invuln <= 0) {
        g.fx.groundBlast(this.x, gy, 0.6, g.scroll);
        this.hurt(12);
      }
    }

    this.invuln = Math.max(0, this.invuln - dt);
    // Self-repair kicks in after a few seconds without taking damage.
    this.sinceHit += dt;
    if (s.regen > 0 && this.sinceHit > 2.5 && this.hp < this.maxHp) this.hp = Math.min(this.maxHp, this.hp + s.regen * dt);
    this.obj.visible = this.invuln <= 0 || Math.floor(this.invuln * 20) % 2 === 0;
    this._pose(dt);

    // Weapons
    const pitch = this.obj.rotation.z;
    this.fireT -= dt;
    if (input.fireHeld() && this.fireT <= 0) {
      this.fireT = s.fireInterval;
      const nx = this.x + 3.2 * Math.cos(pitch);
      const ny = this.y + 3.2 * Math.sin(pitch);
      const streams = s.gunStreams;
      for (let i = 0; i < streams; i++) {
        const off = streams === 1 ? 0 : (i / (streams - 1) - 0.5);
        const spread = streams === 2 ? off * 0.04 : off * 0.07 * (streams - 1);
        g.weapons.playerBullet(nx, ny + off * 0.9, pitch + spread, 72, s.gunDamage);
      }
      g.stats.shots++;
      g.fx.muzzle(nx + 0.4, ny, g.scroll);
      g.audio.play('shoot');
    }
    if (input.missilePressed()) {
      if (this.missiles > 0) {
        if (!g.god) this.missiles--;
        for (let i = 0; i < s.salvo; i++) {
          const off = (i - (s.salvo - 1) / 2) * 1.1;
          g.weapons.missile(this.x - Math.abs(off) * 0.5, this.y - 0.4 + off, this.vxRel, this.vyRel + off * 4, s.missileDamage);
        }
      } else g.audio.play('deny');
    }
    this.bombT -= dt;
    if (input.bombPressed()) {
      if (this.bombs > 0 && this.bombT <= 0) {
        if (!g.god) this.bombs--;
        this.bombT = 0.25;
        g.weapons.bomb(this.x - 0.3, this.y - 0.8, g.scroll + this.vxRel * 0.5, Math.min(0, this.vyRel * 0.3) - 2, s.bombRadius, s.bombDamage);
      } else if (this.bombs <= 0) g.audio.play('deny');
    }

    // Exhaust and damage smoke.
    const bx = this.x - 2.4 * Math.cos(pitch);
    const by = this.y - 2.4 * Math.sin(pitch);
    g.fx.exhaust(bx, by, 0, 0, 1, this.plane.flame);
    if (this.hp < this.maxHp * 0.35 && Math.random() < 0.5) g.fx.damageSmoke(bx, by, 0, this.hp < this.maxHp * 0.18);
  }

  _pose(dt) {
    const target = clamp(this.vyRel * 0.022, -0.45, 0.45);
    this.obj.rotation.z += (target - this.obj.rotation.z) * Math.min(1, dt * 10);
    const roll = clamp(-this.vyRel * 0.035, -0.8, 0.8);
    this.obj.rotation.x += (roll - this.obj.rotation.x) * Math.min(1, dt * 6);
    this.obj.position.set(this.x, this.y, 0);
    const boost = 0.9 + Math.max(0, this.vxRel) * 0.03;
    for (const f of this.obj.userData.flames) {
      const b = f.userData.baseScale;
      f.scale.set(b * (boost + Math.random() * 0.3), b, b);
    }
  }
}

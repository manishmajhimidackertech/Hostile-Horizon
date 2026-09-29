// Map-specific environmental hazards that can hit the player *and* enemies:
//   lightning   (Storm Front)  - telegraphed strike from sky to ground
//   lava        (Volcano Ridge) - ground vents erupt lava balls upward
//   vigilantes  (Metropolis)   - street launchers fire homing torpedoes at anything that flies
//   watchtowers (Night Siege)  - searchlight towers that fire missiles at a lit player
// Every hazard is telegraphed so it can be dodged. Positions are kept relative to the
// camera while a hazard winds up, so warnings stay where the player sees them.
import * as THREE from 'three';
import { createMissile } from './models.js';

const rand = (a, b) => a + Math.random() * (b - a);

function line(points, color, opacity) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(points * 3), 3));
  const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity, fog: false, depthWrite: false }));
  l.frustumCulled = false;
  l.visible = false;
  l.renderOrder = 5;
  return l;
}

export class Hazards {
  constructor(game) {
    this.g = game;
    this.warn = line(2, 0xbfe0ff, 0.5);
    this.bolt = line(18, 0xffffff, 1);
    game.scene.add(this.warn, this.bolt);
    this.torpedoes = [];
    this.reset(null);
  }

  reset(map) {
    this.map = map;
    this.type = map ? map.hazard : null;
    this.t = rand(5, 8);
    this.pending = null;
    this.boltT = 0;
    this.warn.visible = false;
    this.bolt.visible = false;
    for (const t of this.torpedoes) this.g.scene.remove(t.obj);
    this.torpedoes.length = 0;
  }

  get rate() {
    const n = this.g.mission ? this.g.mission.number : 1;
    return Math.min(1.6, 1 + n * 0.03);
  }

  update(dt) {
    const g = this.g;
    this._updateTorpedoes(dt);
    if (this.boltT > 0) {
      this.boltT -= dt;
      this.bolt.visible = this.boltT > 0.12 || (this.boltT > 0 && this.boltT < 0.06);
    }
    if (!this.type) return;
    if (this.pending) {
      this._windUp(dt);
      return;
    }
    if (g.state !== 'playing') return;
    this.t -= dt;
    if (this.t > 0) return;
    switch (this.type) {
      case 'lightning':
        this.pending = this._anchor(this._pickTargetRel(0.55), 1.0);
        g.audio.play('crackle');
        g.hint('lightning');
        break;
      case 'lava':
        this.pending = this._anchor(this._pickTargetRel(0.4), 1.1);
        g.audio.play('rumble');
        g.hint('eruption');
        break;
      case 'vigilantes': {
        this.pending = { ...this._anchor(g.halfW * rand(-0.75, 0.85), 0.9), target: this._pickVictim() };
        g.audio.play('beep');
        g.hint('vigilante');
        break;
      }
      case 'watchtowers':
        g.addEnemy('watchtower', g.camX + g.halfW + 6, 0);
        this.t = rand(6, 10) / this.rate;
        return;
      default:
        return;
    }
  }

  // Ground-anchored hazards are fixed in the world. Aircraft keep pace with the camera,
  // so place the spot where the target will be when the timer runs out.
  _anchor(rel, timer) {
    const g = this.g;
    return { x: g.camX + rel + g.scroll * timer, timer };
  }

  // Aim near the player some of the time, otherwise near an enemy or a random spot.
  _pickTargetRel(playerChance) {
    const g = this.g;
    if (g.player.alive && Math.random() < playerChance) return g.player.x - g.camX + rand(-2.5, 2.5);
    const air = g.enemies.filter((e) => e.air && !e.dead && e.dying <= 0 && e.onScreen(2) && e.kind !== 'meteor');
    if (air.length && Math.random() < 0.7) {
      const e = air[Math.floor(Math.random() * air.length)];
      return e.x - g.camX + rand(-1.5, 1.5);
    }
    return g.halfW * rand(-0.8, 0.8);
  }

  _pickVictim() {
    const g = this.g;
    const air = g.enemies.filter((e) => e.air && !e.dead && e.dying <= 0 && e.onScreen(2) && e.kind !== 'meteor' && e.kind !== 'rocket');
    if (!g.player.alive || (air.length && Math.random() < 0.5)) return air[Math.floor(Math.random() * air.length)] || g.player;
    return g.player;
  }

  _windUp(dt) {
    const g = this.g;
    const p = this.pending;
    p.timer -= dt;
    const x = p.x;
    const gy = g.world.groundY(x);
    if (this.type === 'lightning') {
      const a = this.warn.geometry.attributes.position.array;
      a[0] = x; a[1] = gy; a[2] = 0.5;
      a[3] = x; a[4] = g.halfH + 6; a[5] = 0.5;
      this.warn.geometry.attributes.position.needsUpdate = true;
      this.warn.visible = Math.random() < 0.75;
      this.warn.material.opacity = 0.2 + Math.random() * 0.45;
      // A crackling column of blue sparks marks where the bolt will land.
      for (let i = 0; i < 3; i++) g.fx.exhaust(x + rand(-0.6, 0.6), rand(gy, g.halfH), 0, rand(-2, 2), 1.4, 'blue');
      if (Math.random() < 0.4) g.fx.sparks(x, gy + rand(0, 1.5), 2, 0);
      if (p.timer <= 0) this._strike(x, gy);
    } else if (this.type === 'lava') {
      if (Math.random() < 0.8) g.fx.fireTrail(x + rand(-1, 1), gy + 0.3, 0, rand(2, 6), 0.8);
      g.shake(dt * 0.6);
      if (p.timer <= 0) this._erupt(x, gy);
    } else if (this.type === 'vigilantes') {
      if (Math.floor(p.timer * 8) % 2 === 0) g.fx.beacon(x, gy + 0.6);
      if (p.timer <= 0 && Math.abs(x - g.camX) < g.halfW + 2) this._launchTorpedo(x, gy + 0.8, p.target);
    }
    if (p.timer <= 0) {
      this.pending = null;
      this.warn.visible = false;
      this.t = rand(4, 8) / this.rate;
    }
  }

  _strike(x, gy) {
    const g = this.g;
    const top = g.halfH + 6;
    const a = this.bolt.geometry.attributes.position.array;
    const n = a.length / 3;
    let bx = x + rand(-3, 3);
    for (let i = 0; i < n; i++) {
      const k = i / (n - 1);
      const wobble = i === n - 1 ? 0 : rand(-1.6, 1.6);
      bx = bx + (x - bx) * 0.35 + wobble;
      a[i * 3] = i === n - 1 ? x : bx;
      a[i * 3 + 1] = top + (gy - top) * k;
      a[i * 3 + 2] = 0.6;
      if (i % 3 === 0) g.fx.sparks(a[i * 3], a[i * 3 + 1], 2, 0);
    }
    this.bolt.geometry.attributes.position.needsUpdate = true;
    this.bolt.visible = true;
    this.boltT = 0.22;
    g.world.flashT = 0.35;
    g.ui.lightningFlash();
    g.audio.play('strike');
    g.fx.groundBlast(x, gy, 1, 0);
    g.shake(0.8);
    this._damageColumn(x, 2.4, 22, 12);
  }

  // Damage everything whose hitbox overlaps a vertical column at x.
  _damageColumn(x, halfWidth, playerDmg, enemyDmg) {
    const g = this.g;
    const p = g.player;
    if (p.alive && Math.abs(p.x - x) < halfWidth) {
      g.fx.sparks(p.x, p.y, 8, g.scroll);
      p.hurt(playerDmg);
    }
    for (const e of g.enemies.slice()) {
      if (e.dead || e.dying > 0 || !e.air) continue;
      if (e.circles.some((c) => Math.abs(e.x + c[0] - x) < c[2] + halfWidth * 0.5)) {
        g.fx.sparks(e.x, e.y, 8, g.scroll);
        e.damage(e.boss ? enemyDmg * 1.5 : enemyDmg);
      }
    }
  }

  _erupt(x, gy) {
    const g = this.g;
    g.fx.explosion(x, gy + 1, 1.4, 0);
    g.audio.play('explode', 1.5);
    g.shake(0.5);
    const n = Math.floor(rand(3, 6));
    for (let i = 0; i < n; i++) {
      g.addEnemy('meteor', x + rand(-1, 1), gy + 1.5, { vx: rand(-7, 7), vy: rand(20, 30) });
    }
  }

  _launchTorpedo(x, y, target) {
    const g = this.g;
    const obj = createMissile(true);
    obj.scale.setScalar(1.3);
    obj.position.set(x, y, 0.4);
    g.scene.add(obj);
    const tx = target && !target.dead ? target.x : g.player.x;
    const ty = target && !target.dead ? target.y : g.player.y;
    this.torpedoes.push({ obj, x, y, target, heading: Math.atan2(ty - y, tx - x), speed: 8, life: 4.5, age: 0 });
    g.fx.explosion(x, y, 0.5, 0);
    g.audio.play('missile');
  }

  _updateTorpedoes(dt) {
    const g = this.g;
    for (let i = this.torpedoes.length - 1; i >= 0; i--) {
      const t = this.torpedoes[i];
      t.age += dt;
      t.life -= dt;
      const tgt = t.target && !t.target.dead && (t.target !== g.player || g.player.alive) ? t.target : null;
      if (tgt && t.age < 1.6) {
        const want = Math.atan2(tgt.y - t.y, tgt.x - t.x);
        let d = want - t.heading;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        t.heading += Math.max(-dt * 1.5, Math.min(dt * 1.5, d));
      }
      t.speed = Math.min(34, t.speed + dt * 40);
      t.x += (g.scroll + Math.cos(t.heading) * t.speed) * dt;
      t.y += Math.sin(t.heading) * t.speed * dt;
      t.obj.position.set(t.x, t.y, 0.4);
      t.obj.rotation.z = t.heading;
      g.fx.trail(t.x - Math.cos(t.heading), t.y - Math.sin(t.heading), g.scroll * 0.9, 0, 1.1, true);
      let hit = false;
      const p = g.player;
      if (p.alive && p.hitTest(t.x, t.y, 0.5)) {
        p.hurt(16);
        hit = true;
      } else {
        for (const e of g.enemies) {
          if (e.dead || e.dying > 0 || !e.air || e.kind === 'rocket') continue;
          if (e.hitTest(t.x, t.y, 0.5)) {
            e.damage(e.boss ? 14 : 10);
            hit = true;
            break;
          }
        }
      }
      const off = t.life <= 0 || Math.abs(t.x - g.camX) > g.halfW + 10 || t.y > g.halfH + 10;
      if (hit || off) {
        if (hit || t.life <= 0) {
          g.fx.explosion(t.x, t.y, 1, g.scroll);
          g.audio.play('explode', 1);
        }
        g.scene.remove(t.obj);
        this.torpedoes.splice(i, 1);
      }
    }
  }
}

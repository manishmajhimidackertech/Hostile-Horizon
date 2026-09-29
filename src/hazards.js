// Map-specific environmental hazards that can hit the player *and* enemies:
//   lightning   (Storm Front)  - natural strikes at random spots; only what is in the bolt is hit
//   lava        (Volcano Ridge) - falling lava bombs (spawned by the director)
//   vigilantes  (Metropolis)   - rooftop launchers fire unguided torpedoes at a random target
//   watchtowers (Night Siege)  - sweeping searchlights; stay lit and a missile launches
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
    this.bolt = line(18, 0xffffff, 1);
    this.branch = line(8, 0xdfe8ff, 0.8);
    game.scene.add(this.bolt, this.branch);
    this.torpedoes = [];
    this.reset(null);
  }

  reset(map) {
    this.map = map;
    this.type = map ? map.hazard : null;
    this.t = rand(4, 7);
    this.pending = null;
    this.boltT = 0;
    this.bolt.visible = false;
    this.branch.visible = false;
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
      const on = this.boltT > 0.12 || (this.boltT > 0 && this.boltT < 0.06);
      this.bolt.visible = on;
      this.branch.visible = on && this.boltT > 0.1;
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
        // Natural lightning: no warning, a random spot anywhere on the visible ground.
        this._strike(g.camX + g.halfW * rand(-1, 1));
        this.t = rand(2.5, 6) / this.rate;
        return;
      case 'vigilantes':
        this._armTorpedo();
        return;
      case 'watchtowers':
        g.addEnemy('watchtower', g.camX + g.halfW + 6, 0);
        this.t = rand(6, 10) / this.rate;
        return;
      default:
        // 'lava' is handled by the director (lava bombs falling from the eruptions).
        return;
    }
  }

  // ------------------------------------------------------------ lightning

  _strike(x) {
    const g = this.g;
    const gy = g.world.groundY(x);
    const top = g.halfH + 6;
    const pts = [];
    const n = this.bolt.geometry.attributes.position.count;
    let bx = x + rand(-6, 6);
    for (let i = 0; i < n; i++) {
      const k = i / (n - 1);
      bx += (x - bx) * 0.3 + (i === n - 1 ? 0 : rand(-1.8, 1.8));
      pts.push([i === n - 1 ? x : bx, top + (gy - top) * k]);
    }
    this._setLine(this.bolt, pts);
    // A short fork off the main channel.
    const j = Math.floor(rand(3, n / 2));
    const fork = [pts[j]];
    let fx = pts[j][0];
    let fy = pts[j][1];
    const dir = Math.random() < 0.5 ? -1 : 1;
    for (let i = 1; i < this.branch.geometry.attributes.position.count; i++) {
      fx += dir * rand(0.6, 2) ;
      fy -= rand(1.2, 2.6);
      fork.push([fx, fy]);
    }
    this._setLine(this.branch, fork);
    this.boltT = 0.22;
    for (let i = 0; i < pts.length; i += 3) g.fx.sparks(pts[i][0], pts[i][1], 2, 0);
    g.world.flashT = 0.35;
    g.ui.lightningFlash();
    g.audio.play('strike');
    g.fx.groundBlast(x, gy, 1, 0);
    g.shake(0.6);
    this._damageAlong(pts, 22, 12);
    this._damageAlong(fork, 12, 6);
    g.hint('lightning');
  }

  _setLine(l, pts) {
    const a = l.geometry.attributes.position.array;
    pts.forEach(([x, y], i) => {
      a[i * 3] = x;
      a[i * 3 + 1] = y;
      a[i * 3 + 2] = 0.6;
    });
    l.geometry.attributes.position.needsUpdate = true;
    l.visible = true;
  }

  // Only what the bolt actually passes through is hit (player, aircraft or vehicles).
  _damageAlong(pts, playerDmg, enemyDmg) {
    const g = this.g;
    const near = (x, y, r) => {
      for (let i = 1; i < pts.length; i++) {
        if (segDist(x, y, pts[i - 1], pts[i]) < r) return true;
      }
      return false;
    };
    const p = g.player;
    if (p.alive && (near(p.x + 1, p.y, 1.2) || near(p.x - 1, p.y, 1.2))) {
      g.fx.sparks(p.x, p.y, 8, g.scroll);
      p.hurt(playerDmg);
    }
    for (const e of g.enemies.slice()) {
      if (e.dead || e.dying > 0) continue;
      if (e.circles.some((c) => near(e.x + c[0], e.y + c[1], c[2] + 0.5))) {
        g.fx.sparks(e.x, e.y, 8, 0);
        e.damage(e.boss ? enemyDmg * 1.5 : enemyDmg);
      }
    }
  }

  // ------------------------------------------------------------ vigilantes

  _armTorpedo() {
    const g = this.g;
    const timer = 0.9;
    // A rooftop that will still be on screen when the torpedo leaves.
    const roofs = g.world.roofsNear(g.camX + g.scroll * timer, g.halfW * 0.85);
    if (!roofs.length) {
      this.t = 1;
      return;
    }
    const roof = roofs[Math.floor(Math.random() * roofs.length)];
    this.pending = { roof, timer };
    g.audio.play('beep');
    g.hint('vigilante');
  }

  _windUp(dt) {
    const g = this.g;
    const p = this.pending;
    p.timer -= dt;
    const [x, y, z] = p.roof;
    if (Math.floor(p.timer * 8) % 2 === 0) g.fx.beacon(x, y + 0.4, z + 0.3);
    if (p.timer <= 0) {
      this.pending = null;
      this._launchTorpedo(x, y + 0.4, z, this._pickVictim());
      this.t = rand(3.5, 7) / this.rate;
    }
  }

  // Random target: the player or any enemy aircraft/vehicle on screen.
  _pickVictim() {
    const g = this.g;
    const others = g.enemies.filter((e) => !e.dead && e.dying <= 0 && e.onScreen(2) && e.kind !== 'meteor' && e.kind !== 'rocket' && e.kind !== 'watchtower');
    if (g.player.alive && (!others.length || Math.random() < 0.5)) return g.player;
    return others.length ? others[Math.floor(Math.random() * others.length)] : null;
  }

  // Unguided: aimed once at launch (leading the target's current motion), then flies straight.
  _launchTorpedo(x, y, z, target) {
    const g = this.g;
    const speed = 36;
    let heading;
    if (target) {
      const p = g.player;
      const tvx = target === p ? g.scroll + p.vxRel : (target.worldVx ?? g.scroll);
      const tvy = target === p ? p.vyRel : (target.air ? target.vy || 0 : 0);
      const ty0 = target.y + (target.air ? 0 : 1);
      let t = Math.hypot(target.x - x, ty0 - y) / speed;
      for (let k = 0; k < 2; k++) t = Math.hypot(target.x + tvx * t - x, ty0 + tvy * t - y) / speed;
      heading = Math.atan2(ty0 + tvy * t - y, target.x + tvx * t - x);
    } else {
      heading = Math.PI * rand(0.3, 0.7);
    }
    const obj = createMissile(true);
    obj.scale.setScalar(1.3);
    obj.position.set(x, y, z);
    obj.rotation.z = heading;
    g.scene.add(obj);
    this.torpedoes.push({ obj, x, y, z, z0: z, vx: Math.cos(heading) * speed, vy: Math.sin(heading) * speed, life: 4, age: 0 });
    g.fx.explosion(x, y, 0.5, 0, z);
    g.audio.play('missile');
  }

  _updateTorpedoes(dt) {
    const g = this.g;
    for (let i = this.torpedoes.length - 1; i >= 0; i--) {
      const t = this.torpedoes[i];
      t.age += dt;
      t.life -= dt;
      // Straight-line flight in the world frame; it leaves the rooftop and moves out to the
      // battle plane (z = 0) over its first half second.
      t.x += t.vx * dt;
      t.y += t.vy * dt;
      t.z = t.z0 * Math.max(0, 1 - t.age / 0.45);
      t.obj.position.set(t.x, t.y, t.z);
      g.fx.trail(t.x - t.vx * 0.03, t.y - t.vy * 0.03, 0, 0, 1.1, true);
      let hit = false;
      if (t.z > -1.5) {
        const p = g.player;
        if (p.alive && p.hitTest(t.x, t.y, 0.5)) {
          p.hurt(16);
          hit = true;
        } else {
          for (const e of g.enemies) {
            if (e.dead || e.dying > 0 || e.kind === 'rocket' || e.kind === 'meteor') continue;
            if (e.hitTest(t.x, t.y, 0.5)) {
              e.damage(e.boss ? 14 : 10);
              hit = true;
              break;
            }
          }
        }
      }
      const grounded = t.z > -1.5 && t.y < g.world.groundY(t.x);
      const off = t.life <= 0 || Math.abs(t.x - g.camX) > g.halfW + 12 || t.y > g.halfH + 10;
      if (hit || grounded || off) {
        if (hit || grounded) {
          g.fx.explosion(t.x, t.y, 1, 0);
          g.audio.play('explode', 1);
        }
        g.scene.remove(t.obj);
        this.torpedoes.splice(i, 1);
      }
    }
  }
}

function segDist(px, py, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / len));
  return Math.hypot(px - (a[0] + dx * t), py - (a[1] + dy * t));
}

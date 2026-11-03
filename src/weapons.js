// Projectiles: instanced tracer rounds for both teams, plus homing missiles and bombs.
import * as THREE from 'three';
import { createMissile, createBomb } from './models.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _z = new THREE.Vector3(0, 0, 1);
const TRACER_HALF = 0.95; // half the length of a player tracer (1.9 units)

// Hit test along the path a round moved this frame, so very fast shells cannot skip
// through the player between frames.
function sweptHit(p, x0, y0, x1, y1, r) {
  const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 0.5));
  for (let k = 1; k <= steps; k++) {
    const t = k / steps;
    if (p.hitTest(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, r)) return true;
  }
  return false;
}

class BulletPool {
  constructor(scene, max, geo, color, scale) {
    this.items = [];
    this.max = max;
    this.scale = scale;
    const mat = new THREE.MeshBasicMaterial({ color, fog: false });
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.renderOrder = 3;
    scene.add(this.mesh);
  }

  add(b) {
    if (this.items.length >= this.max) this.items.shift();
    this.items.push(b);
  }

  sync(game) {
    const list = this.items;
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      const relVx = b.vx - game.scroll;
      _q.setFromAxisAngle(_z, Math.atan2(b.vy, relVx));
      const k = b.big ? 1.7 : 1;
      _s.set(this.scale[0] * k, this.scale[1] * k, this.scale[2] * k);
      _m.compose(_p.set(b.x, b.y, 0.2), _q, _s);
      this.mesh.setMatrixAt(i, _m);
    }
    this.mesh.count = list.length;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  clear() {
    this.items.length = 0;
    this.mesh.count = 0;
  }
}

export class Weapons {
  constructor(game) {
    this.game = game;
    const scene = game.scene;
    const tracer = new THREE.CylinderGeometry(0.5, 0.5, 1, 5);
    tracer.rotateZ(-Math.PI / 2);
    this.player = new BulletPool(scene, 260, tracer, 0xffc93d, [1.9, 0.24, 0.24]);
    const orb = new THREE.IcosahedronGeometry(0.5, 1);
    this.enemy = new BulletPool(scene, 320, orb, 0xff4a2a, [0.9, 0.65, 0.65]);
    // Bosses fire tracer lines like the player's, in red. Shots a boss charges up first
    // stay round (and very fast) so the charge reads as something different.
    this.enemyTracer = new BulletPool(scene, 320, tracer, 0xff3b2a, [1.9, 0.24, 0.24]);
    this.bossFire = false; // set while a boss runs its update
    this.missiles = [];
    this.bombs = [];
    this.enemyBombs = [];
    this.decoys = [];
  }

  setTracer(color) {
    this.player.mesh.material.color.set(color);
  }

  clear() {
    this.player.clear();
    this.clearEnemyRounds();
    for (const m of this.missiles) this.game.scene.remove(m.obj);
    for (const b of this.bombs) this.game.scene.remove(b.obj);
    for (const b of this.enemyBombs) this.game.scene.remove(b.obj);
    this.missiles.length = 0;
    this.bombs.length = 0;
    this.enemyBombs.length = 0;
    this.decoys.length = 0;
  }

  // Angle is relative to the screen (camera frame).
  playerBullet(x, y, angle, speed, damage) {
    const g = this.game;
    // No range limit: a tracer flies until it hits something or reaches the edge of the screen.
    this.player.add({ x, y, vx: g.scroll + Math.cos(angle) * speed, vy: Math.sin(angle) * speed, damage, life: 6 });
  }

  clearEnemyRounds() {
    this.enemy.clear();
    this.enemyTracer.clear();
  }

  // `opts.orb` forces a round shell (charged boss shots); otherwise bosses fire tracers.
  enemyBullet(x, y, angle, speed, damage, opts = {}) {
    const g = this.game;
    const pool = this.bossFire && !opts.orb ? this.enemyTracer : this.enemy;
    pool.add({
      x, y,
      vx: g.scroll + Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      damage,
      life: opts.fuse ?? 5,
      flak: !!opts.flak,
      grav: opts.grav || 0,
      big: !!opts.big || !!opts.flak,
    });
    if (!opts.flak) g.audio.play('enemyShoot');
  }

  missile(x, y, vxRel, vyRel, damage) {
    const g = this.game;
    const obj = createMissile(false);
    obj.position.set(x, y, 0.3);
    g.scene.add(obj);
    this.missiles.push({
      obj, x, y, damage,
      heading: Math.atan2(vyRel - 3, Math.max(8, vxRel + 8)),
      speed: Math.max(8, vxRel + 6),
      life: 4,
      target: null,
      retarget: 0,
    });
    g.audio.play('missile');
  }

  bomb(x, y, vxWorld, vy, radius, damage) {
    const g = this.game;
    const obj = createBomb();
    obj.position.set(x, y, 0.3);
    g.scene.add(obj);
    this.bombs.push({ obj, x, y, vx: vxWorld, vy, radius, damage });
    g.audio.play('bomb');
  }

  // Enemy gravity bomb (world-frame velocity), same physics as the player's bombs. It
  // explodes on contact with the player or the ground; the blast hurts the player within
  // `radius`. Cluster bombs split into three bomblets shortly after release.
  // Player cannon fire can detonate a falling bomb in mid-air.
  enemyBomb(x, y, vxWorld, vy, opts = {}) {
    const g = this.game;
    const obj = createBomb(true);
    const scale = opts.scale ?? 1;
    obj.scale.setScalar(scale);
    obj.position.set(x, y, 0.3);
    g.scene.add(obj);
    this.enemyBombs.push({
      obj, x, y, vx: vxWorld, vy, age: 0, scale,
      radius: opts.radius ?? 4, damage: opts.damage ?? 16, cluster: !!opts.cluster,
    });
    g.audio.play('enemyBomb');
  }

  // Flare decoy: a burning point that player missiles will chase instead of the boss.
  flare(x, y, vxWorld, vy) {
    const d = { x, y, vx: vxWorld, vy, life: 2.2, dead: false, dying: 0, decoy: true };
    this.decoys.push(d);
    return d;
  }

  _pickTarget(m) {
    const g = this.game;
    let best = null;
    let bestScore = Infinity;
    for (const e of g.enemies) {
      // Stealthy targets (Nightwing with its bay shut) cannot be locked.
      if (e.dead || e.dying > 0 || e.def.noTarget || e.stealth || !e.onScreen(-2)) continue;
      const dx = e.x - m.x;
      const dy = e.y - m.y;
      if (dx < -4) continue;
      // Prefer things ahead of the missile and in the air.
      const score = Math.hypot(dx, dy) + (e.air ? 0 : 25) + (e.kind === 'rocket' ? 10 : 0) - (e.boss ? 5 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = e;
      }
    }
    return best;
  }

  update(dt) {
    const g = this.game;
    const world = g.world;
    const left = g.camX - g.halfW - 4;
    const right = g.camX + g.halfW + 6;

    // Player tracers. A tracer may travel all the way to the edge of the screen but never
    // past it: on the frame its tip would cross an edge it is pulled back so the tip sits
    // exactly on the edge, drawn there once, and removed on the next frame.
    const edgeX = g.halfWidthAt(0.2);
    const edgeY = edgeX / g.camera.aspect;
    let list = this.player.items;
    for (let i = list.length - 1; i >= 0; i--) {
      const b = list[i];
      if (b.atEdge) {
        list[i] = list[list.length - 1];
        list.pop();
        continue;
      }
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      const rvx = b.vx - g.scroll;
      const len = Math.hypot(rvx, b.vy) || 1;
      const half = TRACER_HALF * (b.big ? 1.7 : 1);
      const tipX = b.x - g.camX + (rvx / len) * half;
      const tipY = b.y + (b.vy / len) * half;
      // How far past the screen edge the tip went, measured back along the flight path.
      let over = 0;
      if (tipX > edgeX && rvx > 0) over = Math.max(over, (tipX - edgeX) * len / rvx);
      if (tipX < -edgeX && rvx < 0) over = Math.max(over, (tipX + edgeX) * len / rvx);
      if (tipY > edgeY && b.vy > 0) over = Math.max(over, (tipY - edgeY) * len / b.vy);
      if (tipY < -edgeY && b.vy < 0) over = Math.max(over, (tipY + edgeY) * len / b.vy);
      if (over > 0) {
        b.x -= (rvx / len) * over;
        b.y -= (b.vy / len) * over;
        b.atEdge = true;
      }
      let hit = b.life <= 0 || b.x < left;
      if (!hit && b.y < world.groundY(b.x)) {
        g.fx.dirt(b.x, world.groundY(b.x), g.scroll * 0.3);
        hit = true;
      }
      if (!hit) {
        for (let k = this.enemyBombs.length - 1; k >= 0; k--) {
          const eb = this.enemyBombs[k];
          if (Math.hypot(eb.x - b.x, eb.y - b.y) < 0.8 * eb.scale) {
            this._enemyBlast(eb.x, eb.y, eb.radius * 0.8, eb.damage, false);
            g.scene.remove(eb.obj);
            this.enemyBombs.splice(k, 1);
            hit = true;
            break;
          }
        }
      }
      if (!hit) {
        for (const e of g.enemies) {
          if (e.dead || e.dying > 0) continue;
          const ci = e.hitIndex(b.x, b.y, 0.25);
          if (ci >= 0) {
            e.damage(b.damage, 'gun', ci, b.x, b.y);
            g.stats.hits++;
            g.fx.sparks(b.x, b.y, 3, g.scroll);
            g.audio.play('hit');
            hit = true;
            break;
          }
        }
      }
      if (hit) {
        list[i] = list[list.length - 1];
        list.pop();
      }
    }

    // Enemy rounds (orbs and boss tracers)
    const p = g.player;
    for (const pool of [this.enemy, this.enemyTracer]) {
    list = pool.items;
    for (let i = list.length - 1; i >= 0; i--) {
      const b = list[i];
      if (b.grav) b.vy += b.grav * dt;
      const x0 = b.x;
      const y0 = b.y;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      let hit = false;
      if (b.flak && b.life <= 0) {
        g.fx.flakBurst(b.x, b.y);
        g.audio.play('flak');
        if (p.alive && Math.hypot(p.x - b.x, p.y - b.y) < 3.4) p.hurt(b.damage);
        hit = true;
      } else if (b.life <= 0 || b.x < left - 6 || b.x > right + 10 || Math.abs(b.y) > g.halfH + 6) {
        hit = true;
      } else if (b.y < world.groundY(b.x)) {
        g.fx.dirt(b.x, world.groundY(b.x), 0);
        hit = true;
      } else if (p.alive && sweptHit(p, x0, y0, b.x, b.y, b.big ? 0.45 : 0.3)) {
        if (b.flak) g.fx.flakBurst(b.x, b.y);
        p.hurt(b.damage);
        g.fx.sparks(b.x, b.y, 5, g.scroll);
        hit = true;
      }
      if (hit) {
        list[i] = list[list.length - 1];
        list.pop();
      }
    }
    }

    // Missiles
    for (let i = this.missiles.length - 1; i >= 0; i--) {
      const m = this.missiles[i];
      m.life -= dt;
      m.retarget -= dt;
      if (m.target && m.target.stealth) m.target = null;
      if (!m.target || m.target.dead || m.target.dying > 0) {
        if (m.retarget <= 0) {
          m.target = this._pickTarget(m);
          m.retarget = 0.2;
        }
      }
      if (m.target && m.life < 3.8) {
        const want = Math.atan2(m.target.y - m.y, m.target.x - m.x);
        let d = want - m.heading;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        m.heading += Math.max(-dt * 5, Math.min(dt * 5, d));
      }
      m.speed = Math.min(48, m.speed + dt * 55);
      m.x += (g.scroll + Math.cos(m.heading) * m.speed) * dt;
      m.y += Math.sin(m.heading) * m.speed * dt;
      m.obj.position.set(m.x, m.y, 0.3);
      m.obj.rotation.z = m.heading;
      m.obj.rotation.x += dt * 8;
      g.fx.trail(m.x - Math.cos(m.heading) * 0.9, m.y - Math.sin(m.heading) * 0.9, 0, 0, 0.9);
      let boom = m.life <= 0 || m.y < world.groundY(m.x) || m.x > right + 20;
      // A missile that reaches the flare it is chasing burns out on it.
      if (!boom && m.target && m.target.decoy && Math.hypot(m.target.x - m.x, m.target.y - m.y) < 1.4) boom = true;
      if (!boom) {
        for (const e of g.enemies) {
          if (e.dead || e.dying > 0) continue;
          if (e.hitTest(m.x, m.y, 0.5)) {
            boom = true;
            break;
          }
        }
      }
      if (boom) {
        this._blast(m.x, m.y, 2.8, m.damage, 0.8, false, 'missile');
        g.scene.remove(m.obj);
        this.missiles.splice(i, 1);
      }
    }

    // Bombs
    for (let i = this.bombs.length - 1; i >= 0; i--) {
      const b = this.bombs[i];
      // Gravity plus light air drag on both axes.
      b.vy -= 30 * dt;
      b.vx *= 1 - 0.08 * dt;
      b.vy *= 1 - 0.08 * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.obj.position.set(b.x, b.y, 0.3);
      // Point along the true (world) flight path.
      b.obj.rotation.z = Math.atan2(b.vy, Math.max(1, b.vx));
      const gy = world.groundY(b.x);
      let boom = b.y <= gy + 0.3;
      if (!boom) {
        for (const e of g.enemies) {
          if (!e.dead && e.dying <= 0 && e.hitTest(b.x, b.y, 0.5)) {
            boom = true;
            break;
          }
        }
      }
      if (boom) {
        const onGround = b.y <= gy + 1;
        this._blast(b.x, Math.max(b.y, gy), b.radius, b.damage, 1.5, onGround, 'bomb');
        g.scene.remove(b.obj);
        this.bombs.splice(i, 1);
      }
    }

    this._updateEnemyBombs(dt, left, right);
    this._updateDecoys(dt);

    this.player.sync(g);
    this.enemy.sync(g);
    this.enemyTracer.sync(g);
  }

  _updateEnemyBombs(dt, left, right) {
    const g = this.game;
    const p = g.player;
    const list = this.enemyBombs;
    for (let i = list.length - 1; i >= 0; i--) {
      const b = list[i];
      b.age += dt;
      b.vy -= 30 * dt;
      b.vx *= 1 - 0.08 * dt;
      b.vy *= 1 - 0.08 * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.obj.position.set(b.x, b.y, 0.3);
      // Nose follows the true flight path whichever way the bomb is travelling.
      b.obj.rotation.z = Math.atan2(b.vy, b.vx);
      if (b.cluster && b.age > 0.5) {
        g.fx.flakBurst(b.x, b.y);
        for (const dv of [-4.5, 0, 4.5]) {
          this.enemyBomb(b.x, b.y, b.vx + dv, b.vy + 1, { scale: b.scale * 0.6, radius: 3, damage: 8 });
        }
        g.scene.remove(b.obj);
        list.splice(i, 1);
        continue;
      }
      const gy = g.world.groundY(b.x);
      let boom = false;
      let ground = false;
      if (b.y <= gy + 0.3) {
        boom = true;
        ground = true;
      } else if (p.alive && p.hitTest(b.x, b.y, 0.45 * b.scale)) {
        boom = true;
      }
      if (boom) this._enemyBlast(b.x, Math.max(b.y, gy), b.radius, b.damage, ground);
      if (boom || b.x < left - 12 || b.x > right + 30 || b.y < -70) {
        g.scene.remove(b.obj);
        list.splice(i, 1);
      }
    }
  }

  // Blast from an enemy bomb: full damage on a direct hit, less towards the edge.
  _enemyBlast(x, y, radius, damage, ground) {
    const g = this.game;
    const size = 0.6 + radius * 0.18;
    if (ground) g.fx.groundBlast(x, y, size, 0);
    else g.fx.explosion(x, y, size, g.scroll * 0.5);
    g.audio.play('explode', size);
    g.shake(0.15 * size);
    const p = g.player;
    if (!p.alive) return;
    const d = Math.max(0, Math.hypot(p.x - x, p.y - y) - 0.8);
    if (d < radius) p.hurt(damage * (1 - 0.6 * (d / radius)));
  }

  _updateDecoys(dt) {
    const g = this.game;
    for (let i = this.decoys.length - 1; i >= 0; i--) {
      const d = this.decoys[i];
      d.life -= dt;
      d.vy -= 9 * dt;
      d.vx *= 1 - 0.9 * dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      g.fx.flareGlow(d.x, d.y);
      if (d.life <= 0) {
        d.dead = true;
        this.decoys.splice(i, 1);
      }
    }
  }

  _blast(x, y, radius, damage, size, ground = false, src = 'other') {
    const g = this.game;
    if (ground) g.fx.groundBlast(x, y, size, g.scroll * 0.2);
    else g.fx.explosion(x, y, size, g.scroll);
    g.audio.play('explode', size);
    g.shake(0.25 * size);
    for (const e of g.enemies.slice()) {
      if (e.dead || e.dying > 0) continue;
      const [d, ci] = e.nearest(x, y);
      if (d < radius) e.damage(damage * (1 - 0.5 * (d / radius)), src, ci, x, y);
    }
  }
}

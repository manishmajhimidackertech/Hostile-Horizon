// Projectiles: instanced tracer rounds for both teams, plus homing missiles and bombs.
import * as THREE from 'three';
import { createMissile, createBomb } from './models.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _z = new THREE.Vector3(0, 0, 1);

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
    this.missiles = [];
    this.bombs = [];
  }

  setTracer(color) {
    this.player.mesh.material.color.set(color);
  }

  clear() {
    this.player.clear();
    this.enemy.clear();
    for (const m of this.missiles) this.game.scene.remove(m.obj);
    for (const b of this.bombs) this.game.scene.remove(b.obj);
    this.missiles.length = 0;
    this.bombs.length = 0;
  }

  // Angle is relative to the screen (camera frame).
  playerBullet(x, y, angle, speed, damage) {
    const g = this.game;
    this.player.add({ x, y, vx: g.scroll + Math.cos(angle) * speed, vy: Math.sin(angle) * speed, damage, life: 1.2 });
  }

  enemyBullet(x, y, angle, speed, damage, opts = {}) {
    const g = this.game;
    this.enemy.add({
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

  _pickTarget(m) {
    const g = this.game;
    let best = null;
    let bestScore = Infinity;
    for (const e of g.enemies) {
      if (e.dead || e.dying > 0 || e.def.noTarget || !e.onScreen(-2)) continue;
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

    // Player tracers
    let list = this.player.items;
    for (let i = list.length - 1; i >= 0; i--) {
      const b = list[i];
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      let hit = b.life <= 0 || b.x > right || b.x < left || Math.abs(b.y) > g.halfH + 4;
      if (!hit && b.y < world.groundY(b.x)) {
        g.fx.dirt(b.x, world.groundY(b.x), g.scroll * 0.3);
        hit = true;
      }
      if (!hit) {
        for (const e of g.enemies) {
          if (e.dead || e.dying > 0) continue;
          if (e.hitTest(b.x, b.y, 0.25)) {
            e.damage(b.damage);
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

    // Enemy rounds
    const p = g.player;
    list = this.enemy.items;
    for (let i = list.length - 1; i >= 0; i--) {
      const b = list[i];
      if (b.grav) b.vy += b.grav * dt;
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
      } else if (p.alive && p.hitTest(b.x, b.y, b.big ? 0.45 : 0.3)) {
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

    // Missiles
    for (let i = this.missiles.length - 1; i >= 0; i--) {
      const m = this.missiles[i];
      m.life -= dt;
      m.retarget -= dt;
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
        this._blast(m.x, m.y, 2.8, m.damage, 0.8);
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
        this._blast(b.x, Math.max(b.y, gy), b.radius, b.damage, 1.5, onGround);
        g.scene.remove(b.obj);
        this.bombs.splice(i, 1);
      }
    }

    this.player.sync(g);
    this.enemy.sync(g);
  }

  _blast(x, y, radius, damage, size, ground = false) {
    const g = this.game;
    if (ground) g.fx.groundBlast(x, y, size, g.scroll * 0.2);
    else g.fx.explosion(x, y, size, g.scroll);
    g.audio.play('explode', size);
    g.shake(0.25 * size);
    for (const e of g.enemies.slice()) {
      if (e.dead || e.dying > 0) continue;
      const d = e.distanceTo(x, y);
      if (d < radius) e.damage(damage * (1 - 0.5 * (d / radius)));
    }
  }
}

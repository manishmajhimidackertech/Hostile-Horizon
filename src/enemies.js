// Enemy roster. All positions are world units; `rel` values are relative to the camera,
// which scrolls right at game.scroll units/second.
import {
  MAT, createFighter, createDart, createHelicopter, createTank, createFlak,
  createBomber, createAirship, createMissile, createGunboat, createAAShip, createMeteor,
  createTitan, createBehemoth, createDreadnought, createAce, createNightwing, createWatchtower,
} from './models.js';

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ------------------------------------------------------------------ boss helpers

// Angle (camera frame) that puts a round fired at `speed` onto where the player will be.
// `k` scales the lead: 1 is a perfect deflection shot, lower values leave a dodge window.
function leadAngle(g, fx, fy, speed, k = 1) {
  const p = g.player;
  let tx = p.x;
  let ty = p.y;
  for (let i = 0; i < 3; i++) {
    const t = Math.hypot(tx - fx, ty - fy) / speed;
    tx = p.x + p.vxRel * t * k;
    ty = p.y + p.vyRel * t * k;
  }
  return Math.atan2(ty - fy, tx - fx);
}

// Launch velocity (camera frame) for a fused shell that reaches (tx, ty) after `t`
// seconds under gravity `grav` (negative = down).
function lobAngle(fx, fy, tx, ty, t, grav) {
  const vx = (tx - fx) / t;
  const vy = (ty - fy - 0.5 * grav * t * t) / t;
  return [Math.atan2(vy, vx), Math.hypot(vx, vy)];
}

// Where a gravity bomb released now crosses height `ty`, using exactly the same physics
// as Weapons (gravity 30, light drag). Returns the time and the world x, or null.
function bombImpact(x, y, vx, vy, ty) {
  const step = 1 / 30;
  for (let t = 0; t < 4; t += step) {
    vy -= 30 * step;
    vx *= 1 - 0.08 * step;
    vy *= 1 - 0.08 * step;
    x += vx * step;
    y += vy * step;
    if (y <= ty) return { t: t + step, x };
  }
  return null;
}

// Switch to the enraged second phase once, announcing it.
function enraged(e, g, at = 0.5) {
  if (!e.phase2 && e.hp < e.maxHp * at) {
    e.phase2 = true;
    if (e.def.enrage) g.ui.banner(e.def.enrage, 1.8, 'warn');
    g.audio.play('warning');
  }
  return !!e.phase2;
}

// Register destructible parts: each is { circle, gun, hp (fraction of max hull), name }.
function addParts(e, list) {
  e.parts = list.map((p) => ({ ...p, hp: p.hp * e.maxHp, maxHp: p.hp * e.maxHp, dead: false }));
  for (const p of e.parts) e.partOf[p.circle] = p;
}

// A knocked-out gun: explosion, the barrel droops and turns to charred metal.
function wreckGun(e, part, g, label) {
  const gun = e.obj.userData.guns[part.gun];
  const c = e.circles[part.circle];
  g.fx.explosion(e.x + c[0], e.y + c[1], 1.6, g.scroll);
  g.audio.play('partDown');
  g.shake(0.5);
  g.ui.popup(e.x + c[0], e.y + c[1] + 2, label, 'part');
  gun.mesh.material = MAT.burnt;
  e.meshes = e.meshes.filter((m) => m !== gun.mesh && m !== gun.base);
  if (gun.base) gun.base.material = MAT.burnt;
  gun.pivot.rotation.z = gun.pivot.rotation.z > Math.PI / 2 ? Math.PI + 0.35 : -0.35;
  if (gun.glow) gun.glow.scale.setScalar(0.001);
  gun.dead = true;
}

// Grow or hide a gun's charge-up glow (0..1).
function setCharge(gun, k) {
  if (!gun.glow) return;
  const r = gun.glow.userData.r;
  gun.glow.scale.setScalar(k <= 0 ? 0.001 : r * (0.3 + 0.7 * k) * (0.9 + Math.random() * 0.2));
}

function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function turnToward(angle, target, maxStep) {
  let d = target - angle;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return angle + clamp(d, -maxStep, maxStep);
}

// Point a turret barrel at a world-space angle. Mirrored parents (rotation.y = PI)
// flip the local angle.
function aim(pivot, angle, mirrored, dt, speed = 4) {
  const target = mirrored ? Math.PI - angle : angle;
  pivot.rotation.z = turnToward(pivot.rotation.z, target, dt * speed);
}

export class Enemy {
  constructor(game, kind, x, y, opts = {}) {
    const def = KINDS[kind];
    this.game = game;
    this.kind = kind;
    this.def = def;
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.age = 0;
    this.flash = 0;
    this.dead = false;
    this.dying = 0;
    this.air = def.air;
    this.boss = !!def.boss;
    this.hp = this.maxHp = Math.ceil(def.hp * (def.boss ? game.diff.bossHp : game.diff.hp));
    this.score = def.score;
    this.credits = def.credits;
    this.ram = def.ram || 0;
    this.circles = def.circles ? def.circles.map((c) => c.slice()) : [[0, def.cy || 0, def.r]];
    // Per-circle damage multiplier (weak spots), destructible parts keyed by circle index,
    // and a short status tag shown next to a boss's health bar.
    this.weak = this.circles.map((c) => c[3] ?? 1);
    this.partOf = [];
    this.tag = '';
    this.stealth = false;
    this.fbT = 0;
    this.obj = def.build(opts);
    this.meshes = this.obj.userData.meshes || [];
    this.obj.position.set(x, y, 0);
    game.scene.add(this.obj);
    def.init(this, opts, game);
  }

  get relX() {
    return this.x - this.game.camX;
  }

  onScreen(margin = 0) {
    const g = this.game;
    return Math.abs(this.x - g.camX) < g.halfW - margin && Math.abs(this.y) < g.halfH - margin;
  }

  // Index of the first hit circle the point touches, or -1. Weak spots and destructible
  // parts are listed first in each boss's circles so they take the hit when they overlap.
  hitIndex(x, y, r) {
    const cs = this.circles;
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i];
      const dx = x - (this.x + c[0]);
      const dy = y - (this.y + c[1]);
      const rr = r + c[2];
      if (dx * dx + dy * dy < rr * rr) return i;
    }
    return -1;
  }

  hitTest(x, y, r) {
    return this.hitIndex(x, y, r) >= 0;
  }

  // Distance from a point to the nearest hit circle edge and that circle's index (splash).
  nearest(x, y) {
    let best = Infinity;
    let idx = -1;
    this.circles.forEach((c, i) => {
      const d = Math.hypot(x - (this.x + c[0]), y - (this.y + c[1])) - c[2];
      if (d < best) {
        best = d;
        idx = i;
      }
    });
    return [Math.max(0, best), idx];
  }

  // `src` is the weapon ('gun', 'missile', 'bomb' or 'other'); the boss's armour scales it,
  // and a hit on a weak spot (circle `ci`) multiplies it again. Hits on a destructible part
  // also wear that part down.
  damage(amount, src = 'other', ci = -1, hx = this.x, hy = this.y) {
    if (this.dead || this.dying > 0) return;
    const armor = this.def.armor?.[src] ?? 1;
    const weak = ci >= 0 ? this.weak[ci] : 1;
    amount *= armor * weak;
    const part = ci >= 0 ? this.partOf[ci] : null;
    if (part && !part.dead) {
      part.hp -= amount;
      if (part.hp <= 0) {
        part.dead = true;
        this.def.onPartDestroyed?.(this, part, this.game);
      }
    }
    if (this.boss) this._hitFeedback(src, armor, weak, hx, hy);
    this.hp -= amount;
    this.flash = 0.06;
    for (const m of this.meshes) m.material = MAT.flash;
    if (this.hp <= 0) {
      if (this.boss) {
        this.dying = 2.6;
        this.game.onBossDown(this);
      } else {
        this.game.onEnemyKilled(this);
        this.remove();
      }
    }
  }

  // Teach the boss's armour: a WEAK SPOT callout on a weak-spot hit, ARMOURED when the
  // cannons barely scratch it, SUPER EFFECTIVE for the weapon it fears. Throttled.
  _hitFeedback(src, armor, weak, x, y) {
    const g = this.game;
    if (weak > 1) g.fx.sparks(x, y, 4, g.scroll);
    if (this.age < this.fbT) return;
    if (weak > 1) {
      g.ui.popup(x, y + 1, 'WEAK SPOT', 'crit');
      this.fbT = this.age + 0.9;
    } else if (armor < 0.75) {
      g.ui.popup(x, y + 1, 'ARMOURED', 'armor');
      this.fbT = this.age + 3;
    } else if (armor > 1.25) {
      g.ui.popup(x, y + 1, 'SUPER EFFECTIVE', 'crit');
      this.fbT = this.age + 1.5;
    }
  }

  update(dt) {
    const g = this.game;
    this.age += dt;
    if (this.flash > 0) {
      this.flash -= dt;
      if (this.flash <= 0) for (const m of this.meshes) m.material = MAT.body;
    }
    if (this.dying > 0) {
      this.dying -= dt;
      this._dieMotion(dt, g);
      if (Math.random() < dt * 14) {
        const c = this.circles[Math.floor(Math.random() * this.circles.length)];
        g.fx.explosion(this.x + c[0] + rand(-c[2], c[2]) * 0.7, this.y + c[1] + rand(-c[2], c[2]) * 0.7, rand(0.8, 1.6), g.scroll);
        g.audio.play('explode', 1);
        g.shake(0.4);
      }
      if (this.dying <= 0) {
        g.onEnemyKilled(this);
        this.remove();
        return;
      }
    } else {
      g.weapons.bossFire = this.boss;
      this.def.update(this, dt, g);
      g.weapons.bossFire = false;
    }
    this.obj.position.set(this.x, this.y, 0);
    if (this.def.naval && this.dying <= 0) {
      // Ride the swell and leave a wake.
      this.obj.position.y += Math.sin(this.age * 2.1 + this.x) * 0.15;
      this.obj.rotation.z = Math.sin(this.age * 1.6 + this.x) * 0.04;
      if (Math.random() < dt * 12) g.fx.wake(this.x + (this.def.wakeX ?? 2.5), this.y, g.scroll * 0.2);
    }
    // Cull once well off-screen (no reward).
    const rel = this.x - g.camX;
    if (!this.boss && (rel < -g.halfW - 18 || rel > g.halfW + 90 || this.y < -70 || this.y > 70)) this.remove();
  }

  // A destroyed boss keeps its momentum: aircraft lose airspeed and fall under gravity
  // nose-first, ground vehicles grind to a halt on the terrain, ships settle and sink.
  _dieMotion(dt, g) {
    const d = this.deathV || (this.deathV = { vx: this.worldVx ?? g.scroll, vy: this.air ? Math.min(this.vy || 0, 4) : 0 });
    if (this.air) {
      d.vy -= 9 * dt;
      d.vx += (g.scroll * 0.55 - d.vx) * Math.min(1, dt * 0.6);
      this.x += d.vx * dt;
      this.y += d.vy * dt;
      const floor = g.world.groundY(this.x) + 2;
      if (this.y < floor) {
        this.y = floor;
        d.vy = 0;
      }
      if (this.def.headingModel) {
        const target = Math.cos(this.heading) >= 0 ? -0.9 : Math.PI + 0.9;
        this.heading = turnToward(this.heading, target, dt * 1.2);
        this.obj.rotation.z = this.heading;
        this.obj.rotation.x += dt * 5;
      } else {
        const facing = this.def.facing ?? -1; // model-space nose direction
        const target = -0.45 * facing;
        this.obj.rotation.z += (target - this.obj.rotation.z) * Math.min(1, dt * 0.9);
      }
    } else if (this.def.naval) {
      d.vx *= 1 - Math.min(1, dt * 0.7);
      this.x += d.vx * dt;
      this.y -= dt * 1.1;
      this.obj.rotation.z += (0.12 * (this.def.facing ?? -1) - this.obj.rotation.z) * Math.min(1, dt);
    } else {
      d.vx *= 1 - Math.min(1, dt * 1.6);
      this.x += d.vx * dt;
      this.y = g.world.groundY(this.x);
    }
  }

  // Air units pitch to match their true flight path (world velocity, not screen velocity).
  // `facing` is +1 (right) or -1 (left).
  bank(vxWorld, vy, facing) {
    const pitch = clamp(Math.atan2(vy, Math.max(4, Math.abs(vxWorld))), -0.6, 0.6);
    this.obj.rotation.z = pitch * facing;
    this.obj.rotation.x = clamp(-vy * 0.03, -0.6, 0.6) * facing;
  }

  aimAngle(fromX, fromY) {
    const p = this.game.player;
    return Math.atan2(p.y - fromY, p.x - fromX);
  }

  remove() {
    if (this.dead) return;
    this.dead = true;
    this.game.scene.remove(this.obj);
  }
}

const KINDS = {
  // Standard fighter crossing the screen in a sine wave.
  fighter: {
    hp: 3, r: 1.9, score: 100, credits: 8, air: true, ram: 22,
    build: (o) => createFighter(o.facing || -1),
    init(e, o, g) {
      e.facing = o.facing || -1;
      // Screen speed must exceed the scroll so the fighter really moves the way it points.
      const speed = o.speed ?? 16;
      e.vxRel = e.facing < 0 ? -Math.max(speed, g.scroll + 7) : speed;
      e.baseY = e.y;
      e.amp = o.amp ?? 3;
      e.freq = o.freq ?? 1.6;
      e.phase = o.phase ?? rand(0, 6);
      e.fireT = rand(0.8, 2.0) / g.diff.rate;
    },
    update(e, dt, g) {
      e.x += (g.scroll + e.vxRel) * dt;
      const ny = e.baseY + Math.sin(e.age * e.freq + e.phase) * e.amp;
      e.vy = (ny - e.y) / Math.max(dt, 1e-4);
      e.y = ny;
      e.bank(g.scroll + e.vxRel, e.vy, e.facing);
      e.obj.userData.flame.scale.x = 0.8 + Math.random() * 0.4;
      e.fireT -= dt;
      if (e.fireT <= 0 && e.onScreen(2) && g.player.alive) {
        const ahead = (g.player.x - e.x) * e.facing > 0;
        if (ahead) g.weapons.enemyBullet(e.x + 2.5 * e.facing, e.y, e.aimAngle(e.x, e.y), 22 * g.diff.speed, 8);
        e.fireT = rand(1.4, 2.6) / g.diff.rate;
      }
    },
  },

  // Fast interceptor that homes briefly then commits to a ramming run.
  dart: {
    hp: 2, r: 1.5, score: 150, credits: 10, air: true, ram: 25,
    build: () => createDart(),
    init(e, o, g) {
      e.heading = Math.PI;
      e.speed = 21 * g.diff.speed;
      e.homeTime = 2.2;
    },
    update(e, dt, g) {
      if (e.age < e.homeTime && g.player.alive) {
        const target = Math.atan2(g.player.y - e.y, g.player.x - e.x);
        e.heading = turnToward(e.heading, target, dt * 1.6);
      }
      e.speed += dt * 6;
      const vxRel = Math.cos(e.heading) * e.speed;
      e.vy = Math.sin(e.heading) * e.speed;
      e.x += (g.scroll + vxRel) * dt;
      e.y += e.vy * dt;
      e.obj.rotation.z = e.heading;
      e.obj.rotation.x = Math.sin(e.age * 6) * 0.4;
      e.obj.userData.flame.scale.x = 1.2 + Math.random() * 0.6;
      if (Math.random() < 0.5) g.fx.exhaust(e.x - Math.cos(e.heading) * 2.4, e.y - Math.sin(e.heading) * 2.4, 0, 0, 0.8);
    },
  },

  // Gunship: flies in, hovers while firing bursts, then leaves.
  heli: {
    hp: 8, r: 2.2, score: 250, credits: 18, air: true, ram: 20,
    circles: [[0, 0, 2.0], [2.6, 0.3, 1.0]],
    build: () => createHelicopter(),
    init(e, o, g) {
      e.state = 'enter';
      e.targetRel = o.targetRel ?? g.halfW * rand(0.35, 0.7);
      e.targetY = o.targetY ?? rand(-6, 14);
      e.stay = rand(7, 10);
      e.fireT = 1.5;
      e.burst = 0;
      e.vxRel = -20;
      e.faceDir = -1;
      e.yaw = Math.PI;
    },
    update(e, dt, g) {
      const u = e.obj.userData;
      u.rotor.rotation.y += dt * 30;
      u.tailRotor.rotation.z += dt * 40;
      const rel = e.x - g.camX;
      let wantVx = 0;
      let wantVy = 0;
      if (e.state === 'enter') {
        wantVx = clamp((e.targetRel - rel) * 1.6, -22, 6);
        wantVy = clamp((e.targetY - e.y) * 1.5, -8, 8);
        if (Math.abs(e.targetRel - rel) < 1) e.state = 'hold';
      } else if (e.state === 'hold') {
        wantVy = Math.cos(e.age * 1.3) * 2.5 + clamp((g.player.y - e.y) * 0.25, -3, 3);
        wantVx = Math.sin(e.age * 0.7) * 2;
        e.stay -= dt;
        e.fireT -= dt;
        if (e.fireT <= 0 && g.player.alive) {
          if (e.burst === 0) e.burst = 3;
          // Chin gun under the nose, which may point either way.
          const gx = e.x + Math.cos(e.yaw) * 2.2;
          g.weapons.enemyBullet(gx, e.y - 0.8, e.aimAngle(gx, e.y - 0.8) + rand(-0.06, 0.06), 20 * g.diff.speed, 8);
          e.burst--;
          e.fireT = e.burst > 0 ? 0.16 : rand(1.6, 2.4) / g.diff.rate;
          if (e.burst === 0 && Math.random() < 0.3 * g.diff.rate) {
            g.addEnemy('rocket', e.x, e.y - 1, { heading: e.aimAngle(e.x, e.y - 1) });
          }
        }
        if (e.stay <= 0) e.state = 'leave';
      } else {
        wantVx = -26;
        wantVy = 7;
      }
      // A helicopter turns to face where it wants to go (world frame), and until the turn
      // is done it can only creep backwards/sideways. Acceleration is limited.
      const wantWorld = g.scroll + wantVx;
      if (wantWorld > 3) e.faceDir = 1;
      else if (wantWorld < -3) e.faceDir = -1;
      e.yaw += clamp((e.faceDir > 0 ? 0 : Math.PI) - e.yaw, -dt * 3, dt * 3);
      u.model.rotation.y = e.yaw;
      e.vxRel += clamp(wantVx - e.vxRel, -dt * 12, dt * 12);
      let vxWorld = g.scroll + e.vxRel;
      const nose = Math.cos(e.yaw);
      if (vxWorld * nose < 0 && Math.abs(vxWorld) > 4) vxWorld = 4 * Math.sign(vxWorld);
      e.vxRel = vxWorld - g.scroll;
      e.vy += clamp(wantVy - e.vy, -dt * 10, dt * 10);
      e.x += vxWorld * dt;
      e.y += e.vy * dt;
      e.worldVx = vxWorld;
      const pitch = clamp(-vxWorld * 0.012, -0.3, 0.3);
      e.obj.rotation.z += (pitch - e.obj.rotation.z) * Math.min(1, dt * 3);
    },
  },

  // Rocket fired by gunships and bosses. Can be shot down. Homing by default; with
  // `guided: false` it is an unguided pod rocket that flies straight and fast.
  rocket: {
    hp: 1, r: 0.7, score: 25, credits: 0, air: true, ram: 16, noDrop: true,
    build: () => createMissile(true),
    init(e, o, g) {
      e.heading = o.heading ?? Math.PI;
      e.guided = o.guided ?? true;
      e.speed = e.guided ? 10 : (o.speed ?? 30);
      e.life = e.guided ? 6 : 3.5;
      e.obj.rotation.z = e.heading;
      if (!e.guided) e.ram = 12;
    },
    update(e, dt, g) {
      e.life -= dt;
      if (e.guided && e.age < 2.6 && g.player.alive) {
        e.heading = turnToward(e.heading, Math.atan2(g.player.y - e.y, g.player.x - e.x), dt * 1.7);
      }
      if (e.guided) e.speed = Math.min(24 * g.diff.speed, e.speed + dt * 18);
      e.x += (g.scroll + Math.cos(e.heading) * e.speed) * dt;
      e.y += Math.sin(e.heading) * e.speed * dt;
      e.obj.rotation.z = e.heading;
      g.fx.trail(e.x - Math.cos(e.heading) * 0.9, e.y - Math.sin(e.heading) * 0.9, 0, 0, 0.8, true);
      if (e.life <= 0 || e.y < g.world.groundY(e.x)) {
        g.fx.explosion(e.x, e.y, 0.5, g.scroll);
        e.remove();
      }
    },
  },

  tank: {
    hp: 6, r: 1.9, cy: 1.0, score: 200, credits: 15, air: false,
    build: () => createTank(),
    init(e, o, g) {
      e.vxWorld = o.vx ?? -3;
      e.fireT = rand(1.0, 2.5) / g.diff.rate;
      e.y = g.world.groundY(e.x);
    },
    update(e, dt, g) {
      e.x += e.vxWorld * dt;
      e.worldVx = e.vxWorld;
      followGround(e, dt, g, 1.8);
      const muzzleY = e.y + 1.6;
      const a = e.aimAngle(e.x, muzzleY);
      aim(e.obj.userData.pivot, clamp(a, 0.15, Math.PI - 0.15) - e.obj.rotation.z, false, dt, 2);
      e.fireT -= dt;
      if (e.fireT <= 0 && e.onScreen(3) && g.player.alive && g.player.y > muzzleY + 2) {
        const ang = e.obj.userData.pivot.rotation.z + e.obj.rotation.z;
        g.weapons.enemyBullet(e.x + Math.cos(ang) * 2.4, muzzleY + Math.sin(ang) * 2.4, ang, 19 * g.diff.speed, 10, { big: true });
        g.fx.muzzle(e.x + Math.cos(ang) * 2.4, muzzleY + Math.sin(ang) * 2.4, 0);
        e.fireT = rand(2.0, 3.2) / g.diff.rate;
      }
    },
  },

  // Anti-aircraft gun: fires time-fused flak shells that burst near the player.
  flak: {
    hp: 5, r: 1.8, cy: 1.0, score: 180, credits: 14, air: false,
    build: () => createFlak(),
    init(e, o, g) {
      e.y = g.world.groundY(e.x);
      e.fireT = rand(0.8, 2) / g.diff.rate;
      e.burst = 0;
    },
    update(e, dt, g) {
      e.y = g.world.groundY(e.x);
      const muzzleY = e.y + 1.6;
      const a = clamp(e.aimAngle(e.x, muzzleY), 0.2, Math.PI - 0.2);
      aim(e.obj.userData.pivot, a, false, dt, 3);
      e.fireT -= dt;
      if (e.fireT <= 0 && e.onScreen(2) && g.player.alive) {
        const ang = e.obj.userData.pivot.rotation.z;
        const p = g.player;
        const dist = Math.hypot(p.x - e.x, p.y - muzzleY);
        const speed = 26 * g.diff.speed;
        g.weapons.enemyBullet(e.x + Math.cos(ang) * 3, muzzleY + Math.sin(ang) * 3, ang, speed, 12, {
          fuse: dist / speed + rand(-0.08, 0.12),
          flak: true,
        });
        g.audio.play('flak');
        if (e.burst === 0) e.burst = 2;
        e.burst--;
        e.fireT = e.burst > 0 ? 0.35 : rand(2.2, 3.2) / g.diff.rate;
      }
    },
  },

  // B-9 Stratofortress: the "flying fortress". Slow and steady with gunners covering
  // above and below. It periodically drops back over the player for a bombing run, and
  // while its bay is open the belly is a weak spot.
  bomber: {
    hp: 100, r: 3, score: 2500, credits: 250, air: true, boss: true, facing: 1, name: 'B-9 Stratofortress',
    features: 'Bombs from overhead',
    weakness: 'Open bomb bay',
    enrage: 'STRATOFORTRESS: ENGINES ON FIRE',
    armor: { missile: 0.8 },
    // Belly (weak spot while the bay is open) first, then the airframe.
    circles: [[0.8, -1.3, 1.6], [5, 0, 1.8], [2, 0, 1.9], [-1, 0.2, 1.8], [-4, 0.4, 1.6]],
    build: () => createBomber(),
    init(e) {
      e.baseY = 8;
      e.patternT = 4;
      e.turretT = [1.0, 1.6];
      e.vxRel = -10;
      e.run = 'none';
      e.runT = rand(8, 10);
      e.bay = 0;
      e.bombsLeft = 0;
      e.bombT = 0;
    },
    update(e, dt, g) {
      const p = g.player;
      const rel = e.x - g.camX;
      const phase2 = enraged(e, g, 0.4);
      const rate = g.diff.rate * (phase2 ? 1.25 : 1);
      // Station: ahead of the player, except during a bombing run when it slides back
      // to sit just ahead of the player so its stick of bombs falls across them.
      e.runT -= dt;
      if (e.run === 'none' && e.runT <= 0 && p.alive) {
        // Only worth it when there is room to fly over the player.
        if (p.y < g.halfH - 12) {
          e.run = 'approach';
          e.runT = 9;
          g.ui.banner('BOMBING RUN!', 1, 'warn');
        } else e.runT = 3;
      }
      let station = g.halfW - 12;
      let wantY = e.baseY + Math.sin(e.age * 0.5) * 7;
      if (e.run === 'approach' || e.run === 'drop') {
        station = p.x - g.camX;
        wantY = Math.min(g.halfH - 6, p.y + 9);
      }
      // After a run it opens the throttle to get back ahead of the player quickly.
      const want = clamp((station - rel) * 1.0, -(g.scroll - 3), e.run === 'none' ? 5 : 11);
      const acc = e.run === 'none' ? 6 : 9;
      e.vxRel += clamp(want - e.vxRel, -dt * acc, dt * acc);
      e.x += (g.scroll + e.vxRel) * dt;
      e.worldVx = g.scroll + e.vxRel;
      e.vy += (clamp((wantY - e.y) * 1.2, -7, 7) - e.vy) * Math.min(1, dt * 2);
      e.y += e.vy * dt;
      e.obj.rotation.z = Math.atan2(e.vy, Math.max(4, e.worldVx)) * 0.8;
      if (e.run === 'approach') {
        // Release when a bomb dropped now would land on the player.
        const hit = e.y > p.y + 3 ? bombImpact(e.x + 0.8, e.y - 1.6, e.worldVx, e.vy - 1, p.y) : null;
        if (hit && Math.abs(hit.x - (p.x + (g.scroll + p.vxRel) * hit.t)) < 4) {
          e.run = 'drop';
          e.bombsLeft = phase2 ? 5 : 3;
          e.bombT = 0.45; // doors open first
        } else if (e.runT <= 0) {
          e.run = 'leave';
          e.runT = 0;
        }
      } else if (e.run === 'drop') {
        e.bombT -= dt;
        if (e.bombT <= 0 && e.bay > 0.9) {
          g.weapons.enemyBomb(e.x + 0.8, e.y - 1.6, e.worldVx, e.vy - 1, { scale: 1.6, radius: 4, damage: 12 });
          e.bombsLeft--;
          e.bombT = 0.17;
          if (e.bombsLeft <= 0) {
            e.run = 'leave';
            e.runT = 1.2;
          }
        }
      } else if (e.run === 'leave') {
        if (e.runT <= 0 && rel > g.halfW - 18) {
          e.run = 'none';
          e.runT = rand(9, 12) / rate;
        }
      }
      const open = e.run === 'drop' || (e.run === 'leave' && e.runT > 0.6);
      e.bay = clamp(e.bay + (open ? dt * 2.5 : -dt * 2), 0, 1);
      e.weak[0] = e.bay > 0.3 ? 2 : 1;
      e.obj.userData.bayLight.material.opacity = e.bay * (0.7 + Math.random() * 0.2);
      e.tag = e.bay > 0.3 ? 'BOMB BAY OPEN' : '';
      // Gunners: the dorsal turret covers above the wing line, the ventral one below.
      const turrets = e.obj.userData.turrets;
      turrets.forEach((t, i) => {
        const wx = e.x + t.group.position.x;
        const wy = e.y + t.group.position.y * 0.95;
        // Gunners aim where you are, not where you are going: this is the first boss most
        // pilots meet, so steady flying is enough to dodge them.
        const a = e.aimAngle(wx, wy);
        aim(t.pivot, a, false, dt, 3);
        e.turretT[i] -= dt;
        // During a bombing run the belly gunner is silent: the bombs are the threat then.
        const bombing = e.run === 'approach' || e.run === 'drop';
        const covers = i === 0 ? p.y > e.y - 2 : p.y < e.y + 2 && !bombing;
        if (e.turretT[i] <= 0 && p.alive && covers && rel < g.halfW - 4) {
          const n = phase2 ? 3 : 2;
          for (let k = 0; k < n; k++) g.weapons.enemyBullet(wx, wy, a + (k - (n - 1) / 2) * 0.12, 21 * g.diff.speed, 8);
          e.turretT[i] = rand(1.3, 1.9) / rate;
        }
      });
      // Tail rockets when it is not busy bombing.
      e.patternT -= dt;
      if (e.patternT <= 0 && e.run === 'none' && rel < g.halfW - 4 && p.alive) {
        const n = phase2 ? 3 : 2;
        const a = e.aimAngle(e.x - 4, e.y);
        for (let k = 0; k < n; k++) g.addEnemy('rocket', e.x - 4, e.y, { heading: a + (k - (n - 1) / 2) * 0.5 });
        g.audio.play('missile');
        e.patternT = rand(4.5, 6.5) / rate;
      }
      if (phase2 && Math.random() < dt * 8) g.fx.damageSmoke(e.x + rand(-3, 3), e.y, 0, true);
    },
  },

  // Leviathan airship: an armoured flying carrier. Cannon rounds mostly pass through the
  // gas bag, so missiles and the gondola are the way in. It launches interceptors from a
  // hangar under the gondola, and the open hangar is a big weak spot.
  airship: {
    hp: 260, r: 5, score: 6000, credits: 600, air: true, boss: true, facing: 1, name: 'Leviathan Airship',
    features: 'Launches fighters',
    weakness: 'Gondola, open hangar',
    enrage: 'LEVIATHAN IS LOSING GAS',
    armor: { gun: 0.75, missile: 1.2 },
    circles: [[1, -5.4, 2.4, 1.6], [11, 0, 3.4], [6, 0, 4.3], [0, 0, 4.6], [-6, 0, 4.3], [-11, 0, 3.4]],
    build: () => createAirship(),
    init(e, o, g) {
      e.baseY = 6;
      e.turretT = [1, 1.5, 2, 2.5];
      e.patternT = 3;
      e.pattern = 0;
      e.barrage = 0;
      e.barrageT = 0;
      e.vxRel = -8;
      e.hangar = 0;
      e.hangarT = 7;
      e.launchT = 0;
    },
    update(e, dt, g) {
      const rel = e.x - g.camX;
      const target = g.halfW - 22;
      const phase2 = enraged(e, g);
      // Heavy and slow to change speed; always cruising forward over the ground. Losing
      // gas in the second phase, it sinks lower.
      const want = clamp((target - rel) * 0.8, -(g.scroll - 3), 4);
      e.vxRel += clamp(want - e.vxRel, -dt * 3, dt * 3);
      e.x += (g.scroll + e.vxRel) * dt;
      e.worldVx = g.scroll + e.vxRel;
      if (phase2) e.baseY = Math.max(2, e.baseY - dt * 0.5);
      const ny = e.baseY + Math.sin(e.age * 0.35) * 4;
      e.vy = (ny - e.y) / Math.max(dt, 1e-4);
      e.y = ny;
      e.obj.rotation.z = Math.sin(e.age * 0.5) * 0.04 + (phase2 ? 0.05 : 0);
      for (const p of e.obj.userData.props) p.rotation.x += dt * 18;
      const rate = g.diff.rate * (phase2 ? 1.3 : 1);
      const inRange = rel < g.halfW - 2;
      e.obj.userData.turrets.forEach((t, i) => {
        const wx = e.x - t.group.position.x; // model is mirrored to face +X
        const wy = e.y + t.group.position.y;
        const a = leadAngle(g, wx, wy, 20 * g.diff.speed, 0.6);
        aim(t.pivot, a, true, dt, 3);
        e.turretT[i] -= dt;
        if (e.turretT[i] <= 0 && inRange && g.player.alive) {
          g.weapons.enemyBullet(wx + Math.cos(a) * 2, wy + Math.sin(a) * 2, a, 20 * g.diff.speed, 9);
          e.turretT[i] = rand(1.4, 2.3) / rate;
        }
      });
      // Hangar: doors open (telegraph), interceptors launch, doors stay open a moment.
      e.hangarT -= dt;
      if (e.hangarT <= 0 && inRange && g.player.alive && e.launchT <= 0) {
        e.launchT = 3.2;
        g.ui.banner('INTERCEPTORS LAUNCHING', 1.1, 'warn');
      }
      if (e.launchT > 0) {
        const before = e.launchT;
        e.launchT -= dt;
        if (before > 2 && e.launchT <= 2) {
          const n = phase2 ? 3 : 2;
          for (let k = 0; k < n; k++) g.addEnemy('dart', e.x + 1 - k * 2, e.y - 7, {});
          g.audio.play('missile');
        }
        if (e.launchT <= 0) e.hangarT = rand(13, 16) / rate;
      }
      e.hangar = clamp(e.hangar + (e.launchT > 0.3 ? dt * 1.5 : -dt * 2), 0, 1);
      e.weak[0] = e.hangar > 0.4 ? 2.5 : 1.6;
      e.obj.userData.hangarLight.material.opacity = e.hangar * 0.85;
      e.tag = e.hangar > 0.4 ? 'HANGAR OPEN' : '';
      e.patternT -= dt;
      if (e.patternT <= 0 && inRange && g.player.alive && e.launchT <= 0) {
        const gx = e.x + 1;
        const gy = e.y - 6;
        if (e.pattern % 3 === 0) {
          const n = phase2 ? 11 : 8;
          for (let k = 0; k < n; k++) {
            g.weapons.enemyBullet(gx, gy, Math.PI * 0.55 + (k / (n - 1)) * Math.PI * 0.9, 15 * g.diff.speed, 9);
          }
          g.audio.play('enemyShoot');
        } else if (e.pattern % 3 === 1) {
          const n = phase2 ? 4 : 3;
          for (let k = 0; k < n; k++) g.addEnemy('rocket', e.x - 4, e.y - 3, { heading: Math.PI * 0.75 + k * 0.25 });
          g.audio.play('missile');
        } else {
          e.barrage = phase2 ? 12 : 8;
        }
        e.pattern++;
        e.patternT = rand(3.8, 5.2) / rate;
      }
      if (e.barrage > 0) {
        e.barrageT -= dt;
        if (e.barrageT <= 0) {
          const a = leadAngle(g, e.x + 7.5, e.y - 5.5, 26 * g.diff.speed, 0.5);
          g.weapons.enemyBullet(e.x + 7.5, e.y - 5.5, a + rand(-0.05, 0.05), 26 * g.diff.speed, 7);
          e.barrage--;
          e.barrageT = 0.1;
        }
      }
      if (phase2 && Math.random() < dt * 10) {
        const c = e.circles[1 + Math.floor(Math.random() * 5)];
        g.fx.damageSmoke(e.x + c[0], e.y + c[1] + 2, 0, true);
      }
    },
  },
};

// Naval variants reuse the land behaviours with ship models.
KINDS.gunboat = {
  ...KINDS.tank, hp: 7, score: 220, credits: 16, naval: true,
  circles: [[0, 0.7, 1.5], [-1.9, 0.5, 1.1], [1.9, 0.6, 1.2]],
  build: () => createGunboat(),
};
KINDS.aaship = {
  ...KINDS.flak, hp: 9, score: 260, credits: 20, naval: true,
  circles: [[0, 0.8, 1.7], [-2.6, 0.5, 1.2], [2.6, 0.8, 1.4]],
  build: () => createAAShip(),
};

// Lava bomb thrown up by erupting volcanoes. Can be shot down.
KINDS.meteor = {
  hp: 3, r: 1.3, score: 60, credits: 0, air: true, ram: 18, noDrop: true, noTarget: true,
  build: () => createMeteor(),
  init(e, o) {
    // Velocities are in the world frame: lava is a ballistic projectile.
    e.vx = o.vx ?? rand(-8, -2);
    e.vy = o.vy ?? -4;
    e.spin = rand(-4, 4);
  },
  update(e, dt, g) {
    e.vy -= 13 * dt;
    e.worldVx = e.vx;
    e.x += e.vx * dt;
    e.y += e.vy * dt;
    e.obj.rotation.x += e.spin * dt;
    e.obj.rotation.y += dt * 2;
    e.obj.children[1].scale.setScalar(0.9 + Math.random() * 0.25);
    g.fx.fireTrail(e.x, e.y + 0.5, e.vx * 0.3, -e.vy * 0.2, 1);
    // Lava hits anything in the air, enemies included.
    for (const o of g.enemies) {
      if (o === e || o.dead || o.dying > 0 || o.kind === 'meteor') continue;
      if (o.hitTest(e.x, e.y, 1.0)) {
        o.damage(o.boss ? 10 : 8);
        g.fx.explosion(e.x, e.y, 1, g.scroll);
        g.audio.play('explode', 1);
        e.remove();
        return;
      }
    }
    const gy = g.world.groundY(e.x);
    if (e.y < gy + 0.5 && e.vy < 0) {
      g.fx.groundBlast(e.x, gy, 1.3, 0);
      g.audio.play('explode', 1);
      g.shake(0.3);
      e.remove();
    }
  },
};

// Night-map watchtower: its searchlight sweeps on a fixed pattern and never follows the
// player. Staying inside the beam for a moment triggers a missile launch.
KINDS.watchtower = {
  hp: 6, r: 1.5, score: 250, credits: 20, air: false,
  circles: [[0, 2, 1.3], [0, 5.5, 1.3], [0, 9, 1.6]],
  build: () => createWatchtower(),
  init(e, o, g) {
    e.y = g.world.groundY(e.x);
    e.beamA = Math.PI * rand(0.45, 0.7);
    e.sweepT = rand(0, 6);
    e.lock = 0;
    e.cool = 1;
  },
  update(e, dt, g) {
    e.y = g.world.groundY(e.x);
    const u = e.obj.userData;
    const lx = e.x;
    const ly = e.y + 9.3;
    const p = g.player;
    const toP = Math.atan2(p.y - ly, p.x - lx);
    let d = toP - e.beamA;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    const lit = p.alive && g.state === 'playing' && Math.abs(d) < 0.12 && Math.hypot(p.x - lx, p.y - ly) < 55 && e.onScreen(-2);
    // The sweep is independent of the player.
    e.sweepT += dt;
    e.beamA = turnToward(e.beamA, Math.PI * 0.55 + Math.sin(e.sweepT * 0.7) * 0.45, dt * 0.8);
    if (lit) {
      e.lock += dt;
      g.hint('searchlight');
    } else {
      e.lock = Math.max(0, e.lock - dt * 2);
    }
    e.cool -= dt;
    if (e.lock > 0.6 && e.cool <= 0) {
      g.addEnemy('rocket', lx, ly + 0.5, { heading: toP });
      g.fx.muzzle(lx, ly, 0);
      g.audio.play('missile');
      g.ui.banner('MISSILE LOCK!', 0.9, 'danger');
      e.cool = 3;
      e.lock = 0;
    } else if (lit && e.lock > 0.2 && !e.beeped) {
      g.audio.play('beep');
      e.beeped = true;
    }
    if (!lit) e.beeped = false;
    u.beamPivot.rotation.z = e.beamA - Math.PI / 2;
    const k = Math.min(1, e.lock / 0.6);
    u.beamMat.color.setRGB(1, 0.95 - k * 0.8, 0.77 - k * 0.7);
    u.beamMat.opacity = 0.13 + k * 0.12;
  },
};

// Keep a ground vehicle on the terrain using two contact points (front/back),
// low-pass filtered so it rides over bumps instead of snapping to every vertex.
function followGround(e, dt, g, half) {
  const w = g.world;
  const back = w.groundY(e.x - half);
  const front = w.groundY(e.x + half);
  const y = Math.max((back + front) / 2, w.groundY(e.x) - 0.3);
  const slope = Math.atan2(front - back, half * 2);
  if (!e.grounded) {
    e.y = y;
    e.obj.rotation.z = slope;
    e.grounded = true;
    return;
  }
  const k = Math.min(1, dt * 8);
  e.y += (y - e.y) * k;
  e.obj.rotation.z += (slope - e.obj.rotation.z) * k;
}

// ------------------------------------------------------------------ fortress bosses

// Ground and naval fortresses hold station on the right, driving forward (facing +X)
// and never reversing over the ground. Returns the camera-relative x.
function fortressDrive(e, dt, g, hold) {
  const rel = e.x - g.camX;
  const want = clamp((g.halfW - hold - rel) * 0.8, -(g.scroll - 3), 4);
  e.vxRel += clamp(want - e.vxRel, -dt * 5, dt * 5);
  e.x += (g.scroll + e.vxRel) * dt;
  e.worldVx = g.scroll + e.vxRel;
  if (e.def.naval) e.y = g.world.groundY(e.x);
  else followGround(e, dt, g, 6);
  return rel;
}

// World position and barrel angle of a gun on a mirrored (built facing -X) model.
function gunWorld(e, gun) {
  const rz = e.obj.rotation.z;
  const wx = e.x - gun.pos[0];
  const wy = e.y + gun.pos[1];
  const ang = Math.PI - gun.pivot.rotation.z + rz;
  return { wx, wy, ang, mx: wx + Math.cos(ang) * gun.len, my: wy + Math.sin(ang) * gun.len };
}

// Time-fused flak shell that bursts near the player.
function flakShot(g, mx, my, ang) {
  const p = g.player;
  const speed = 26 * g.diff.speed;
  const dist = Math.hypot(p.x - mx, p.y - my);
  g.weapons.enemyBullet(mx, my, ang, speed, 12, { fuse: dist / speed + rand(-0.1, 0.12), flak: true });
  g.audio.play('flak');
}

// A heavy gun can only elevate between `lo` and `hi` radians above the horizon, on
// either side. Returns the closest reachable angle and whether the target is reachable.
function elevationBand(a, lo, hi) {
  if (a < -Math.PI / 2 || a > Math.PI) a = Math.PI;
  else if (a < 0) a = 0;
  if (a <= Math.PI / 2) return [clamp(a, lo, hi), a <= hi];
  const m = Math.PI - a;
  return [Math.PI - clamp(m, lo, hi), m <= hi];
}

// Behemoth land fortress: the armoured brute. Cannon fire barely scratches it and
// missiles do little more; bombs are what it fears, above all on the hot engine deck at
// the back. The main gun hits hard after a visible charge but cannot fire straight up;
// two flak guns on the bow cover that blind spot and can be knocked out.
KINDS.behemoth = {
  hp: 170, r: 4, score: 4000, credits: 400, air: false, boss: true, facing: 1, name: 'Behemoth Land Fortress',
  features: 'Shrugs off cannons',
  weakness: 'Bombs, engine deck',
  enrage: 'BEHEMOTH: MORTARS ONLINE',
  armor: { gun: 0.55, missile: 0.8, bomb: 1.6 },
  // Flak guns (destructible), the engine deck (weak spot), then hull and turret.
  circles: [[5.0, 4.9, 1.1], [5.0, 4.9, 1.1], [-5.1, 4.3, 1.8, 1.75], [6.4, 2, 2.4], [2.4, 2, 2.4], [-1.6, 2, 2.4], [-5.6, 2, 2.4], [1.0, 5.6, 2.4]],
  build: () => createBehemoth(),
  init(e, o, g) {
    e.y = g.world.groundY(e.x);
    e.gunT = [2.5, 1.4, 2.0];
    e.charge = 0;
    e.missileT = 6;
    e.mortarT = 3;
    e.vxRel = -10;
    addParts(e, [{ circle: 0, gun: 1, hp: 0.08 }, { circle: 1, gun: 2, hp: 0.08 }]);
  },
  onPartDestroyed(e, part, g) {
    wreckGun(e, part, g, 'FLAK GUN DESTROYED');
  },
  update(e, dt, g) {
    const rel = fortressDrive(e, dt, g, 14);
    const phase2 = enraged(e, g);
    const rate = g.diff.rate * (phase2 ? 1.3 : 1);
    const inRange = rel < g.halfW - 1;
    const p = g.player;
    const u = e.obj.userData;
    const rz = e.obj.rotation.z;
    // Main gun: slow to traverse, charges visibly, then fires one heavy shell.
    const main = u.guns[0];
    // The charged shell is a very fast round shot: the charge-up glow is the warning.
    const shellSpeed = 70 * g.diff.speed;
    let w = gunWorld(e, main);
    const [a, reachable] = elevationBand(leadAngle(g, w.wx, w.wy, shellSpeed, 0.6), 0.1, 1.15);
    aim(main.pivot, a - rz, true, dt, 1.2);
    e.gunT[0] -= dt;
    if (e.charge > 0) {
      e.charge += dt / 0.8;
      setCharge(main, e.charge);
      if (e.charge >= 1) {
        w = gunWorld(e, main);
        g.weapons.enemyBullet(w.mx, w.my, w.ang, shellSpeed, 16, { big: true, orb: true });
        g.fx.explosion(w.mx, w.my, 0.5, g.scroll);
        g.audio.play('explode', 0.8);
        g.shake(0.35);
        e.charge = 0;
        setCharge(main, 0);
        e.gunT[0] = rand(3.2, 4.2) / rate;
      }
    } else if (e.gunT[0] <= 0 && inRange && p.alive && reachable) {
      e.charge = 0.001;
      g.audio.play('charge');
    }
    // Flak guns cover the overhead blind spot.
    for (let i = 1; i < 3; i++) {
      const gun = u.guns[i];
      if (gun.dead) continue;
      const gw = gunWorld(e, gun);
      aim(gun.pivot, clamp(e.aimAngle(gw.wx, gw.wy), 0.15, Math.PI - 0.15) - rz, true, dt, 3);
      e.gunT[i] -= dt;
      if (e.gunT[i] <= 0 && inRange && p.alive) {
        flakShot(g, gw.mx, gw.my, gw.ang);
        e.gunT[i] = rand(1.5, 2.3) / rate;
      }
    }
    // Missile rack: tilts up (and a lock tone sounds) a second before each salvo.
    const prevT = e.missileT;
    e.missileT -= dt;
    if (prevT > 1 && e.missileT <= 1 && inRange) g.audio.play('lock');
    u.rack.rotation.z += ((e.missileT < 1 ? 0.75 : 0) - u.rack.rotation.z) * Math.min(1, dt * 4);
    if (e.missileT <= 0 && inRange && p.alive) {
      const n = phase2 ? 4 : 2;
      for (let k = 0; k < n; k++) g.addEnemy('rocket', e.x - 2.4, e.y + 7.6, { heading: Math.PI * 0.5 + 0.3 + k * 0.18 });
      g.audio.play('missile');
      e.missileT = rand(6, 8) / rate;
    }
    // Enraged: a turret-top mortar lobs fused shells around where the player is heading.
    if (phase2) {
      e.mortarT -= dt;
      if (e.mortarT <= 0 && inRange && p.alive) {
        const mx = e.x - 1;
        const my = e.y + 7.2;
        for (const off of [-4, 0, 4]) {
          const T = 1.5 + off * 0.03;
          const [ang, sp] = lobAngle(mx, my, p.x + p.vxRel * T * 0.6 + off, p.y + p.vyRel * T * 0.4, T, -22);
          g.weapons.enemyBullet(mx, my, ang, sp, 12, { fuse: T, flak: true, grav: -22 });
        }
        g.audio.play('flak');
        e.mortarT = rand(4, 5.5) / rate;
      }
    }
    // The hot engine deck pulses; exhaust smoke from the stacks.
    u.vents.material.opacity = 0.3 + 0.25 * (0.5 + 0.5 * Math.sin(e.age * 5));
    if (Math.random() < dt * 6) g.fx.trail(e.x - 6.4, e.y + 6.1, 0, 2.5, 1.3, true);
    const flak = e.parts.filter((pt) => !pt.dead).length;
    e.tag = `FLAK ${flak}/2`;
    if (phase2 && Math.random() < dt * 8) {
      const c = e.circles[3 + Math.floor(Math.random() * 5)];
      g.fx.damageSmoke(e.x + c[0], e.y + c[1] + 1, 0, true);
    }
  },
};

// Dreadnought battleship: firepower spread over five guns that can each be destroyed.
// Three slow-traversing triple turrets fire single shells and, after a warning glow, a
// full broadside; two AA mounts throw flak. Every gun knocked out silences part of its
// firepower. Enraged, it launches cruise missiles from its quarterdeck.
KINDS.dreadnought = {
  hp: 250, r: 5, score: 4500, credits: 450, air: false, boss: true, naval: true, facing: 1, wakeX: -11,
  name: 'Dreadnought Battleship',
  features: 'Broadsides, flak guns',
  weakness: 'Bombs, destructible turrets',
  enrage: 'DREADNOUGHT: CRUISE MISSILES ARMED',
  armor: { gun: 0.6, missile: 0.9, bomb: 1.4 },
  // Turrets A, B, C and the two AA mounts (destructible), then hull and superstructure.
  circles: [[8.1, 3.6, 1.6], [4.8, 4.2, 1.6], [-8.4, 2.9, 1.6], [3.4, 3.9, 1.0], [-3.7, 3.9, 1.0],
    [12, 1.8, 1.7], [9, 1, 2.2], [5, 1.2, 2.6], [1, 1.5, 2.8], [-3, 1.5, 2.8], [-7, 1.2, 2.6], [-11, 1.2, 2.0], [1.0, 5.6, 2.4]],
  build: () => createDreadnought(),
  init(e, o, g) {
    e.y = g.world.groundY(e.x);
    e.gunT = [3, 4.2, 2.2, 1.5, 2.2];
    e.broadT = 6;
    e.broad = 0;
    e.vlsT = 3;
    e.vls = 0;
    e.vlsFire = 0;
    e.vxRel = -10;
    addParts(e, [0, 1, 2, 3, 4].map((i) => ({ circle: i, gun: i, hp: i < 3 ? 0.12 : 0.06 })));
  },
  onPartDestroyed(e, part, g) {
    wreckGun(e, part, g, part.gun < 3 ? 'TURRET DESTROYED' : 'AA GUN DESTROYED');
    if (part.gun < 3 && e.parts.slice(0, 3).every((pt) => pt.dead)) g.ui.banner('MAIN BATTERY SILENCED', 1.6, 'good');
  },
  update(e, dt, g) {
    const rel = fortressDrive(e, dt, g, 18);
    const phase2 = enraged(e, g);
    const rate = g.diff.rate * (phase2 ? 1.3 : 1);
    const inRange = rel < g.halfW - 1;
    const p = g.player;
    const u = e.obj.userData;
    const sp = 22 * g.diff.speed;
    // Single shots are tracers; a charged broadside fires very fast round shells.
    const fireMain = (gun, n, charged) => {
      const w = gunWorld(e, gun);
      const speed = charged ? 65 * g.diff.speed : sp;
      for (let k = 0; k < n; k++) g.weapons.enemyBullet(w.mx, w.my, w.ang + (k - (n - 1) / 2) * 0.07, speed, 12, { big: true, orb: charged });
      g.fx.explosion(w.mx, w.my, 0.45, g.scroll);
      g.shake(0.2);
    };
    let mainsAlive = 0;
    u.guns.forEach((gun, i) => {
      if (gun.dead) return;
      const w = gunWorld(e, gun);
      if (gun.type === 'main') {
        mainsAlive++;
        // Slow traverse: fast flying outruns it.
        const aimSpeed = e.broad > 0 ? 65 * g.diff.speed : sp;
        aim(gun.pivot, clamp(leadAngle(g, w.wx, w.wy, aimSpeed, 0.5), 0.08, Math.PI - 0.08), true, dt, 0.8);
        setCharge(gun, e.broad > 0 ? 1 - e.broad / 1.1 : 0);
        e.gunT[i] -= dt;
        if (e.gunT[i] <= 0 && inRange && p.alive && e.broad <= 0) {
          fireMain(gun, 1, false);
          e.gunT[i] = rand(4.5, 6) / rate;
        }
      } else {
        aim(gun.pivot, clamp(e.aimAngle(w.wx, w.wy), 0.15, Math.PI - 0.15), true, dt, 3);
        e.gunT[i] -= dt;
        if (e.gunT[i] <= 0 && inRange && p.alive) {
          flakShot(g, w.mx, w.my, w.ang);
          e.gunT[i] = rand(1.3, 2) / rate;
        }
      }
    });
    // Broadside: every live turret glows, then all fire three-shell spreads together.
    e.broadT -= dt;
    if (e.broad > 0) {
      e.broad -= dt;
      if (e.broad <= 0) {
        for (const gun of u.guns) if (gun.type === 'main' && !gun.dead) fireMain(gun, 3, true);
        g.shake(0.6);
        e.broadT = rand(8, 10) / rate;
      }
    } else if (e.broadT <= 0 && inRange && p.alive && mainsAlive > 0) {
      e.broad = 1.1;
      g.audio.play('charge');
      g.ui.banner('BROADSIDE!', 1, 'danger');
    }
    // Enraged: cruise missiles leave the vertical launch cells one after another.
    if (phase2) {
      e.vlsT -= dt;
      if (e.vlsT <= 0 && inRange && p.alive) {
        e.vls = 3;
        e.vlsT = rand(6.5, 8.5) / rate;
        g.audio.play('lock');
      }
    }
    if (e.vls > 0) {
      e.vlsFire -= dt;
      if (e.vlsFire <= 0) {
        g.addEnemy('rocket', e.x - 11.3, e.y + 2.6, { heading: Math.PI / 2 + rand(-0.12, 0.12) });
        g.fx.muzzle(e.x - 11.3, e.y + 2.6, g.scroll);
        g.audio.play('missile');
        e.vls--;
        e.vlsFire = 0.3;
      }
    }
    for (const f of u.funnels) if (Math.random() < dt * 7) g.fx.funnelSmoke(e.x - f[0], e.y + f[1], 0);
    for (const pt of e.parts) {
      if (pt.dead && Math.random() < dt * 4) {
        const c = e.circles[pt.circle];
        g.fx.damageSmoke(e.x + c[0], e.y + c[1], 0, false);
      }
    }
    const aa = e.parts.slice(3).filter((pt) => !pt.dead).length;
    e.tag = `TURRETS ${mainsAlive}/3 · AA ${aa}/2`;
    if (phase2 && Math.random() < dt * 6) {
      const c = e.circles[5 + Math.floor(Math.random() * 7)];
      g.fx.damageSmoke(e.x + c[0], e.y + c[1] + 1, 0, true);
    }
  },
};

// Titan heavy gunship: an armoured flying tank. It shadows your altitude and hoses you
// with a chin minigun that sweeps toward you, but the gun overheats after a long burst
// and goes quiet while it cools. Rocket pods fire unguided ripples after a lock tone.
// The engines on the rear pylon are its weak spot.
KINDS.titan = {
  hp: 150, r: 3, score: 3500, credits: 350, air: true, boss: true, facing: 1, name: 'Titan Heavy Gunship',
  features: 'Armour, minigun, rocket pods',
  weakness: 'Engines, minigun overheats',
  enrage: 'TITAN: DOOR GUNNER OPENS FIRE',
  armor: { gun: 0.7, missile: 1.2 },
  // Engines (weak spot) first, then nose to tail.
  circles: [[-4.8, 3.05, 1.2, 1.8], [6.2, 0, 1.4], [3.6, 0, 1.6], [0.8, 0, 1.6], [-2.0, 0, 1.6], [-4.6, 0.6, 1.6]],
  build: () => createTitan(),
  init(e) {
    e.heat = 0;
    e.overheat = 0;
    e.fireT = 1.5;
    e.rocketT = 5;
    e.ripple = 0;
    e.rippleT = 0;
    e.doorT = 2;
    e.locked = false;
    e.vy = 0;
    e.vxRel = -10;
  },
  update(e, dt, g) {
    const u = e.obj.userData;
    const p = g.player;
    u.rotors[0].rotation.y += dt * 22;
    u.rotors[1].rotation.y -= dt * 22;
    const rel = e.x - g.camX;
    const want = clamp((g.halfW - 13 - rel) * 1.0, -(g.scroll - 3), 5);
    const prevVx = e.vxRel;
    e.vxRel += clamp(want - e.vxRel, -dt * 6, dt * 6);
    e.x += (g.scroll + e.vxRel) * dt;
    e.worldVx = g.scroll + e.vxRel;
    const ty = clamp(p.y, -6, g.halfH - 9);
    e.vy += (clamp((ty - e.y) * 0.8, -6, 6) - e.vy) * Math.min(1, dt * 1.5);
    e.y += e.vy * dt;
    // Nose down in proportion to forward speed, plus extra while accelerating.
    const accel = (e.vxRel - prevVx) / Math.max(dt, 1e-4);
    const pitch = clamp(-e.worldVx * 0.008 - accel * 0.02, -0.35, 0.1);
    e.obj.rotation.z += (pitch - e.obj.rotation.z) * Math.min(1, dt * 2);
    const phase2 = enraged(e, g);
    const rate = g.diff.rate * (phase2 ? 1.3 : 1);
    const inRange = rel < g.halfW - 3 && p.alive;
    // Chin minigun: tracks with a slow slew rate, fires 12 rounds/s along the barrel.
    const chin = u.guns[0];
    const sp = 30 * g.diff.speed;
    let w = gunWorld(e, chin);
    aim(chin.pivot, leadAngle(g, w.wx, w.wy, sp, 0.5) - e.obj.rotation.z, true, dt, phase2 ? 1.9 : 1.5);
    w = gunWorld(e, chin);
    if (e.overheat > 0) {
      e.overheat -= dt;
      if (Math.random() < dt * 20) g.fx.steam(w.mx, w.my);
      if (e.overheat <= 0) e.heat = 0;
    } else {
      e.fireT -= dt;
      const onTarget = Math.abs(angleDiff(w.ang, e.aimAngle(w.wx, w.wy))) < 0.5;
      if (e.fireT <= 0 && inRange && onTarget) {
        g.weapons.enemyBullet(w.mx, w.my, w.ang + rand(-0.035, 0.035), sp, 5);
        g.fx.muzzle(w.mx, w.my, g.scroll);
        e.heat += 1 / (phase2 ? 24 : 20);
        e.fireT = 1 / 12;
        if (e.heat >= 1) {
          // No text: the barrel glowing red is the tell.
          e.overheat = phase2 ? 1.6 : 2.2;
          g.audio.play('overheat');
        }
      } else if (!onTarget || !inRange) {
        e.heat = Math.max(0, e.heat - dt * 0.25);
      }
    }
    chin.heat.material.opacity = e.overheat > 0 ? 0.85 + 0.15 * Math.random() : e.heat * e.heat * 0.4;
    // Rocket pods: lock tone, then an unguided ripple aimed ahead of the player.
    e.rocketT -= dt;
    if (e.rocketT <= 0.6 && !e.locked && inRange) {
      e.locked = true;
      g.audio.play('lock');
    }
    if (e.rocketT <= 0 && inRange) {
      e.ripple = phase2 ? 9 : 5;
      e.rippleT = 0;
      e.rocketT = rand(6.5, 8.5) / rate;
      e.locked = false;
    }
    if (e.ripple > 0) {
      e.rippleT -= dt;
      if (e.rippleT <= 0) {
        const px = e.x + 2.9;
        const py = e.y - 0.95;
        const a = leadAngle(g, px, py, 30, 0.8) + rand(-0.08, 0.08);
        g.addEnemy('rocket', px, py, { heading: a, guided: false, speed: 30 });
        g.fx.muzzle(px, py, g.scroll);
        g.audio.play('missile');
        e.ripple--;
        e.rippleT = 0.09;
      }
    }
    // Enraged: the door gunner adds short aimed bursts.
    if (phase2) {
      const door = u.guns[1];
      const dw = gunWorld(e, door);
      const a = leadAngle(g, dw.wx, dw.wy, 24 * g.diff.speed, 0.7);
      aim(door.pivot, a - e.obj.rotation.z, true, dt, 4);
      e.doorT -= dt;
      if (e.doorT <= 0 && inRange) {
        for (let k = 0; k < 3; k++) g.weapons.enemyBullet(dw.mx, dw.my, a + (k - 1) * 0.05, 24 * g.diff.speed, 7);
        e.doorT = rand(1.2, 1.6) / rate;
      }
      if (Math.random() < dt * 8) g.fx.damageSmoke(e.x - 4.8, e.y + 3.2, 0, true);
    }
    e.tag = e.locked ? 'ROCKET LOCK' : '';
  },
};

// Enemy ace: a real flight model. It has a heading and airspeed in the world frame and
// can only turn and accelerate at finite rates, so every manoeuvre is a curve.
const ACE_TURN_ACCEL = 8; // rad/s^2: how fast the pilot can roll into or out of a turn
const ACE_SAFE_ALT = 7; // never aims lower than this above the ground
const ACE_PULL_SPEED = 28; // throttles back to this in a pull-out to tighten the turn
const ACE_MUZZLE = 44; // muzzle velocity of its cannon rounds
const ACE_GIMBAL = 0.16; // how far the guns can swivel off the nose
// How far the airframe reaches below its centre: the nose sticks down in a dive.
const aceBelly = (heading) => 1.2 + 3.8 * Math.abs(Math.sin(heading));

// One step of the ace's flight dynamics: the turn rate eases toward what is needed
// (proportional near the target, capped by the load limit a = v * omega <= 80, with a
// finite roll-in rate) instead of snapping, so the flight path is always a clean curve.
function aceSteer(st, want, turn, wantSpeed, dt) {
  const maxTurn = Math.min(turn, 80 / Math.max(st.speed, 1));
  const wantRate = clamp(angleDiff(want, st.heading) * 3, -maxTurn, maxTurn);
  st.turnRate += clamp(wantRate - st.turnRate, -dt * ACE_TURN_ACCEL, dt * ACE_TURN_ACCEL);
  st.heading = angleDiff(st.heading + st.turnRate * dt, 0);
  st.speed += clamp(wantSpeed - st.speed, -dt * 22, dt * 22);
}

const acePullWant = (heading) => (Math.cos(heading) >= 0 ? 0.7 : Math.PI - 0.7);

// Flies a full-effort pull-out from the ace's current state (heading, turn rate, speed)
// over the real terrain ahead and returns the tightest gap between its belly and the ground.
function acePullOutClearance(e, world) {
  const st = { heading: e.heading, turnRate: e.turnRate, speed: e.speed };
  const want = acePullWant(e.heading);
  let x = e.x;
  let y = e.y;
  let low = y - world.groundY(x) - aceBelly(st.heading);
  const step = 1 / 40;
  for (let t = 0; t < 2.5; t += step) {
    aceSteer(st, want, 3.2, ACE_PULL_SPEED, step);
    x += Math.cos(st.heading) * st.speed * step;
    y += Math.sin(st.heading) * st.speed * step;
    low = Math.min(low, y - world.groundY(x) - aceBelly(st.heading));
  }
  return low;
}

// Deflection shooting: the muzzle direction that makes a round (aircraft velocity plus
// muzzle velocity) meet a target moving at (tvx, tvy) in the camera frame.
function aceGunSolution(e, g, tx, ty, tvx, tvy) {
  const ax = Math.cos(e.heading) * e.speed - g.scroll;
  const ay = Math.sin(e.heading) * e.speed;
  let t = Math.hypot(tx - e.x, ty - e.y) / ACE_MUZZLE;
  let ux = 1;
  let uy = 0;
  let dist = 0;
  for (let i = 0; i < 3; i++) {
    const dx = tx + tvx * t - e.x;
    const dy = ty + tvy * t - e.y;
    dist = Math.hypot(dx, dy) || 1;
    const nx = dx / dist;
    const ny = dy / dist;
    // Cancel the aircraft's sideways drift relative to the line of fire.
    const along = ax * nx + ay * ny;
    const qx = -(ax - along * nx) / ACE_MUZZLE;
    const qy = -(ay - along * ny) / ACE_MUZZLE;
    const s = Math.sqrt(Math.max(0, 1 - qx * qx - qy * qy));
    ux = qx + s * nx;
    uy = qy + s * ny;
    t = dist / Math.max(10, along + ACE_MUZZLE * s);
  }
  return { heading: Math.atan2(uy, ux), dist };
}

// Crimson Ace: the fastest, most agile and most accurate boss, with the thinnest armour.
// It alternates gun runs (deflection shooting, so it leads you) with dive-bombing passes,
// fires heat-seekers when you are in front of it and pops flares to break your missile
// locks. After every attack it is slow and exposed while it recovers.
KINDS.ace = {
  hp: 80, r: 2, score: 3500, credits: 350, air: true, boss: true, headingModel: true, name: 'Crimson Ace',
  features: 'Fast, accurate, uses flares',
  weakness: 'Thin armour',
  enrage: 'CRIMSON ACE CALLED IN WINGMEN',
  armor: { gun: 1.2 },
  circles: [[0, 0, 1.9]],
  build: () => createAce(),
  init(e) {
    e.state = 'fly';
    e.stateT = 5;
    e.fireT = 1.5;
    e.missileT = 4;
    e.lockT = 0;
    e.heading = Math.PI;
    e.speed = 26;
    e.ram = 0;
    e.orbitT = 0;
    e.turnRate = 0;
    e.pullUp = false;
    e.aimRel = null;
    e.aimY = 0;
    e.aimVx = 0;
    e.aimVy = 0;
    e.attacks = 0;
    e.flares = 2;
    e.flareCd = 0;
    e.bombsLeft = 0;
    e.bombT = 0;
  },
  update(e, dt, g) {
    const p = g.player;
    const world = g.world;
    const wasPhase2 = !!e.phase2;
    const phase2 = enraged(e, g);
    if (phase2 && !wasPhase2) {
      e.flares += 2;
      for (let k = 0; k < 3; k++) g.addEnemy('fighter', g.camX + g.halfW + 5 + k * 4, 12 - k * 6, { amp: 2, speed: 12 });
    }
    const rate = g.diff.rate * (phase2 ? 1.3 : 1);
    // The pilot steers by a smoothed picture of the player (camera-relative, so the scroll
    // adds no lag), not every twitch of the player's stick; the guns use the true state.
    if (e.aimRel === null) {
      e.aimRel = p.x - g.camX;
      e.aimY = p.y;
    }
    const follow = 1 - Math.exp(-dt / 0.3);
    e.aimRel += (p.x - g.camX - e.aimRel) * follow;
    e.aimY += (p.y - e.aimY) * follow;
    e.aimVx += (p.vxRel - e.aimVx) * follow;
    e.aimVy += (p.vyRel - e.aimVy) * follow;
    const aimX = g.camX + e.aimRel;
    const aimY = Math.max(e.aimY, world.groundY(aimX) + ACE_SAFE_ALT);
    const steerSol = aceGunSolution(e, g, aimX, aimY, e.aimVx, e.aimVy);
    let want;
    let wantSpeed;
    let turn;
    e.stateT -= dt;
    if (e.state === 'fly') {
      // Chase a waypoint that orbits ahead of the player (it moves with the camera,
      // so lead it by the scroll speed).
      e.orbitT += dt * (phase2 ? 0.55 : 0.45);
      const tx = g.camX + g.halfW * 0.3 + Math.cos(e.orbitT) * g.halfW * 0.35;
      const ty = Math.max(4 + Math.sin(e.orbitT * 2) * Math.min(11, g.halfH - 9), world.groundY(tx) + 10);
      want = Math.atan2(ty - e.y, tx + g.scroll * 0.8 - e.x);
      wantSpeed = phase2 ? 34 : 30;
      turn = 2.0;
      if (e.stateT <= 0 && p.alive) {
        // Alternate gun runs and bombing passes (a bombing pass needs room above you).
        e.attacks++;
        if (e.attacks % 2 === 0 && p.y < g.halfH - 13) {
          e.state = 'bomb';
          e.stateT = 5;
          g.ui.banner('ACE IS LINING UP A BOMBING RUN!', 1, 'warn');
        } else {
          e.state = 'aim';
          e.stateT = 0.9;
          g.ui.banner('ACE IS DIVING AT YOU!', 1, 'warn');
        }
      }
    } else if (e.state === 'aim') {
      // Bleed a little speed and swing the nose onto the firing solution.
      want = steerSol.heading;
      wantSpeed = 26;
      turn = 2.8;
      if (e.stateT <= 0) {
        e.state = 'dash';
        e.stateT = 1.3;
        e.ram = 30;
      }
    } else if (e.state === 'dash') {
      // Full-throttle gun run with limited turning: committed, so it can be dodged.
      want = steerSol.heading;
      wantSpeed = 50;
      turn = 1.0;
      if (e.stateT <= 0) {
        e.state = 'recover';
        e.stateT = 1.4;
        e.ram = 0;
      }
    } else if (e.state === 'bomb') {
      // Climb to a point above where the player is heading and release over them.
      const tx = p.x + (g.scroll + p.vxRel) * 0.8;
      const ty = Math.min(g.halfH - 4, p.y + 12);
      want = Math.atan2(ty - e.y, tx - e.x);
      wantSpeed = 36;
      turn = 2.4;
      const vx = Math.cos(e.heading) * e.speed;
      const vy = Math.sin(e.heading) * e.speed;
      const drop = e.y - p.y;
      if (drop > 5 && e.bombsLeft === 0) {
        // Where would a bomb released now cross the player's altitude?
        const t = (vy + Math.sqrt(vy * vy + 60 * drop)) / 30;
        const miss = e.x + vx * t - (p.x + (g.scroll + p.vxRel) * t);
        if (Math.abs(miss) < 2.5) {
          e.bombsLeft = phase2 ? 3 : 2;
          e.bombT = 0;
          e.state = 'recover';
          e.stateT = 1.6;
        }
      }
      if (e.stateT <= 0) {
        e.state = 'fly';
        e.stateT = rand(3, 4.5) / rate;
      }
    } else {
      // Recovering: slow, level and predictable - the opening to punish it.
      want = Math.cos(e.heading) >= 0 ? 0.2 : Math.PI - 0.2;
      wantSpeed = 22;
      turn = 1.2;
      if (e.stateT <= 0) {
        e.state = 'fly';
        e.stateT = rand(4, 6) / rate;
      }
    }
    e.weak[0] = e.state === 'recover' ? 1.5 : 1;
    // Stay in the arena: if it wanders off, turn back toward the middle of the screen.
    const rel = e.x - g.camX;
    if (rel < -g.halfW - 10 || rel > g.halfW + 12 || e.y > g.halfH + 4) {
      want = Math.atan2(4 - e.y, g.camX + g.scroll * 0.8 - e.x);
      turn = 2.6;
    }
    // Terrain avoidance: the pull-out radius grows with speed, so rather than a fixed floor,
    // rehearse a full-effort pull-out from the current state every frame and commit to it
    // as soon as that would only just clear the ground ahead. Keep pulling until climbing
    // with room to spare, so it doesn't flip back and forth at the limit.
    const clearance = acePullOutClearance(e, world);
    e.pullUp = e.pullUp ? clearance < 6 || Math.sin(e.heading) < 0.1 : clearance < 3;
    if (e.pullUp) {
      want = acePullWant(e.heading);
      turn = 3.2;
      wantSpeed = Math.min(wantSpeed, ACE_PULL_SPEED);
      if (e.state === 'dash' || e.state === 'aim') {
        e.state = 'recover';
        e.stateT = 1.2;
        e.ram = 0;
      }
    }
    aceSteer(e, want, turn, wantSpeed, dt);
    const vx = Math.cos(e.heading) * e.speed;
    const vy = Math.sin(e.heading) * e.speed;
    e.x += vx * dt;
    e.y += vy * dt;
    // Last resort only (the pull-out above should always win): never sink into the terrain.
    e.y = Math.max(e.y, world.groundY(e.x) + aceBelly(e.heading));
    e.vy = vy;
    e.worldVx = vx;
    e.obj.rotation.z = e.heading;
    // Bank into turns.
    const roll = clamp(-e.turnRate * 0.45, -1.3, 1.3);
    e.obj.rotation.x += (roll - e.obj.rotation.x) * Math.min(1, dt * 5);
    e.obj.userData.flame.scale.x = 0.9 + (e.speed - 20) / 25 + Math.random() * 0.3;
    if (e.state === 'dash' && Math.random() < 0.7) g.fx.exhaust(e.x - Math.cos(e.heading) * 3, e.y - Math.sin(e.heading) * 3, vx * 0.5, vy * 0.5, 1.2);
    // Guns: a true deflection shot on the player's real position and velocity. The guns
    // swivel a little off the nose, so it fires as soon as the solution is that close.
    e.fireT -= dt;
    const sol = aceGunSolution(e, g, p.x, p.y, p.vxRel, p.vyRel);
    const off = angleDiff(sol.heading, e.heading);
    const cone = e.state === 'dash' || e.state === 'aim' ? ACE_GIMBAL + 0.12 : ACE_GIMBAL;
    if (e.fireT <= 0 && p.alive && e.onScreen(1) && Math.abs(off) < cone && sol.dist < 55) {
      const h = e.heading + clamp(off, -ACE_GIMBAL, ACE_GIMBAL);
      const muzzle = ACE_MUZZLE * Math.min(1.2, g.diff.speed);
      for (let k = -1; k <= 1; k++) {
        const hk = h + k * 0.02;
        // Round velocity = aircraft velocity + muzzle velocity, expressed in the camera frame.
        const rvx = vx + Math.cos(hk) * muzzle - g.scroll;
        const rvy = vy + Math.sin(hk) * muzzle;
        g.weapons.enemyBullet(e.x + Math.cos(hk) * 2.6, e.y + Math.sin(hk) * 2.6, Math.atan2(rvy, rvx), Math.hypot(rvx, rvy), 7);
      }
      e.fireT = (e.state === 'dash' ? 0.16 : 0.45) / rate;
    }
    // Bombs: released in a short stick over the player.
    if (e.bombsLeft > 0) {
      e.bombT -= dt;
      if (e.bombT <= 0) {
        g.weapons.enemyBomb(e.x, e.y - 1.2, vx, vy - 1, { scale: 1.3, radius: 3.5, damage: 12 });
        e.bombsLeft--;
        e.bombT = 0.14;
      }
    }
    // Heat-seekers: a lock tone when you are in front of it, then the launch.
    e.missileT -= dt;
    if (e.lockT > 0) {
      e.lockT -= dt;
      if (e.lockT <= 0) {
        const n = phase2 ? 2 : 1;
        for (let k = 0; k < n; k++) {
          const side = n === 1 ? 0 : k * 2 - 1;
          g.addEnemy('rocket', e.x - Math.sin(e.heading) * side * 0.8, e.y - 0.8, { heading: e.heading + side * 0.2 });
        }
        g.audio.play('missile');
        e.missileT = rand(5.5, 7.5) / rate;
      }
    } else if (e.missileT <= 0 && p.alive && e.onScreen(0)) {
      const d = Math.hypot(p.x - e.x, p.y - e.y);
      if (d > 12 && d < 50 && Math.abs(angleDiff(e.aimAngle(e.x, e.y), e.heading)) < 1.0) {
        e.lockT = 0.7;
        g.audio.play('lock');
      } else e.missileT = 0.4;
    }
    // Flares: when one of your missiles closes in, it fires a fan of flares and your
    // missiles chase those instead. Limited supply.
    e.flareCd -= dt;
    if (e.flares > 0 && e.flareCd <= 0) {
      const threats = g.weapons.missiles.filter((m) => m.target === e && Math.hypot(m.x - e.x, m.y - e.y) < 16);
      if (threats.length) {
        const decoys = [];
        for (let k = 0; k < 4; k++) {
          decoys.push(g.weapons.flare(e.x - Math.cos(e.heading) * 2, e.y - Math.sin(e.heading) * 2, vx * 0.35 + rand(-6, 6), vy * 0.35 + rand(2, 7)));
        }
        for (const m of g.weapons.missiles) {
          if (m.target === e) m.target = decoys[Math.floor(Math.random() * decoys.length)];
        }
        e.flares--;
        e.flareCd = 1.5;
        g.audio.play('flare');
        g.ui.popup(e.x, e.y + 2, 'FLARES!', 'armor');
      }
    }
    e.tag = e.lockT > 0 ? 'MISSILE LOCK' : e.state === 'recover' ? `RECOVERING · FLARES ${e.flares}` : `FLARES ${e.flares}`;
  },
};

// Nightwing stealth bomber: carpet-bombing passes across the screen in alternating
// directions, turning around off-screen. Stealthy, so player missiles cannot lock on
// until the bomb bay opens over the player, which also exposes the bay as a weak spot.
// It has no guns: it defends itself with missiles, and more of them if you sit above it.
KINDS.nightwing = {
  hp: 170, r: 4, score: 4000, credits: 400, air: true, boss: true, facing: -1, name: 'Nightwing Stealth Bomber',
  features: 'Stealth, carpet bombing',
  weakness: 'Open bomb bay',
  enrage: 'NIGHTWING: CLUSTER BOMBS ARMED',
  armor: { gun: 0.85 },
  // Bomb bay (weak spot while open) first, then centre body and wings.
  circles: [[0.6, 0, 1.6], [-4, 0, 2.2], [0, 0, 2.8], [2.5, 4.5, 2.2], [2.5, -4.5, 2.2], [4.5, 8, 1.8], [4.5, -8, 1.8]],
  build: () => createNightwing(),
  init(e, o, g) {
    e.dir = -1; // travel direction over the ground
    e.facing = -1;
    e.state = 'pass';
    e.y = g.halfH - 10;
    e.targetY = e.y;
    e.bombT = 0.3;
    e.missileT = 3;
    e.passes = 0;
    e.vxWorld = -12;
    e.vy = 0;
    e.yaw = 0;
    e.bay = 0;
    e.stealth = true;
    e.baseCircles = e.circles.map((c) => c.slice());
  },
  update(e, dt, g) {
    const p = g.player;
    const u = e.obj.userData;
    const phase2 = enraged(e, g);
    const rate = g.diff.rate * (phase2 ? 1.3 : 1);
    for (const f of u.glows) f.scale.x = 0.8 + Math.random() * 0.4;
    const cruise = (phase2 ? 16 : 12) * g.diff.speed;
    // Passes right-to-left fly at -cruise over the ground; left-to-right runs must beat the
    // scroll speed to overtake the player, so they fly at scroll + cruise.
    const wantVx = e.dir < 0 ? -cruise : g.scroll + cruise;
    e.vxWorld += clamp(wantVx - e.vxWorld, -dt * 18, dt * 18);
    e.vy += (clamp((e.targetY - e.y) * 0.8, -6, 6) + Math.sin(e.age * 1.5) * 1.2 - e.vy) * Math.min(1, dt * 1.5);
    e.x += e.vxWorld * dt;
    e.y += e.vy * dt;
    e.worldVx = e.vxWorld;
    // Face the direction of travel (yaw turns while off-screen), pitch with the climb angle.
    const face = e.vxWorld >= 0 ? 1 : -1;
    e.facing = face;
    e.yaw += clamp((face > 0 ? Math.PI : 0) - e.yaw, -dt * 2, dt * 2);
    e.obj.rotation.y = e.yaw;
    // Pitch is applied in model space (nose at local -X) before the yaw, so it is the
    // same sign whichever way the wing is facing.
    e.obj.rotation.z = -Math.atan2(e.vy, Math.max(4, Math.abs(e.vxWorld))) * 0.8;
    // Hitboxes follow the model's orientation.
    const flip = Math.cos(e.yaw) >= 0 ? 1 : -1;
    e.circles.forEach((c, i) => {
      c[0] = e.baseCircles[i][0] * flip;
    });
    const rel = e.x - g.camX;
    const onScreen = Math.abs(rel) < g.halfW + 4;
    // Bombs keep the bomber's speed as they fall, so it must release them before it is
    // over the player. Predict where a bomb dropped now would cross the player's height
    // and carpet-bomb while that point is near the player. The bay opens a little earlier.
    const drop = e.y - 0.6 - p.y;
    const hit = drop > 2 ? bombImpact(e.x + e.circles[0][0], e.y - 0.6, e.vxWorld, e.vy - 1, p.y) : null;
    // The player keeps moving with the scroll (and its own speed) while the bomb falls.
    const miss = hit ? Math.abs(hit.x - (p.x + (g.scroll + p.vxRel) * hit.t)) : Infinity;
    const bombing = e.state === 'pass' && onScreen && p.alive && hit !== null;
    e.bay = clamp(e.bay + (bombing && miss < 24 ? dt * 3 : -dt * 2), 0, 1);
    e.stealth = e.bay < 0.5;
    e.weak[0] = e.bay > 0.5 ? 2 : 1;
    for (const d of u.doors) d.mesh.position.z = d.side * (0.46 + 0.9 * e.bay);
    u.bayLight.material.opacity = e.bay * (0.75 + Math.random() * 0.2);
    if (e.bay >= 1 && bombing && miss < 12) {
      e.bombT -= dt;
      if (e.bombT <= 0) {
        // Released bombs keep the bomber's velocity, then fall under gravity.
        const bx = e.x + e.circles[0][0];
        if (phase2) g.weapons.enemyBomb(bx, e.y - 0.6, e.vxWorld, e.vy - 1, { cluster: true, scale: 1.9, radius: 4, damage: 12 });
        else g.weapons.enemyBomb(bx, e.y - 0.6, e.vxWorld, e.vy - 1, { scale: 1.9, radius: 4.5, damage: 13 });
        e.bombT = (phase2 ? 0.36 : 0.22) / g.diff.rate;
      }
    }
    // Missiles from the dorsal hatches; a pair, and sooner, if you sit above it.
    e.missileT -= dt;
    if (e.missileT <= 0 && onScreen && p.alive) {
      const above = p.y > e.y + 2;
      const n = above || phase2 ? 2 : 1;
      const a = e.aimAngle(e.x, e.y + 1);
      for (let k = 0; k < n; k++) g.addEnemy('rocket', e.x, e.y + 1, { heading: a + (k - (n - 1) / 2) * 0.35 });
      g.audio.play('missile');
      e.missileT = (above ? rand(2.4, 3.2) : rand(4, 5)) / rate;
    }
    if (e.state === 'pass') {
      // Once clear of the screen, turn around for the next run.
      if ((e.dir < 0 && rel < -g.halfW - 16) || (e.dir > 0 && rel > g.halfW + 16)) {
        e.state = 'turn';
        e.dir = -e.dir;
        e.passes++;
        e.targetY = e.passes % 2 ? rand(-2, 6) : g.halfH - 10;
      }
    } else if (Math.abs(rel) < g.halfW + 2) {
      e.state = 'pass';
      g.ui.banner('NIGHTWING INBOUND', 1.2, 'warn');
    }
    e.tag = e.stealth ? 'STEALTH: NO MISSILE LOCK' : 'BAY OPEN: LOCK ON';
    if (phase2 && Math.random() < dt * 8) g.fx.damageSmoke(e.x, e.y, 0, true);
  },
};

export const BOSS_NAMES = Object.fromEntries(Object.entries(KINDS).filter(([, d]) => d.boss).map(([k, d]) => [k, d.name]));
export const BOSS_INFO = Object.fromEntries(Object.entries(KINDS).filter(([, d]) => d.boss).map(([k, d]) => [k, { features: d.features, weakness: d.weakness }]));

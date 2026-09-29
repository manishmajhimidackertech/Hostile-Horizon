// Enemy roster. All positions are world units; `rel` values are relative to the camera,
// which scrolls right at game.scroll units/second.
import {
  MAT, createFighter, createDart, createHelicopter, createTank, createFlak,
  createBomber, createAirship, createMissile, createGunboat, createAAShip, createMeteor,
  createTitan, createBehemoth, createDreadnought, createAce, createNightwing, createWatchtower,
} from './models.js';

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

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

  hitTest(x, y, r) {
    for (const c of this.circles) {
      const dx = x - (this.x + c[0]);
      const dy = y - (this.y + c[1]);
      const rr = r + c[2];
      if (dx * dx + dy * dy < rr * rr) return true;
    }
    return false;
  }

  // Squared distance from a point to the nearest hit circle edge (for splash damage).
  distanceTo(x, y) {
    let best = Infinity;
    for (const c of this.circles) {
      const d = Math.hypot(x - (this.x + c[0]), y - (this.y + c[1])) - c[2];
      if (d < best) best = d;
    }
    return Math.max(0, best);
  }

  damage(amount) {
    if (this.dead || this.dying > 0) return;
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
      this.def.update(this, dt, g);
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

  // Homing rocket fired by gunships and bosses. Can be shot down.
  rocket: {
    hp: 1, r: 0.7, score: 25, credits: 0, air: true, ram: 16, noDrop: true,
    build: () => createMissile(true),
    init(e, o, g) {
      e.heading = o.heading ?? Math.PI;
      e.speed = 10;
      e.life = 6;
      e.obj.rotation.z = e.heading;
    },
    update(e, dt, g) {
      e.life -= dt;
      if (e.age < 2.6 && g.player.alive) {
        e.heading = turnToward(e.heading, Math.atan2(g.player.y - e.y, g.player.x - e.x), dt * 1.7);
      }
      e.speed = Math.min(24 * g.diff.speed, e.speed + dt * 18);
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

  // Heavy bomber. Flies ahead of the player in the same direction; rear gunners fire back.
  bomber: {
    hp: 90, r: 3, score: 2500, credits: 250, air: true, boss: true, facing: 1, name: 'B-9 Stratofortress',
    circles: [[5, 0, 1.8], [2, 0, 1.9], [-1, 0, 1.8], [-4, 0.4, 1.6], [-0.5, -0.5, 2.4]],
    build: () => createBomber(),
    init(e) {
      e.baseY = 8;
      e.patternT = 4;
      e.turretT = [1.0, 1.6];
      e.vxRel = -10;
    },
    update(e, dt, g) {
      const rel = e.x - g.camX;
      // Ease toward station ahead of the player, never slower than 3 u/s over the ground.
      const want = clamp((g.halfW - 12 - rel) * 1.0, -(g.scroll - 3), 5);
      e.vxRel += clamp(want - e.vxRel, -dt * 6, dt * 6);
      e.x += (g.scroll + e.vxRel) * dt;
      e.worldVx = g.scroll + e.vxRel;
      const ny = e.baseY + Math.sin(e.age * 0.5) * 7;
      e.vy = (ny - e.y) / Math.max(dt, 1e-4);
      e.y = ny;
      e.obj.rotation.z = Math.atan2(e.vy, Math.max(4, e.worldVx)) * 0.8;
      const turrets = e.obj.userData.turrets;
      const enraged = e.hp < e.maxHp * 0.4;
      turrets.forEach((t, i) => {
        const wx = e.x + t.group.position.x;
        const wy = e.y + t.group.position.y * 0.95;
        aim(t.pivot, e.aimAngle(wx, wy), false, dt, 3);
        e.turretT[i] -= dt;
        if (e.turretT[i] <= 0 && g.player.alive && rel < g.halfW - 4) {
          const a = e.aimAngle(wx, wy);
          const n = enraged ? 3 : 2;
          for (let k = 0; k < n; k++) g.weapons.enemyBullet(wx, wy, a + (k - (n - 1) / 2) * 0.12, 21 * g.diff.speed, 9);
          e.turretT[i] = rand(1.1, 1.7) / g.diff.rate;
        }
      });
      e.patternT -= dt;
      if (e.patternT <= 0 && rel < g.halfW - 4) {
        const n = enraged ? 3 : 2;
        const a = e.aimAngle(e.x - 2, e.y - 1.5);
        for (let k = 0; k < n; k++) g.addEnemy('rocket', e.x - 2, e.y - 1.5, { heading: a + (k - (n - 1) / 2) * 0.5 });
        g.audio.play('missile');
        e.patternT = rand(4.5, 6.5) / g.diff.rate;
      }
      if (enraged && Math.random() < dt * 8) g.fx.damageSmoke(e.x + rand(-3, 3), e.y, 0, true);
    },
  },

  // Armoured airship cruising ahead of the player.
  airship: {
    hp: 260, r: 5, score: 6000, credits: 600, air: true, boss: true, facing: 1, name: 'Leviathan Airship',
    circles: [[11, 0, 3.4], [6, 0, 4.3], [0, 0, 4.6], [-6, 0, 4.3], [-11, 0, 3.4], [1, -5.4, 2.4]],
    build: () => createAirship(),
    init(e, o, g) {
      e.baseY = 6;
      e.turretT = [1, 1.5, 2, 2.5];
      e.patternT = 3;
      e.pattern = 0;
      e.barrage = 0;
      e.barrageT = 0;
      e.vxRel = -8;
    },
    update(e, dt, g) {
      const rel = e.x - g.camX;
      const target = g.halfW - 22;
      // Heavy and slow to change speed; always cruising forward over the ground.
      const want = clamp((target - rel) * 0.8, -(g.scroll - 3), 4);
      e.vxRel += clamp(want - e.vxRel, -dt * 3, dt * 3);
      e.x += (g.scroll + e.vxRel) * dt;
      e.worldVx = g.scroll + e.vxRel;
      const ny = e.baseY + Math.sin(e.age * 0.35) * 4;
      e.vy = (ny - e.y) / Math.max(dt, 1e-4);
      e.y = ny;
      e.obj.rotation.z = Math.sin(e.age * 0.5) * 0.04;
      for (const p of e.obj.userData.props) p.rotation.x += dt * 18;
      const phase2 = e.hp < e.maxHp * 0.5;
      const rate = g.diff.rate * (phase2 ? 1.4 : 1);
      const inRange = rel < g.halfW - 2;
      e.obj.userData.turrets.forEach((t, i) => {
        const wx = e.x - t.group.position.x; // model is mirrored to face +X
        const wy = e.y + t.group.position.y;
        const a = e.aimAngle(wx, wy);
        aim(t.pivot, a, true, dt, 3);
        e.turretT[i] -= dt;
        if (e.turretT[i] <= 0 && inRange && g.player.alive) {
          g.weapons.enemyBullet(wx + Math.cos(a) * 2, wy + Math.sin(a) * 2, a, 20 * g.diff.speed, 9);
          e.turretT[i] = rand(1.3, 2.2) / rate;
        }
      });
      e.patternT -= dt;
      if (e.patternT <= 0 && inRange && g.player.alive) {
        const gx = e.x + 1;
        const gy = e.y - 6;
        if (e.pattern % 3 === 0) {
          const n = phase2 ? 13 : 9;
          for (let k = 0; k < n; k++) {
            g.weapons.enemyBullet(gx, gy, Math.PI * 0.55 + (k / (n - 1)) * Math.PI * 0.9, 15 * g.diff.speed, 9);
          }
          g.audio.play('enemyShoot');
        } else if (e.pattern % 3 === 1) {
          const n = phase2 ? 4 : 3;
          for (let k = 0; k < n; k++) g.addEnemy('rocket', e.x - 4, e.y - 3, { heading: Math.PI * 0.75 + k * 0.25 });
          g.audio.play('missile');
        } else {
          e.barrage = phase2 ? 14 : 9;
        }
        e.pattern++;
        e.patternT = rand(3.5, 5) / rate;
      }
      if (e.barrage > 0) {
        e.barrageT -= dt;
        if (e.barrageT <= 0) {
          const a = e.aimAngle(e.x + 7.5, e.y - 5.5);
          g.weapons.enemyBullet(e.x + 7.5, e.y - 5.5, a + rand(-0.05, 0.05), 26 * g.diff.speed, 7);
          g.audio.play('enemyShoot');
          e.barrage--;
          e.barrageT = 0.1;
        }
      }
      if (phase2 && Math.random() < dt * 10) {
        const c = e.circles[Math.floor(Math.random() * 5)];
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

// Shared logic for ground/naval fortress bosses: hold position on the right,
// aim every gun at the player, big shells from main guns and fused flak from the rest.
function fortressUpdate(e, dt, g, cfg) {
  const rel = e.x - g.camX;
  // Drives forward (facing +X) and never reverses over the ground; accelerates gradually.
  const want = clamp((g.halfW - cfg.hold - rel) * 0.8, -(g.scroll - 3), 4);
  e.vxRel += clamp(want - e.vxRel, -dt * 5, dt * 5);
  e.x += (g.scroll + e.vxRel) * dt;
  e.worldVx = g.scroll + e.vxRel;
  if (e.def.naval) e.y = g.world.groundY(e.x);
  else followGround(e, dt, g, 6);
  const phase2 = e.hp < e.maxHp * 0.5;
  const rate = g.diff.rate * (phase2 ? 1.35 : 1);
  const inRange = rel < g.halfW - 1;
  const p = g.player;
  e.obj.userData.guns.forEach((gun, i) => {
    const wx = e.x - gun.pos[0]; // model is mirrored to face +X
    const wy = e.y + gun.pos[1];
    const a = clamp(e.aimAngle(wx, wy), 0.12, Math.PI - 0.12);
    aim(gun.pivot, a, true, dt, gun.type === 'main' ? 1.5 : 3);
    e.gunT[i] -= dt;
    if (e.gunT[i] > 0 || !inRange || !p.alive) return;
    const ang = Math.PI - gun.pivot.rotation.z;
    const mx = wx + Math.cos(ang) * 2.5;
    const my = wy + Math.sin(ang) * 2.5;
    if (gun.type === 'main') {
      const shots = phase2 ? 3 : 1;
      for (let k = 0; k < shots; k++) g.weapons.enemyBullet(mx, my, ang + (k - (shots - 1) / 2) * 0.1, 23 * g.diff.speed, 16, { big: true });
      g.fx.muzzle(mx, my, 0);
      g.shake(0.15);
      e.gunT[i] = rand(2.2, 3.2) / rate;
    } else {
      const speed = 26 * g.diff.speed;
      const dist = Math.hypot(p.x - mx, p.y - my);
      g.weapons.enemyBullet(mx, my, ang, speed, 12, { fuse: dist / speed + rand(-0.1, 0.12), flak: true });
      g.audio.play('flak');
      e.gunT[i] = rand(1.4, 2.2) / rate;
    }
  });
  e.missileT -= dt;
  if (e.missileT <= 0 && inRange) {
    const n = phase2 ? 4 : 2;
    for (let k = 0; k < n; k++) g.addEnemy('rocket', e.x - cfg.rack[0], e.y + cfg.rack[1], { heading: Math.PI * 0.5 + 0.35 + k * 0.18 });
    g.audio.play('missile');
    e.missileT = rand(5, 7) / rate;
  }
  if (phase2 && Math.random() < dt * 8) {
    const c = e.circles[Math.floor(Math.random() * e.circles.length)];
    g.fx.damageSmoke(e.x + c[0], e.y + c[1] + 1, 0, true);
  }
}

// Heavy twin-rotor gunship.
KINDS.titan = {
  hp: 140, r: 3, score: 3500, credits: 350, air: true, boss: true, facing: 1, name: 'Titan Heavy Gunship',
  circles: [[4.5, 0, 2.2], [1, 0, 2.2], [-2.5, 0.3, 2.2], [-5, 1.2, 2]],
  build: () => createTitan(),
  init(e) {
    e.burst = 0;
    e.gunT = 1.5;
    e.rocketT = 4;
    e.fanT = 6;
    e.vy = 0;
    e.vxRel = -10;
  },
  update(e, dt, g) {
    const u = e.obj.userData;
    u.rotors[0].rotation.y += dt * 22;
    u.rotors[1].rotation.y -= dt * 22;
    const rel = e.x - g.camX;
    const want = clamp((g.halfW - 13 - rel) * 1.0, -(g.scroll - 3), 5);
    const prevVx = e.vxRel;
    e.vxRel += clamp(want - e.vxRel, -dt * 6, dt * 6);
    e.x += (g.scroll + e.vxRel) * dt;
    e.worldVx = g.scroll + e.vxRel;
    const ty = clamp(g.player.y, -6, g.halfH - 9);
    e.vy += (clamp((ty - e.y) * 0.8, -6, 6) - e.vy) * Math.min(1, dt * 1.5);
    e.y += e.vy * dt;
    // Nose down in proportion to forward speed, plus extra while accelerating.
    const accel = (e.vxRel - prevVx) / Math.max(dt, 1e-4);
    const pitch = clamp(-e.worldVx * 0.008 - accel * 0.02, -0.35, 0.1);
    e.obj.rotation.z += (pitch - e.obj.rotation.z) * Math.min(1, dt * 2);
    const phase2 = e.hp < e.maxHp * 0.5;
    const rate = g.diff.rate * (phase2 ? 1.4 : 1);
    const inRange = rel < g.halfW - 3 && g.player.alive;
    const gun = u.guns[0];
    const gx = e.x - gun.pos[0]; // model is mirrored to face +X
    const gy = e.y + gun.pos[1];
    aim(gun.pivot, e.aimAngle(gx, gy), true, dt, 5);
    e.gunT -= dt;
    if (e.gunT <= 0 && inRange) {
      if (e.burst <= 0) e.burst = phase2 ? 14 : 10;
      g.weapons.enemyBullet(gx, gy, e.aimAngle(gx, gy) + rand(-0.08, 0.08), 30 * g.diff.speed, 6);
      e.burst--;
      e.gunT = e.burst > 0 ? 0.08 : rand(1.8, 2.6) / rate;
    }
    e.rocketT -= dt;
    if (e.rocketT <= 0 && inRange) {
      const n = phase2 ? 8 : 6;
      const a = e.aimAngle(e.x - 0.3, e.y - 1);
      for (let k = 0; k < n; k++) g.addEnemy('rocket', e.x - 0.3, e.y - 1 + (k % 2 ? 0.5 : -0.5), { heading: a + (k - (n - 1) / 2) * 0.12 });
      g.audio.play('missile');
      e.rocketT = rand(5, 7) / rate;
    }
    if (phase2) {
      e.fanT -= dt;
      if (e.fanT <= 0 && inRange) {
        for (let k = 0; k < 9; k++) g.weapons.enemyBullet(e.x + 3, e.y - 1, Math.PI * 0.7 + k * 0.075, 17 * g.diff.speed, 8);
        e.fanT = rand(3, 4);
      }
      if (Math.random() < dt * 8) g.fx.damageSmoke(e.x + rand(-4, 4), e.y + 1, 0, true);
    }
  },
};

// Land fortress super-tank.
KINDS.behemoth = {
  hp: 200, r: 4, score: 4000, credits: 400, air: false, boss: true, facing: 1, name: 'Behemoth Land Fortress',
  circles: [[5, 2, 2.4], [1.5, 2.5, 2.6], [-2.5, 2.5, 2.6], [-5.5, 2.2, 2.4], [-0.5, 4.8, 2.2]],
  build: () => createBehemoth(),
  init(e, o, g) {
    e.y = g.world.groundY(e.x);
    e.gunT = [2, 1.2, 1.8];
    e.missileT = 5;
    e.vxRel = -10;
  },
  update(e, dt, g) {
    fortressUpdate(e, dt, g, { hold: 14, rack: [5.4, 5.6] });
  },
};

// Battleship: the naval fortress.
KINDS.dreadnought = {
  hp: 240, r: 5, score: 4500, credits: 450, air: false, boss: true, naval: true, facing: 1, wakeX: -11,
  name: 'Dreadnought Battleship',
  circles: [[9, 1, 2.2], [5, 1.2, 2.6], [1, 1.5, 2.8], [-3, 1.5, 2.8], [-7, 1.2, 2.6], [-0.5, 5.5, 2.2]],
  build: () => createDreadnought(),
  init(e, o, g) {
    e.y = g.world.groundY(e.x);
    e.gunT = [2.5, 1.5, 3.2, 1.0, 1.8];
    e.missileT = 6;
    e.vxRel = -10;
  },
  update(e, dt, g) {
    fortressUpdate(e, dt, g, { hold: 18, rack: [5.4, 3.5] });
  },
};

// Enemy ace: a real flight model. It has a heading and airspeed in the world frame and
// can only turn and accelerate at finite rates, so every manoeuvre is a curve. It orbits
// ahead of the player, lines up, dives in with guns firing along its nose, then pulls out.
KINDS.ace = {
  hp: 75, r: 2, score: 3500, credits: 350, air: true, boss: true, headingModel: true, name: 'Crimson Ace',
  circles: [[0, 0, 1.9]],
  build: () => createAce(),
  init(e) {
    e.state = 'fly';
    e.stateT = 6;
    e.fireT = 1.5;
    e.missileT = 5;
    e.heading = Math.PI;
    e.speed = 26;
    e.wingmen = false;
    e.ram = 0;
    e.orbitT = 0;
  },
  update(e, dt, g) {
    const p = g.player;
    const phase2 = e.hp < e.maxHp * 0.5;
    const rate = g.diff.rate * (phase2 ? 1.3 : 1);
    let want;
    let wantSpeed;
    let turn;
    if (e.state === 'fly') {
      // Chase a waypoint that orbits ahead of the player (it moves with the camera,
      // so lead it by the scroll speed).
      e.orbitT += dt * (phase2 ? 0.55 : 0.45);
      const tx = g.camX + g.halfW * 0.3 + Math.cos(e.orbitT) * g.halfW * 0.35;
      const ty = 4 + Math.sin(e.orbitT * 2) * Math.min(11, g.halfH - 9);
      want = Math.atan2(ty - e.y, tx + g.scroll * 0.8 - e.x);
      wantSpeed = phase2 ? 34 : 30;
      turn = 2.0;
      e.stateT -= dt;
      if (e.stateT <= 0 && p.alive) {
        e.state = 'aim';
        e.stateT = 1.0;
        g.ui.banner('ACE IS DIVING AT YOU!', 1, 'warn');
      }
    } else if (e.state === 'aim') {
      // Bleed a little speed and swing the nose onto the player.
      want = Math.atan2(p.y - e.y, p.x + g.scroll * 0.4 - e.x);
      wantSpeed = 24;
      turn = 2.6;
      e.stateT -= dt;
      if (e.stateT <= 0) {
        e.state = 'dash';
        e.stateT = 1.3;
        e.ram = 30;
      }
    } else {
      // Full-throttle attack run with limited turning: committed, so it can be dodged.
      want = Math.atan2(p.y - e.y, p.x + g.scroll * 0.3 - e.x);
      wantSpeed = 52;
      turn = 0.8;
      e.stateT -= dt;
      if (e.stateT <= 0) {
        e.state = 'fly';
        e.stateT = rand(5, 7) / rate;
        e.ram = 0;
      }
    }
    // Stay in the arena: if it wanders off, turn back toward the middle of the screen.
    const rel = e.x - g.camX;
    if (rel < -g.halfW - 10 || rel > g.halfW + 12 || e.y > g.halfH + 4) {
      want = Math.atan2(4 - e.y, g.camX + g.scroll * 0.8 - e.x);
      turn = 2.6;
    }
    // Pull up before the ground (earlier when fast, since turning radius grows with speed).
    const floor = g.world.groundY(e.x) + 6 + e.speed * 0.2;
    if (e.y < floor) {
      want = Math.cos(e.heading) >= 0 ? 0.8 : Math.PI - 0.8;
      turn = 3.2;
    }
    // Turn rate is limited by the load the airframe can take: a = v * omega <= 80.
    turn = Math.min(turn, 80 / Math.max(e.speed, 1));
    const prev = e.heading;
    e.heading = turnToward(e.heading, want, dt * turn);
    const yawRate = angleDiff(e.heading, prev) / Math.max(dt, 1e-4);
    e.speed += clamp(wantSpeed - e.speed, -dt * 22, dt * 22);
    const vx = Math.cos(e.heading) * e.speed;
    const vy = Math.sin(e.heading) * e.speed;
    e.x += vx * dt;
    e.y += vy * dt;
    e.vy = vy;
    e.worldVx = vx;
    e.obj.rotation.z = e.heading;
    // Bank into turns.
    const roll = clamp(-yawRate * 0.45, -1.3, 1.3);
    e.obj.rotation.x += (roll - e.obj.rotation.x) * Math.min(1, dt * 5);
    e.obj.userData.flame.scale.x = 0.9 + (e.speed - 20) / 25 + Math.random() * 0.3;
    if (e.state === 'dash' && Math.random() < 0.7) g.fx.exhaust(e.x - Math.cos(e.heading) * 3, e.y - Math.sin(e.heading) * 3, vx * 0.5, vy * 0.5, 1.2);
    // Fixed forward guns: only fire when the player is in front of the nose.
    e.fireT -= dt;
    const offNose = Math.abs(angleDiff(e.aimAngle(e.x, e.y), e.heading));
    if (e.fireT <= 0 && p.alive && e.onScreen(1) && offNose < 0.4) {
      const muzzle = 36;
      for (let k = 0; k < 3; k++) {
        const h = e.heading + (k - 1) * 0.05;
        // Round velocity = aircraft velocity + muzzle velocity, expressed in the camera frame.
        const rvx = vx + Math.cos(h) * muzzle - g.scroll;
        const rvy = vy + Math.sin(h) * muzzle;
        g.weapons.enemyBullet(e.x + Math.cos(h) * 2.6, e.y + Math.sin(h) * 2.6, Math.atan2(rvy, rvx), Math.hypot(rvx, rvy) * g.diff.speed, 8);
      }
      e.fireT = (e.state === 'dash' ? 0.25 : rand(0.8, 1.3)) / rate;
    }
    e.missileT -= dt;
    if (phase2 && e.missileT <= 0 && e.onScreen(0)) {
      g.addEnemy('rocket', e.x, e.y, { heading: e.heading + 0.4 });
      g.addEnemy('rocket', e.x, e.y, { heading: e.heading - 0.4 });
      g.audio.play('missile');
      e.missileT = rand(5, 7);
    }
    if (phase2 && !e.wingmen) {
      e.wingmen = true;
      g.ui.banner('ACE CALLED IN WINGMEN', 1.5, 'warn');
      for (let k = 0; k < 3; k++) g.addEnemy('fighter', g.camX + g.halfW + 5 + k * 4, 12 - k * 6, { amp: 2, speed: 12 });
    }
  },
};

// Stealth flying wing: carpet-bombing passes. It flies real passes across the screen,
// turns around off-screen (continuous motion, no teleport) and comes back the other way,
// alternating right-to-left and left-to-right (overtaking the player) runs.
KINDS.nightwing = {
  hp: 170, r: 4, score: 4000, credits: 400, air: true, boss: true, facing: -1, name: 'Nightwing Stealth Bomber',
  circles: [[-4, 0, 2.2], [0, 0, 2.8], [2.5, 4.5, 2.2], [2.5, -4.5, 2.2], [4.5, 8, 1.8], [4.5, -8, 1.8]],
  build: () => createNightwing(),
  init(e, o, g) {
    e.dir = -1; // travel direction over the ground
    e.facing = -1;
    e.state = 'pass';
    e.y = g.halfH - 10;
    e.targetY = e.y;
    e.bombT = 0.5;
    e.gunT = 1;
    e.passes = 0;
    e.vxWorld = -12;
    e.vy = 0;
    e.yaw = 0;
    e.baseCircles = e.circles.map((c) => c.slice());
  },
  update(e, dt, g) {
    const phase2 = e.hp < e.maxHp * 0.5;
    const rate = g.diff.rate * (phase2 ? 1.35 : 1);
    for (const f of e.obj.userData.glows) f.scale.x = 0.8 + Math.random() * 0.4;
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
    if (e.state === 'pass') {
      e.bombT -= dt;
      if (e.bombT <= 0 && onScreen) {
        // Released bombs keep the bomber's velocity, then fall under gravity.
        const bvx = e.vxWorld - g.scroll;
        const bvy = e.vy - 2;
        for (const dz of [-3, 3]) g.weapons.enemyBullet(e.x, e.y - 1 + dz * 0.3, Math.atan2(bvy, bvx), Math.hypot(bvx, bvy), 12, { big: true, grav: -22 });
        e.bombT = (phase2 ? 0.28 : 0.4) / g.diff.rate;
      }
      e.gunT -= dt;
      if (e.gunT <= 0 && onScreen && g.player.alive) {
        const a = e.aimAngle(e.x, e.y);
        const n = phase2 ? 5 : 3;
        for (let k = 0; k < n; k++) g.weapons.enemyBullet(e.x, e.y, a + (k - (n - 1) / 2) * 0.12, 20 * g.diff.speed, 8);
        if (phase2) g.addEnemy('rocket', e.x, e.y, { heading: a });
        e.gunT = rand(1.4, 2) / rate;
      }
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
    if (phase2 && Math.random() < dt * 8) g.fx.damageSmoke(e.x, e.y, 0, true);
  },
};

export const BOSS_NAMES = Object.fromEntries(Object.entries(KINDS).filter(([, d]) => d.boss).map(([k, d]) => [k, d.name]));

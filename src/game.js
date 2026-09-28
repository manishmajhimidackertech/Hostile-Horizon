// Core game: renderer, camera, main loop, entity bookkeeping and mission flow.
import * as THREE from 'three';
import { World } from './world.js';
import { Effects } from './fx.js';
import { Weapons } from './weapons.js';
import { Player } from './player.js';
import { Enemy, BOSS_NAMES } from './enemies.js';
import { Director, missionInfo, difficulty } from './director.js';
import { createPickup } from './models.js';
import { playerStats, writeSave } from './save.js';

const FOV = 28;
const TAN = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
const VIEW_HALF_H = 24;
const MIN_HALF_W = 34;
const rand = (a, b) => a + Math.random() * (b - a);

const HINTS = {
  move: {
    touch: 'Drag anywhere on the left to fly',
    mouse: 'Steer with the mouse · hold left click to fire',
    keyboard: 'Fly with WASD / arrows · hold Space to fire',
    gamepad: 'Left stick to fly · hold A / RT to fire',
  },
  fire: {
    touch: 'Hold FIRE to shoot (or enable Auto-fire in Settings)',
  },
  missile: {
    touch: 'MSL launches homing missiles',
    mouse: 'Right click launches homing missiles',
    keyboard: 'E launches homing missiles',
    gamepad: 'B / RB launches homing missiles',
  },
  ground: {
    touch: 'Ground targets! Tap BOMB to drop bombs',
    mouse: 'Ground targets! Scroll wheel or Q drops bombs',
    keyboard: 'Ground targets! Q drops bombs',
    gamepad: 'Ground targets! X / LB drops bombs',
  },
};

export class Game {
  constructor(canvas, { ui, audio, input, save }) {
    this.canvas = canvas;
    this.ui = ui;
    this.audio = audio;
    this.input = input;
    this.save = save;

    const quality = save.settings.quality;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: quality === 'high',
      powerPreference: 'high-performance',
    });
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(FOV, 1, 1, 1200);

    this.world = new World(this.scene);
    this.fx = new Effects(this.scene);
    this.weapons = new Weapons(this);
    this.player = new Player(this);
    this.enemies = [];
    this.pickups = [];

    this.state = 'menu';
    this.time = 0;
    this.scroll = 10;
    this.scrollX = 0;
    this.camX = 0;
    this.halfW = 40;
    this.halfH = VIEW_HALF_H;
    this.camDist = 60;
    this.shakeAmt = 0;
    this.hintsShown = new Set();
    this.boss = null;
    this.diff = difficulty(1);
    this.resetStats();

    this.world.setup(0, 7);
    this.setQuality(quality);
    addEventListener('resize', () => this.resize());
    this.resize();

    this.last = performance.now();
    this.renderer.setAnimationLoop((t) => this.frame(t));
  }

  resetStats() {
    this.stats = {
      score: 0, kills: 0, credits: 0, shots: 0, hits: 0,
      damageTaken: 0, combo: 0, comboT: 0, maxCombo: 0,
    };
  }

  setQuality(q) {
    const max = q === 'high' ? 2 : q === 'medium' ? 1.5 : 1;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, max));
    this.fx.quality = q === 'low' ? 0.5 : 1;
    this.resize();
  }

  resize() {
    const w = this.canvas.clientWidth || innerWidth;
    const h = this.canvas.clientHeight || innerHeight;
    this.renderer.setSize(w, h, false);
    const aspect = w / h;
    this.halfH = Math.max(VIEW_HALF_H, MIN_HALF_W / aspect);
    this.halfW = this.halfH * aspect;
    this.camDist = this.halfH / TAN;
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    this.worldPerPixel = (this.halfH * 2) / h;
    this.fx.setScale(this.renderer.domElement.height / (2 * TAN));
  }

  halfWidthAt = (z) => (this.camDist - z) * TAN * this.camera.aspect;

  toScreen(x, y) {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    return [
      ((x - this.camera.position.x) / this.halfW * 0.5 + 0.5) * w,
      (0.5 - (y - this.camera.position.y) / this.halfH * 0.5) * h,
    ];
  }

  // ------------------------------------------------------------ mission flow

  showMenuScene(missionNumber) {
    this.clearField();
    this.state = 'menu';
    this.boss = null;
    const info = missionInfo(missionNumber);
    this.world.setup(info.theme, 7 + missionNumber * 101);
    this.scroll = 10;
    this.player.reset(null);
    this.audio.playSong('menu');
  }

  startMission(n) {
    this.clearField();
    this.mission = missionInfo(n);
    this.diff = difficulty(n);
    this.director = new Director(this, this.mission);
    this.world.setup(this.mission.theme, 1000 + n * 7919 + Math.floor(Math.random() * 1000));
    this.scroll = 15;
    this.scrollX = 0;
    this.camX = 0;
    this.boss = null;
    this.resetStats();
    this.player.reset(playerStats(this.save.upgrades));
    this.player.x = -this.halfW * 0.55;
    this.player.y = 2;
    this.state = 'playing';
    this.endTimer = 0;
    this.save.stats.sorties++;
    this.audio.playSong('battle');
    this.ui.onMissionStart(this.mission);
    this.ui.banner(`MISSION ${n} · ${this.mission.name.toUpperCase()}`, 2.6);
  }

  clearField() {
    for (const e of this.enemies) e.remove();
    this.enemies.length = 0;
    for (const p of this.pickups) this.scene.remove(p.obj);
    this.pickups.length = 0;
    this.weapons.clear();
    this.fx.clear();
    this.ui.setBoss(null);
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.ui.showPause();
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.last = performance.now();
    this.ui.hidePause();
  }

  abort() {
    this.state = 'playing';
    this.endMission(false, true);
  }

  endMission(success, aborted = false) {
    if (this.state === 'ended') return;
    const s = this.stats;
    const m = this.mission.number;
    const hpRatio = this.player.hp / this.player.maxHp;
    const bonus = success ? 150 + 75 * m + Math.round(hpRatio * 100) : 0;
    const total = s.credits + bonus;
    const save = this.save;
    save.credits += total;
    save.stats.kills += s.kills;
    if (success) {
      save.stats.wins++;
      save.unlocked = Math.max(save.unlocked, m + 1);
    }
    const newHigh = s.score > save.highScore;
    if (newHigh) save.highScore = s.score;
    writeSave(save);
    this.state = 'ended';
    this.audio.play(success ? 'win' : 'lose');
    this.audio.playSong('menu');
    this.ui.showResult({
      success, aborted, mission: m,
      score: s.score, kills: s.kills, maxCombo: s.maxCombo,
      accuracy: s.shots ? Math.min(100, Math.round((s.hits / (s.shots * this.player.stats.gunStreams)) * 100)) : 0,
      credits: s.credits, bonus, total, newHigh,
    });
  }

  // ------------------------------------------------------------ entities

  addEnemy(kind, x, y, opts) {
    const e = new Enemy(this, kind, x, y, opts);
    this.enemies.push(e);
    return e;
  }

  setBoss(e) {
    this.boss = e;
    this.ui.setBoss(BOSS_NAMES[e.kind]);
  }

  onBossDown(boss) {
    this.state = 'victory';
    this.weapons.enemy.clear();
    this.ui.banner('TARGET DESTROYED', 2.5, 'good');
    for (const e of this.enemies) {
      if (e !== boss && !e.dead) {
        this.fx.explosion(e.x, e.y, 1, this.scroll);
        e.remove();
      }
    }
  }

  onEnemyKilled(e) {
    const s = this.stats;
    s.kills++;
    s.combo++;
    s.comboT = 2.5;
    s.maxCombo = Math.max(s.maxCombo, s.combo);
    const mult = 1 + Math.min(s.combo - 1, 20) * 0.1;
    const pts = Math.round(e.score * mult);
    s.score += pts;
    s.credits += e.credits;
    this.ui.popup(e.x, e.y + 1.5, `+${pts}`, e.boss ? 'big' : '');
    if (e.boss) {
      this.fx.explosion(e.x, e.y, 5, this.scroll);
      this.fx.explosion(e.x - 5, e.y, 3, this.scroll);
      this.fx.explosion(e.x + 5, e.y, 3, this.scroll);
      this.audio.play('bigExplode');
      this.shake(2);
      this.ui.setBoss(null);
      this.boss = null;
      for (let i = 0; i < 10; i++) this.spawnPickup('coin', e.x + rand(-8, 8), e.y + rand(-3, 3));
      this.spawnPickup('health', e.x, e.y);
      this.endTimer = 3.5;
      return;
    }
    const size = e.kind === 'rocket' ? 0.6 : e.kind === 'heli' ? 1.6 : 1.2;
    if (e.air) this.fx.explosion(e.x, e.y, size, this.scroll * 0.6);
    else this.fx.groundBlast(e.x, e.y + 1, 1.5, 0);
    this.audio.play('explode', size);
    this.shake(0.2 * size);
    if (!e.def.noDrop) {
      const r = Math.random();
      if (r < 0.05) this.spawnPickup('health', e.x, e.y + 1);
      else if (r < 0.13) this.spawnPickup('ammo', e.x, e.y + 1);
      else if (r < 0.5) this.spawnPickup('coin', e.x, e.y + 1);
    }
  }

  onPlayerDown() {
    this.state = 'dying';
    this.endTimer = 2.6;
    this.ui.banner('YOU HAVE BEEN SHOT DOWN', 2.4, 'danger');
  }

  spawnPickup(kind, x, y) {
    const obj = createPickup(kind);
    obj.position.set(x, y, 0.5);
    this.scene.add(obj);
    this.pickups.push({ kind, obj, x, y, vy: rand(3, 8), vx: rand(-3, 3), age: 0 });
  }

  _updatePickups(dt) {
    const p = this.player;
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const it = this.pickups[i];
      it.age += dt;
      it.vy -= 7 * dt;
      it.vx *= 1 - dt * 1.5;
      it.x += (this.scroll - 3 + it.vx) * dt;
      it.y += it.vy * dt;
      const gy = this.world.groundY(it.x) + 1.2;
      if (it.y < gy) {
        it.y = gy;
        it.vy = Math.abs(it.vy) * 0.3;
      }
      if (p.alive) {
        const dx = p.x - it.x;
        const dy = p.y - it.y;
        const d = Math.hypot(dx, dy);
        const magnet = this.state === 'victory' ? 1e9 : 9;
        if (d < magnet) {
          const pull = this.state === 'victory' ? 45 : (1 - d / 9) * 40 + 8;
          it.x += (dx / d) * pull * dt;
          it.y += (dy / d) * pull * dt;
        }
        if (d < 2.3) {
          this._collect(it);
          this.scene.remove(it.obj);
          this.pickups.splice(i, 1);
          continue;
        }
      }
      it.obj.position.set(it.x, it.y, 0.5);
      it.obj.rotation.y += dt * 2.5;
      if (it.kind !== 'coin') it.obj.rotation.x = Math.sin(it.age * 2) * 0.3;
      if (it.age > 16 || it.x < this.camX - this.halfW - 4) {
        this.scene.remove(it.obj);
        this.pickups.splice(i, 1);
      }
    }
  }

  _collect(it) {
    const p = this.player;
    this.fx.pickupSparkle(it.x, it.y);
    if (it.kind === 'coin') {
      const v = 10 + this.mission.number * 2;
      this.stats.credits += v;
      this.ui.popup(it.x, it.y + 1, `+${v}¢`, 'coin');
      this.audio.play('coin');
    } else if (it.kind === 'health') {
      p.heal(35);
      this.ui.popup(it.x, it.y + 1, 'REPAIR +35', 'heal');
      this.audio.play('pickup');
    } else {
      p.missiles = Math.min(p.stats.missiles + 4, p.missiles + 2);
      p.bombs = Math.min(p.stats.bombs + 4, p.bombs + 3);
      this.ui.popup(it.x, it.y + 1, 'AMMO', 'ammo');
      this.audio.play('pickup');
    }
  }

  hint(key) {
    if (this.hintsShown.has(key) || this.state !== 'playing') return;
    const texts = HINTS[key];
    const text = texts[this.input.mode] || (key === 'fire' ? null : texts.keyboard);
    this.hintsShown.add(key);
    if (text) this.ui.toast(text, 4.5);
  }

  shake(a) {
    this.shakeAmt = Math.min(2.5, this.shakeAmt + a);
  }

  // ------------------------------------------------------------ loop

  frame(now) {
    const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.input.pollGamepad();

    if (this.input.pausePressed()) {
      if (this.state === 'playing') this.pause();
      else if (this.state === 'paused') this.resume();
    }

    if (this.ui.blocking) {
      // Rotate-device overlay is up: hold the action.
    } else if (this.state === 'playing' || this.state === 'dying' || this.state === 'victory') {
      this.update(dt);
    } else if (this.state === 'menu' || this.state === 'ended') {
      this.updateMenu(dt);
    }
    this.renderer.render(this.scene, this.camera);
    this.input.endFrame();
  }

  updateMenu(dt) {
    this.time += dt;
    this.scrollX += this.scroll * dt;
    this.camX = this.scrollX;
    if (this.state === 'menu') {
      this.player.obj.visible = true;
      this.player.updateAttract(dt, this.time);
    } else {
      this.player.obj.visible = false;
    }
    for (const e of this.enemies) if (!e.dead) e.update(dt);
    this.enemies = this.enemies.filter((e) => !e.dead);
    this.weapons.update(dt);
    this._updatePickups(dt);
    this.fx.update(dt);
    this._updateCamera(dt);
    this.input.takeDrag();
  }

  update(dt) {
    this.time += dt;
    this.scrollX += this.scroll * dt;
    this.camX = this.scrollX;

    if (this.state === 'playing') this.director.update(dt);
    this.player.update(dt);

    for (const e of this.enemies) if (!e.dead) e.update(dt);
    const p = this.player;
    if (p.alive && this.state === 'playing') {
      for (const e of this.enemies) {
        if (e.dead || e.dying > 0 || !e.ram) continue;
        if (e.hitTest(p.x + 1, p.y, 0.9) || e.hitTest(p.x - 1, p.y, 0.9)) {
          p.hurt(e.ram);
          if (!e.boss) e.damage(999);
        }
      }
    }
    this.enemies = this.enemies.filter((e) => !e.dead);

    this.weapons.update(dt);
    this._updatePickups(dt);
    this.fx.update(dt);

    const s = this.stats;
    if (s.comboT > 0) {
      s.comboT -= dt;
      if (s.comboT <= 0) s.combo = 0;
    }

    if (this.endTimer > 0 && (this.state === 'dying' || (this.state === 'victory' && !this.boss))) {
      this.endTimer -= dt;
      if (this.endTimer <= 0) this.endMission(this.state === 'victory');
    }

    this._updateCamera(dt);
    this.ui.updateHud(this);
  }

  _updateCamera(dt) {
    this.shakeAmt = Math.max(0, this.shakeAmt - dt * 3);
    const s = this.shakeAmt * this.shakeAmt;
    this.camera.position.set(this.camX + rand(-1, 1) * s, rand(-1, 1) * s, this.camDist);
    this.world.update(this.camX, this.camDist, this.halfWidthAt);
    this.ui.updatePopups(this, dt);
  }
}

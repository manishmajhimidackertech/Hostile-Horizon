// Mission pacing: timed enemy waves, tutorial hints and the end-of-mission boss.
import { MAPS } from './maps.js';

const rand = (a, b) => a + Math.random() * (b - a);
const randi = (a, b) => Math.floor(rand(a, b + 1));

export function missionInfo(n) {
  const theme = (n - 1) % MAPS.length;
  return {
    number: n,
    theme,
    name: MAPS[theme].name,
    desc: MAPS[theme].desc,
    map: MAPS[theme],
    boss: MAPS[theme].bosses[Math.floor((n - 1) / MAPS.length) % MAPS[theme].bosses.length],
    duration: Math.min(70 + n * 10, 150),
  };
}

export function difficulty(n) {
  const k = n - 1;
  return {
    hp: 1 + k * 0.14,
    bossHp: 1 + k * 0.22,
    rate: Math.min(2.2, 1 + k * 0.1),
    speed: Math.min(1.5, 1 + k * 0.05),
    interval: Math.max(1.5, 4.0 - k * 0.3),
  };
}

const WAVES = [
  {
    min: 1, weight: 3,
    spawn(g) {
      const n = randi(3, 4 + Math.floor(g.mission.number / 3));
      const y = rand(-6, g.halfH - 8);
      for (let i = 0; i < n; i++) g.addEnemy('fighter', g.camX + g.halfW + 5 + i * 4.5, y, { amp: 3, phase: i * 0.6, speed: 15 });
    },
  },
  {
    min: 1, weight: 2,
    spawn(g) {
      const y = rand(-2, 10);
      const rows = [[0, 0], [1, 3.5], [1, -3.5], [2, 7], [2, -7]];
      rows.forEach(([col, dy]) => g.addEnemy('fighter', g.camX + g.halfW + 5 + col * 4, y + dy, { amp: 1.2, freq: 1, phase: 0, speed: 13 }));
    },
  },
  {
    min: 1, weight: 2,
    spawn(g) {
      const n = randi(1, g.mission.number >= 4 ? 2 : 1);
      for (let i = 0; i < n; i++) g.addEnemy('heli', g.camX + g.halfW + 6 + i * 8, rand(-4, 12), { targetRel: g.halfW * (0.3 + i * 0.3) });
    },
  },
  {
    min: 1, weight: 3, ground: true,
    spawn(g) {
      const n = randi(2, 3 + Math.floor(g.mission.number / 3));
      for (let i = 0; i < n; i++) g.addEnemy('tank', g.camX + g.halfW + 6 + i * 7, 0, { vx: -2.5 });
      g.hint('ground');
    },
  },
  {
    min: 2, weight: 2,
    spawn(g) {
      const n = randi(2, 4);
      for (let i = 0; i < n; i++) g.addEnemy('dart', g.camX + g.halfW + 5 + i * 5, rand(-10, g.halfH - 6));
    },
  },
  {
    min: 2, weight: 2, ground: true,
    spawn(g) {
      const n = randi(1, 2);
      for (let i = 0; i < n; i++) g.addEnemy('flak', g.camX + g.halfW + 6 + i * 16, 0);
      g.hint('ground');
    },
  },
  {
    min: 3, weight: 1.5,
    spawn(g) {
      const n = randi(2, 3);
      for (let i = 0; i < n; i++) {
        g.addEnemy('fighter', g.camX - g.halfW - 5 - i * 4, rand(-4, g.halfH - 6), { facing: 1, speed: 9, amp: 2 });
      }
      g.ui.banner('BANDITS ON YOUR SIX!', 1.6, 'warn');
    },
  },
  {
    min: 3, weight: 2, ground: true,
    spawn(g) {
      g.addEnemy('flak', g.camX + g.halfW + 6, 0);
      g.addEnemy('tank', g.camX + g.halfW + 14, 0, { vx: -2 });
      g.addEnemy('tank', g.camX + g.halfW + 21, 0, { vx: -2 });
      g.addEnemy('fighter', g.camX + g.halfW + 8, rand(4, 14), { amp: 2.5, speed: 14 });
    },
  },
];

export class Director {
  constructor(game, mission) {
    this.g = game;
    this.mission = mission;
    this.diff = difficulty(mission.number);
    this.t = 0;
    this.nextWave = 2.5;
    this.lastGround = 0;
    this.bossState = 'none';
    this.bossTimer = 0;
    this.hazardT = 8;
  }

  get progress() {
    return Math.min(1, this.t / this.mission.duration);
  }

  update(dt) {
    const g = this.g;
    this.t += dt;
    if (this.mission.number === 1) {
      if (this.t > 0.5) g.hint('move');
      if (this.t > 6) g.hint('fire');
      if (this.t > 14) g.hint('missile');
    }
    if (this.mission.map.hazard === 'lava' && this.bossState !== 'warning') this._lavaBombs(dt);
    if (this.bossState === 'none') {
      this.nextWave -= dt;
      if (this.nextWave <= 0 && this.t < this.mission.duration - 3) {
        this._spawnWave();
        this.nextWave = this.diff.interval * rand(0.8, 1.3);
      }
      if (this.t >= this.mission.duration) {
        this.bossState = 'warning';
        this.bossTimer = 3;
        g.ui.banner('WARNING — HEAVY TARGET INBOUND', 3, 'danger');
        g.audio.play('warning');
      }
    } else if (this.bossState === 'warning') {
      this.bossTimer -= dt;
      if (this.bossTimer <= 0) {
        this.bossState = 'fight';
        const boss = g.addEnemy(this.mission.boss, g.camX + g.halfW + 22, 8);
        g.setBoss(boss);
        g.audio.playSong('boss');
        this.nextWave = 9;
      }
    } else if (this.bossState === 'fight') {
      // Light escorts during the boss fight on later missions.
      this.nextWave -= dt;
      if (this.nextWave <= 0 && this.mission.number >= 2) {
        const n = randi(2, 3);
        const y = rand(-8, 4);
        for (let i = 0; i < n; i++) g.addEnemy('fighter', g.camX + g.halfW + 5 + i * 4, y, { amp: 2, speed: 16 });
        this.nextWave = rand(9, 13);
      }
    }
  }

  // Volcano maps: lava bombs rain down from the eruptions.
  _lavaBombs(dt) {
    const g = this.g;
    this.hazardT -= dt;
    if (this.hazardT > 0) return;
    this.hazardT = rand(4, 8) / Math.min(1.6, 1 + this.mission.number * 0.03);
    const n = randi(1, this.mission.number >= 6 ? 3 : 2);
    for (let i = 0; i < n; i++) {
      g.addEnemy('meteor', g.camX + rand(-0.2, 1.1) * g.halfW, g.halfH + 5 + i * 4, { vx: rand(-9, -2), vy: rand(-6, -2) });
    }
    g.hint('lava');
  }

  _spawnWave() {
    const g = this.g;
    const n = this.mission.number;
    let pool = WAVES.filter((w) => w.min <= n);
    // Keep ground targets coming regularly so bombs stay useful.
    if (this.t - this.lastGround > 14) pool = pool.filter((w) => w.ground);
    const total = pool.reduce((s, w) => s + w.weight, 0);
    let r = Math.random() * total;
    let wave = pool[0];
    for (const w of pool) {
      r -= w.weight;
      if (r <= 0) {
        wave = w;
        break;
      }
    }
    if (wave.ground) this.lastGround = this.t;
    wave.spawn(g);
  }
}

// Persistent progress (credits, upgrades, unlocked missions, settings).

const KEY = 'hostile-horizon:save:v1';

export const UPGRADES = [
  { id: 'armor', name: 'Armor Plating', desc: '+25 max hull per level', max: 5, base: 120 },
  { id: 'guns', name: 'Cannon Caliber', desc: 'Heavier rounds. Extra barrels at Lv 2 and Lv 4', max: 5, base: 150 },
  { id: 'rate', name: 'Fire Control', desc: 'Faster cannon rate of fire', max: 5, base: 130 },
  { id: 'missiles', name: 'Missile Racks', desc: '+2 homing missiles per sortie', max: 5, base: 110 },
  { id: 'bombs', name: 'Bomb Bay', desc: '+2 bombs per sortie and bigger blasts', max: 5, base: 100 },
  { id: 'engine', name: 'Turbofan', desc: 'Faster, more agile flight', max: 5, base: 100 },
];

export function upgradeCost(upgrade, level) {
  return Math.round((upgrade.base * Math.pow(1.8, level)) / 10) * 10;
}

export function defaultSave() {
  return {
    version: 1,
    credits: 0,
    unlocked: 1,
    highScore: 0,
    upgrades: { armor: 0, guns: 0, rate: 0, missiles: 0, bombs: 0, engine: 0 },
    settings: { sfx: true, music: true, autofire: null, quality: 'high' },
    stats: { kills: 0, sorties: 0, wins: 0 },
  };
}

export function loadSave() {
  const def = defaultSave();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return def;
    const data = JSON.parse(raw);
    return {
      ...def,
      ...data,
      upgrades: { ...def.upgrades, ...data.upgrades },
      settings: { ...def.settings, ...data.settings },
      stats: { ...def.stats, ...data.stats },
    };
  } catch {
    return def;
  }
}

export function writeSave(save) {
  try {
    localStorage.setItem(KEY, JSON.stringify(save));
  } catch {
    // Storage may be unavailable (private mode); progress just won't persist.
  }
}

export function playerStats(up) {
  return {
    maxHp: 100 + 25 * up.armor,
    gunDamage: 1 + 0.3 * up.guns,
    gunStreams: up.guns >= 4 ? 3 : up.guns >= 2 ? 2 : 1,
    fireInterval: 0.13 * Math.pow(0.88, up.rate),
    missiles: 4 + 2 * up.missiles,
    bombs: 6 + 2 * up.bombs,
    bombRadius: 4.5 + 0.45 * up.bombs,
    speed: 24 + 3 * up.engine,
  };
}

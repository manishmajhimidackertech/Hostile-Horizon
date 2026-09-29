// Persistent progress (credits, owned planes and their upgrades, unlocked missions, settings).
import { PLANE_BY_ID } from './planes.js';

const KEY = 'hostile-horizon:save:v1';

export const UPGRADES = [
  { id: 'armor', name: 'Armor Plating', desc: '+25% max hull per level (and faster self-repair)', max: 5, base: 120 },
  { id: 'guns', name: 'Cannon Caliber', desc: 'Heavier rounds. Extra barrels at Lv 2 and Lv 4', max: 5, base: 150 },
  { id: 'rate', name: 'Fire Control', desc: 'Faster cannon rate of fire', max: 5, base: 130 },
  { id: 'missiles', name: 'Missile Racks', desc: '+2 homing missiles per sortie', max: 5, base: 110 },
  { id: 'bombs', name: 'Bomb Bay', desc: '+2 bombs per sortie and bigger blasts', max: 5, base: 100 },
  { id: 'engine', name: 'Turbofan', desc: 'Faster, more agile flight', max: 5, base: 100 },
];

export function upgradeCost(upgrade, level, plane) {
  const mult = plane ? plane.upgradeMult : 1;
  return Math.round((upgrade.base * Math.pow(1.8, level) * mult) / 10) * 10;
}

export function emptyUpgrades() {
  return Object.fromEntries(UPGRADES.map((u) => [u.id, 0]));
}

export function defaultSave() {
  return {
    version: 2,
    credits: 0,
    unlocked: 1,
    highScore: 0,
    plane: 'hawk',
    planes: { hawk: { upgrades: emptyUpgrades() } },
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
    const save = {
      ...def,
      ...data,
      settings: { ...def.settings, ...data.settings },
      stats: { ...def.stats, ...data.stats },
    };
    // v1 saves had a single set of upgrades: they belong to the starter jet.
    const planes = {};
    for (const [id, p] of Object.entries(data.planes || {})) {
      if (PLANE_BY_ID[id]) planes[id] = { upgrades: { ...emptyUpgrades(), ...(p && p.upgrades) } };
    }
    if (!planes.hawk) planes.hawk = { upgrades: { ...emptyUpgrades(), ...(data.upgrades || {}) } };
    save.planes = planes;
    delete save.upgrades;
    if (!planes[save.plane]) save.plane = 'hawk';
    save.version = 2;
    return save;
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

// Purchasable aircraft. Each plane has its own base stats and its own upgrade levels.

export const PLANES = [
  {
    id: 'hawk', name: 'F-5 Hawk', role: 'Reliable starter fighter', price: 0, upgradeMult: 1,
    hp: 100, dmg: 1, streams: 1, interval: 0.13, speed: 24, regen: 0,
    missiles: 4, salvo: 1, missileDamage: 7, bombs: 6, bombRadius: 4.5, bombDamage: 14,
    tracer: '#ffc93d', flame: 'orange',
  },
  {
    id: 'viper', name: 'V-7 Viper', role: 'Nimble interceptor with twin cannons', price: 2500, upgradeMult: 1.5,
    hp: 120, dmg: 1.25, streams: 2, interval: 0.11, speed: 30, regen: 0,
    missiles: 6, salvo: 1, missileDamage: 8, bombs: 5, bombRadius: 4.5, bombDamage: 14,
    tracer: '#ffe46b', flame: 'orange',
  },
  {
    id: 'thunder', name: 'A-12 Thunderbolt', role: 'Armoured tank-buster with a huge bomb bay', price: 6000, upgradeMult: 2,
    hp: 220, dmg: 1.7, streams: 2, interval: 0.1, speed: 22, regen: 1.5,
    missiles: 6, salvo: 1, missileDamage: 9, bombs: 14, bombRadius: 6.5, bombDamage: 24,
    tracer: '#ff9a3d', flame: 'orange',
  },
  {
    id: 'raptor', name: 'F-40 Raptor', role: 'Stealth air-superiority fighter. Fires missiles in pairs', price: 12000, upgradeMult: 3,
    hp: 200, dmg: 2.2, streams: 3, interval: 0.09, speed: 31, regen: 2.5,
    missiles: 10, salvo: 2, missileDamage: 10, bombs: 8, bombRadius: 5.5, bombDamage: 18,
    tracer: '#9fe8ff', flame: 'orange',
  },
  {
    id: 'specter', name: 'Su-X Specter', role: 'Forward-swept super-fighter with self-repair', price: 25000, upgradeMult: 4.5,
    hp: 260, dmg: 3, streams: 3, interval: 0.075, speed: 34, regen: 4,
    missiles: 12, salvo: 2, missileDamage: 12, bombs: 10, bombRadius: 6, bombDamage: 22,
    tracer: '#c9a0ff', flame: 'blue',
  },
  {
    id: 'nova', name: 'X-1 Nova', role: 'Experimental plasma fighter. Fires missiles in threes', price: 50000, upgradeMult: 6,
    hp: 320, dmg: 4, streams: 4, interval: 0.065, speed: 36, regen: 6,
    missiles: 16, salvo: 3, missileDamage: 14, bombs: 12, bombRadius: 7, bombDamage: 26,
    tracer: '#7dffb0', flame: 'green',
  },
];

export const PLANE_BY_ID = Object.fromEntries(PLANES.map((p) => [p.id, p]));

export function getPlane(id) {
  return PLANE_BY_ID[id] || PLANES[0];
}

export function planeStats(plane, up) {
  return {
    maxHp: Math.round(plane.hp * (1 + 0.25 * up.armor)),
    gunDamage: plane.dmg * (1 + 0.3 * up.guns),
    gunStreams: Math.min(5, plane.streams + (up.guns >= 2 ? 1 : 0) + (up.guns >= 4 ? 1 : 0)),
    fireInterval: plane.interval * Math.pow(0.88, up.rate),
    missiles: plane.missiles + 2 * up.missiles,
    salvo: plane.salvo,
    missileDamage: plane.missileDamage,
    bombs: plane.bombs + 2 * up.bombs,
    bombRadius: plane.bombRadius + 0.45 * up.bombs,
    bombDamage: plane.bombDamage,
    speed: plane.speed + 3 * up.engine,
    regen: plane.regen * (1 + 0.2 * up.armor),
    tracer: plane.tracer,
  };
}

// 0..1 ratings used for the hangar stat bars (square-root scaled so small planes still show).
const MAX = { hull: 800, fire: 1500, speed: 51, ordnance: 60 };
export function planeRatings(plane, up) {
  const s = planeStats(plane, up);
  const r = (v, m) => Math.min(1, Math.sqrt(v / m));
  return {
    hull: r(s.maxHp, MAX.hull),
    fire: r((s.gunDamage * s.gunStreams) / s.fireInterval, MAX.fire),
    speed: r(s.speed, MAX.speed),
    ordnance: r(s.missiles * s.salvo * 0.5 + s.bombs, MAX.ordnance),
  };
}

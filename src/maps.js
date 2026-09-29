// Theatre definitions. Each mission cycles through these maps.
//   terrain  : hills | canyon | ocean | volcano | city  (shape of the land)
//   scenery  : forest | desert | snow | island | volcanic | city
//   weather  : rain | snow | sand | ash (camera-space particles)
//   bosses   : end-of-mission bosses, rotating each time the map comes round again
//   extras   : lightning, searchlights, naval (ships replace tanks/flak), hazard (lava | lightning | vigilantes | watchtowers, see hazards.js)

export const MAPS = [
  {
    id: 'valley', bosses: ['bomber', 'ace', 'titan'], name: 'Verdant Valley', desc: 'Rolling farmland and forests',
    terrain: 'hills', scenery: 'forest', town: 0.35, clouds: 2,
    skyTop: '#2f6fc4', skyBottom: '#c4e4fb', fog: '#c9e2f5',
    hemiSky: '#dff0ff', hemiGround: '#5a6b3a', sun: '#fff4c8', sunLight: '#fff3dc', sunIntensity: 2.4, hemiIntensity: 1.4,
    ground: ['#5e9442', '#6ba34a', '#57883c', '#77a852'], rock: '#7d7563', high: '#8e9a6a',
    mountain: '#7494ad', snowcap: '#eef3f8', trunk: '#5a3f26', tree: '#2f6b31', tree2: '#3f8538',
    buildings: ['#c9c1b0', '#b5a58b', '#d8d2c4'], windows: '#3b4a5a', cloud: '#ffffff',
  },
  {
    id: 'canyon', bosses: ['behemoth', 'nightwing', 'bomber'], name: 'Red Canyon', desc: 'Towering mesas and a howling dust storm',
    terrain: 'canyon', scenery: 'desert', weather: 'sand', town: 0.2, clouds: 1, fogNear: 30, fogFar: 300,
    skyTop: '#5c8cc0', skyBottom: '#f0c89a', fog: '#e2b187',
    hemiSky: '#ffe6c8', hemiGround: '#9a5433', sun: '#fff0c0', sunLight: '#ffe2c0', sunIntensity: 2.6, hemiIntensity: 1.3,
    ground: ['#d39a62', '#c98d56', '#dca771', '#c4854f'], rock: '#8f4a2e', high: '#c77d4c',
    strata: ['#b85c35', '#d08a55', '#9e4a2c', '#e0a36c', '#c46d40'],
    mountain: '#b0643e', snowcap: '#e0a36c', trunk: '#4d7a3a', tree: '#4f8a3c',
    buildings: ['#e0cfa5', '#cdb68a', '#d9c7a0'], windows: '#5a4630', cloud: '#fff1dc',
  },
  {
    id: 'coast', bosses: ['dreadnought', 'airship', 'ace'], name: 'Coastal Assault', desc: 'Island chain defended by gunboats and AA ships',
    terrain: 'ocean', scenery: 'island', naval: true, clouds: 3,
    skyTop: '#2a78c8', skyBottom: '#bfe6f7', fog: '#cfe9f5',
    hemiSky: '#e4f4ff', hemiGround: '#3f6f7a', sun: '#fff6d8', sunLight: '#fff5e0', sunIntensity: 2.5, hemiIntensity: 1.4,
    ground: ['#5f9a45', '#6aa84d', '#579040', '#74ad55'], rock: '#8a8274', high: '#7aa052', sand: '#e6d39c', seabed: '#2d6272',
    water: '#1f76a8', mountain: '#6f93a8', snowcap: '#eef3f8', trunk: '#8a6a42', tree: '#3f8a3a',
    buildings: ['#f2efe6', '#e6dcc8'], windows: '#3b5a7a', cloud: '#ffffff',
  },
  {
    id: 'frozen', bosses: ['titan', 'behemoth', 'airship'], name: 'Frozen Front', desc: 'Blizzard over the tundra',
    terrain: 'hills', scenery: 'snow', weather: 'snow', town: 0.25, clouds: 3, fogNear: 40, fogFar: 320,
    skyTop: '#5d86b0', skyBottom: '#dde9f3', fog: '#dbe6ef',
    hemiSky: '#eef6ff', hemiGround: '#8aa0b3', sun: '#ffffff', sunLight: '#f2f6ff', sunIntensity: 2.0, hemiIntensity: 1.6,
    ground: ['#eef3f7', '#e2eaf1', '#f6f9fb', '#d9e3ec'], rock: '#8b949c', high: '#c9d5df',
    mountain: '#8fa6bd', snowcap: '#ffffff', trunk: '#4a3a2c', tree: '#27493a',
    buildings: ['#9b8b7a', '#7d6f63', '#b1a28f'], windows: '#f4c870', cloud: '#f5f8fb',
  },
  {
    id: 'storm', bosses: ['airship', 'nightwing', 'titan'], name: 'Storm Front', desc: 'Torrential rain. Lightning strikes anything in the air',
    terrain: 'hills', scenery: 'forest', weather: 'rain', lightning: true, hazard: 'lightning', noSun: true, town: 0.3, clouds: 4,
    fogNear: 30, fogFar: 300,
    skyTop: '#232a33', skyBottom: '#5f6c78', fog: '#56626d',
    hemiSky: '#9aa7b5', hemiGround: '#2a352a', sun: '#c8d0da', sunLight: '#b8c4d4', sunIntensity: 1.0, hemiIntensity: 1.3,
    ground: ['#3f5e34', '#46673a', '#3a5530', '#4d6e3f'], rock: '#5a5a55', high: '#56663f',
    mountain: '#4b5866', snowcap: '#9aa6b2', trunk: '#3a2b20', tree: '#24452a', tree2: '#2d5230',
    buildings: ['#8d8a84', '#7a766f', '#9c988f'], windows: '#f4d27a', cloud: '#5d6670',
  },
  {
    id: 'volcano', bosses: ['nightwing', 'behemoth', 'bomber'], name: 'Volcano Ridge', desc: 'Erupting vents and lava bombs hit friend and foe alike',
    terrain: 'volcano', scenery: 'volcanic', weather: 'ash', hazard: 'lava', clouds: 2, fogNear: 40, fogFar: 330,
    skyTop: '#241012', skyBottom: '#b8472c', fog: '#6e2e22',
    hemiSky: '#ff9a6a', hemiGround: '#2a1a16', sun: '#ffb080', sunLight: '#ff9a70', sunIntensity: 1.7, hemiIntensity: 1.2,
    ground: ['#3b3431', '#453c37', '#332d2b', '#4a3f38'], rock: '#5b4a40', high: '#4e433c',
    mountain: '#3d302c', snowcap: '#5a3a30', lava: '#ff5a1a', trunk: '#2a211c', tree: '#2a211c',
    buildings: ['#5a4d45'], windows: '#ff9a4a', cloud: '#3b302d',
  },
  {
    id: 'city', bosses: ['ace', 'titan', 'airship'], name: 'Metropolis', desc: 'Street vigilantes fire torpedoes at anything that flies',
    hazard: 'vigilantes', terrain: 'city', scenery: 'city', lit: true, clouds: 2, fogNear: 15, fogFar: 320,
    skyTop: '#2b2d5c', skyBottom: '#f39a5d', fog: '#d98a66',
    hemiSky: '#ffc59a', hemiGround: '#40324a', sun: '#ffb070', sunLight: '#ffb58a', sunIntensity: 2.2, hemiIntensity: 1.2,
    ground: ['#7a7a72', '#6f7068', '#85857c', '#727368'], rock: '#6e5b52', high: '#7a7a72', road: '#34353a',
    mountain: '#6c5a7a', snowcap: '#f0c9b5', trunk: '#3e2b20', tree: '#2f5530',
    buildings: ['#5d6270', '#6d6a73', '#4f5563', '#7a7680', '#8a7f78'], windows: '#ffd27a', windowsOff: '#2a2f3a', cloud: '#ffd2b8',
  },
  {
    id: 'night', bosses: ['nightwing', 'airship', 'behemoth'], name: 'Night Siege', desc: 'Watchtower searchlights. Stay lit too long and a missile launches',
    hazard: 'watchtowers', terrain: 'hills', scenery: 'forest', night: true, searchlights: true, lit: true, town: 0.5, clouds: 2,
    skyTop: '#060b1c', skyBottom: '#1f3456', fog: '#1b2a45',
    hemiSky: '#6f8fc4', hemiGround: '#1a2230', sun: '#e8eeff', sunLight: '#9fb6ff', sunIntensity: 1.4, hemiIntensity: 1.0,
    ground: ['#2d3f31', '#33473a', '#29392d', '#384b3c'], rock: '#434650', high: '#3b4a3e',
    mountain: '#26344f', snowcap: '#8ea2c4', trunk: '#231c17', tree: '#1b3326',
    buildings: ['#4a4f5c', '#3e4350', '#565b68'], windows: '#ffcf5c', cloud: '#56627d',
  },
];

export function getMap(i) {
  return MAPS[((i % MAPS.length) + MAPS.length) % MAPS.length];
}

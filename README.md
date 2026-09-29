# Hostile Horizon

A side-scrolling aerial combat game built with **Three.js** and packaged as an installable, offline-capable **Progressive Web App**. It is inspired by the classic Miniclip Flash game *Hostile Skies*.

Fly a jet through enemy territory. Shoot down fighters, interceptors and gunships, bomb tanks, flak guns and warships, and destroy the heavy target at the end of each sortie. Spend the credits you earn on new aircraft and on upgrades for each one.

> This is an original fan-made remake. All code, models (procedural low-poly geometry), sounds (synthesised with Web Audio) and icons are created from scratch in this repository. It is not affiliated with or endorsed by Miniclip.

## Features

- **2.5D Three.js rendering**: low-poly models with flat shading, endless procedural terrain, parallax mountains and clouds, and GPU particle explosions.
- **Eight theatres**, each with its own terrain, weather and hazards:

  | Map | What's different |
  | --- | --- |
  | Verdant Valley | Rolling farmland, forests and villages |
  | Red Canyon | Terraced mesas, canyon walls, rock hoodoos and a dust storm |
  | Coastal Assault | Animated sea and palm islands with lighthouses. Gunboats and AA ships replace tanks and flak |
  | Frozen Front | Snowy tundra in a blizzard |
  | Storm Front | Driving rain, dark clouds, lightning strikes and thunder |
  | Volcano Ridge | Lava rivers, erupting volcanoes and falling lava bombs you can shoot down |
  | Metropolis | Skyscraper skyline with lit windows, and a highway battle at dusk |
  | Night Siege | Night raid under sweeping searchlights |

- **Six aircraft**: F-5 Hawk (starter), V-7 Viper, A-12 Thunderbolt, F-40 Raptor, Su-X Specter and X-1 Nova. They differ in hull, guns, speed and ordnance. The heavier planes repair themselves when out of fire, and the top planes launch missiles in pairs or threes. Each plane has its own five-level upgrade tracks.
- **Enemies**: fighters (including ones attacking from behind), homing interceptors, gunships with rockets, tanks, time-fused flak guns and naval units.
- **Bosses**: the *B-9 Stratofortress* bomber, and the *Leviathan Airship* every third mission.
- **Weapons**: cannons aimed by the jet's pitch, homing missiles and gravity bombs.
- **Progression**: credits, combo multiplier, an aircraft shop with rendered previews, six upgrade tracks per plane, and unlockable missions. Progress is saved in `localStorage`, and older saves migrate automatically (existing upgrades move to the Hawk).
- **Input**: keyboard, mouse steering, touch (drag to fly with FIRE / MSL / BOMB buttons and optional auto-fire) and gamepad.
- **PWA**: web app manifest, precaching service worker (Workbox), offline play, fullscreen landscape display, install button and update prompt.
- **No asset downloads**: every model, texture, sound and music track is generated at runtime.

## Controls

| Action  | Keyboard       | Mouse           | Touch          | Gamepad    |
| ------- | -------------- | --------------- | -------------- | ---------- |
| Fly     | WASD / Arrows  | Move pointer    | Drag left side | Left stick |
| Cannons | Space (hold)   | Left button     | FIRE (hold)    | A / RT     |
| Missile | E              | Right button    | MSL            | B / RB     |
| Bomb    | Q              | Wheel / middle  | BOMB           | X / LB     |
| Pause   | Esc / P        | —               | II button      | Start      |

## Development

Requires Node.js 20 or newer.

```bash
npm install
npm run dev       # dev server on http://localhost:5173 (also reachable from your phone on the LAN)
npm run build     # production build in dist/ with service worker + manifest
npm run preview   # serve the production build
npm run icons     # regenerate the PWA icons in public/icons
```

The service worker is generated only for production builds. To test installability and offline mode, use `npm run build && npm run preview`.

## Deployment

A PWA must be served over HTTPS (or from `localhost`). The included workflow `.github/workflows/deploy.yml` builds the game and publishes it to **GitHub Pages** on every push to `main`:

1. In the repository go to **Settings → Pages** and set **Source** to **GitHub Actions**.
2. Push to `main`, or run the workflow manually. The game is served at `https://<user>.github.io/<repo>/`.

To deploy anywhere else, run `npm run build` and upload `dist/`. If the game lives under a sub-path, set the path at build time, for example `BASE_PATH=/my-game/ npm run build`.

## Project layout

```
index.html            DOM overlay: HUD, menus, touch controls
vite.config.js        Vite + vite-plugin-pwa (manifest, Workbox service worker)
scripts/gen-icons.mjs Dependency-free PNG/SVG icon generator
src/
  main.js             Bootstrap, service-worker registration
  game.js             Renderer, camera, main loop, mission flow, pickups
  world.js            Sky, chunked procedural terrain per map type, sea, lava, lightning, searchlights
  maps.js             The eight theatre definitions (palette, terrain, weather, hazards)
  weather.js          Rain / snow / sand / ash particles that follow the camera
  planes.js           Aircraft catalogue, stats and hangar ratings
  models.js           Procedural low-poly models (merged vertex-coloured geometry)
  player.js           Player jet movement and weapons
  enemies.js          Enemy and boss behaviours
  weapons.js          Instanced tracers, missiles, bombs, collisions
  director.js         Wave spawning, difficulty scaling, boss trigger
  fx.js               GPU point-sprite particle systems and effect presets
  audio.js            Procedural Web Audio SFX and music sequencer
  input.js            Keyboard / mouse / touch / gamepad
  ui.js               Screens, hangar, HUD updates, popups
  save.js             Save data (with v1 migration) and upgrade definitions
  noise.js            Hash / value noise / seeded RNG
```

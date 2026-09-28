# Hostile Horizon

A side-scrolling aerial combat game built with **Three.js** and packaged as an installable, offline-capable **Progressive Web App**. It is inspired by the classic Miniclip Flash game *Hostile Skies*.

Fly a jet through enemy territory. Shoot down fighters, interceptors and gunships, bomb tanks and flak guns, and destroy the heavy target at the end of each sortie. Spend the credits you earn on upgrades in the hangar.

> This is an original fan-made remake. All code, models (procedural low-poly geometry), sounds (synthesised with Web Audio) and icons are created from scratch in this repository. It is not affiliated with or endorsed by Miniclip.

## Features

- **2.5D Three.js rendering**: low-poly models with flat shading, endless procedural terrain, parallax mountains and clouds, and GPU particle explosions.
- **Five theatres**: Verdant Valley, Desert Storm, Frozen Front, Dusk Raid and Night Siege, each with its own sky, lighting and scenery.
- **Enemies**: fighters (including ones attacking from behind), homing interceptors, gunships with rockets, tanks and time-fused flak guns.
- **Bosses**: the *B-9 Stratofortress* bomber, and the *Leviathan Airship* every third mission.
- **Weapons**: cannons aimed by the jet's pitch, homing missiles and gravity bombs.
- **Progression**: credits, combo multiplier, six upgrade tracks with five levels each, and unlockable missions. Progress is saved in `localStorage`.
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
  world.js            Themes, sky, chunked procedural terrain, mountains, clouds
  models.js           Procedural low-poly models (merged vertex-coloured geometry)
  player.js           Player jet movement and weapons
  enemies.js          Enemy and boss behaviours
  weapons.js          Instanced tracers, missiles, bombs, collisions
  director.js         Wave spawning, difficulty scaling, boss trigger
  fx.js               GPU point-sprite particle systems and effect presets
  audio.js            Procedural Web Audio SFX and music sequencer
  input.js            Keyboard / mouse / touch / gamepad
  ui.js               Screens, hangar, HUD updates, popups
  save.js             Save data, upgrade definitions, player stats
  noise.js            Hash / value noise / seeded RNG
```

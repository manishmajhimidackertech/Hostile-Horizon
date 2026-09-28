import './style.css';
import { registerSW } from 'virtual:pwa-register';
import { loadSave } from './save.js';
import { AudioEngine } from './audio.js';
import { Input } from './input.js';
import { UI } from './ui.js';
import { Game } from './game.js';

const save = loadSave();
const audio = new AudioEngine();
const canvas = document.getElementById('game');
const input = new Input(canvas);
const ui = new UI({ save, audio, input });
const game = new Game(canvas, { ui, audio, input, save });
ui.attach(game);
game.showMenuScene(save.unlocked);

// Pause automatically when the app is backgrounded.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    game.pause();
    audio.suspend();
  } else {
    audio.resume();
  }
});

// Service worker: precaches the whole game for offline play.
const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    ui.showUpdateAvailable(() => updateSW(true));
  },
  onOfflineReady() {
    ui.toast('Ready to play offline', 2.5);
  },
});

if (import.meta.env.DEV) window.game = game;

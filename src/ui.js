// DOM overlay: menus, hangar, HUD, banners and floating score popups.
import {
  UPGRADES, upgradeCost, writeSave, defaultSave, emptyUpgrades, loadSave, applyGod, setGodEnabled,
} from './save.js';
import { PLANES, planeRatings, gunsUpgradeDesc } from './planes.js';
import { missionInfo } from './director.js';
import { BOSS_NAMES } from './enemies.js';

const $ = (id) => document.getElementById(id);

export class UI {
  constructor({ save, audio, input }) {
    this.save = save;
    this.audio = audio;
    this.input = input;
    this.game = null;
    this.current = null;
    this.previous = null;
    this.selectedMission = save.unlocked;
    this.hudCache = {};
    this.popupPool = [];
    this.activePopups = [];
    this.bannerTimer = null;
    this.toastTimer = null;
    this.rotateDismissed = false;
    this.blocking = false;
    this.installEvent = null;
    this._bind();
    this._applySettings();
  }

  attach(game) {
    this.game = game;
    this.show('title');
    this._refreshTitle();
  }

  // ------------------------------------------------------------ navigation

  show(name) {
    for (const el of document.querySelectorAll('.screen')) el.classList.remove('active');
    if (name) $(`screen-${name}`).classList.add('active');
    if (name !== this.current) this.previous = this.current;
    this.current = name;
    const playing = !name || name === 'pause';
    $('hud').hidden = !playing && name !== 'result';
    this._updateGodBadge();
    this._updateTouchVisibility();
    this._updateRotateHint();
  }

  _click(id, fn) {
    $(id).addEventListener('click', (e) => {
      this.audio.unlock();
      this.audio.play('ui');
      fn(e);
    });
  }

  _bind() {
    // Any first interaction unlocks audio (browser autoplay policy).
    const unlock = () => this.audio.unlock();
    addEventListener('pointerdown', unlock, { passive: true });
    addEventListener('keydown', unlock);

    this._click('btn-play', () => this.openHangar());
    this._click('btn-help', () => this.show('help'));
    this._click('btn-settings', () => this.show('settings'));
    for (const el of document.querySelectorAll('[data-back]')) {
      el.addEventListener('click', () => {
        this.audio.play('ui');
        this.show(this.previous === 'pause' ? 'pause' : this.previous === 'hangar' ? 'hangar' : 'title');
      });
    }
    this._click('hangar-back', () => {
      this.game.previewPlane(this.save.plane);
      this.show('title');
      this._refreshTitle();
    });
    this._click('mission-prev', () => this._selectMission(-1));
    this._click('mission-next', () => this._selectMission(1));
    this._click('btn-launch', () => this.launch(this.selectedMission));
    this._click('plane-prev', () => this._selectPlane(-1));
    this._click('plane-next', () => this._selectPlane(1));
    $('plane-action').addEventListener('click', () => {
      this.audio.unlock();
      this._planeAction();
    });

    this._click('btn-pause', () => this.game.pause());
    this._click('btn-resume', () => this.game.resume());
    this._click('btn-restart', () => this.launch(this.game.mission.number));
    this._click('btn-pause-settings', () => this.show('settings'));
    this._click('btn-abort', () => this.game.abort());

    this._click('btn-next', () => {
      if (this.lastResult && this.lastResult.success) this.launch(this.lastResult.mission + 1);
      else this.launch(this.lastResult.mission);
    });
    this._click('btn-retry', () => this.launch(this.lastResult.mission));
    this._click('btn-to-hangar', () => this.openHangar());

    // Settings
    const s = this.save.settings;
    this._click('set-sfx', () => {
      s.sfx = !s.sfx;
      this._applySettings();
    });
    this._click('set-music', () => {
      s.music = !s.music;
      this._applySettings();
    });
    this._click('set-autofire', () => {
      s.autofire = !this.input.autofire;
      this._applySettings();
    });
    for (const b of $('set-quality').querySelectorAll('button')) {
      b.addEventListener('click', () => {
        this.audio.play('ui');
        s.quality = b.dataset.q;
        this._applySettings();
        if (this.game) this.game.setQuality(s.quality);
      });
    }
    this._click('set-fullscreen', () => this.toggleFullscreen());
    document.addEventListener('fullscreenchange', () => this._applySettings());
    let resetArmed = false;
    this._click('set-reset', () => {
      const btn = $('set-reset');
      if (!resetArmed) {
        resetArmed = true;
        btn.textContent = 'CONFIRM?';
        setTimeout(() => {
          resetArmed = false;
          btn.textContent = 'RESET';
        }, 3000);
        return;
      }
      resetArmed = false;
      btn.textContent = 'RESET';
      const fresh = defaultSave();
      fresh.settings = { ...this.save.settings };
      Object.assign(this.save, fresh);
      applyGod(this.save);
      writeSave(this.save);
      this.selectedMission = 1;
      this.toast('Progress reset', 2);
    });

    // Hidden god mode: type "godmode" or tap the title logo 7 times.
    let typed = '';
    addEventListener('keydown', (e) => {
      if (e.key.length !== 1) return;
      typed = (typed + e.key.toLowerCase()).slice(-7);
      if (typed === 'godmode') {
        typed = '';
        this.toggleGod();
      }
    });
    let taps = [];
    document.querySelector('.logo').addEventListener('click', () => {
      const now = performance.now();
      taps = taps.filter((t) => now - t < 4000);
      taps.push(now);
      if (taps.length >= 7) {
        taps = [];
        this.toggleGod();
      }
    });
    this._click('set-god', () => this.toggleGod());
    this._click('btn-skip-boss', () => {
      this.game.skipToBoss();
      this.game.resume();
    });
    this._updateGodBadge();

    // Install prompt (Chromium browsers)
    addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.installEvent = e;
      $('btn-install').hidden = false;
    });
    addEventListener('appinstalled', () => {
      $('btn-install').hidden = true;
      this.installEvent = null;
    });
    this._click('btn-install', async () => {
      if (!this.installEvent) return;
      this.installEvent.prompt();
      await this.installEvent.userChoice.catch(() => null);
      this.installEvent = null;
      $('btn-install').hidden = true;
    });

    this._click('btn-rotate-dismiss', () => {
      this.rotateDismissed = true;
      this._updateRotateHint();
    });
    matchMedia('(orientation: portrait)').addEventListener('change', () => this._updateRotateHint());

    this.input.bindTouch({ steer: $('touch-steer'), fire: $('t-fire'), missile: $('t-missile'), bomb: $('t-bomb') });
    this.input.onModeChange = () => {
      this._updateTouchVisibility();
      if (this.save.settings.autofire === null) this._applySettings();
    };
  }

  _applySettings() {
    const s = this.save.settings;
    this.audio.setSfx(s.sfx);
    this.audio.setMusic(s.music);
    // Auto-fire defaults to on for touch play unless the player chose otherwise.
    this.input.autofire = s.autofire === null ? this.input.mode === 'touch' : s.autofire;
    $('set-sfx').classList.toggle('on', s.sfx);
    $('set-music').classList.toggle('on', s.music);
    $('set-autofire').classList.toggle('on', this.input.autofire);
    $('set-fullscreen').classList.toggle('on', !!document.fullscreenElement);
    for (const b of $('set-quality').querySelectorAll('button')) b.classList.toggle('on', b.dataset.q === s.quality);
    writeSave(this.save);
  }

  async toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    } catch {
      this.toast('Fullscreen is not available here', 2);
    }
  }

  async _enterImmersive() {
    // On phones, go fullscreen + landscape when a sortie starts (ignored where unsupported).
    if (!matchMedia('(pointer: coarse)').matches) return;
    if (matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches) return;
    try {
      if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      }
      await screen.orientation?.lock?.('landscape');
    } catch {
      // Not supported (e.g. iOS Safari) - the rotate hint covers it.
    }
  }

  _updateTouchVisibility() {
    const playing = !this.current;
    $('touch').hidden = !(playing && this.input.mode === 'touch');
  }

  _updateRotateHint() {
    const portrait = matchMedia('(orientation: portrait)').matches;
    const coarse = matchMedia('(pointer: coarse)').matches;
    const show = portrait && coarse && !this.rotateDismissed && !this.current;
    $('rotate-hint').hidden = !show;
    this.blocking = show;
  }

  // Swap between the real save and the god-mode test profile (kept in separate slots).
  toggleGod() {
    const on = this.save.profile !== 'god';
    writeSave(this.save);
    setGodEnabled(on);
    const next = loadSave(on ? 'god' : 'main');
    next.settings = { ...this.save.settings };
    for (const k of Object.keys(this.save)) delete this.save[k];
    Object.assign(this.save, next);
    writeSave(this.save);
    this.audio.play(on ? 'buy' : 'ui');
    this.toast(on
      ? 'GOD MODE ON · test profile with unlimited credits, health and ammo'
      : 'God mode off · back to your real save', 3);
    this._applySettings();
    this._updateGodBadge();
    if (this.game) {
      this.hudCache = {};
      if (this.current === 'hangar') this.openHangar();
      else if (this.game.state === 'menu') this.game.showMenuScene(Math.min(this.selectedMission, this.save.unlocked));
      this._refreshTitle();
    }
  }

  // The badge only shows in flight (it would cover panel controls in menus);
  // the title screen gets a text note instead.
  _updateGodBadge() {
    const on = this.save.profile === 'god';
    $('god-badge').hidden = !on || $('hud').hidden;
    $('title-god').hidden = !on;
    $('set-god-row').hidden = !on;
  }

  _refreshTitle() {
    const best = this.save.highScore;
    $('title-best').textContent = best ? `Best score ${best.toLocaleString()}` : '';
  }

  showUpdateAvailable(apply) {
    $('update-note').hidden = false;
    $('btn-update').onclick = apply;
  }

  // ------------------------------------------------------------ hangar

  openHangar() {
    this.selectedMission = Math.min(this.selectedMission, this.save.unlocked);
    this.viewPlane = Math.max(0, PLANES.findIndex((p) => p.id === this.save.plane));
    this.game.showMenuScene(this.selectedMission);
    this.show('hangar');
    this._renderHangar();
  }

  _selectMission(d) {
    const n = Math.max(1, Math.min(this.save.unlocked, this.selectedMission + d));
    if (n === this.selectedMission) return;
    this.selectedMission = n;
    this.game.showMenuScene(n);
    this.game.previewPlane(PLANES[this.viewPlane].id);
    this._renderHangar();
  }

  _renderHangar() {
    const save = this.save;
    const m = missionInfo(this.selectedMission);
    applyGod(save);
    $('hangar-credits').textContent = save.profile === 'god' ? '∞' : save.credits.toLocaleString();
    $('mission-num').textContent = `MISSION ${m.number}`;
    $('mission-name').textContent = m.name;
    $('mission-desc').textContent = m.desc;
    $('mission-boss').textContent = `Target: ${BOSS_NAMES[m.boss]}`;
    $('mission-prev').disabled = m.number <= 1;
    $('mission-next').disabled = m.number >= save.unlocked;
    $('hangar-record').textContent = save.highScore ? `Best score ${save.highScore.toLocaleString()} · ${save.stats.kills} kills total` : 'Complete a mission to unlock the next one';
    this._renderPlane();
  }

  _selectPlane(d) {
    const n = PLANES.length;
    this.viewPlane = (this.viewPlane + d + n) % n;
    this.game.previewPlane(PLANES[this.viewPlane].id);
    this._renderPlane();
  }

  _renderPlane() {
    const save = this.save;
    const plane = PLANES[this.viewPlane];
    const owned = !!save.planes[plane.id];
    const inUse = save.plane === plane.id;
    const ups = owned ? save.planes[plane.id].upgrades : emptyUpgrades();

    $('plane-img').src = this.game.planeThumb(plane.id);
    $('plane-count').textContent = `AIRCRAFT ${this.viewPlane + 1} / ${PLANES.length}`;
    $('plane-name').textContent = plane.name.toUpperCase();
    $('plane-role').textContent = plane.role;
    const tag = $('plane-tag');
    tag.textContent = inUse ? 'IN USE' : owned ? 'OWNED' : 'LOCKED';
    tag.className = 'plane-tag' + (inUse ? ' using' : owned ? '' : ' locked');

    const ratings = planeRatings(plane, ups);
    const stats = $('plane-stats');
    stats.textContent = '';
    for (const [key, label] of [['hull', 'HULL'], ['fire', 'FIREPOWER'], ['speed', 'SPEED'], ['ordnance', 'ORDNANCE']]) {
      const l = document.createElement('span');
      l.textContent = label;
      const bar = document.createElement('div');
      bar.className = 'stat-bar';
      const fill = document.createElement('i');
      fill.style.width = `${Math.round(ratings[key] * 100)}%`;
      bar.appendChild(fill);
      stats.append(l, bar);
    }

    const action = $('plane-action');
    action.textContent = '';
    action.className = 'btn primary';
    action.disabled = false;
    if (inUse) {
      action.textContent = 'IN USE';
      action.className = 'btn owned';
      action.disabled = true;
    } else if (owned) {
      action.textContent = 'SELECT';
    } else {
      const coin = document.createElement('span');
      coin.className = 'coin';
      action.append(document.createTextNode('BUY '), coin, document.createTextNode(plane.price.toLocaleString()));
      action.disabled = save.credits < plane.price;
    }

    const wrap = $('upgrades');
    wrap.textContent = '';
    wrap.classList.toggle('locked', !owned);
    for (const up of UPGRADES) {
      const lvl = ups[up.id];
      const maxed = lvl >= up.max;
      const cost = maxed ? 0 : upgradeCost(up, lvl, plane);
      const card = document.createElement('div');
      card.className = 'upgrade' + (maxed ? ' maxed' : '');
      const h = document.createElement('h3');
      h.textContent = up.name.toUpperCase();
      const p = document.createElement('p');
      p.textContent = up.id === 'guns' ? gunsUpgradeDesc(plane) : up.desc;
      const pips = document.createElement('div');
      pips.className = 'pips';
      for (let i = 0; i < up.max; i++) {
        const pip = document.createElement('div');
        pip.className = 'pip' + (i < lvl ? ' on' : '');
        pips.appendChild(pip);
      }
      const btn = document.createElement('button');
      btn.className = 'btn';
      if (maxed) {
        btn.textContent = 'MAXED';
        btn.disabled = true;
      } else {
        const coin = document.createElement('span');
        coin.className = 'coin';
        btn.append(coin, document.createTextNode(cost.toLocaleString()));
        btn.disabled = !owned || save.credits < cost;
        btn.addEventListener('click', () => this._buy(plane, up));
      }
      card.append(h, p, pips, btn);
      wrap.appendChild(card);
    }
    if (!owned) {
      const note = document.createElement('div');
      note.className = 'upgrades-note';
      note.textContent = 'Buy this aircraft to unlock its upgrades';
      wrap.prepend(note);
    }
  }

  _planeAction() {
    const save = this.save;
    const plane = PLANES[this.viewPlane];
    if (!save.planes[plane.id]) {
      if (save.credits < plane.price) {
        this.audio.play('deny');
        return;
      }
      save.credits -= plane.price;
      save.planes[plane.id] = { upgrades: emptyUpgrades() };
      this.audio.play('buy');
      this.toast(`${plane.name} added to your hangar`, 2.5);
    }
    save.plane = plane.id;
    writeSave(save);
    this.game.previewPlane(plane.id);
    this._renderHangar();
  }

  _buy(plane, up) {
    const save = this.save;
    const owned = save.planes[plane.id];
    if (!owned) return;
    const lvl = owned.upgrades[up.id];
    if (lvl >= up.max) return;
    const cost = upgradeCost(up, lvl, plane);
    if (save.credits < cost) {
      this.audio.play('deny');
      return;
    }
    save.credits -= cost;
    owned.upgrades[up.id] = lvl + 1;
    writeSave(save);
    this.audio.play('buy');
    this._renderHangar();
  }

  launch(n) {
    this.audio.unlock();
    this.selectedMission = Math.min(n, this.save.unlocked);
    this._enterImmersive();
    this.show(null);
    this.game.startMission(this.selectedMission);
  }

  // ------------------------------------------------------------ in-game

  onMissionStart(mission) {
    $('hud-mission').textContent = `MISSION ${mission.number}`;
    this.hudCache = {};
    this.setBoss(null);
  }

  showPause() {
    const g = this.game;
    $('btn-skip-boss').hidden = !(g.god && g.director && g.director.bossState === 'none');
    this.show('pause');
  }

  hidePause() {
    this.show(null);
  }

  showResult(r) {
    this.lastResult = r;
    const title = $('result-title');
    title.textContent = r.success ? 'MISSION COMPLETE' : r.aborted ? 'MISSION ABORTED' : 'SHOT DOWN';
    title.className = r.success ? 'win' : 'fail';
    const info = missionInfo(r.mission);
    $('result-sub').textContent = `Mission ${r.mission} · ${info.name}`;
    const dl = $('result-stats');
    dl.textContent = '';
    const rows = [
      ['Score', r.score.toLocaleString()],
      ['Kills', r.kills],
      ['Best combo', r.maxCombo > 1 ? `×${r.maxCombo}` : '—'],
      ['Accuracy', `${r.accuracy}%`],
      ['Credits collected', r.credits.toLocaleString()],
    ];
    if (r.success) rows.push(['Mission bonus', r.bonus.toLocaleString()]);
    rows.push(['Total earned', r.total.toLocaleString()]);
    rows.forEach(([k, v], i) => {
      const dt = document.createElement('dt');
      dt.textContent = k;
      const dd = document.createElement('dd');
      dd.textContent = v;
      if (i === rows.length - 1) dd.className = 'total';
      dl.append(dt, dd);
    });
    if (r.newHigh && r.score > 0) {
      const dt = document.createElement('dt');
      dt.className = 'new-high';
      dt.textContent = 'NEW HIGH SCORE!';
      dl.prepend(dt);
    }
    $('btn-next').textContent = r.success ? 'NEXT MISSION' : 'TRY AGAIN';
    $('btn-retry').hidden = !r.success;
    this.show('result');
  }

  setBoss(name) {
    $('boss-bar').hidden = !name;
    if (name) $('boss-name').textContent = name.toUpperCase();
  }

  banner(text, seconds = 2, cls = '') {
    const el = $('banner');
    el.textContent = text;
    el.className = 'show ' + cls;
    clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => (el.className = cls), seconds * 1000);
  }

  toast(text, seconds = 3) {
    const el = $('toast');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => el.classList.remove('show'), seconds * 1000);
  }

  lightningFlash() {
    const el = $('lightning-flash');
    el.classList.add('on');
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('on')));
  }

  damageFlash() {
    const el = $('damage-vignette');
    el.classList.add('on');
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('on')));
  }

  _set(key, value, fn) {
    if (this.hudCache[key] === value) return;
    this.hudCache[key] = value;
    fn(value);
  }

  updateHud(g) {
    const p = g.player;
    const s = g.stats;
    const hull = p.maxHp ? p.hp / p.maxHp : 0;
    this._set('hull', Math.round(hull * 200), () => {
      $('hud-hull').style.transform = `scaleX(${hull})`;
      $('hud-hull').parentElement.classList.toggle('low', hull < 0.3);
    });
    const inf = g.god;
    this._set('msl', inf ? '∞' : p.missiles, (v) => {
      $('hud-missiles').textContent = v;
      $('t-missile-count').textContent = v;
    });
    this._set('bmb', inf ? '∞' : p.bombs, (v) => {
      $('hud-bombs').textContent = v;
      $('t-bomb-count').textContent = v;
    });
    this._set('score', s.score, (v) => ($('hud-score').textContent = v.toLocaleString()));
    this._set('credits', s.credits, (v) => ($('hud-credits').textContent = v.toLocaleString()));
    this._set('combo', s.combo, (v) => {
      const el = $('hud-combo');
      el.textContent = v > 1 ? `COMBO ×${v}` : '';
      el.classList.remove('pulse');
      if (v > 1) {
        void el.offsetWidth;
        el.classList.add('pulse');
      }
    });
    if (g.director) {
      this._set('prog', Math.round(g.director.progress * 300), () => {
        $('hud-progress').style.transform = `scaleX(${g.director.progress})`;
      });
    }
    if (g.boss) {
      const f = Math.max(0, g.boss.hp / g.boss.maxHp);
      this._set('boss', Math.round(f * 300), () => ($('boss-fill').style.transform = `scaleX(${f})`));
    }
  }

  // Floating world-space text.
  popup(x, y, text, cls = '') {
    let el = this.popupPool.pop();
    if (!el) {
      el = document.createElement('div');
      $('popups').appendChild(el);
    }
    el.className = 'popup ' + cls;
    el.textContent = text;
    el.style.display = '';
    this.activePopups.push({ el, x, y, t: 0, life: cls === 'big' ? 1.6 : 0.9 });
    if (this.activePopups.length > 30) this._releasePopup(0);
  }

  _releasePopup(i) {
    const p = this.activePopups[i];
    p.el.style.display = 'none';
    this.popupPool.push(p.el);
    this.activePopups.splice(i, 1);
  }

  updatePopups(g, dt) {
    for (let i = this.activePopups.length - 1; i >= 0; i--) {
      const p = this.activePopups[i];
      p.t += dt;
      if (p.t >= p.life) {
        this._releasePopup(i);
        continue;
      }
      p.x += g.scroll * dt;
      p.y += dt * 4;
      const [sx, sy] = g.toScreen(p.x, p.y);
      const a = 1 - Math.max(0, (p.t - p.life * 0.6) / (p.life * 0.4));
      p.el.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px) translate(-50%, -50%)`;
      p.el.style.opacity = a.toFixed(2);
    }
  }
}

import * as std from 'std';
import { ASSETS, AUDIO } from './assets.js';
import { SCENERY } from './scenery.js';
import { buildCheckpointArt, frameForTime } from './checkpoint_art.js';
import { campaign as CAMPAIGN, multiplayer as MULTIPLAYER, decodeLevel } from './levels.js';
import { createGame, stepGame, restartGame } from './simulation.js';
import { createSaveStore } from './save.js';
import { runChecks } from '../tests/checks.js';
import { MENU_ART, moveMain } from './menu.js';
import { CREDITS } from './credits.js';
import { createIntro, stepIntro, dueSounds, introTiles, pagesAhead, SOUND_FILES } from './intro.js';

const S = 448 / 501,
  OX0 = (640 - 640 * S) / 2;
let OX = OX0;
const HUDH = Math.round(73 * S),
  WS = (448 - HUDH) / 501,
  WVW = (640 * S) / WS;
let K = S,
  OY = 0,
  VW = 640;

const ANIMS = {
  idle: [0],
  run: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  fall: [19, 20, 21, 22, 13, 14, 15, 16, 17, 18],
  morph: Array.from({ length: 22 }, (_, i) => 23 + i),
  death: [45, 46, 47, 48, 49, 50, 51],
  switch: [60, 62, 64, 66, 70, 72, 74],
  push: [52, 53, 54, 55, 56, 57, 58],
  landing: [76, 78, 80, 82, 84, 86],
  slide: [89],
  runfast: [91, 92, 93, 94, 95, 96, 97, 98, 99],
};

const ENEMY_ANIMS = {
  ...ANIMS,
  run: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14],
  fall: [15, 16, 17, 18, 19, 20, 21, 22, 23, 24],
  switch: [45, 47, 49, 51, 53, 55, 57, 59, 61],
  push: [30, 31, 32, 33, 34, 35, 36, 37, 38, 39],
  landing: [71, 73, 75, 65, 67, 69],
  slide: [88, 87, 89],
  runfast: [77, 78, 79, 80, 81, 82, 83, 84, 85],
};

const RATES = { run: 20, fall: 12, morph: 20, death: 10, switch: 27, push: 15, landing: 30, slide: 20, runfast: 20 };
const COLORS = [
  [65, 198, 255],
  [100, 235, 125],
  [255, 219, 70],
  [255, 105, 110],
];

export function startGame({
  validation = false,
  menuValidation = false,
  endingValidation = false,
  perfRun = false,
  perfCheckpoint = 0,
  soak = false,
  soakSpeed = 260,
  useAtlas = true, // false: old baked 512 px pages streamed through ImageList
  startScore = 0,
  startCheckpoint = null, // comparison runs: boot straight into the campaign at this checkpoint, nothing is saved
} = {}) {
  const mode = Screen.getMode();
  Object.assign(mode, {
    mode: Screen.NTSC,
    width: 640,
    height: 448,
    psm: Screen.CT24,
    zbuffering: false,
    double_buffering: true,
  });
  Screen.setMode(mode);
  Screen.setVSync(true);
  const white = Color.new(245, 248, 255),
    cyan = Color.new(113, 224, 255),
    yellow = Color.new(255, 220, 90),
    muted = Color.new(170, 184, 200),
    black = Color.new(0, 0, 0),
    shade = Color.new(0, 0, 0, 104),
    panel = Color.new(16, 25, 38, 125);
  const ETHNO = 'assets/fonts/ethno.ttf',
    font = new Font(ETHNO, { size: 13 }),
    large = new Font(ETHNO, { size: 22 }),
    fScore = new Font(ETHNO, { size: 18 }),
    fWins = new Font(ETHNO, { size: 15 }),
    fBonus = new Font(ETHNO, { size: 16 }),
    fEnd = new Font(ETHNO, { size: 28 });
  font.outline = 1;
  font.outlineColor = black;
  large.outline = 1;
  large.outlineColor = black;
  fBonus.outline = 1;
  fBonus.outlineColor = black;
  for (const f of [font, large, fScore, fWins, fBonus, fEnd]) f.preload(Font.ASCII, { budgetMs: 0 });
  const images = new Map();
  let bytes = 0,
    drawFrameNumber = 0;
  const perf = { sprites: 0, missing: 0, names: [], queued: 0, frames: [], loads: 0, frees: 0, events: [], sec: {}, last: 0 };
  const pf = (k) => {
    if (!perfRun) return;
    const t = System.getMilliseconds();
    if (k !== '_') {
      perf.sec[k] = (perf.sec[k] || 0) + (t - perf.last);
    }
    perf.last = t;
  };

  const textureRetry = new Map();

  function texture(path) {
    let e = images.get(path);
    if (!e) {
      perf.loads++;
      if (perfRun && perf.names.length < 6) perf.names.push(path.replace('assets/', ''));
      if ((textureRetry.get(path) || 0) > drawFrameNumber) return null;
      let image = null;
      for (let attempt = 0; attempt < 2 && !image; attempt++) {
        try {
          const img = new Image(path);
          if (img.ready()) image = img;
        } catch (err) {
          // out of EE/VRAM: free everything idle and try once more
        }
        if (!image && attempt === 0) emergencyTrim();
      }
      if (!image) {
        console.log('GG_TEXTURE_FAIL ' + path + ' ee=' + System.getFreeMemory() + ' vram=' + Screen.getFreeVRAM() + ' bytes=' + bytes);
        textureRetry.set(path, drawFrameNumber + 10);
        return null;
      }
      image.optimize();
      e = { image, seen: 0, bytes: image.size };
      images.set(path, e);
      bytes += e.bytes;
    }
    e.seen = drawFrameNumber;
    return e.image;
  }

  const loader = new ImageList({ workers: 1 });
  const retryAt = new Map();

  function emergencyTrim() {
    for (const [path, e] of images) {
      if (pinned.has(path) || drawFrameNumber - e.seen <= 1) continue;
      e.image.free();
      images.delete(path);
      bytes -= e.bytes;
    }
    std.gc();
  }

  function tile(path) {
    let e = images.get(path);
    if (e && !e.async) {
      e.seen = drawFrameNumber;
      return e.image;
    }

    if (e) {
      e.seen = drawFrameNumber;
      if (e.image.ready()) {
        const real = e.image.size;
        if (real > 0) {
          bytes += real - e.bytes;
          e.bytes = real;
        }
        e.async = false;
        return e.image;
      }
      if (!e.image.failed()) return null;
      const err = e.image.error && e.image.error();
      console.log(
        'GG_TILE_FAIL ' +
          path +
          ' ' +
          JSON.stringify(err || {}) +
          ' ee=' +
          System.getFreeMemory() +
          ' vram=' +
          Screen.getFreeVRAM() +
          ' bytes=' +
          bytes
      );
      e.image.free();
      images.delete(path);
      bytes -= e.bytes;
      retryAt.set(path, drawFrameNumber + 6);
      emergencyTrim();
      return null;
    }

    if ((retryAt.get(path) || 0) > drawFrameNumber) return null;
    retryAt.delete(path);
    prefetchTile(path, ImageList.HIGH);
    return null;
  }

  function prefetchTile(path, priority = ImageList.LOW) {
    const e = images.get(path);
    if (e) {
      e.seen = drawFrameNumber;
      return;
    }
    try {
      perf.queued++;
      images.set(path, { image: loader.load(path, { priority }), seen: drawFrameNumber, bytes: 262144, async: true });
      bytes += 262144;
    } catch (err) {
      console.log('GG_TILE_QUEUE_FAIL ' + path + ' ' + err + ' ee=' + System.getFreeMemory());
      retryAt.set(path, drawFrameNumber + 6);
      emergencyTrim();
    }
  }

  // How far ahead of the camera tiles are queued: grows with speed so fast runs don't outrun the loader.
  function lookahead() {
    const p = state && state.players && state.players[0];
    const v = p && p.vx > 0 ? p.vx : 0;
    return Math.max(1100, Math.min(2300, Math.round(v * 2.4)));
  }

  function prefetchAround(camera, priority) {
    if (!renderBins) return;
    for (const kind of ['back', 'front'])
      for (const q of renderBins[kind])
        if (q.x + q.w >= camera - 64 && q.x <= camera + 640 + lookahead()) prefetchTile(q.path, priority);
  }

  const pinned = new Set();

  function warmActors() {
    const t0 = System.getMilliseconds();
    try {
      warmActors2();
    } finally {
      console.log('GG_WARM_MS ' + (System.getMilliseconds() - t0));
    }
  }

  function warmActors2() {
    for (const name of [
      'Player_ImgPlayer',
      'Player_ImgPlayerGreen',
      'Player_ImgPlayerYellow',
      'Player_ImgPlayerRed',
      'Enemy_ImgPlayer',
      'PlayState_ImgPuff',
      'PlayState_ImgSpeed',
      'PlayState_ImgSonicBoom',
      'PlayState_ImgLevelCleared',
      'PlayState_ImgHudBg',
      'PlayState_ImgPauseBut',
      'MenuState_ImgSoundButOn',
      'MenuState_ImgSoundBut',
    ]) {
      const a = ASSETS[name];
      if (!a) continue;
      if (/^Player_ImgPlayer./.test(name) && players < (name.endsWith('Green') ? 2 : name.endsWith('Yellow') ? 3 : 4))
        continue;
      for (const q of a.frames ? [...new Set(a.frames.map((f) => f.path))] : a.parts.map((q) => q.path)) {
        texture(q);
        pinned.add(q);
      }
    }
  }

  const IMAGE_CAP = 8 * 1024 * 1024;

  function trimImages() {
    if (drawFrameNumber % 30 && bytes < IMAGE_CAP) return;
    for (const [path, e] of images) {
      if (pinned.has(path)) continue;
      const idle = drawFrameNumber - e.seen;
      if (idle > 3 && ((bytes > IMAGE_CAP && idle > 90) || idle > 1800)) {
        perf.frees++;
        e.image.free();
        images.delete(path);
        bytes -= e.bytes;
      }
    }
  }

  function art(name, x, y, sx = 1, sy = 1, tint = undefined, angle = 0) {
    const a = ASSETS[name];
    if (!a) {
      if (!missing.has(name)) {
        console.log('GG_MISSING_ASSET ' + name);
        missing.add(name);
      }
      return;
    }
    if (x + a.w * Math.abs(sx) < 0 || x > VW || y + a.h * Math.abs(sy) < 0 || y > 501) return;
    if (a.frames) {
      const n = Math.floor(clock * (name === 'PlayState_ImgSpeed' ? 20 : 18)) % a.frames.length;
      frame(name, n, x, y, { sx, sy });
      return;
    }
    for (const q of a.parts) {
      const img = texture(q.path);
      if (!img) continue;
      img.draw(Math.round(OX + (x + q.x * sx) * K), Math.round(OY + (y + q.y * sy) * K), {
        width: q.w * sx * K,
        height: q.h * sy * K,
        color: tint,
        angle: angle || undefined,
      });
    }
  }

  function frame(name, n, x, y, { flipY = false, flipX = false, angle = 0, sx = 1, sy = 1, tint = undefined } = {}) {
    const a = ASSETS[name],
      q = a && a.frames && a.frames[n];
    if (!q) return;
    const img = texture(q.path);
    if (!img) return;
    img.draw(OX + x * K, OY + y * K, {
      startx: q.x,
      starty: q.y,
      endx: q.x + q.w,
      endy: q.y + q.h,
      width: q.w * K * sx,
      height: q.h * K * sy,
      flipY,
      flipX,
      angle,
      color: tint,
    });
  }

  const missing = new Set();
  let lastPerfLabel = '',
    perfWait = 0;
  let loadedMeta = null,
    loadedLevel = null;

  function loadLevel(meta) {
    if (loadedMeta === meta) return loadedLevel;
    const t0 = System.getMilliseconds();
    state = null;
    renderLevel = null;
    renderBins = null;
    freeAtlas();
    loadedLevel = null;
    loadedMeta = null;
    std.gc();
    console.log('GG_LEVEL_LOAD ' + meta.id);
    const t1 = System.getMilliseconds(),
      txt = std.loadFile(meta.path),
      t2 = System.getMilliseconds(),
      raw = JSON.parse(txt),
      t3 = System.getMilliseconds();
    loadedLevel = decodeLevel(raw);
    console.log(
      'GG_LEVEL_PHASES ' +
        meta.id +
        ' read=' +
        (t2 - t1) +
        ' parse=' +
        (t3 - t2) +
        ' decode=' +
        (System.getMilliseconds() - t3) +
        ' gcBefore=' +
        (t1 - t0)
    );
    loadedMeta = meta;
    console.log('GG_LEVEL_READY ' + meta.id + ' ' + System.getFreeMemory() + ' ms=' + (System.getMilliseconds() - t0));
    return loadedLevel;
  }

  const text = (str, x, y, color = white, big = false) => {
    const f = big ? large : font;
    f.color = color;
    f.print(OX + x * S, y * S, str);
  };
  const center = (str, y, color = white, big = false) => {
    const f = big ? large : font;
    f.color = color;
    const w = f.getTextSize(str).width;
    f.print(320 - w / 2, y * S, str);
  };

  function box(x, y, w, h, c = panel) {
    Draw.rect(OX + x * S, y * S, w * S, h * S, c);
  }

  Gamepad.configure({ multitap: true });
  const pads = [0, 1, 2, 3].map((i) => Gamepad.player(i));
  const pending = [false, false, false, false];
  const store = createSaveStore(!validation && !menuValidation && !startCheckpoint),
    prefs = store.data;
  let multiTimer = 0.5, // PlayState.multiStartFlicker (static in the original: it carries over between rounds)
    tutorial = 0,
    screen = 'menu',
    cursor = 0,
    subCursor = 0,
    returnTo = 'menu',
    paused = false,
    notice = '',
    noticeLeft = 0,
    state = null,
    players = 2,
    track = 0,
    round = 1,
    wins = [0, 0, 0, 0],
    clock = 0;
  const menuMotion = { left: -250, right: 709, logo: 0, direction: 1, slow: false };
  let fadeFx = null,
    splashFx = null;
  let creditsTime = 0,
    lastUi = '';
  if (menuValidation) {
    prefs.checkpoint = { x: 7442, y: 105, index: 1, speed: 220 };
    prefs.score = 150;
    prefs.best = 4321;
  }
  let music = null,
    musicName = '',
    musicPlaying = false,
    sceneTime = 0,
    validationIndex = -1,
    validationHold = 0,
    validationDone = false,
    pendingView = null;
  const sounds = {},
    puffs = [];
  let checkpointArt = null,
    checkpointTimes = {},
    checkpointBanner = 0,
    renderAlpha = 1;

  function sfx(name, vol = 1) {
    if (!prefs.sfx || !AUDIO[name]) return;
    if (endingValidation) console.log('GG_SFX ' + name + ' ' + vol);
    try {
      if (!sounds[name]) sounds[name] = new Sound.Sfx(AUDIO[name].path);
      sounds[name].volume = Math.round(55 * vol);
      sounds[name].play();
    } catch (e) {
      console.log('GG_AUDIO_ERROR ' + name + ' ' + e);
    }
  }

  const ev = { n: 0, t: 0, hold: 0 };
  const loops = {};

  function loopSfx(name, want, vol = 1) {
    const l = loops[name] || (loops[name] = { ch: -1 });
    const s = sounds[name] || (AUDIO[name] && prefs.sfx ? (sounds[name] = new Sound.Sfx(AUDIO[name].path)) : null);
    if (!s) return;
    try {
      if (endingValidation && (want && prefs.sfx) !== !!l.on) {
        l.on = want && prefs.sfx;
        console.log('GG_LOOP ' + name + ' ' + (l.on ? 'on' : 'off'));
      }
      if (want && prefs.sfx) {
        if (l.ch < 0 || !s.playing(l.ch)) {
          s.volume = Math.round(55 * vol);
          l.ch = s.play();
        }
      } else if (l.ch >= 0) {
        s.stop(l.ch);
        l.ch = -1;
      }
    } catch (e) {
      console.log('GG_AUDIO_ERROR ' + name + ' ' + e);
    }
  }

  function stopLoops() {
    for (const n of Object.keys(loops)) loopSfx(n, false);
    accelLeft = 0;
  }

  let endTime = 0,
    bannerY = 100,
    accelLeft = 0,
    boom = null,
    flashFx = null,
    shakeFx = null,
    bonusText = '',
    bonusTime = 0;

  function flash(r, g, b, dur = 1, a = 1) {
    flashFx = { r, g, b, dur, t: 0, a };
  }

  function quake(amount, dur) {
    shakeFx = { amount, dur, t: 0 };
  }

  function fadeOut(dur, cb) {
    fadeFx = { t: 0, dur, cb };
  }

  function withSplash(cb) {
    screen = 'loading';
    paused = false;
    splashFx = { n: 0, cb };
  }

  function goTo(fn, dur = 1) {
    fadeMusicOut(dur * 800);
    fadeOut(dur, () => withSplash(fn));
  }

  const streams = {};

  const GAME_MUSIC_VOLUME = 70; // Sound.setVolume scale 0-100; was 30 (sfx sit at 55)

  function playMusic(name, fresh = false) {
    if (musicName !== name) {
      if (music && musicPlaying) {
        music.pause();
        musicPlaying = false;
      }
      music = streams[name] || (streams[name] = new Sound.Stream(AUDIO[name].path));
      music.loop = true;
      musicName = name;
      musicPlaying = false;
      if (fresh || name === 'SndMusic') music.rewind();
    }
    if (prefs.music && !musicPlaying) {
      Sound.setVolume(name === 'SndMenuMusic' ? 27 : GAME_MUSIC_VOLUME);
      music.play({ fade: 400 });
      musicPlaying = true;
      console.log('GG_MUSIC ' + name + ' converted=' + music.converted);
    } else if (!prefs.music && musicPlaying) {
      music.pause();
      musicPlaying = false;
    }
  }

  function fadeMusicOut(ms) {
    if (music && musicPlaying) {
      music.pause({ fade: ms });
      musicPlaying = false;
      console.log('GG_MUSIC_FADE_OUT ' + ms);
    }
  }

  function preloadSfx() {
    let n = 0;
    for (const name of Object.keys(AUDIO)) {
      if (sounds[name] || /Music$/.test(name)) continue;
      try {
        sounds[name] = new Sound.Sfx(AUDIO[name].path);
        n++;
      } catch (e) {
        console.log('GG_AUDIO_ERROR preload ' + name + ' ' + e);
      }
    }
    console.log('GG_SFX_PRELOADED ' + n + ' ' + JSON.stringify(Sound.getMemoryStats()));
  }

  function message(s) {
    notice = s;
    noticeLeft = 3;
  }

  function beginEndingValidation() {
    tutorial = 0;
    puffs.length = 0;
    checkpointBanner = 0;
    checkpointTimes = {};
    state = createGame(loadLevel(CAMPAIGN), {
      checkpoint: { x: 122440, y: 241, speed: 600, index: 20 },
      score: 2000,
      morph: false,
      enemy: false,
      autoRestart: false,
    });
    screen = 'game';
    paused = false;
    sceneTime = 20;
    pending.fill(false);
    playMusic('SndMusic');
    console.log('GG_ENDING_VALIDATION_START');
  }

  function beginPerfRun() {
    tutorial = 0;
    puffs.length = 0;
    const lv = loadLevel(CAMPAIGN),
      c = perfCheckpoint > 0 ? lv.checkpoints[perfCheckpoint - 1] : null;
    state = createGame(lv, {
      enemy: true,
      morph: false,
      checkpoint: c ? { x: c.spawnX, y: c.spawnY, speed: c.speed || 220, index: c.index } : null,
    });
    screen = 'game';
    paused = false;
    sceneTime = 20;
    pending.fill(false);
    players = 1;
    warmActors();
    playMusic('SndMusic');
    console.log('GG_PERF_RUN_START');
  }

  function enterMenu() {
    tutorial = 0;
    if (state && state.players.length === 1 && state.score > prefs.best) {
      prefs.best = state.score;
      store.save();
    }
    screen = 'menu';
    paused = false;
    cursor = 0;
    playMusic('SndMenuMusic');
    console.log('GG_MENU_READY');
  }

  // Armor Games opening (the original's FlxPreloader child): see game/intro.js. Pages stream in as the frames need them.
  let intro = null,
    introMeta = null,
    introSfx = null,
    introShown = [],
    introStarted = false,
    introWait = 0,
    introStalls = 0;
  const introPath = (page) => introMeta.pages[page].file;
  // The original builds the menu only when the preloader hands over; here its pictures are loaded one per frame while the
  // intro plays so the first menu frame does not stall on the disk.
  const MENU_WARM = [
    'MenuState_ImgMenuBackground',
    'MenuState_ImgLeftGuy',
    'MenuState_ImgRightGuy',
    ...MENU_ART.main.flatMap((b) => [b.asset, b.over]),
    'MenuState_ImgMiniclip',
    'MenuState_ImgLogoHL',
    'MenuState_ImgSoundButOn',
    'MenuState_ImgSoundButOnHL',
    'MenuState_ImgSoundBut',
    'MenuState_ImgSoundButHL',
  ];
  let introWarm = 0;

  function warmMenuArt() {
    const a = ASSETS[MENU_WARM[introWarm++]];
    if (a && a.parts) for (const q of a.parts) texture(q.path);
  }

  function enterIntro() {
    introMeta = JSON.parse(std.loadFile('assets/intro/intro.json'));
    intro = createIntro(introMeta);
    introShown = [];
    introStarted = false;
    introWait = 0;
    introStalls = 0;
    introWarm = 0;
    screen = 'intro';
    paused = false;
    Sound.setVolume(30);
    introSfx = {};
    for (const id of Object.keys(SOUND_FILES)) {
      try {
        introSfx[id] = new Sound.Sfx('assets/audio/' + SOUND_FILES[id] + '.adp');
        introSfx[id].volume = 55;
      } catch (e) {
        console.log('GG_AUDIO_ERROR intro ' + id + ' ' + e);
      }
    }
    introPrefetch();
    console.log('GG_INTRO');
  }

  function leaveIntro() {
    for (const [path, e] of images) {
      if (!path.startsWith('assets/intro/')) continue;
      e.image.free();
      images.delete(path);
      bytes -= e.bytes;
    }
    if (introSfx) {
      for (const id of Object.keys(introSfx)) {
        introSfx[id].stop();
        introSfx[id].free();
      }
      introSfx = null;
    }
    console.log('GG_INTRO_STALLS ' + introStalls + ' audio=' + JSON.stringify(Sound.getMemoryStats()) + ' vram=' + Screen.getFreeVRAM());
    intro = null;
    introMeta = null;
    introShown = [];
    enterMenu();
    flash(0, 0, 0, 1.2);
  }

  function introPrefetch() {
    for (const page of pagesAhead(intro, 14)) prefetchTile(introPath(page), ImageList.HIGH);
    const keep = introShown.length ? Math.min(...introShown.map((t) => t.page)) : 0;
    for (const [path, e] of images) {
      if (!path.startsWith('assets/intro/')) continue;
      if (Number(path.slice(-6, -4)) < keep) {
        e.image.free();
        images.delete(path);
        bytes -= e.bytes;
      }
    }
  }

  function updateIntro(dt) {
    introPrefetch();
    if (!introStarted) {
      introStarted = pagesAhead(intro, 2).every((page) => {
        const e = images.get(introPath(page));
        return e && e.image.ready();
      });
      introWait += dt;
      if (!introStarted && introWait > 8) {
        console.log('GG_INTRO_SKIP pictures did not load');
        leaveIntro();
        return;
      }
    } else {
      stepIntro(intro, dt);
      if (introWarm < MENU_WARM.length && intro.frame > 115 && intro.frame < 185) warmMenuArt(); // logo is static from frame ~100 to 192
    }
    if (introStarted) {
      for (const id of dueSounds(intro)) if (prefs.sfx && introSfx[id]) introSfx[id].play();
    }
    if (intro.done) {
      console.log('GG_INTRO_DONE');
      leaveIntro();
    }
  }

  function drawIntro() {
    if (!intro) return;
    const tiles = introTiles(intro).map((id) => introMeta.tiles[id]);
    if (tiles.length) {
      const imgs = tiles.map((t) => {
        const e = images.get(introPath(t.page));
        if (e) e.seen = drawFrameNumber;
        return e && e.image.ready() ? e.image : null;
      });
      if (imgs.every(Boolean)) introShown = tiles.map((t, i) => ({ page: t.page, t, img: imgs[i] }));
      else introStalls++;
    } else introShown = [];
    for (const q of introShown) {
      const t = q.t;
      q.img.draw(Math.round(OX0 + introMeta.origin[0] + t.x), Math.round(introMeta.origin[1] + t.y), {
        width: t.w,
        height: t.h,
        startx: t.sx,
        starty: t.sy,
        endx: t.sx + t.w,
        endy: t.sy + t.h,
      });
    }
  }

  function startSolo(cont = false) {
    puffs.length = 0;
    checkpointBanner = 0;
    checkpointTimes = {};
    state = createGame(loadLevel(CAMPAIGN), {
      checkpoint: cont ? prefs.checkpoint : null,
      score: cont ? prefs.score : 0,
    });
    tutorial = state.players[0].x < 2000 ? 2 : 0;
    screen = 'game';
    paused = false;
    sceneTime = 0;
    pending.fill(false);
    warmActors();
    playMusic('SndMusic');
    flash(19, 28, 27, 1);
    bonusTime = 0;
    console.log('GG_GAME_START ' + JSON.stringify({ players: 1, checkpoint: state.checkpoint }));
    sfx('SndMorph');
  }

  function startMulti(reset = true) {
    tutorial = 3; // PlayState.create: FlxG.tutorial = true when numPlayers > 1 ("Press SPACE to start")
    if (reset) {
      wins = [0, 0, 0, 0];
      round = 1;
    }
    puffs.length = 0;
    checkpointBanner = 0;
    checkpointTimes = {};
    state = createGame(loadLevel(MULTIPLAYER[(track + round - 1) % MULTIPLAYER.length]), { players });
    screen = 'game';
    paused = false;
    sceneTime = 0;
    pending.fill(false);
    warmActors();
    playMusic('SndMusic');
    flash(19, 28, 27, 1);
    bonusTime = 0;
    console.log('GG_GAME_START ' + JSON.stringify({ players, track, round }));
    sfx('SndMorph');
  }

  function openOptions(back) {
    returnTo = back;
    screen = 'options';
    subCursor = 0;
  }

  function toggleSound() {
    const on = prefs.music || prefs.sfx;
    prefs.music = !on;
    prefs.sfx = !on;
    store.save();
    playMusic(screen === 'menu' || screen === 'multi' || screen === 'resume' ? 'SndMenuMusic' : 'SndMusic');
    console.log('GG_SOUND ' + !on);
  }

  function requestSolo() {
    if (prefs.checkpoint && prefs.checkpoint.x > 1800) {
      screen = 'resume';
      subCursor = 0;
      sfx('SndPopupAppear');
      console.log('GG_RESUME_PROMPT');
    } else withSplash(startSolo);
  }

  function startCredits() {
    tutorial = 0;
    state = createGame(loadLevel(CREDITS), { enemy: false, autoRestart: false, credits: true });
    state.cameraX = CREDITS.startCamera;
    screen = 'game';
    paused = false;
    creditsTime = 0;
    sceneTime = 20;
    puffs.length = 0;
    players = 1;
    warmActors();
    playMusic('SndMusic');
    console.log('GG_CREDITS_START');
  }

  function confirmMenu() {
    sfx('SndClick');
    if (cursor === 0) {
      flash(238, 238, 238, 0.5);
      if (!(prefs.checkpoint && prefs.checkpoint.x > 1800)) fadeMusicOut(800);
      fadeOut(1, requestSolo);
    } else if (cursor === 1) {
      players = 2;
      track = 0;
      screen = 'multi';
      subCursor = 0;
      flash(238, 238, 238, 0.5);
      console.log('GG_MULTIPLAYER_SELECT');
    } else if (cursor === 2) {
      flash(238, 238, 238, 0.5);
      goTo(startCredits);
    } else if (cursor === 3) {
      screen = 'scores';
      console.log('GG_LOCAL_SCORES');
    } else toggleSound();
  }

  function input() {
    if (fadeFx || splashFx || screen === 'intro') return;
    const p = pads[0];
    if (screen === 'game' && pads.some((pad, i) => i < state.players.length && pad.justDisconnected)) {
      paused = true;
      subCursor = 0;
    }
    if (!p.connected && !(screen === 'game' && tutorial === 3)) return;
    const up = p.repeatPressed(Gamepad.UP),
      down = p.repeatPressed(Gamepad.DOWN),
      left = p.repeatPressed(Gamepad.LEFT),
      right = p.repeatPressed(Gamepad.RIGHT),
      ok = p.anyJustPressed(Gamepad.CROSS | Gamepad.START),
      back = p.justPressed(Gamepad.CIRCLE);

    if (screen === 'menu') {
      cursor = moveMain(cursor, right ? 1 : left ? -1 : 0, down ? 1 : up ? -1 : 0);
      if (ok) confirmMenu();
      if (p.justPressed(Gamepad.SELECT)) openOptions('menu');
    } else if (screen === 'multi') {
      if (left || right) {
        if (subCursor < 3) subCursor = (subCursor + (left ? 2 : 1)) % 3;
      }
      if (down) subCursor = 3;
      if (up && subCursor === 3) subCursor = 0;
      if (back) {
        flash(238, 238, 238, 0.5);
        enterMenu();
      }
      if (ok) {
        if (subCursor === 3) {
          flash(238, 238, 238, 0.5);
          enterMenu();
        } else {
          players = subCursor + 2;
          track = 0;
          const connected = pads.filter((p) => p.connected).length;
          if (connected < players) message('Connect ' + players + ' controllers (3 / 4: multitap)');
          else {
            flash(238, 238, 238, 0.5);
            goTo(startMulti);
          }
        }
      }
    } else if (screen === 'resume') {
      if (left || right || up || down) subCursor = 1 - subCursor;
      if (back) enterMenu();
      if (ok) {
        sfx('SndPopupDisappear');
        if (subCursor === 0) goTo(() => startSolo(true), 0.3);
        else {
          prefs.checkpoint = null;
          prefs.score = 0;
          store.save();
          goTo(startSolo, 0.3);
        }
      }
    } else if (screen === 'scores') {
      if (ok || back) enterMenu();
    } else if (screen === 'options') {
      if (up || down) subCursor = (subCursor + (up ? 2 : 1)) % 3;
      if (ok || left || right) {
        if (subCursor < 2) {
          const k = subCursor === 0 ? 'music' : 'sfx';
          prefs[k] = !prefs[k];
          store.save();
          playMusic(returnTo === 'menu' ? 'SndMenuMusic' : 'SndMusic');
        } else screen = returnTo;
      }
      if (back) screen = returnTo;
    } else if (screen === 'game') {
      if (tutorial === 3 && !paused) {
        if (pads.some((pd) => pd.connected && pd.justPressed(Gamepad.START))) {
          sfx('SndPopupDisappear');
          tutorial = 0;
          pending.fill(false);
        }
        return;
      }
      if (tutorial && !paused) {
        if (ok) {
          sfx('SndPopupDisappear');
          tutorial = 0;
          pending.fill(false);
        }
        if (p.justDisconnected) {
          paused = true;
          subCursor = 0;
        }
        return;
      }
      if (p.justDisconnected) {
        paused = true;
        subCursor = 0;
      }
      if (state.players.length > 1 && pads.some((p, i) => i < state.players.length && p.justDisconnected)) {
        paused = true;
        subCursor = 0;
      }
      if (state.options.credits && back && !paused) {
        enterMenu();
        return;
      }

      if (paused) {
        if (up || down) subCursor = 1 - subCursor;
        if (back) {
          paused = false;
          pending.fill(false);
        }
        if (p.justPressed(Gamepad.SELECT)) {
          openOptions('game');
          return;
        }
        if (ok) {
          if (subCursor === 0) {
            paused = false;
            pending.fill(false);
          } else enterMenu();
        }
        return;
      }

      if (state.status === 'complete' || state.status === 'results') {
        if (state.players.length === 1 && state.status === 'complete' && endTime < 1.25) return;

        if (state.players.length > 1) {
          if (left || right) subCursor = 1 - subCursor;
          if (p.justPressed(Gamepad.START) || (ok && subCursor === 1)) {
            sfx('SndPopupDisappear');
            round++;
            startMulti(false);
          } else if (ok || back) enterMenu();
          return;
        }

        if (ok) {
          if (state.status === 'complete') enterMenu();
        }
        if (back) enterMenu();
        return;
      }

      if (p.justPressed(Gamepad.START)) {
        paused = true;
        subCursor = 0;
        pending.fill(false);
        console.log('GG_PAUSE');
        return;
      }
      if (p.justPressed(Gamepad.SELECT)) {
        restartGame(state);
        console.log('GG_RETRY');
        return;
      }
      pads.forEach((pad, i) => {
        if (pad.anyJustPressed(Gamepad.CROSS | Gamepad.R1)) {
          pending[i] = true;
          console.log('GG_PAD_FLIP ' + i);
        }
      });
    }
  }

  function background(cameraX) {
    const bounds = CAMPAIGN.backgroundSections || [
      6029, 6490, 21927, 22559, 47129, 48603, 60512, 62347, 71022, 71168, 77227, 77776, 87799, 88637,
    ];
    if (!state.options.credits && state.players.length === 1 && bounds.filter((x) => x < cameraX).length % 2) {
      box(0, 59, 640, 442, Color.new(2, 5, 10));
      return;
    }
    art('PlayState_ImgBackground', 0, 59);
    for (let i = -1; i < 3; i++) art('PlayState_ImgBackground2', i * 444 - ((cameraX * 0.25) % 444), 264);
    art('PlayState_ImgSun', 39, 266); // PlayState.as:1024, scrollFactor 0
    for (let i = -1; i < 3; i++) art('PlayState_ImgBackground1', i * 427 - ((cameraX * 0.5) % 427), 254);
    for (let i = -1; i < 3; i++) art('PlayState_ImgBackship', i * 350 - ((cameraX * 0.26) % 350), 59);
    for (let i = -1; i < 3; i++) {
      art('PlayState_ImgTopShipSmall', i * 580 + 426 - ((cameraX * 0.55) % 580), 59);
      art('PlayState_ImgTopShipBig', i * 580 - ((cameraX * 0.55) % 580), 59);
    }
  }

  let renderLevel = null,
    renderBins = null,
    atlas = null;

  function freeAtlas() {
    if (!atlas) return;
    atlas.image.unlock();
    atlas.image.free();
    atlas = null;
  }

  // Static scenery as TileMap sprites (VU1): one resident atlas texture, one sprite list per layer, no streaming.
  // Sprites are stored nearly x-sorted with the original paint order kept for every overlapping pair, so the
  // sprites on screen are one contiguous [lo, hi) range found by binary search over prefix/suffix bounds.
  function buildAtlas(level) {
    const txt = std.loadFile('assets/scenery/' + level.id + '/sprites.json');
    if (!txt) return null;
    const data = JSON.parse(txt),
      image = new Image(data.path);
    if (!image.ready()) throw Error('Atlas failed: ' + data.path);
    image.lock();
    const o = TileMap.layout.offsets,
      stride = TileMap.layout.stride,
      layers = {};
    for (const kind of ['back', 'front']) {
      const L = data[kind],
        n = L.x.length;
      if (!n) continue;
      const buf = TileMap.SpriteBuffer.create(n),
        dv = new DataView(buf),
        sufMinL = new Float32Array(n + 1),
        prefMaxR = new Float32Array(n + 1);
      for (let i = 0; i < n; i++) {
        const at = i * stride;
        dv.setFloat32(at + o.x, L.x[i] * WS, true);
        dv.setFloat32(at + o.y, L.y[i] * WS, true);
        dv.setFloat32(at + o.w, L.w[i] * WS, true);
        dv.setFloat32(at + o.h, L.h[i] * WS, true);
        dv.setFloat32(at + o.u1, L.u[i], true);
        dv.setFloat32(at + o.v1, L.v[i], true);
        dv.setFloat32(at + o.u2, L.u[i] + L.tw[i], true);
        dv.setFloat32(at + o.v2, L.v[i] + L.th[i], true);
        for (const c of ['r', 'g', 'b', 'a']) dv.setUint32(at + o[c], 128, true);
        prefMaxR[i + 1] = Math.max(prefMaxR[i], L.x[i] + L.w[i]);
      }
      sufMinL[n] = 1e9;
      for (let i = n - 1; i >= 0; i--) sufMinL[i] = Math.min(sufMinL[i + 1], L.x[i]);
      const descriptor = new TileMap.Descriptor({
        textures: [image],
        materials: [{ textureIndex: 0, endOffset: n - 1 }],
      });
      layers[kind] = { map: new TileMap.Instance({ descriptor, spriteBuffer: buf }), n, sufMinL, prefMaxR };
    }
    console.log('GG_ATLAS ' + level.id + ' ' + data.w + 'x' + data.h + ' back=' + (data.back.x.length) + ' front=' + data.front.x.length);
    return { image, layers };
  }

  // First index i with a[i] > v in a nondecreasing array.
  function upperBound(a, v, n) {
    let lo = 0,
      hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (a[mid] > v) hi = mid;
      else lo = mid + 1;
    }
    return lo;
  }

  function drawAtlas(kind, camera) {
    const L = atlas.layers[kind];
    if (!L) return;
    const lo = Math.max(0, upperBound(L.prefMaxR, camera, L.n + 1) - 1),
      hi = upperBound(L.sufMinL, camera + VW + 8, L.n + 1);
    if (hi <= lo) return;
    L.map.render(OX - camera * WS, OY, { first: lo, count: hi - lo });
    perf.sprites += hi - lo;
  }

  function buildRender(level) {
    if (renderLevel === level) return;
    renderLevel = level;
    const scene = level.id === 'credits' ? CREDITS : SCENERY[level.id];
    if (!scene) throw Error('Scenery missing: ' + level.id);
    freeAtlas();
    atlas = level.id === 'credits' || !useAtlas ? null : buildAtlas(level);
    renderBins = {
      back: atlas ? [] : scene.back,
      front: atlas ? [] : scene.front,
      animated: {
        back: [...(scene.animated.back || [])].sort((a, b) => a.x - b.x),
        front: [...(scene.animated.front || [])].sort((a, b) => a.x - b.x),
      },
    };
    checkpointArt = buildCheckpointArt(level);
    checkpointTimes = {};
    if (!atlas) prefetchAround(Math.max(0, state.cameraX - 320), ImageList.HIGH);
  }

  function lowerBound(list, x) {
    let lo = 0,
      hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid].x < x) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  function scenery(kind, camera) {
    if (atlas) drawAtlas(kind, camera);
    const tiles = renderBins[kind],
      ahead = lookahead();
    for (let i = lowerBound(tiles, camera - 512); i < tiles.length; i++) {
      const q = tiles[i];
      if (q.x > camera + VW + ahead) break;
      if (q.x > camera + VW) {
        prefetchTile(q.path);
        continue;
      }
      if (q.x + q.w >= camera) {
        const img = tile(q.path);
        if (img) img.draw(OX + (q.x - camera) * K, OY, { width: q.w * K, height: q.h * K });
        else perf.missing++;
      }
    }
    const anim = renderBins.animated[kind];

    for (let i = lowerBound(anim, camera - 150); i < anim.length; i++) {
      const o = anim[i];
      if (o.x > camera + VW) break;
      art(o.image, o.x - camera, o.y, o.sx === undefined ? 1 : o.sx, o.sy === undefined ? 1 : o.sy);
    }
  }

  function actor(p, camera, enemy = false) {
    if (!p.visible) return;
    const anims = enemy ? ENEMY_ANIMS : ANIMS,
      seq = anims[p.anim] || ANIMS.run;
    let k = Math.floor(p.animTime * (RATES[p.anim] || 20));
    if (['death', 'morph'].includes(p.anim)) k = Math.min(k, seq.length - 1);
    else k %= seq.length;
    const name = enemy
      ? 'Enemy_ImgPlayer'
      : ['Player_ImgPlayer', 'Player_ImgPlayerGreen', 'Player_ImgPlayerYellow', 'Player_ImgPlayerRed'][p.id - 1];
    const ox = state.players.length > 1 ? 16 : 10,
      oy =
        p.gravity < 0
          ? enemy
            ? 11
            : state.players.length > 1
              ? 9
              : 7
          : enemy
            ? 12
            : state.players.length > 1
              ? 19
              : 17;
    const x = p.prevX + (p.x - p.prevX) * renderAlpha,
      y = p.prevY + (p.y - p.prevY) * renderAlpha;
    const dark = !state.options.credits && p.x > 6170 && p.x < 6580 && p.y > 280 && p.anim !== 'death';
    frame(name, seq[k], x - ox - camera, y - oy, {
      flipY: p.gravity < 0,
      tint: dark ? Color.new(29, 29, 29, 128) : undefined,
    });
  }

  function drawGame() {
    const cx =
      state.prevCameraX === undefined
        ? state.cameraX
        : state.prevCameraX + (state.cameraX - state.prevCameraX) * renderAlpha;
    const camera = Math.max(0, Math.min(cx - 320, (state.level.width || 123090) - WVW));
    pf('_');
    background(cx);
    pf('background');
    K = WS;
    OY = HUDH;
    VW = WVW;
    buildRender(state.level);
    scenery('back', camera);
    pf('sceneryBack');
    if (state.players.length === 1)
      for (const a of checkpointArt.back) {
        if (a.x + a.drawW < camera || a.x > camera + WVW) continue;
        const at = checkpointTimes[a.checkpointIndex];
        const trigger = at === undefined ? (a.checkpointIndex <= state.checkpoint.index ? 0 : null) : at;
        frame(a.image, frameForTime(a, clock, trigger), a.x - camera, a.y, { sx: a.sx, sy: a.sy });
      }

    if (boom) {
      const a = ASSETS.PlayState_ImgSonicBoom;
      if (a) art('PlayState_ImgSonicBoom', boom.x - camera, boom.y, 1, 1, undefined, (boom.angle * Math.PI) / 180);
    }
    pf('checkpointArt');
    for (const p of state.players)
      if (!(tutorial === 3 && multiTimer < 0.4 && p.animTime * RATES.morph > 16)) actor(p, camera);
    for (const f of puffs)
      frame('PlayState_ImgPuff', Math.min(5, Math.floor(f.t * 18)), f.x - camera, f.y, { flipY: f.flip });
    if (state.enemy) actor(state.enemy, camera, true);
    pf('actors');
    scenery('front', camera);
    pf('sceneryFront');
    K = S;
    OY = 0;
    VW = 640;
    art('PlayState_ImgHudBg', 0, 0);
    art('PlayState_ImgPauseBut', 0, 0);
    art(prefs.music || prefs.sfx ? 'MenuState_ImgSoundButOn' : 'MenuState_ImgSoundBut', 58, 0);

    if (!state.options.credits) {
      if (state.players.length === 1) {
        const str = String(state.score),
          w = fScore.getTextSize(str).width / S;
        fScore.color = white;
        fScore.print(OX + (634 - w) * S, -1 * S, str);
      }
    }

    if (checkpointBanner > 0 && state.players.length === 1) {
      const t = checkpointBanner,
        a0 = ASSETS.PlayState_ImgLevelCleared,
        sc = t > 2.0 ? 2.3 - t + 0.7 : 1,
        al = t < 1 ? t : 1;
      if (a0)
        art(
          'PlayState_ImgLevelCleared',
          23 + (a0.w * (1 - sc)) / 2,
          bannerY + (a0.h * (1 - sc)) / 2,
          sc,
          sc,
          Color.new(128, 128, 128, Math.round(128 * al))
        );
    }
    if (bonusTime > 0) {
      const t = bonusTime,
        al = t < 1 ? t : 1,
        str = bonusText,
        w = fBonus.getTextSize(str).width / S;
      fBonus.color = Color.new(255, 255, 255, Math.round(128 * al));
      fBonus.print(OX + (634 - w) * S, (23 - (3 - t) * 4.7) * S, str);
    }
    if (tutorial === 3 && multiTimer >= 0.4 && state.players[0].animTime * RATES.morph > 16)
      center('Press START to start', 106, white, true);
    if (tutorial === 2) {
      art('PlayState_ImgDontGetCaught', 98, 139);
      art('PlayState_ImgContinueOver', 209, 288);
    }
    pf('hud');
    if (paused) {
      art('FlxPause_ImgPauseBackground', 0, 0);
      buttons('pause', subCursor);
    }
    if (state.status === 'complete' || state.status === 'results') {
      if (state.players.length === 1) {
        if (endTime > 1) {
          const sc = Math.min(1, 0.5 + (endTime - 1) * 2);
          art('PlayState_ImgTheEnd', (640 * (1 - sc)) / 2, (501 * (1 - sc)) / 2, sc, sc);
          if (sc >= 1) {
            {
              fEnd.color = white;
              fEnd.print(320 - fEnd.getTextSize(String(state.score)).width / 2, 231 * S, String(state.score));
            }
            art('PlayState_ImgContinue', 213, 281);
            center('START  Main menu', 380, yellow);
          }
        }
      } else drawResults();
    }
  }

  const PLAYER_NAMES = ['Blue', 'Green', 'Yellow', 'Red'];

  function drawResults() {
    art('PlayState_ImgMultiEnd', 0, 0);
    const n = state.players.length,
      standings = state.players.map((q, i) => ({ i, st: q.standing || n }));
    if (!standings.some((q) => q.st === 1)) {
      standings.sort((a, b) => a.st - b.st);
      standings.forEach((q, k) => (q.st = k + 1));
    }
    const label = (w) => w + (w === 1 ? ' win' : ' wins'),
      wtext = (str, right, y) => {
        fWins.color = Color.new(0x96, 0xdc, 0xe8);
        fWins.print(OX + right * S - fWins.getTextSize(str).width, y * S, str);
      };

    for (const { i, st } of standings) {
      const name = PLAYER_NAMES[i];

      if (st === 1) {
        art('PlayState_ImgResult' + name, 87, 99);
        art('PlayState_Img1st', 211, 316);
        wtext(label(wins[i]), 286, 378);
      } else {
        const y = [0, 0, 113, 212, 309][st];
        art('PlayState_ImgResult' + name + 'Small', 360, y);
        wtext(label(wins[i]), 577, y + 68);
      }
    }

    for (let st = n + 1; st <= 4; st++) {
      const y = [0, 0, 113, 212, 309][st];
      art('PlayState_ImgResultNoneSmall', 360, y);
      wtext('------------', 577, y + 68);
    }
    art(subCursor === 0 ? 'PlayState_ImgEndButtonOver' : 'PlayState_ImgEndButton', 103, 424);
    art(subCursor === 1 ? 'PlayState_ImgNextButtonOver' : 'PlayState_ImgNextButton', 402, 424);
  }

  function buttons(group, selected) {
    MENU_ART[group].forEach((b, i) => art(i === selected ? b.over : b.asset, b.x, b.y));
  }

  function drawMenu() {
    art('MenuState_ImgMenuBackground', 0, 6);
    art('MenuState_ImgLeftGuy', menuMotion.left, 127);
    art('MenuState_ImgRightGuy', menuMotion.right, 139);

    if (screen === 'multi') {
      art('MenuState_ImgChooseNumberOfPlayers', 168, 220);
      buttons('multi', subCursor);
    } else buttons('main', screen === 'menu' ? cursor : -1);

    art('MenuState_ImgMiniclip', 171, -18);
    art('MenuState_ImgLogoHL', 232, 53, 1, 1, Color.new(128, 128, 128, Math.round(menuMotion.logo * 128)));
    const sound = prefs.music || prefs.sfx ? 'MenuState_ImgSoundButOn' : 'MenuState_ImgSoundBut';
    art(sound + (screen === 'menu' && cursor === 4 ? 'HL' : ''), 0, 0);
  }

  function drawPage() {
    OX =
      OX0 + (shakeFx && (screen === 'game' || screen === 'menu') ? (Math.random() * 2 - 1) * shakeFx.amount * 640 : 0);

    if (screen === 'intro') drawIntro();
    else if (screen === 'menu' || screen === 'multi') drawMenu();
    else if (screen === 'game') drawGame();
    else if (screen === 'loading') art('MenuState_ImgLoadingSplash', 0, 0);
    else if (screen === 'resume') {
      drawMenu();
      art('MenuState_ImgContinueGame', 0, 0);
      buttons('resume', subCursor);
    } else if (screen === 'options') {
      if (returnTo === 'game') drawGame();
      else drawMenu();
      art('FlxPause_ImgPauseBackground', 0, 0);
      center('OPTIONS', 140, white, true);
      ['MUSIC   ' + (prefs.music ? 'ON' : 'OFF'), 'SOUND   ' + (prefs.sfx ? 'ON' : 'OFF'), 'BACK'].forEach((s, i) =>
        center((subCursor === i ? '> ' : '') + s, 200 + i * 47, subCursor === i ? cyan : white)
      );
    } else if (screen === 'scores') {
      drawMenu();
      art('FlxPause_ImgPauseBackground', 0, 0);
      art('MenuState_ImgScoreButtonOver', 248, 145);
      center('PERSONAL BEST', 212);
      center(String(prefs.best), 250, white, true);
      center('X / START / O', 309, cyan);
    }

    if (noticeLeft > 0) {
      box(10, 470, 620, 31);
      center(notice, 475, yellow);
    }
    Draw.rect(0, 0, OX, 448, black);
    Draw.rect(640 - OX, 0, OX + 1, 448, black);
  }

  function updateMenu(dt) {
    if (screen === 'intro') return;
    const opened = screen === 'multi' || screen === 'resume' || screen === 'scores';
    const l = opened ? -200 : 0,
      r = opened ? 659 : 459,
      step = (opened ? 530 : menuMotion.slow || menuMotion.left < -229 ? 250 : 530) * dt;
    if (!opened && menuMotion.left < -229) menuMotion.slow = true;
    menuMotion.left += Math.max(-step, Math.min(step, l - menuMotion.left));
    menuMotion.right += Math.max(-step, Math.min(step, r - menuMotion.right));
    if (menuMotion.slow && menuMotion.left >= 0) {
      menuMotion.slow = false;
      quake(0.01, 0.2);
      flash(255, 255, 255, 0.8, 0.87);
    } else if (opened) menuMotion.slow = false;
    menuMotion.logo += menuMotion.direction * dt * 0.8;
    if (menuMotion.logo >= 1) {
      menuMotion.logo = 1;
      menuMotion.direction = -1;
    }
    if (menuMotion.logo <= 0) {
      menuMotion.logo = 0;
      menuMotion.direction = 1;
    }
  }

  const scenes = [
    { label: 'menu' },
    { label: 'solo-start', x: 450 },
    { label: 'tutorial-caught', tutorial: 2 },
    { label: 'inverted', x: 880, invert: true },
    { label: 'checkpoint', x: 7425 },
    { label: 'city-2', x: 28650 },
    { label: 'city-3', x: 54120 },
    { label: 'city-4', x: 81800 },
    { label: 'city-5', x: 107800 },
    { label: 'multiplayer', multi: 2 },
    { label: 'multiplayer-four', multi: 4 },
    { label: 'multiplayer-track-2', multi: 2, track: 1 },
    { label: 'multiplayer-track-3', multi: 2, track: 2 },
    { label: 'results', multi: 2, results: true },
    { label: 'ending', x: 122900, ending: true },
    { label: 'pause', x: 850, pause: true },
  ];

  function validationScene() {
    validationIndex++;
    if (validationIndex >= scenes.length) {
      validationDone = true;
      enterMenu();
      console.log(
        'GG_VALIDATION_COMPLETE ' +
          JSON.stringify({
            frame: Loop.getStats(),
            vramFree: Screen.getFreeVRAM(),
            eeFree: System.getFreeMemory(),
            audio: Sound.getMemoryStats(),
            missing: [...missing],
          })
      );
      return;
    }
    const q = scenes[validationIndex];
    players = q.multi || 1;
    tutorial = q.tutorial || 0;

    if (q.label === 'menu') enterMenu();
    else {
      state = createGame(loadLevel(q.multi ? MULTIPLAYER[q.track || 0] : CAMPAIGN), {
        players: q.multi || 1,
        morph: false,
        autoRestart: false,
      });
      screen = 'game';
      sceneTime = 20;
      paused = !!q.pause;
      subCursor = 0;
      if (q.results) {
        state.status = 'results';
        state.winner = 2;
        wins = [0, 1, 0, 0];
        subCursor = 1;
        state.players.forEach((p, i) => (p.standing = i === 1 ? 1 : i === 0 ? 2 : i + 1));
      }
      if (q.ending) {
        state.status = 'complete';
        endTime = 5;
      }
      if (q.x) {
        state.cameraX = q.x;
        const p = state.players[0];
        p.x = q.x - 15;
        p.prevX = p.x;
        p.y = q.invert ? 180 : 270;
        p.prevY = p.y;
        p.gravity = q.invert ? -1 : 1;
      }
    }

    validationHold = 3.0;
    pendingView = q.label;
    lastPerfLabel = q.label;
    perfWait = 1.8;
  }

  if (validation || menuValidation) {
    let checks = 0;
    runChecks((condition, label) => {
      checks++;
      if (!condition) throw Error('GG_TEST_FAIL ' + label);
    });
    console.log('GG_TEST_PASS ' + checks);
  }
  console.log('GG_IOP_MODULES ' + JSON.stringify(IOP.getModules()));
  for (const name of ['cdfs', 'usbd', 'bdm', 'bdmfs_fatfs', 'usbmass_bd'])
    if (!IOP.getModule(name)) throw Error('Required IOP module missing: ' + name);
  preloadSfx();
  if (validation || endingValidation || perfRun || menuValidation) enterMenu();
  if (validation) validationScene();
  else if (endingValidation) beginEndingValidation();
  else if (perfRun) beginPerfRun();
  else if (menuValidation) flash(0, 0, 0, 1.2);
  else if (startCheckpoint) {
    prefs.checkpoint = startCheckpoint;
    prefs.score = startScore;
    enterMenu();
    startSolo(true);
  }
  else enterIntro();
  Loop.addSystem({
    name: 'gg-input',
    realTime: true,
    preUpdate(dt) {
      clock += dt;
      loader.process({ maxItems: 2, maxTime: 4 });
      if (fadeFx) {
        fadeFx.t += dt;
        if (fadeFx.t >= fadeFx.dur) {
          const cb = fadeFx.cb;
          fadeFx = null;
          cb();
        }
      } else if (splashFx) {
        if (++splashFx.n >= 3) {
          const cb = splashFx.cb;
          splashFx = null;
          cb();
        }
      }
      if (flashFx) {
        flashFx.t += dt;
        if (flashFx.t >= flashFx.dur) flashFx = null;
      }
      if (shakeFx) {
        shakeFx.t += dt;
        if (shakeFx.t >= shakeFx.dur) shakeFx = null;
      }
      if (screen === 'intro') updateIntro(dt);
      updateMenu(dt);
      noticeLeft = Math.max(0, noticeLeft - dt);
      Gamepad.update();
      input();
      const ui = screen + ':' + cursor + ':' + subCursor + ':' + paused + ':' + tutorial;
      if (ui !== lastUi) {
        lastUi = ui;
        console.log('GG_UI ' + JSON.stringify({ screen, cursor, subCursor, paused, tutorial }));
      }
      Sound.process();
      store.poll();
    },
  });

  Loop.run(
    {
      update(dt) {
        if (validation && !validationDone) {
          validationHold -= dt;
          perfWait -= dt;
          if (perfWait > 0 && perfWait <= dt)
            console.log(
              'GG_PERF ' +
                JSON.stringify({
                  scene: lastPerfLabel,
                  frame: Loop.getStats(),
                  eeFree: System.getFreeMemory(),
                  vramFree: Screen.getFreeVRAM(),
                  imageBytes: bytes,
                  musicPosition: music ? music.position : 0,
                })
            );
          if (validationHold <= 0) validationScene();
          return;
        }
        if (screen !== 'game' || paused) {
          boom = null;
          stopLoops();
          return;
        }
        if (endingValidation && ev.hold > 0) {
          ev.hold -= dt;
          return;
        }
        if (tutorial === 3) {
          // players keep morphing but nothing moves until START; the prompt blinks once the morph is past frame 16 (multiStartFlicker)
          for (const q of state.players)
            if (q.morphLeft > 0.001) {
              q.morphLeft = Math.max(0.001, q.morphLeft - dt);
              q.animTime += dt;
            }
          if (state.players[0].animTime * RATES.morph > 16) {
            multiTimer -= dt;
            if (multiTimer <= 0) multiTimer = 0.8;
          }
          return;
        }
        if (tutorial) return;
        sceneTime += dt;
        if (state.options.credits) creditsTime += dt;
        checkpointBanner = Math.max(0, checkpointBanner - dt);
        bonusTime = Math.max(0, bonusTime - dt);
        for (let i = puffs.length - 1; i >= 0; i--) {
          puffs[i].t += dt;
          if (puffs[i].t >= 1 / 3) puffs.splice(i, 1);
        }
        if (menuValidation && state.options.credits && state.players[0].blocked && state.players[0].vy === 0)
          pending[0] = true;
        const prev = state.status;
        state.prevCameraX = state.cameraX;
        if (perfRun) {
          const p0 = state.players[0];
          if (p0.vy === 0 && (p0.blocked || drawFrameNumber % 37 === 0)) pending[0] = true;
        }
        pf('_');
        const wasEnd = endTime;
        if (soak) {
          state.cameraX += soakSpeed * dt;
          state.players[0].vx = soakSpeed;
          state.players[0].x = state.cameraX;
          state.players[0].prevX = state.cameraX;
        } else stepGame(state, pending, dt);
        pending.fill(false);
        pf('step');
        if (state.status === 'complete' && state.players.length === 1) {
          endTime += dt;
          if (wasEnd <= 1 && endTime > 1) sfx('SndPopupAppear');
        }
        if (state.options.credits) {
          // PlayState.as:2953-2970: falling out of the credits only reloads them (timeToReload 1.3 s); the end of the course goes to the menu
          if (state.status === 'dead' && state.deathTime <= 0.001) {
            startCredits();
            flash(19, 28, 27, 1);
            return;
          }
          if (state.status !== 'dead' && state.players[0].x > CREDITS.width - 100) {
            enterMenu();
            return;
          }
        }
        for (const e of state.events) {
          if (e.type === 'flip') {
            sfx('SndSwitch');
            if (puffs.length < 12)
              puffs.push({ x: e.x - 37, y: e.y - (e.gravity > 0 ? 55 : 20), flip: e.gravity > 0, t: 0 });
          }
          if (e.type === 'land') sfx('Player_SndLand', 0.7);
          if (e.type === 'boost') {
            const l = loops.SndAccelLoop;
            if (!(l && l.ch >= 0 && sounds.SndAccelLoop && sounds.SndAccelLoop.playing(l.ch)))
              sfx('SndAccelTrigger', 0.7);
            accelLeft = 65 / Math.max(1, e.speed || state.players[0].vx);
            loopSfx('SndAccelLoop', true, 0.7);
          }
          if (e.type === 'death') {
            prefetchAround(state.checkpoint.x + state.players[0].w / 2);
            if (e.reason === 'caught') {
              sfx('SndCaught');
              flash(255, 255, 255, 0.45);
            }
            if (state.players.length === 1 && state.score > prefs.best) {
              prefs.best = state.score;
              store.save();
            }
          }
          if (e.type === 'restart') {
            sfx('SndMorph');
            flash(19, 28, 27, 1);
          }
          if (e.type === 'checkpoint') {
            checkpointBanner = 2.3;
            bannerY = Math.max(0, Math.min(430, state.players[0].y + 6));
            if (e.bonus > 0) {
              bonusText = '+' + e.bonus;
              bonusTime = 3;
            }
            flash(241, 255, 241, 0.75);
            checkpointTimes[e.index] = clock;
            sfx('SndLevelCleared');
            prefs.checkpoint = { ...state.checkpoint };
            prefs.score = state.checkpointScore;
            prefs.best = Math.max(prefs.best, state.score);
            store.save();
            console.log('GG_CHECKPOINT ' + JSON.stringify(state.checkpoint));
          }
          if (e.type === 'winner') {
            if (state.winner) wins[state.winner - 1]++;
            sfx('SndWin');
            subCursor = 1;
            console.log('GG_RESULT ' + state.winner);
          }
          if (e.type === 'quake') quake(0.01, 0.45);
          if (e.type === 'ending') {
            prefs.best = Math.max(prefs.best, state.score);
            store.save();
            console.log('GG_ENDING_START');
          }
          if (e.type === 'complete') {
            if (state.players.length > 1) sfx('SndWin');
            else {
              endTime = 1;
              prefs.checkpoint = null;
              prefs.score = 0;
              store.save();
              console.log('GG_ENDING_COMPLETE');
            }
            prefs.best = Math.max(prefs.best, state.score);
            store.save();
          }
        }

        {
          const p0 = state.players[0],
            solo = state.players.length === 1;
          boom =
            solo &&
            p0.alive &&
            state.status === 'playing' &&
            p0.vx >= 513.208 &&
            p0.anim !== 'push' &&
            p0.anim !== 'death' &&
            p0.anim !== 'morph'
              ? {
                  x: p0.x - 40,
                  y: p0.y - (p0.gravity > 0 ? 16 : 3),
                  angle: p0.vy > 1 && !p0.grounded ? 20 : p0.vy < -1 && !p0.grounded ? -20 : 0,
                }
              : null;
          loopSfx('SndSonicBoomLoop', !!boom && p0.x < 122640);
          loopSfx('SndSlide', state.status === 'playing' && state.players.some((q) => q.alive && q.anim === 'slide'));
          if (accelLeft > 0) {
            accelLeft -= dt;
            if (accelLeft <= 0) {
              accelLeft = 0;
              loopSfx('SndAccelLoop', false);
            }
          }
          if (state.status !== 'playing' && state.status !== 'dead') stopLoops();
        }

        if (endingValidation) {
          ev.n++;
          if (ev.n % 10 === 0)
            console.log(
              'GG_END_TRACE ' +
                JSON.stringify({
                  t: +ev.t.toFixed(2),
                  x: Math.round(state.players[0].x),
                  vx: Math.round(state.players[0].vx),
                  ts: +state.timeScale.toFixed(2),
                  ending: +state.ending.toFixed(2),
                  status: state.status,
                })
            );
          ev.t += dt;
          for (const e of state.events)
            if (e.type === 'ending' || e.type === 'quake' || e.type === 'complete')
              console.log(
                'GG_END_EVENT ' +
                  e.type +
                  ' ' +
                  JSON.stringify({
                    t: +ev.t.toFixed(2),
                    x: Math.round(e.x ?? state.players[0].x),
                    ts: +state.timeScale.toFixed(2),
                  })
              );
          if (state.events.some((e) => e.type === 'ending')) pendingView = 'ending-start';
          if (state.timeScale === 0.25 && !ev.slow) {
            ev.slow = true;
            pendingView = 'ending-slowmo';
          }
          if (ev.slow && state.timeScale === 1 && !ev.rec) {
            ev.rec = true;
          }
          if (ev.rec && boom && !ev.boom) {
            ev.boom = true;
            pendingView = 'ending-boom';
          }
          if (state.status === 'complete' && !ev.done) {
            ev.done = true;
            ev.doneAt = ev.t;
          }
          if (ev.done && ev.t - ev.doneAt > 0.6 && !ev.fin) {
            ev.fin = true;
            pendingView = 'ending-popup';
          }
          if (pendingView && pendingView.startsWith('ending-') && pendingView !== 'ending-popup') ev.hold = 0.7;
          if (ev.fin && ev.t - ev.doneAt > 1.2 && !ev.over) {
            ev.over = true;
            console.log('GG_ENDING_VALIDATION_DONE');
          }
        }

        if (prev !== state.status) console.log('GG_STATUS ' + state.status);
      },
      draw(alpha) {
        renderAlpha =
          screen === 'game' && !paused && state.status === 'playing' && (!validation || validationDone) ? alpha : 1;
        drawFrameNumber++;
        const t0 = perfRun ? Loop.getStats() : null;
        drawPage();
        if (fadeFx) {
          Draw.rect(0, 0, 640, 448, Color.new(0, 0, 0, Math.round(128 * Math.min(1, fadeFx.t / fadeFx.dur))));
        }
        if (flashFx) {
          const f = flashFx,
            al = Math.max(0, 1 - f.t / f.dur) * f.a;
          if (al > 0) Draw.rect(0, 0, 640, 448, Color.new(f.r, f.g, f.b, Math.round(128 * al)));
        }
        if (menuValidation && drawFrameNumber % 60 === 0)
          console.log(
            'GG_MENU_PERF ' + JSON.stringify({ screen, paused, frame: Loop.getStats(), vramFree: Screen.getFreeVRAM() })
          );
        trimImages();
        if (perfRun) {
          const st = Loop.getStats();
          perf.frames.push(st.frameMs);
          if (perf.frames.length >= 120) {
            const f = perf.frames.slice().sort((a, b) => a - b);
            const sum = f.reduce((a, b) => a + b, 0);
            console.log(
              'GG_PERF_SAMPLE ' +
                JSON.stringify({
                  frame: drawFrameNumber,
                  x: Math.round(state.cameraX),
                  status: state.status,
                  avgMs: +(sum / f.length).toFixed(2),
                  p95: +f[Math.floor(f.length * 0.95)].toFixed(2),
                  max: +f[f.length - 1].toFixed(2),
                  over20: f.filter((v) => v > 20).length,
                  over33: f.filter((v) => v > 33).length,
                  cpuMs: +st.cpuMs.toFixed(2),
                  loads: perf.loads,
                  names: perf.names.slice(),
                  queued: perf.queued,
                  frees: perf.frees,
                  sec: Object.fromEntries(Object.entries(perf.sec).map(([k, v]) => [k, +(v / 120).toFixed(2)])),
                  imageBytes: bytes,
                  eeFree: System.getFreeMemory(),
                  vel: Math.round(state.players[0].vx),
                  musicMs: music ? Math.round(music.position) : 0,
                  musicRate: music ? music.rate : 0,
                  musicConv: music ? music.converted : null,
                  missing: perf.missing,
                  sprites: perf.sprites,
                  loader: loader.stats(),
                })
            );
            perf.missing = 0;
            perf.sprites = 0;
            perf.names.length = 0;
            perf.frames.length = 0;
            perf.queued = 0;
            perf.loads = 0;
            perf.frees = 0;
            perf.sec = {};
          }
        }
        if (pendingView) {
          console.log('GG_VIEW ' + pendingView);
          pendingView = null;
        }
      },
    },
    { fixedStep: 1 / 40, maxSteps: 3, clearColor: black }
  );
}

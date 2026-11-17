export const RULES = {
  hz: 40,
  gravity: 30000,
  maxFall: 320.755,
  acceleration: 6.9440061776,
  startSpeed: 220,
  multiSpeed: 211.6983,
  buffer: 0.35,
  morphTime: 1.1,
  width: 42,
  height: 48,
  fastSpeed: 513.208,
  boostThreshold: 769.812,
};

const EPS = 0.00001,
  BUCKET = 512,
  SBUCKET = 64;
let stampCounter = 0;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const overlaps = (a, b) =>
  a.x + a.w > b.x + EPS && a.x < b.x + b.w - EPS && a.y + a.h > b.y + EPS && a.y < b.y + b.h - EPS;

function rect(o) {
  return {
    ...o,
    w: o.w === undefined ? (o.width === undefined ? 34 : o.width) : o.w,
    h: o.h === undefined ? (o.height === undefined ? 34 : o.height) : o.h,
  };
}

function typeOf(o) {
  return o.type === undefined ? 1 : o.type;
}

function isSolid(o) {
  return (
    o.solid !== false &&
    (typeOf(o) === 1 || typeOf(o) === 2 || typeOf(o) === 3 || ['solid', 'block', 'accelerator'].indexOf(typeOf(o)) >= 0)
  );
}

function event(s, type, player, extra = {}) {
  s.events.push({ type, player: player ? player.id : 0, ...extra });
}

function animation(p, name) {
  if (p.anim !== name) {
    p.anim = name;
    p.animTime = 0;
  }
}

function makePlayer(x, y, vx, id, multi, gravity, morph) {
  return {
    id,
    x,
    y,
    prevX: x,
    prevY: y,
    w: multi ? 37 : 42,
    h: 48,
    vx,
    vy: 0,
    gravity,
    alive: true,
    visible: true,
    grounded: true,
    blocked: false,
    buffer: 0,
    anim: morph ? 'morph' : 'run',
    animTime: 0,
    animationTime: 0,
    flips: 0,
    standing: 0,
    wins: 0,
    angle: gravity < 0 ? 180 : 0,
    savedSpeed: vx,
    morphLeft: morph ? RULES.morphTime : 0,
    flipTime: 0,
    landTime: 0,
  };
}

function prepareLevel(level) {
  if (level._prepared) return level._prepared;
  const objects = (level.objects || level.solids || []).map((o) =>
      o.w !== undefined && o.h !== undefined ? o : rect(o)
    ),
    solids = objects.filter(isSolid),
    buckets = {};
  solids.forEach((o) => {
    for (let x = Math.floor(o.x / SBUCKET); x <= Math.floor((o.x + o.w) / SBUCKET); x++)
      (buckets[x] || (buckets[x] = [])).push(o);
  });
  const accelerators = [];

  objects.forEach((o, i) => {
    if (typeOf(o) === 2 || typeOf(o) === 'accelerator') {
      accelerators.push(
        { x: o.x, y: o.y - 1, w: o.w, h: 1, type: 2, key: 'a' + i + 't' },
        { x: o.x, y: o.y + o.h, w: o.w, h: 1, type: 2, key: 'a' + i + 'b' }
      );
    }
  });

  for (const o of level.triggers || []) {
    if (typeOf(o) === 2 || typeOf(o) === 'boost') accelerators.push({ ...rect(o), key: 't' + accelerators.length });
  }
  let checkpoints;

  if (level.checkpoints && level.checkpoints.length) checkpoints = level.checkpoints.map(rect);
  else {
    const columns = {};

    objects.forEach((o) => {
      if (typeOf(o) !== 4) return;
      const key = String(o.x);

      if (!columns[key]) columns[key] = { ...o };
      else {
        const c = columns[key],
          bottom = Math.max(c.y + c.h, o.y + o.h);
        c.y = Math.min(c.y, o.y);
        c.h = bottom - c.y;
      }
    });

    checkpoints = Object.keys(columns).map((k) => {
      const c = columns[k],
        bounds = objects.filter((o) => typeOf(o) === 3 && Math.abs(o.x - c.x) < 1).sort((a, b) => a.y - b.y);
      const bottom = bounds[bounds.length - 1];

      return {
        ...c,
        speed: c.speed || c.num || (bottom && bottom.speed) || 220,
        spawnX: c.spawnX === undefined ? c.x - 4 : c.spawnX,
        spawnY: c.spawnY === undefined ? (bottom ? bottom.y - 48 : c.y) : c.spawnY,
      };
    });
  }

  checkpoints.sort((a, b) => a.x - b.x);
  checkpoints.forEach((c, i) => {
    c.index = i + 1;
    c.key = 'c' + i;
  });
  const triggerBuckets = {};
  accelerators.forEach((a) => {
    for (let x = Math.floor(a.x / BUCKET); x <= Math.floor((a.x + a.w) / BUCKET); x++)
      (triggerBuckets[x] || (triggerBuckets[x] = [])).push(a);
  });
  return (level._prepared = { objects, solids, buckets, accelerators, checkpoints, triggerBuckets });
}

function nearSolids(s, p, dx, dy) {
  const a = Math.floor((Math.min(p.x, p.x + dx) - 1) / SBUCKET),
    b = Math.floor((Math.max(p.x + p.w, p.x + p.w + dx) + 1) / SBUCKET),
    stamp = ++stampCounter,
    list = [],
    buckets = s.geometry.buckets;
  for (let x = a; x <= b; x++) {
    const bin = buckets[x];
    if (!bin) continue;
    for (let i = 0; i < bin.length; i++) {
      const o = bin[i];
      if (o._stamp !== stamp) {
        o._stamp = stamp;
        list.push(o);
      }
    }
  }
  return list;
}

export function createGame(level, options = {}) {
  const count = clamp(Math.floor(options.players || 1), 1, 4),
    multi = count > 1,
    geometry = prepareLevel(level);
  const start = level.start || { x: 274, y: 270 };
  const checkpoint = options.checkpoint
    ? { ...options.checkpoint }
    : { x: start.x, y: start.y, speed: level.speed || start.speed || 220, index: 0 };

  const s = {
    ending: -1,
    timeScale: 1,
    level,
    geometry,
    options: { ...options, players: count },
    players: [],
    enemy: null,
    enemySwitch: [],
    cameraX: multi ? 316 : checkpoint.x + 42,
    cameraSpeed: multi ? 160.3775 : checkpoint.speed,
    checkpoint,
    checkpointTime: 0,
    checkpointScore: options.score || 0,
    score: options.score || 0,
    distanceScore: 0,
    time: 0,
    tick: 0,
    status: 'playing',
    deathTime: 0,
    events: [],
    consumed: new Set(),
    winner: 0,
    enemySpawn: { x: checkpoint.x, y: checkpoint.y, speed: checkpoint.speed, gravity: 1 },
    stats: {
      flips: 0,
      lands: 0,
      boosts: 0,
      checkpoints: 0,
      deaths: 0,
      restarts: 0,
      enemySpawns: 0,
      maxSpeed: checkpoint.speed,
    },
  };

  const multiStarts = level.spawns ||
    level.starts || [
      { x: 316, y: 103, gravity: 1 },
      { x: 316, y: 325, gravity: -1 },
      { x: 316, y: 240, gravity: 1 },
      { x: 316, y: 188, gravity: -1 },
    ];

  for (let i = 0; i < count; i++) {
    const spawn = multi ? multiStarts[i] : checkpoint;
    s.players.push(
      makePlayer(
        spawn.x,
        spawn.y,
        multi ? RULES.multiSpeed : checkpoint.speed,
        i + 1,
        multi,
        spawn.gravity || 1,
        options.morph !== false
      )
    );
  }

  if (multi) {
    const track = level.track || level.round || 1;
    s.cameraSpeed = track === 1 || track === 4 ? 160.3775 : 153.9624;
  }
  return s;
}

export function flipGravity(s, p) {
  if (typeof p === 'number') p = s.players[p];
  if (!p || !p.alive || p.morphLeft > 0) return false;
  p.gravity *= -1;
  p.grounded = false;
  p.buffer = 0;
  p.flipTime = 7 / 27;
  p.flips++;
  p.angle = p.gravity < 0 ? 180 : 0;
  animation(p, 'switch');
  s.stats.flips++;
  event(s, 'flip', p, { x: p.x, y: p.y, gravity: p.gravity });
  if (s.players.length === 1 && p === s.players[0]) s.enemySwitch.push(p.x);
  return true;
}

function enemyFlip(s, p) {
  p.gravity *= -1;
  p.grounded = false;
  p.flipTime = 9 / 30;
  p.angle = p.gravity < 0 ? 180 : 0;
  animation(p, 'switch');
}

function integrate(s, p, dt, ax) {
  p.prevX = p.x;
  p.prevY = p.y;
  p.blocked = false;
  const vx = p.vx + ax * dt,
    vy = clamp(p.vy + p.gravity * RULES.gravity * dt, -RULES.maxFall, RULES.maxFall);
  const dx = (p.vx + vx) * 0.5 * dt,
    dy = (p.vy + vy) * 0.5 * dt;
  p.vx = vx;
  p.vy = vy;
  const candidates = nearSolids(s, p, dx, dy);
  let moveX = dx;

  for (const o of candidates) {
    if (p.y + p.h <= o.y + EPS || p.y >= o.y + o.h - EPS) continue;

    if (dx > 0 && p.x + p.w <= o.x + EPS && p.x + p.w + moveX > o.x) moveX = Math.min(moveX, o.x - p.x - p.w);
    else if (dx < 0 && p.x >= o.x + o.w - EPS && p.x + moveX < o.x + o.w) moveX = Math.max(moveX, o.x + o.w - p.x);
  }

  if (Math.abs(moveX - dx) > EPS) {
    p.blocked = true;
    if (dx < 0) p.vx = 0;
  }
  p.x += moveX;
  let moveY = dy,
    grounded = false;

  for (const o of candidates) {
    if (p.x + p.w <= o.x + EPS || p.x >= o.x + o.w - EPS) continue;

    if (dy > 0 && p.y + p.h <= o.y + EPS && p.y + p.h + moveY >= o.y - EPS) {
      moveY = Math.min(moveY, o.y - p.y - p.h);
      grounded = p.gravity > 0;
    } else if (dy < 0 && p.y >= o.y + o.h - EPS && p.y + moveY <= o.y + o.h + EPS) {
      moveY = Math.max(moveY, o.y + o.h - p.y);
      grounded = p.gravity < 0;
    }
  }

  p.x = Number.isFinite(p.x) ? p.x : p.prevX;
  p.y += moveY;
  const landed = Math.abs(moveY - dy) > EPS;
  if (landed) p.vy = 0;
  p.grounded = grounded;
  if (grounded && Math.abs(p.prevY - p.y) > EPS) {
    s.stats.lands++;
    p.landTime = 6 / 67;
    event(s, 'land', p, { x: p.x, y: p.y });
  }
  p.flipTime = Math.max(0, p.flipTime - dt);
  p.landTime = Math.max(0, p.landTime - dt);

  if (p.flipTime > 0) animation(p, 'switch');
  else if (p.blocked) animation(p, p.grounded ? 'push' : 'slide');
  else if (p.landTime > 0) animation(p, 'landing');
  else if (!p.grounded) animation(p, 'fall');
  else animation(p, p.vx >= RULES.fastSpeed ? 'runfast' : 'run');

  p.animTime += dt;
  p.animationTime += dt;
}

function killPlayer(s, p, reason) {
  if (!p.alive) return;
  p.alive = false;
  p.deathReason = reason;
  p.buffer = 0;
  p.vx = 0;
  p.vy = 0;
  animation(p, 'death');
  p.animTime = 0;
  s.stats.deaths++;
  event(s, 'death', p, { reason, x: p.x, y: p.y });

  if (s.players.length === 1) {
    s.status = 'dead';
    s.deathTime = reason === 'fall' ? 1.3 : 2.3;
  } else {
    p.visible = false;
    p.standing = s.players.filter((q) => q.alive).length + 1;
  }
}

function boost(s, p, a) {
  const key = a.key;
  if (s.consumed.has(key)) return;
  s.consumed.add(key);
  p.vx += -0.05 * Math.min(p.vx, RULES.boostThreshold) + 51.3208;
  if (p !== s.enemy && s.enemy) s.enemy.vx += -0.05 * Math.min(s.enemy.vx, RULES.boostThreshold) + 51.3208;
  s.stats.boosts++;
  event(s, 'boost', p, { x: a.x, y: a.y, speed: p.vx });
}

function handleTriggers(s, p) {
  if (s.players.length > 1) return;
  const amin = Math.floor(p.x / BUCKET),
    amax = Math.floor((p.x + p.w) / BUCKET),
    stamp = ++stampCounter;
  for (let bin = amin; bin <= amax; bin++) {
    const list = s.geometry.triggerBuckets[bin];
    if (!list) continue;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (a._stamp !== stamp) {
        a._stamp = stamp;
        if (overlaps(p, a)) boost(s, p, a);
      }
    }
  }
  const cps = s.geometry.checkpoints;

  for (let i = 0; i < cps.length; i++) {
    const c = cps[i];
    if (c.x > p.x + p.w || c.x + c.w < p.x || !overlaps(p, c)) continue;
    if (p === s.enemy) {
      const key = c.key + ':enemy';
      if (!s.consumed.has(key)) {
        s.consumed.add(key);
        p.vx = c.speed || c.num || 220;
      }
      continue;
    }
    if (s.consumed.has(c.key) || c.index <= s.checkpoint.index) continue;
    s.consumed.add(c.key);
    p.vx = c.speed || c.num || 220;
    const n = c.index,
      base = 100 * n,
      bonus = Math.floor(Math.pow(1 - Math.min(1, s.checkpointTime / base), 2) * base);
    s.checkpointScore += base + bonus;
    s.checkpointTime = 0;
    s.stats.checkpoints++;
    s.checkpoint = {
      x: c.spawnX === undefined ? c.x - 4 : c.spawnX,
      y: c.spawnY === undefined ? c.y : c.spawnY,
      speed: 220,
      index: c.index,
    };
    event(s, 'checkpoint', p, {
      index: c.index,
      x: s.checkpoint.x,
      y: s.checkpoint.y,
      score: s.checkpointScore,
      bonus,
    });

    if (c.x >= 122400 && s.players.length === 1 && !s.options.credits) {
      if (s.ending < 0) {
        s.ending = 0;
        s.timeScale = 0.5;
        if (p.gravity < 0) flipGravity(s, p);
        event(s, 'ending', p);
      }
    } else if (c.finish || c.x >= 122400) {
      s.status = 'complete';
      event(s, 'complete', p);
    }
  }
}

function ejectFromSolids(s, p) {
  for (let pass = 0; pass < 4; pass++) {
    let moved = false;
    const list = nearSolids(s, p, 0, 0);

    for (let i = 0; i < list.length; i++) {
      const o = list[i];
      const ox = Math.min(p.x + p.w, o.x + o.w) - Math.max(p.x, o.x),
        oy = Math.min(p.y + p.h, o.y + o.h) - Math.max(p.y, o.y);
      if (ox <= EPS || oy <= EPS) continue;

      if (oy <= ox + EPS) {
        if (p.y + p.h / 2 < o.y + o.h / 2) {
          p.y -= oy;
        } else p.y += oy;
        p.vy = 0;
        p.grounded = true;
      } else if (p.x + p.w / 2 < o.x + o.w / 2) p.x -= ox;
      else p.x += ox;

      moved = true;
    }

    if (!moved) return;
  }
}

function movingPlayers(s, dt) {
  for (let pass = 0; pass < 10; pass++)
    for (let i = 0; i < s.players.length; i++)
      for (let j = i + 1; j < s.players.length; j++) {
        const a = s.players[i],
          b = s.players[j];
        if (!a.alive || !b.alive || !overlaps(a, b)) continue;
        const vertical = Math.abs(a.y - a.vy * dt - (b.y - b.vy * dt)) >= a.h - 8;

        if (vertical) {
          const rel = Math.abs(a.vy - b.vy) * dt;
          if (rel < EPS) continue;
          const depth = 48 - Math.abs(a.y - b.y),
            dir = a.y > b.y ? 1 : -1;

          if ((a.vy >= 0 && b.vy <= 0) || (a.vy <= 0 && b.vy >= 0)) {
            a.y += (dir * depth * Math.abs(a.vy * dt)) / rel;
            b.y -= (dir * depth * Math.abs(b.vy * dt)) / rel;
          } else if (a.vy > 0 || b.vy > 0) {
            if (a.y > b.y) b.y = a.y - a.h;
            else a.y = b.y - b.h;
          } else {
            if (a.y > b.y) a.y = b.y + b.h;
            else b.y = a.y + a.h;
          }

          if (a.vy === 0 || b.vy === 0 || a.vy * b.vy < 0) {
            a.vy = 0;
            b.vy = 0;
            a.grounded = true;
            b.grounded = true;
          }
        } else if (a.x < b.x) a.x = b.x - b.w * 1.1;
        else b.x = a.x - a.w * 1.1;
      }
}

export function restartGame(s) {
  const oldStats = s.stats,
    wins = s.players.map((p) => p.wins),
    time = s.time,
    tick = s.tick;
  const fresh = createGame(s.level, { ...s.options, checkpoint: s.checkpoint, score: s.checkpointScore });
  for (const key of Object.keys(s)) delete s[key];
  Object.assign(s, fresh);
  s.stats = oldStats;
  s.stats.restarts++;
  s.time = time;
  s.tick = tick;
  s.players.forEach((p, i) => (p.wins = wins[i] || 0));
  event(s, 'restart', s.players[0]);
  return s;
}

export function stepGame(s, inputs = [], dt = 1 / RULES.hz) {
  if (!(dt > 0) || !Number.isFinite(dt)) return s;
  dt = Math.min(dt, 0.05);
  if (s.timeScale < 1) dt *= s.timeScale;
  s.events = [];
  s.tick++;
  s.time += dt;
  if (s.status === 'complete' || s.status === 'results') return s;

  if (s.status === 'dead') {
    s.players[0].animTime += dt;
    s.deathTime -= dt;
    s.cameraSpeed = Math.max(0, s.cameraSpeed * (1 - dt * 0.8));
    s.cameraX += s.cameraSpeed * dt;
    if (s.deathTime <= EPS && s.options.autoRestart !== false) restartGame(s);
    return s;
  }

  const multi = s.players.length > 1,
    wasMorph = s.players[0].morphLeft > 0;
  if (multi && !wasMorph) {
    const nv = s.cameraSpeed + 7.740191 * dt;
    s.cameraX += (s.cameraSpeed + nv) * 0.5 * dt;
    s.cameraSpeed = nv;
  }

  for (let i = 0; i < s.players.length; i++) {
    const p = s.players[i];
    if (!p.alive) continue;
    if (p.morphLeft > 0) {
      p.morphLeft = Math.max(0, p.morphLeft - dt);
      p.animTime += dt;
      if (p.morphLeft <= EPS) {
        p.morphLeft = 0;
        animation(p, 'run');
        event(s, 'ready', p);
      }
      continue;
    }
    const input = inputs[i],
      pressed = input === true || !!(input && input.flip);
    if (pressed && p.x < 122400) {
      if (p.vy === 0) flipGravity(s, p);
      else p.buffer = RULES.buffer;
    }
    if (p.buffer > 0) {
      p.buffer = Math.max(0, p.buffer - dt);
      if (p.vy === 0 && p.buffer > 0) flipGravity(s, p);
    }
    if (multi) {
      p.vx = s.cameraSpeed;
      if (p.x >= s.cameraX) p.x = s.cameraX;
      else p.x += ((s.cameraX - p.x) * dt) / 5;
    }
    integrate(s, p, dt, s.options.credits ? 0 : RULES.acceleration);
    handleTriggers(s, p);
    s.stats.maxSpeed = Math.max(s.stats.maxSpeed, p.vx);

    if (!multi && s.options.credits !== true) {
      if ((p.y > 500 && p.x < 122640) || (p.y < -60 && p.x < 123640)) killPlayer(s, p, 'fall');
      else if (p.y > 1000) p.y = 1000;
    } else if (p.y > 500 || p.y < -60) killPlayer(s, p, 'fall');
    else if (p.x < s.cameraX - (multi ? 350 : 330)) killPlayer(s, p, 'left-behind');
  }

  if (!multi) {
    const p = s.players[0];

    if (!wasMorph && p.alive && s.status === 'playing') {
      s.checkpointTime += dt;
      s.cameraSpeed = p.vx;
      if (s.cameraX > p.x + 21) s.cameraSpeed = (1 - (s.cameraX - p.x) / 352) * p.vx;
      s.cameraX += s.cameraSpeed * dt;
      if (s.cameraX < p.x) s.cameraX = p.x;

      if (!s.enemy && s.options.enemy !== false && s.cameraX - 369 > s.enemySpawn.x && p.x < 123244) {
        const spawn = s.enemySpawn;
        s.enemy = makePlayer(spawn.x, spawn.y, spawn.speed, 0, false, spawn.gravity, false);
        s.stats.enemySpawns++;
        event(s, 'enemySpawn', s.enemy);
      }

      if (s.enemy) {
        const e = s.enemy;
        if (s.enemySwitch.length && e.x >= s.enemySwitch[0] && e.vy === 0) {
          enemyFlip(s, e);
          s.enemySwitch.shift();
        }
        if (e.x < s.cameraX - 290) e.x += dt * 34;
        else e.x -= dt * 12;
        if (e.x < s.cameraX - 375) e.x += dt * 50;
        integrate(s, e, dt, RULES.acceleration);
        handleTriggers(s, e);
        if (overlaps(p, e)) killPlayer(s, p, 'caught');

        if (e.y > 500 || e.y < -60 || e.x < s.cameraX - 405) {
          if (p.anim === 'run' || p.anim === 'runfast') {
            s.enemy = null;
            s.enemySpawn = { x: p.x, y: p.y, speed: p.vx, gravity: p.gravity };
            s.enemySwitch.length = 0;
          }
        }
      }

      const next = s.geometry.checkpoints.find((c) => c.index > s.checkpoint.index);
      const prev = s.checkpoint.x;
      s.distanceScore = next
        ? clamp((p.x - prev) / Math.max(1, next.x - prev), 0, 1) * ((s.checkpoint.index + 1) * 100)
        : 0;
      s.score = Math.floor(s.checkpointScore + s.distanceScore);

      if (s.ending >= 0 && s.status === 'playing') {
        s.ending += dt;
        if (p.alive && p.x > 122800 && s.ending <= 0.75) {
          event(s, 'quake', p);
          s.timeScale = 0.25;
          p.vx = 100;
        }
        if (s.ending > 1.07 && s.timeScale < 1) {
          s.timeScale = Math.min(1, s.timeScale + dt * 2.5);
          p.vx = Math.min(600, p.vx + dt * 1500);
        }
        if (s.ending > 3) {
          s.status = 'complete';
          event(s, 'complete', p);
        }
      }

      if (s.ending < 0 && s.level.finishX !== undefined && p.x >= s.level.finishX) {
        s.status = 'complete';
        event(s, 'complete', p);
      }
    }
  } else {
    movingPlayers(s, dt);
    for (const p of s.players) if (p.alive) ejectFromSolids(s, p);
    const alive = s.players.filter((p) => p.alive);

    if (alive.length <= 1 && !wasMorph) {
      s.status = 'results';
      s.winner = alive.length ? alive[0].id : 0;
      if (alive.length) {
        alive[0].standing = 1;
        alive[0].wins++;
      }
      event(s, 'winner', alive[0], { winner: s.winner });
    }
  }

  return s;
}

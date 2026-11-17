const BEAM = 'PlayState_ImgCheckpointRayAnim';
const SPEED = 'PlayState_ImgSpeed';
const round = (v) => Math.round(v * 1e6) / 1e6;

export function buildCheckpointArt(level) {
  const back = [],
    front = [],
    animatedScenery = [];
  const bounds = new Map();

  for (const o of level.objects || []) {
    if (o.type !== 3) continue;
    if (!bounds.has(o.x)) bounds.set(o.x, []);
    bounds.get(o.x).push(o);
  }

  for (const cp of level.checkpoints || []) {
    const pair = bounds.get(cp.x) || [];
    const triggerFps = pair.length > 1 && pair[1].y > pair[0].y ? 22 : 20;
    const sx = 2,
      sy = cp.h / 128;

    back.push({
      image: BEAM,
      x: cp.x - 239,
      y: round(cp.y - cp.h / 2 + 3.9),
      sx,
      sy: round(sy),
      w: 256,
      h: 256,
      drawW: 512,
      drawH: cp.h * 2,
      frame: 0,
      checkpointIndex: cp.index,
      kind: 'checkpoint',
      triggerFps,
      solid: false,
      layer: 'back',
      renderDepth: 1,
    });
  }

  for (const [layer, items] of [
    ['back', level.decorations || []],
    ['front', level.foreground || []],
  ]) {
    for (let i = 0; i < items.length; i++) {
      const o = items[i];

      if (o.image === SPEED)
        animatedScenery.push({
          ...o,
          kind: 'speed',
          frame: 0,
          layer,
          sceneryIndex: i,
          alreadyPresent: true,
          solid: false,
        });
    }
  }

  return { back, front, animatedScenery };
}

export function frameForTime(sprite, time, triggeredAt = null) {
  if (sprite.kind === 'speed') return Math.floor(Math.max(0, time) * 20) % 7;

  if (sprite.kind === 'checkpoint') {
    if (triggeredAt !== null && triggeredAt !== undefined && time >= triggeredAt)
      return 6 + Math.min(6, Math.floor((time - triggeredAt) * (sprite.triggerFps || 22)));

    return Math.floor(Math.max(0, time) * 20) % 6;
  }

  return sprite.frame === undefined ? 0 : sprite.frame;
}

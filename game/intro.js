// Armor Games opening of the original (symbol 16 of the SWF embedded in org.flixel.FlxPreloader_FlashAds).
// The preloader adds it on the stage and the game starts when its timeline reaches frame 218 (`FlxG.prePlay = true`), so frames
// 2..217 are on screen (216 frames at the stage rate of 40 fps = 5.4 s) and nothing skips it. Pure logic: runtime.js draws it.
export const FPS = 40;
export const LAST_FRAME = 217;
export const SOUND_FILES = Object.freeze({
  4: 'IntroSnd4',
  '4b': 'IntroSnd4b', // frame 77 plays only the in/out window of sound 4
  5: 'IntroSnd5',
  9: 'IntroSnd9',
  10: 'IntroSnd10',
  11: 'IntroSnd11',
  14: 'IntroSnd14',
  15: 'IntroSnd15',
});
// StartSoundTag of symbol 16: [timeline frame, sound]
export const INTRO_SOUNDS = Object.freeze([
  [2, '4'],
  [2, '5'],
  [8, '9'],
  [32, '10'],
  [37, '11'],
  [77, '4b'],
  [85, '14'],
  [85, '15'],
]);

export function createIntro(meta) {
  return { meta, frame: 0, done: false, played: 1 };
}

// timeline frame being shown (2 = first)
export function timelineFrame(intro) {
  return Math.min(LAST_FRAME, 2 + Math.floor(intro.frame + 1e-6));
}

export function dueSounds(intro) {
  const reached = timelineFrame(intro),
    out = [];
  for (const [frame, id] of INTRO_SOUNDS) if (frame <= reached && frame > intro.played) out.push(id);
  intro.played = Math.max(intro.played, reached);
  return out;
}

export function stepIntro(intro, dt) {
  intro.frame += dt * FPS;
  if (2 + Math.floor(intro.frame + 1e-6) > LAST_FRAME) intro.done = true;
  return intro;
}

// tile ids of the frame on screen
export function introTiles(intro) {
  return intro.done ? [] : intro.meta.frames[timelineFrame(intro) - intro.meta.frameFrom] || [];
}

// pages needed by the next `count` frames, in order, so the runtime can stream them
export function pagesAhead(intro, count) {
  const m = intro.meta,
    out = [],
    from = timelineFrame(intro);
  for (let n = from; n < from + count && n <= LAST_FRAME; n++)
    for (const id of m.frames[n - m.frameFrom] || []) {
      const page = m.tiles[id].page;
      if (!out.includes(page)) out.push(page);
    }
  return out.sort((a, b) => a - b);
}

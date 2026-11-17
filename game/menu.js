export const MENU_ART = {
  main: [
    { id: 'play', asset: 'MenuState_ImgPlayButton', over: 'MenuState_ImgPlayButtonOver', x: 194, y: 224 },
    { id: 'multi', asset: 'MenuState_ImgMultiButton', over: 'MenuState_ImgMultiButtonOver', x: 204, y: 332 },
    { id: 'credits', asset: 'MenuState_ImgCreditsButton', over: 'MenuState_ImgCreditsButtonOver', x: 148, y: 422 },
    { id: 'scores', asset: 'MenuState_ImgScoreButton', over: 'MenuState_ImgScoreButtonOver', x: 345, y: 422 },
  ],
  multi: [
    { id: 'two', asset: 'MenuState_ImgMultiButton2', over: 'MenuState_ImgMultiButtonOver2', x: 117, y: 288 },
    { id: 'three', asset: 'MenuState_ImgMultiButton3', over: 'MenuState_ImgMultiButtonOver3', x: 257, y: 288 },
    { id: 'four', asset: 'MenuState_ImgMultiButton4', over: 'MenuState_ImgMultiButtonOver4', x: 391, y: 288 },
    { id: 'back', asset: 'MenuState_ImgBackButton', over: 'MenuState_ImgBackButtonOver', x: 238, y: 415 },
  ],
  resume: [
    { id: 'yes', asset: 'MenuState_ImgYes', over: 'MenuState_ImgYesOver', x: 172, y: 264 },
    { id: 'no', asset: 'MenuState_ImgNo', over: 'MenuState_ImgNoOver', x: 342, y: 264 },
  ],
  pause: [
    { id: 'resume', asset: 'FlxPause_ImgResumeButton', over: 'FlxPause_ImgResumeButtonOver', x: 173, y: 160 },
    { id: 'menu', asset: 'FlxPause_ImgMenuButton', over: 'FlxPause_ImgMenuButtonOver', x: 180, y: 248 },
  ],
};

export function moveMain(index, dx, dy) {
  if (dy > 0) return [1, 2, 4, 4, 0][index];
  if (dy < 0) return [4, 0, 1, 1, 3][index];
  if (dx > 0) return index === 2 ? 3 : index === 4 ? 0 : index;
  if (dx < 0) return index === 3 ? 2 : index;
  return index;
}

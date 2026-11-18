import RAPIER from '@dimforge/rapier3d-simd-compat';
import * as xb from 'xrblocks';

import {RolloxGame} from './RolloxGame';

function startRollox(): void {
  const options = new xb.Options();
  options.setAppTitle('Rollox');
  options.setAppDescription(
    'Miniature mixed-reality bowling. Pinch & pull the ball back to aim, release to bowl!'
  );

  // Hands-first WebXR setup with reticles for comfortable seated play
  options.enableHands();
  options.hands.visualization = true;
  options.enableReticles();

  // Enable real Rapier3D physics with collision event queue
  options.physics.RAPIER = RAPIER as unknown as xb.RAPIERCompat;
  options.physics.fps = 60;
  options.physics.useEventQueue = true;

  xb.add(new RolloxGame());
  void xb.init(options);
}

document.addEventListener('DOMContentLoaded', startRollox);

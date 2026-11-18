import './index.css';

import {DepthSensingSystem, World} from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';

import {AimingSystem} from './systems/AimingSystem';
import {GameFlowSystem} from './systems/GameFlowSystem';
import {RolloxPhysicsSystem} from './systems/PhysicsSystem';
import {SpatialUISystem} from './systems/SpatialUISystem';

const container = document.getElementById('scene-container') as HTMLElement;

if (!container) {
  throw new Error('[Rollox] Missing #scene-container element in index.html');
}

World.create(container, projectOptions)
  .then((world) => {
    world
      .registerSystem(DepthSensingSystem)
      .registerSystem(RolloxPhysicsSystem)
      .registerSystem(AimingSystem)
      .registerSystem(SpatialUISystem)
      .registerSystem(GameFlowSystem);
  })
  .catch((err) => {
    console.error('[Rollox] Failed to initialize IWSDK World:', err);
  });

import {Types, createComponent, defineComponents} from '@iwsdk/core';

export const ArenaRootTag = createComponent('ArenaRootTag', {});

export const BowlingBall = createComponent('BowlingBall', {});

export const BallNearHandle = createComponent('BallNearHandle', {});

export const BallRayHandle = createComponent('BallRayHandle', {});

export const BowlingPin = createComponent('BowlingPin', {
  pinIndex: {type: Types.Int16, default: 0},
  fallen: {type: Types.Boolean, default: false},
});

export const LaneSegmentTag = createComponent('LaneSegmentTag', {
  segmentId: {type: Types.String, default: ''},
});

export const MovingObstacleTag = createComponent('MovingObstacleTag', {
  obstacleId: {type: Types.String, default: ''},
  kind: {type: Types.String, default: 'dwarf'},
});

export const GroundSurfaceTag = createComponent('GroundSurfaceTag', {});

export const SpatialPanelTag = createComponent('SpatialPanelTag', {
  panelId: {type: Types.String, default: ''},
  offsetX: {type: Types.Float32, default: 0},
  offsetY: {type: Types.Float32, default: 0},
  offsetZ: {type: Types.Float32, default: 0},
  yawDeg: {type: Types.Float32, default: 0},
  pitchDeg: {type: Types.Float32, default: 0},
  targetWidthM: {type: Types.Float32, default: 0.52},
  targetHeightM: {type: Types.Float32, default: 0.42},
});

export default defineComponents([
  ArenaRootTag,
  BowlingBall,
  BallNearHandle,
  BallRayHandle,
  BowlingPin,
  LaneSegmentTag,
  MovingObstacleTag,
  GroundSurfaceTag,
  SpatialPanelTag,
]);

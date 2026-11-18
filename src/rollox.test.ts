import {describe, expect, it} from 'vitest';

import {
  CAMPAIGN_LEVELS,
  MAX_LATERAL_PULL,
  MAX_PULL_DISTANCE,
  MIN_LAUNCH_POWER,
  WORKSHOP_MODULE_CATALOG,
  addWorkshopObstacle,
  appendWorkshopSegment,
  calculateLevelStars,
  compileWorkshopLevel,
  computeLaunchParameters,
  createDefaultWorkshopLayout,
  evaluateShotScoring,
  generatePinFormation,
  getSegmentExitSocket,
  removeWorkshopObstacle,
  removeWorkshopSegment,
  repositionWorkshopObstacle,
  repositionWorkshopSegment,
  rotateWorkshopSegment,
  syncWorkshopIdSeed,
  validateWorkshopLayout,
} from './levels';
import {RolloxStateMachine} from './stateMachine';
import type {WorkshopModuleKind} from './types';

describe('RolloxStateMachine', () => {
  it('enforces valid lifecycle transitions and pause/resume restoration', () => {
    const sm = new RolloxStateMachine();
    expect(sm.state).toBe('LOADING');
    expect(sm.transitionGame('MAIN_MENU')).toBe(true);
    expect(sm.transitionGame('READY')).toBe(true);
    expect(sm.transitionGame('AIMING')).toBe(true);

    // Pause from AIMING should resume back to READY safely
    expect(sm.pause()).toBe(true);
    expect(sm.state).toBe('PAUSED');
    expect(sm.previousBeforePause).toBe('READY');
    expect(sm.resume()).toBe(true);
    expect(sm.state).toBe('READY');
  });

  it('preserves WORKSHOP_TEST across pause/resume and rejects invalid transitions', () => {
    const sm = new RolloxStateMachine();
    sm.transitionGame('MAIN_MENU');
    sm.transitionGame('WORKSHOP');
    sm.transitionGame('WORKSHOP_TEST');
    expect(sm.pause()).toBe(true);
    expect(sm.previousBeforePause).toBe('WORKSHOP_TEST');
    expect(sm.resume()).toBe(true);
    expect(sm.state).toBe('WORKSHOP_TEST');

    const fresh = new RolloxStateMachine();
    expect(fresh.transitionGame('RESULT')).toBe(false);
    expect(fresh.state).toBe('LOADING');
  });
});

describe('Launch Physics & Curves', () => {
  it('cancels launches below MIN_LAUNCH_POWER and clamps pullback pocket', () => {
    const tap = computeLaunchParameters(0, 0.005, 'smooth');
    expect(tap.canLaunch).toBe(false);
    expect(tap.power01).toBe(0);

    const full = computeLaunchParameters(
      MAX_LATERAL_PULL * 3,
      MAX_PULL_DISTANCE * 3,
      'linear'
    );
    expect(full.canLaunch).toBe(true);
    expect(full.power01).toBeCloseTo(1, 4);
    expect(full.velocity.z).toBeLessThan(0);
    // Pulling ball right (+X) aims shot left (-X)
    expect(full.dirX).toBeLessThan(0);
  });

  it('applies linear, smooth, and snappy curves monotonically', () => {
    const linear = computeLaunchParameters(0, MAX_PULL_DISTANCE * 0.5, 'linear');
    const smooth = computeLaunchParameters(0, MAX_PULL_DISTANCE * 0.5, 'smooth');
    const snappy = computeLaunchParameters(0, MAX_PULL_DISTANCE * 0.5, 'snappy');
    expect(linear.power01).toBeGreaterThanOrEqual(MIN_LAUNCH_POWER);
    expect(snappy.power01).toBeGreaterThan(smooth.power01);
    expect(smooth.power01).toBeCloseTo(0.5, 3);
  });
});

describe('Campaign Levels, Pin Formations & Scoring', () => {
  it('defines 5 valid campaign levels and all 4 pin formations cleanly', () => {
    expect(CAMPAIGN_LEVELS).toHaveLength(5);
    CAMPAIGN_LEVELS.forEach((lvl, idx) => {
      expect(lvl.index).toBe(idx);
      expect(lvl.segments.length).toBeGreaterThanOrEqual(3);
      expect(lvl.segments[0].id).toBe('launch-pad');
    });

    expect(generatePinFormation('standard10', {x: 0, y: 0, z: -1.3})).toHaveLength(10);
    expect(generatePinFormation('diamond9', {x: 0, y: 0, z: -1.3})).toHaveLength(9);
    expect(generatePinFormation('split8', {x: 0, y: 0, z: -1.3})).toHaveLength(8);
    expect(generatePinFormation('crown6', {x: 0, y: 0, z: -1.3})).toHaveLength(6);

    // Rotated pin deck rotates placements around deck origin
    const rotated = generatePinFormation('crown6', {x: 0, y: 0, z: -1.3}, Math.PI / 2);
    expect(rotated[0].x).toBeCloseTo(0, 5);
    expect(rotated[0].z).toBeCloseTo(-1.3, 5);
    expect(rotated[3].x).toBeLessThan(-0.1);
  });

  it('awards Strike, Spare, All Cleared, Partial, Miss, and Stars accurately', () => {
    const strike = evaluateShotScoring({
      newlyFallen: 10,
      totalFallen: 10,
      totalPins: 10,
      shotsUsed: 1,
    });
    expect(strike.isStrike).toBe(true);
    expect(strike.shotPoints).toBe(150);
    expect(calculateLevelStars(10, 10, 1, 2)).toBe(3);

    const spare = evaluateShotScoring({
      newlyFallen: 4,
      totalFallen: 10,
      totalPins: 10,
      shotsUsed: 2,
    });
    expect(spare.isSpare).toBe(true);
    expect(spare.shotPoints).toBe(65);
    expect(calculateLevelStars(10, 10, 2, 1)).toBe(3);

    const clearedThird = evaluateShotScoring({
      newlyFallen: 2,
      totalFallen: 10,
      totalPins: 10,
      shotsUsed: 3,
    });
    expect(clearedThird.isAllCleared).toBe(true);
    expect(clearedThird.shotPoints).toBe(35);
    expect(calculateLevelStars(10, 10, 3, 0)).toBe(2);

    const partial = evaluateShotScoring({
      newlyFallen: 3,
      totalFallen: 7,
      totalPins: 10,
      shotsUsed: 2,
    });
    expect(partial.shotPoints).toBe(30);
    expect(calculateLevelStars(7, 10, 3, 0)).toBe(2);

    const miss = evaluateShotScoring({
      newlyFallen: 0,
      totalFallen: 3,
      totalPins: 10,
      shotsUsed: 3,
    });
    expect(miss.shotPoints).toBe(0);
    expect(miss.callout).toContain('MISS');
    expect(calculateLevelStars(3, 10, 3, 0)).toBe(1);
    expect(calculateLevelStars(2, 10, 3, 0)).toBe(0);
  });
});

describe('Alley Workshop Builder, Edge Cases & Persistence', () => {
  it('supports all 8 module kinds, enforces caps, and rotates/moves/deletes safely', () => {
    const allKinds = Object.keys(WORKSHOP_MODULE_CATALOG) as WorkshopModuleKind[];
    expect(allKinds).toHaveLength(8);

    // Snap each module cleanly after a default segment
    for (const kind of allKinds) {
      let ws = createDefaultWorkshopLayout();
      ws = removeWorkshopSegment(ws); // 1 straight segment
      ws = appendWorkshopSegment(ws, kind);
      expect(ws.segments).toHaveLength(2);
      const val = validateWorkshopLayout(ws);
      expect(val.valid).toBe(true);
    }

    // Cap at 6 segments and 4 obstacles
    let full = createDefaultWorkshopLayout();
    for (let i = 0; i < 8; i++) {
      full = appendWorkshopSegment(full, 'short');
      full = addWorkshopObstacle(full, 'slidingBarrier');
    }
    expect(full.segments).toHaveLength(6);
    expect(full.obstacles).toHaveLength(4);

    // Rotate segment + verify validation catches extreme broken rotation / disconnection
    const firstId = full.segments[0].id;
    const rotated = rotateWorkshopSegment(full, firstId, 0.8);
    expect(validateWorkshopLayout(rotated).valid).toBe(false);

    // Obstacle movement & removal
    const obsId = full.obstacles[full.obstacles.length - 1].id;
    const floating = repositionWorkshopObstacle(full, obsId, 1.2, 0);
    expect(validateWorkshopLayout(floating).valid).toBe(false);
    const trimmed = removeWorkshopObstacle(floating, obsId);
    expect(trimmed.obstacles).toHaveLength(3);
  });

  it('catches obstacle overlap against rotated Workshop pin decks and prevents duplicate IDs after restore', () => {
    let layout = createDefaultWorkshopLayout();
    layout = {
      ...layout,
      obstacles: [],
      segments: [layout.segments[0]],
    };
    layout = appendWorkshopSegment(layout, 'leftTurn');
    layout = appendWorkshopSegment(layout, 'leftTurn');
    const lastExit = getSegmentExitSocket(layout.segments[layout.segments.length - 1]);
    // Place obstacle directly on the rotated pin deck center
    const overlapping = {
      ...layout,
      obstacles: [
        {
          id: 'obs-42',
          kind: 'bumper' as const,
          x: lastExit.x - Math.sin(lastExit.yawY) * 0.22,
          y: lastExit.y,
          z: lastExit.z - Math.cos(lastExit.yawY) * 0.22,
          yawY: lastExit.yawY,
          patrolRadius: 0.14,
          speed: 1.85,
          radius: 0.115,
        },
      ],
    };
    const res = validateWorkshopLayout(overlapping);
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes('pin deck'))).toBe(true);

    // Sync seed past obs-42 and verify new segment/obstacle IDs never collide
    syncWorkshopIdSeed(overlapping);
    const addedSeg = appendWorkshopSegment(overlapping, 'straight');
    const newSegId = addedSeg.segments[addedSeg.segments.length - 1].id;
    const segNum = Number(newSegId.split('-')[1]);
    expect(segNum).toBeGreaterThan(42);
  });

  it('compiles custom Workshop rails toggle & 4 pin formations into LevelConfig cleanly', () => {
    let layout = createDefaultWorkshopLayout();
    layout = {...layout, railsEnabled: false, pinFormation: 'split8'};
    const compiled = compileWorkshopLevel(layout);
    expect(compiled.layout).toBe('custom');
    expect(compiled.pinFormation).toBe('split8');
    expect(compiled.segments.every((s) => s.hasRails === false)).toBe(true);

    // Moving a segment breaks connectivity
    const broken = repositionWorkshopSegment(layout, layout.segments[0].id, 0.8, 0);
    expect(validateWorkshopLayout(broken).valid).toBe(false);
  });
});

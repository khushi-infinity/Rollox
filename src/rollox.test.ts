import {describe, expect, it} from 'vitest';

import {
  CAMPAIGN_LEVELS,
  MAX_LATERAL_PULL,
  MAX_PULL_DISTANCE,
  MIN_LAUNCH_POWER,
  addWorkshopObstacle,
  appendWorkshopSegment,
  calculateLevelStars,
  compileWorkshopLevel,
  computeLaunchParameters,
  createDefaultWorkshopLayout,
  evaluateShotScoring,
  generatePinFormation,
  removeWorkshopSegment,
  repositionWorkshopSegment,
  validateWorkshopLayout,
} from './levels';
import {RolloxStateMachine} from './stateMachine';

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

  it('preserves WORKSHOP_TEST across pause/resume', () => {
    const sm = new RolloxStateMachine();
    sm.transitionGame('MAIN_MENU');
    sm.transitionGame('WORKSHOP');
    sm.transitionGame('WORKSHOP_TEST');
    expect(sm.pause()).toBe(true);
    expect(sm.previousBeforePause).toBe('WORKSHOP_TEST');
    expect(sm.resume()).toBe(true);
    expect(sm.state).toBe('WORKSHOP_TEST');
  });

  it('rejects invalid state jumps', () => {
    const sm = new RolloxStateMachine();
    expect(sm.transitionGame('RESULT')).toBe(false);
    expect(sm.state).toBe('LOADING');
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
  it('defines 5 playable campaign levels with expected pin counts', () => {
    expect(CAMPAIGN_LEVELS).toHaveLength(5);
    expect(generatePinFormation('standard10', {x: 0, y: 0, z: -1.3})).toHaveLength(10);
    expect(generatePinFormation('diamond9', {x: 0, y: 0, z: -1.3})).toHaveLength(9);
    expect(generatePinFormation('split8', {x: 0, y: 0, z: -1.3})).toHaveLength(8);
    expect(generatePinFormation('crown6', {x: 0, y: 0, z: -1.3})).toHaveLength(6);
  });

  it('awards Strike, Spare, Clear, and Stars accurately', () => {
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
    expect(calculateLevelStars(3, 10, 3, 0)).toBe(1);
    expect(calculateLevelStars(2, 10, 3, 0)).toBe(0);
  });
});

describe('Alley Workshop Builder & Validation', () => {
  it('creates a valid default layout and compiles into a runnable LevelConfig', () => {
    const layout = createDefaultWorkshopLayout();
    const validation = validateWorkshopLayout(layout);
    expect(validation.valid).toBe(true);
    expect(validation.errors).toHaveLength(0);

    const compiled = compileWorkshopLevel(layout);
    expect(compiled.layout).toBe('custom');
    expect(compiled.segments.length).toBe(layout.segments.length + 2);
  });

  it('snaps new modules seamlessly and detects disconnected modules', () => {
    let layout = createDefaultWorkshopLayout();
    layout = appendWorkshopSegment(layout, 'rampUp');
    layout = addWorkshopObstacle(layout, 'bumper', 2);
    expect(validateWorkshopLayout(layout).valid).toBe(true);

    // Move first segment far away to trigger gap validation error
    const firstId = layout.segments[0].id;
    const broken = repositionWorkshopSegment(layout, firstId, 0.8, 0);
    const res = validateWorkshopLayout(broken);
    expect(res.valid).toBe(false);
    expect(res.errors.length).toBeGreaterThan(0);

    // Deleting down to minimum 1 segment preserves at least 1 segment
    let shrunk = removeWorkshopSegment(layout);
    shrunk = removeWorkshopSegment(shrunk);
    shrunk = removeWorkshopSegment(shrunk);
    expect(shrunk.segments).toHaveLength(1);
  });
});

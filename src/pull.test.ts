import {describe, expect, it} from 'vitest';

import {BALL_RADIUS, MAX_PULL_DISTANCE} from './levels';
import {
  PULL_CONSTANTS,
  PullStateMachine,
  UI_SCALE_DEFAULT,
  UI_SCALE_MAX,
  UI_SCALE_MIN,
  UI_SCALE_STEP,
  clampUiScale,
  stepUiScale,
} from './pullInteraction';

describe('PullStateMachine — Hand Pinch Hysteresis & Release Reliability', () => {
  it('keeps the ball attached continuously through deep pulls without premature snap-forward or auto-release', () => {
    const sm = new PullStateMachine();
    sm.beginGrab(
      'hand-pinch',
      'right',
      {x: 0.02, y: BALL_RADIUS + 0.01, z: 0.01},
      {x: 0, y: BALL_RADIUS, z: 0},
      true
    );

    // Pull progressively back even past MAX_PULL_DISTANCE while fingers stay pinched
    let res = sm.step({
      dt: 0.016,
      tracked: true,
      pointerLocal: {x: 0.02, y: BALL_RADIUS + 0.01, z: 0.14},
      pinchDistM: 0.018,
      selectActive: true,
      curve: 'smooth',
    });
    expect(res.outcome).toBe('HOLDING');
    expect(res.pullZ).toBeGreaterThan(0.1);
    expect(res.launch.power01).toBeGreaterThan(0.35);

    // Deep pull (0.42m back, far beyond MAX_PULL_DISTANCE)
    for (let i = 0; i < 12; i++) {
      res = sm.step({
        dt: 0.016,
        tracked: true,
        pointerLocal: {x: -0.04, y: BALL_RADIUS + 0.02, z: 0.42},
        pinchDistM: 0.02,
        selectActive: true,
        curve: 'smooth',
      });
    }
    expect(res.outcome).toBe('HOLDING');
    expect(res.pullZ).toBeCloseTo(MAX_PULL_DISTANCE, 4);
    expect(res.launch.power01).toBeGreaterThan(0.95);
    expect(sm.active).toBe(true);
  });

  it('prevents mid-pull drops from finger spread jitter or premature WebXR selectend occlusion glitches', () => {
    const sm = new PullStateMachine();
    sm.beginGrab(
      'hand-pinch',
      'right',
      {x: 0, y: BALL_RADIUS, z: 0},
      {x: 0, y: BALL_RADIUS, z: 0},
      true
    );

    // Pull back and simulate selectActive flickering off while fingers are still closed (<= 0.032m)
    const heldTight = sm.step({
      dt: 0.03,
      tracked: true,
      pointerLocal: {x: 0, y: BALL_RADIUS, z: 0.16},
      pinchDistM: 0.029,
      selectActive: false,
      curve: 'smooth',
    });
    expect(heldTight.outcome).toBe('HOLDING');

    // Fluctuate inside hysteresis band (between 0.028m acquire and 0.048m release) while selectActive=true
    const heldHysteresis = sm.step({
      dt: 0.08,
      tracked: true,
      pointerLocal: {x: 0.03, y: BALL_RADIUS, z: 0.18},
      pinchDistM: 0.044,
      selectActive: true,
      curve: 'smooth',
    });
    expect(heldHysteresis.outcome).toBe('HOLDING');
    expect(sm.active).toBe(true);
  });

  it('requires sustained intentional pinch opening to launch, and rejects light taps safely', () => {
    const sm = new PullStateMachine();
    sm.beginGrab(
      'hand-pinch',
      'right',
      {x: 0, y: BALL_RADIUS, z: 0},
      {x: 0, y: BALL_RADIUS, z: 0},
      true
    );

    // Pull to ~75% power
    for (let i = 0; i < 6; i++) {
      sm.step({
        dt: 0.02,
        tracked: true,
        pointerLocal: {x: 0.04, y: BALL_RADIUS, z: 0.18},
        pinchDistM: 0.016,
        selectActive: true,
        curve: 'linear',
      });
    }

    // Open fingers wide: first 20ms frame holds during debounce confirm window
    const debouncing = sm.step({
      dt: 0.02,
      tracked: true,
      pointerLocal: {x: 0.04, y: BALL_RADIUS, z: 0.18},
      pinchDistM: 0.065,
      selectActive: false,
      curve: 'linear',
    });
    expect(debouncing.outcome).toBe('HOLDING');

    // Sustained open past HAND_RELEASE_CONFIRM_SEC launches forward!
    const launched = sm.step({
      dt: PULL_CONSTANTS.HAND_RELEASE_CONFIRM_SEC + 0.01,
      tracked: true,
      pointerLocal: {x: 0.04, y: BALL_RADIUS, z: 0.18},
      pinchDistM: 0.072,
      selectActive: false,
      curve: 'linear',
    });
    expect(launched.outcome).toBe('RELEASE_LAUNCH');
    expect(launched.launch.canLaunch).toBe(true);
    expect(launched.launch.velocity.z).toBeLessThan(0);
    expect(launched.launch.dirX).toBeLessThan(0);
    expect(sm.active).toBe(false);

    // Light tap below MIN_LAUNCH_POWER cancels cleanly back to tee
    sm.beginGrab(
      'mouse',
      null,
      {x: 0, y: BALL_RADIUS, z: 0},
      {x: 0, y: BALL_RADIUS, z: 0},
      true
    );
    sm.step({
      dt: 0.016,
      tracked: true,
      pointerLocal: {x: 0, y: BALL_RADIUS, z: 0.005},
      pinchDistM: null,
      selectActive: true,
      curve: 'smooth',
    });
    const tapCancel = sm.step({
      dt: 0.016,
      tracked: true,
      pointerLocal: {x: 0, y: BALL_RADIUS, z: 0.005},
      pinchDistM: null,
      selectActive: false,
      curve: 'smooth',
    });
    expect(tapCancel.outcome).toBe('CANCELLED');
    expect(sm.active).toBe(false);
  });

  it('holds safely during brief hand tracking loss and cancels rather than misfiring if tracking stays lost', () => {
    const sm = new PullStateMachine();
    sm.beginGrab(
      'hand-pinch',
      'left',
      {x: 0, y: BALL_RADIUS, z: 0},
      {x: 0, y: BALL_RADIUS, z: 0},
      true
    );

    sm.step({
      dt: 0.02,
      tracked: true,
      pointerLocal: {x: -0.02, y: BALL_RADIUS, z: 0.15},
      pinchDistM: 0.015,
      selectActive: true,
      curve: 'smooth',
    });

    // Brief 120ms tracking blink -> holds ball steadily at pulled position
    const briefBlink = sm.step({
      dt: 0.12,
      tracked: false,
      pointerLocal: {x: 0, y: 0, z: 0},
      pinchDistM: null,
      selectActive: false,
      curve: 'smooth',
    });
    expect(briefBlink.outcome).toBe('HOLDING');
    expect(sm.active).toBe(true);

    // Tracking recovers -> timer resets and pull continues seamlessly!
    const recovered = sm.step({
      dt: 0.016,
      tracked: true,
      pointerLocal: {x: -0.02, y: BALL_RADIUS, z: 0.17},
      pinchDistM: 0.015,
      selectActive: true,
      curve: 'smooth',
    });
    expect(recovered.outcome).toBe('HOLDING');

    // Prolonged tracking loss (> TRACKING_LOSS_HOLD_SEC across frames) cancels back to tee — never auto-fires!
    let prolonged = recovered;
    for (let i = 0; i < 4; i++) {
      prolonged = sm.step({
        dt: 0.08,
        tracked: false,
        pointerLocal: {x: 0, y: 0, z: 0},
        pinchDistM: null,
        selectActive: false,
        curve: 'smooth',
      });
    }
    expect(prolonged.outcome).toBe('CANCELLED');
    expect(sm.active).toBe(false);
  });
});

describe('Spatial Menu & UI Scaling Bounds', () => {
  it('clamps UI scale safely within [0.7, 1.5] and steps cleanly without drift', () => {
    expect(clampUiScale(0.2)).toBe(UI_SCALE_MIN);
    expect(clampUiScale(2.8)).toBe(UI_SCALE_MAX);
    expect(clampUiScale(Number.NaN)).toBe(UI_SCALE_DEFAULT);

    let scale = UI_SCALE_DEFAULT;
    scale = stepUiScale(scale, UI_SCALE_STEP);
    expect(scale).toBe(1.1);
    scale = stepUiScale(scale, UI_SCALE_STEP);
    expect(scale).toBe(1.2);
    scale = stepUiScale(scale, -UI_SCALE_STEP);
    expect(scale).toBe(1.1);

    for (let i = 0; i < 10; i++) {
      scale = stepUiScale(scale, UI_SCALE_STEP);
    }
    expect(scale).toBe(UI_SCALE_MAX);

    for (let i = 0; i < 12; i++) {
      scale = stepUiScale(scale, -UI_SCALE_STEP);
    }
    expect(scale).toBe(UI_SCALE_MIN);
  });
});

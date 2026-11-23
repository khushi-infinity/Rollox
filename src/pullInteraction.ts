import {
  BALL_RADIUS,
  MAX_LATERAL_PULL,
  MAX_PULL_DISTANCE,
  type LaunchParameters,
  computeLaunchParameters,
} from './levels';
import type {PowerCurveMode} from './types';

export type PullSourceKind = 'hand-pinch' | 'controller' | 'mouse';
export type HandSide = 'left' | 'right';

export const PULL_CONSTANTS = {
  /** Thumb-tip to index-tip distance (meters) required to start a pinch grab. */
  PINCH_ACQUIRE_GAP_M: 0.032,
  /**
   * Wide hysteresis release threshold (meters): once pinched, fingers must
   * visibly open past this gap before release triggers, preventing partial
   * self-occlusion or jitter from dropping the ball mid-pull.
   */
  PINCH_RELEASE_GAP_M: 0.05,
  /**
   * Tight pinch threshold below which raw `selectend` events are treated as
   * runtime pinch-occlusion glitches rather than an intentional open-hand release.
   */
  PINCH_STILL_CLOSED_OVERRIDE_M: 0.034,
  /** Near-hand grab bubble radius (meters) around the tee/ball. */
  HAND_NEAR_GRAB_RADIUS_M: 0.24,
  /** Debounce window (seconds) hand pinch must stay open before launching. */
  HAND_RELEASE_CONFIRM_SEC: 0.048,
  /**
   * Grace window (seconds) to hold the ball steadily if hand tracking blinks
   * during a deep backward pull toward the chest. Never auto-fires on expiry.
   */
  TRACKING_LOSS_HOLD_SEC: 0.24,
  /** Watchdog timeout (seconds) if held input freezes completely without motion. */
  STUCK_HOLD_TIMEOUT_SEC: 15.0,
  /** Exponential smoothing rate (1/s) for ball-to-hand attachment. */
  HAND_FOLLOW_DAMP_LAMBDA: 36,
  /** Exponential decay rate (1/s) pulling the grabbed ball smoothly onto the hand anchor. */
  GRAB_OFFSET_DECAY_LAMBDA: 28,
  /** Multiplier on physical backward Z pull so seated ~20cm pulls reach 100% power cleanly. */
  DESK_DEPTH_PULL_SCALE: 1.18,
} as const;

export const UI_SCALE_MIN = 0.7;
export const UI_SCALE_MAX = 1.5;
export const UI_SCALE_DEFAULT = 1.0;
export const UI_SCALE_STEP = 0.1;

export function clampUiScale(scale: number): number {
  if (!Number.isFinite(scale)) return UI_SCALE_DEFAULT;
  const clamped = Math.max(UI_SCALE_MIN, Math.min(UI_SCALE_MAX, scale));
  return Number(clamped.toFixed(2));
}

export function stepUiScale(currentScale: number, delta: number): number {
  return clampUiScale(currentScale + delta);
}

/**
 * Framerate-independent exponential damping interpolation factor in [0, 1].
 */
export function dampFactor(lambda: number, dt: number): number {
  if (dt <= 0) return 0;
  return 1 - Math.exp(-lambda * dt);
}

export function clampNumber(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export interface PullStepInput {
  dt: number;
  tracked: boolean;
  /** Current hand/controller/cursor position in arena-local space. */
  pointerLocal: Vec3Like;
  /** Thumb-tip to index-tip distance in meters when XRHand joint poses exist; null otherwise. */
  pinchDistM: number | null;
  /** Runtime select/trigger active state. */
  selectActive: boolean;
  /** Active power curve from settings. */
  curve: PowerCurveMode;
  /** Explicit emergency/button cancel (e.g. controller B/Y or Escape). */
  cancelRequested?: boolean;
}

export type PullStepOutcome = 'HOLDING' | 'RELEASE_LAUNCH' | 'CANCELLED';

export interface PullStepResult {
  outcome: PullStepOutcome;
  ballLocal: Vec3Like;
  pullX: number;
  pullZ: number;
  launch: LaunchParameters;
  /** True only on the frame power crosses a 25%/50%/75%/95% haptic threshold upward. */
  crossedPowerTier: boolean;
}

/**
 * Stateful, pure TypeScript interaction state machine governing Rollox's
 * pinch-pull-aim-release bowling mechanic across WebXR Hands, Controllers,
 * and Desktop Mouse drag.
 *
 * Key guarantees:
 * 1. Ball remains continuously attached to the player's hand throughout the
 *    entire backward pull — clamping only restricts the physical tee pocket
 *    without dragging the anchor forward or triggering snap-back jumps.
 * 2. Hand pinch hysteresis (`PINCH_ACQUIRE_GAP_M` vs `PINCH_RELEASE_GAP_M`) +
 *    `HAND_RELEASE_CONFIRM_SEC` debounce prevent premature drop when fingers
 *    partially occlude near the chest.
 * 3. Temporary tracking dropout holds the ball steadily (`TRACKING_LOSS_HOLD_SEC`)
 *    and safely cancels back to the tee if prolonged — NEVER fires forward on lost tracking.
 */
export class PullStateMachine {
  public active = false;
  public sourceKind: PullSourceKind | null = null;
  public handedness: HandSide | null = null;

  private anchorLocal: Vec3Like = {x: 0, y: BALL_RADIUS, z: 0};
  private grabOffsetLocal: Vec3Like = {x: 0, y: 0, z: 0};
  private smoothedBallLocal: Vec3Like = {x: 0, y: BALL_RADIUS, z: 0};
  private clampedPullX = 0;
  private clampedPullZ = 0;
  private lastLaunch: LaunchParameters = computeLaunchParameters(0, 0, 'smooth');

  private releaseConfirmTimer = 0;
  private trackingLostTimer = 0;
  private frozenHoldTimer = 0;
  private lastPointerLocal: Vec3Like = {x: 0, y: BALL_RADIUS, z: 0};
  private sawSelectActive = false;
  private lastPowerTier = 0;

  reset(): void {
    this.active = false;
    this.sourceKind = null;
    this.handedness = null;
    this.anchorLocal = {x: 0, y: BALL_RADIUS, z: 0};
    this.grabOffsetLocal = {x: 0, y: 0, z: 0};
    this.smoothedBallLocal = {x: 0, y: BALL_RADIUS, z: 0};
    this.clampedPullX = 0;
    this.clampedPullZ = 0;
    this.lastLaunch = computeLaunchParameters(0, 0, 'smooth');
    this.releaseConfirmTimer = 0;
    this.trackingLostTimer = 0;
    this.frozenHoldTimer = 0;
    this.lastPointerLocal = {x: 0, y: BALL_RADIUS, z: 0};
    this.sawSelectActive = false;
    this.lastPowerTier = 0;
  }

  beginGrab(
    sourceKind: PullSourceKind,
    handedness: HandSide | null,
    pointerLocal: Vec3Like,
    ballCurrentLocal: Vec3Like,
    selectCurrentlyActive = false
  ): void {
    this.active = true;
    this.sourceKind = sourceKind;
    this.handedness = handedness;
    this.anchorLocal = {x: pointerLocal.x, y: pointerLocal.y, z: pointerLocal.z};
    this.lastPointerLocal = {x: pointerLocal.x, y: pointerLocal.y, z: pointerLocal.z};
    this.grabOffsetLocal = {
      x: ballCurrentLocal.x - pointerLocal.x,
      y: ballCurrentLocal.y - pointerLocal.y,
      z: ballCurrentLocal.z - pointerLocal.z,
    };
    this.smoothedBallLocal = {
      x: ballCurrentLocal.x,
      y: ballCurrentLocal.y,
      z: ballCurrentLocal.z,
    };
    this.clampedPullX = clampNumber(ballCurrentLocal.x, -MAX_LATERAL_PULL, MAX_LATERAL_PULL);
    this.clampedPullZ = clampNumber(ballCurrentLocal.z, 0, MAX_PULL_DISTANCE);
    this.lastLaunch = computeLaunchParameters(this.clampedPullX, this.clampedPullZ, 'smooth');
    this.releaseConfirmTimer = 0;
    this.trackingLostTimer = 0;
    this.frozenHoldTimer = 0;
    this.sawSelectActive = selectCurrentlyActive;
    this.lastPowerTier = 0;
  }

  step(input: PullStepInput): PullStepResult {
    if (!this.active) {
      return {
        outcome: 'CANCELLED',
        ballLocal: {x: 0, y: BALL_RADIUS, z: 0},
        pullX: 0,
        pullZ: 0,
        launch: this.lastLaunch,
        crossedPowerTier: false,
      };
    }

    if (input.cancelRequested) {
      const launch = this.lastLaunch;
      this.reset();
      return {
        outcome: 'CANCELLED',
        ballLocal: {x: 0, y: BALL_RADIUS, z: 0},
        pullX: 0,
        pullZ: 0,
        launch,
        crossedPowerTier: false,
      };
    }

    const dt = Math.max(0, Math.min(0.1, input.dt));

    if (!input.tracked) {
      this.trackingLostTimer += dt;
      if (this.trackingLostTimer <= PULL_CONSTANTS.TRACKING_LOSS_HOLD_SEC) {
        return {
          outcome: 'HOLDING',
          ballLocal: {...this.smoothedBallLocal},
          pullX: this.clampedPullX,
          pullZ: this.clampedPullZ,
          launch: this.lastLaunch,
          crossedPowerTier: false,
        };
      }
      const launch = this.lastLaunch;
      this.reset();
      return {
        outcome: 'CANCELLED',
        ballLocal: {x: 0, y: BALL_RADIUS, z: 0},
        pullX: 0,
        pullZ: 0,
        launch,
        crossedPowerTier: false,
      };
    }

    this.trackingLostTimer = 0;
    if (input.selectActive) {
      this.sawSelectActive = true;
    }

    // Gesture abort: pushing the ball strongly forward down-lane or lifting way up cancels cleanly
    const forwardPushZ = input.pointerLocal.z - this.anchorLocal.z;
    const heightAboveTee = input.pointerLocal.y - BALL_RADIUS;
    if ((forwardPushZ < -0.14 && this.clampedPullZ <= 0.015) || heightAboveTee > 0.36) {
      const launch = this.lastLaunch;
      this.reset();
      return {
        outcome: 'CANCELLED',
        ballLocal: {x: 0, y: BALL_RADIUS, z: 0},
        pullX: 0,
        pullZ: 0,
        launch,
        crossedPowerTier: false,
      };
    }

    // Watchdog if a frozen XR runtime fails to dispatch selectend/release
    const pointerMove = Math.hypot(
      input.pointerLocal.x - this.lastPointerLocal.x,
      input.pointerLocal.y - this.lastPointerLocal.y,
      input.pointerLocal.z - this.lastPointerLocal.z
    );
    this.lastPointerLocal = {
      x: input.pointerLocal.x,
      y: input.pointerLocal.y,
      z: input.pointerLocal.z,
    };
    if (pointerMove < 0.002) {
      this.frozenHoldTimer += dt;
      if (this.frozenHoldTimer >= PULL_CONSTANTS.STUCK_HOLD_TIMEOUT_SEC) {
        const launch = this.lastLaunch;
        this.reset();
        return {
          outcome: 'CANCELLED',
          ballLocal: {x: 0, y: BALL_RADIUS, z: 0},
          pullX: 0,
          pullZ: 0,
          launch,
          crossedPowerTier: false,
        };
      }
    } else {
      this.frozenHoldTimer = 0;
    }

    // Evaluate whether the user is still intentionally holding the ball
    let stillHeld = false;
    if (this.sourceKind === 'hand-pinch') {
      if (input.pinchDistM !== null && Number.isFinite(input.pinchDistM)) {
        const d = input.pinchDistM;
        if (d <= PULL_CONSTANTS.PINCH_STILL_CLOSED_OVERRIDE_M) {
          // Fingers visibly pinched together: hold even if WebXR select flickered off near chest
          stillHeld = true;
        } else if (d <= PULL_CONSTANTS.PINCH_RELEASE_GAP_M) {
          // Inside hysteresis band: keep held unless select explicitly ended after being active
          // and fingers are already separating past acquire gap
          stillHeld = !(
            this.sawSelectActive &&
            !input.selectActive &&
            d > PULL_CONSTANTS.PINCH_ACQUIRE_GAP_M
          );
        } else {
          // Fingers opened wide past hysteresis release threshold
          stillHeld = false;
        }
      } else {
        // Emulator / select-only hand fallback
        stillHeld = input.selectActive;
      }
    } else {
      // Controller trigger/grip or desktop mouse pointer button
      stillHeld = input.selectActive;
    }

    if (!stillHeld) {
      this.releaseConfirmTimer += dt;
      const confirmWindow =
        this.sourceKind === 'hand-pinch'
          ? PULL_CONSTANTS.HAND_RELEASE_CONFIRM_SEC
          : 0;

      if (this.releaseConfirmTimer >= confirmWindow) {
        const finalLaunch = computeLaunchParameters(
          this.clampedPullX,
          this.clampedPullZ,
          input.curve
        );
        const releasePos = {
          x: this.clampedPullX,
          y: BALL_RADIUS + 0.004,
          z: this.clampedPullZ,
        };
        const pullX = this.clampedPullX;
        const pullZ = this.clampedPullZ;
        this.reset();
        return {
          outcome: finalLaunch.canLaunch ? 'RELEASE_LAUNCH' : 'CANCELLED',
          ballLocal: releasePos,
          pullX,
          pullZ,
          launch: finalLaunch,
          crossedPowerTier: false,
        };
      }

      // Hold smoothly during the brief release-confirm debounce window
      return {
        outcome: 'HOLDING',
        ballLocal: {...this.smoothedBallLocal},
        pullX: this.clampedPullX,
        pullZ: this.clampedPullZ,
        launch: this.lastLaunch,
        crossedPowerTier: false,
      };
    }

    // Active hold: update attachment & power
    this.releaseConfirmTimer = 0;

    // Quickly decay initial grab center-offset so the ball glides smoothly to the pinch point
    const offsetDecay = Math.exp(-PULL_CONSTANTS.GRAB_OFFSET_DECAY_LAMBDA * dt);
    this.grabOffsetLocal.x *= offsetDecay;
    this.grabOffsetLocal.z *= offsetDecay;

    const rawDeltaX =
      input.pointerLocal.x - this.anchorLocal.x + this.grabOffsetLocal.x;
    const rawDeltaZ =
      (input.pointerLocal.z - this.anchorLocal.z) *
        PULL_CONSTANTS.DESK_DEPTH_PULL_SCALE +
      this.grabOffsetLocal.z;

    this.clampedPullX = clampNumber(
      rawDeltaX,
      -MAX_LATERAL_PULL,
      MAX_LATERAL_PULL
    );
    this.clampedPullZ = clampNumber(rawDeltaZ, 0, MAX_PULL_DISTANCE);

    const launch = computeLaunchParameters(
      this.clampedPullX,
      this.clampedPullZ,
      input.curve
    );
    this.lastLaunch = launch;

    // Slight tactile lift while cradled back along the pull pocket
    const targetY = BALL_RADIUS + Math.min(0.012, this.clampedPullZ * 0.04);
    const followLambda =
      this.sourceKind === 'mouse'
        ? 75
        : PULL_CONSTANTS.HAND_FOLLOW_DAMP_LAMBDA;
    const alpha = dampFactor(followLambda, dt);
    this.smoothedBallLocal.x +=
      (this.clampedPullX - this.smoothedBallLocal.x) * alpha;
    this.smoothedBallLocal.y +=
      (targetY - this.smoothedBallLocal.y) * alpha;
    this.smoothedBallLocal.z +=
      (this.clampedPullZ - this.smoothedBallLocal.z) * alpha;

    const tier =
      launch.power01 >= 0.95
        ? 4
        : launch.power01 >= 0.75
          ? 3
          : launch.power01 >= 0.5
            ? 2
            : launch.power01 >= 0.25
              ? 1
              : 0;
    const crossedPowerTier = tier > this.lastPowerTier;
    this.lastPowerTier = tier;

    return {
      outcome: 'HOLDING',
      ballLocal: {...this.smoothedBallLocal},
      pullX: this.clampedPullX,
      pullZ: this.clampedPullZ,
      launch,
      crossedPowerTier,
    };
  }
}

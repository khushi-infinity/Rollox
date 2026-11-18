import type {GameState, GrabState} from './types';

const VALID_GAME_TRANSITIONS: Record<GameState, GameState[]> = {
  LOADING: ['MAIN_MENU', 'ONBOARDING', 'READY'],
  MAIN_MENU: ['ONBOARDING', 'LEVEL_SELECT', 'READY', 'WORKSHOP'],
  ONBOARDING: ['MAIN_MENU', 'READY', 'AIMING', 'BALL_IN_MOTION'],
  LEVEL_SELECT: ['MAIN_MENU', 'READY', 'WORKSHOP'],
  READY: [
    'MAIN_MENU',
    'LEVEL_SELECT',
    'ONBOARDING',
    'AIMING',
    'BALL_IN_MOTION',
    'PAUSED',
    'WORKSHOP',
    'READY',
  ],
  AIMING: ['READY', 'BALL_IN_MOTION', 'PAUSED', 'MAIN_MENU', 'WORKSHOP'],
  BALL_IN_MOTION: ['SETTLING', 'READY', 'PAUSED', 'MAIN_MENU', 'WORKSHOP'],
  SETTLING: ['READY', 'RESULT', 'PAUSED', 'MAIN_MENU', 'WORKSHOP'],
  RESULT: ['READY', 'MAIN_MENU', 'LEVEL_SELECT', 'WORKSHOP', 'WORKSHOP_TEST'],
  PAUSED: ['READY', 'MAIN_MENU', 'LEVEL_SELECT', 'WORKSHOP', 'WORKSHOP_TEST'],
  WORKSHOP: ['WORKSHOP', 'WORKSHOP_TEST', 'READY', 'MAIN_MENU', 'LEVEL_SELECT', 'PAUSED'],
  WORKSHOP_TEST: [
    'WORKSHOP',
    'AIMING',
    'BALL_IN_MOTION',
    'SETTLING',
    'RESULT',
    'PAUSED',
    'MAIN_MENU',
  ],
};

const VALID_GRAB_TRANSITIONS: Record<GrabState, GrabState[]> = {
  IDLE: ['HOVER', 'GRABBED', 'IDLE'],
  HOVER: ['IDLE', 'GRABBED', 'HOVER'],
  GRABBED: ['AIMING', 'IDLE', 'RELEASED'],
  AIMING: ['AIMING', 'RELEASED', 'IDLE'],
  RELEASED: ['IN_FLIGHT', 'IDLE'],
  IN_FLIGHT: ['SETTLING', 'IDLE'],
  SETTLING: ['RESULT', 'IDLE'],
  RESULT: ['IDLE'],
};

/**
 * Enforces valid transitions for Rollox's 12-state game lifecycle and 8-state
 * pinch-pull-release grab machine, preventing invalid jumps and preserving
 * safe pause/resume across XR session interruptions.
 */
export class RolloxStateMachine {
  private _state: GameState = 'LOADING';
  private _previousBeforePause: GameState = 'READY';
  private _grabState: GrabState = 'IDLE';

  get state(): GameState {
    return this._state;
  }

  get grabState(): GrabState {
    return this._grabState;
  }

  get previousBeforePause(): GameState {
    return this._previousBeforePause;
  }

  canTransitionGame(next: GameState): boolean {
    if (this._state === next) return true;
    return VALID_GAME_TRANSITIONS[this._state].includes(next);
  }

  transitionGame(next: GameState): boolean {
    if (!this.canTransitionGame(next)) {
      return false;
    }
    if (next === 'PAUSED' && this._state !== 'PAUSED') {
      this._previousBeforePause = this._state;
    }
    this._state = next;
    return true;
  }

  pause(): boolean {
    if (this._state === 'PAUSED') return false;
    if (
      this._state === 'READY' ||
      this._state === 'AIMING' ||
      this._state === 'BALL_IN_MOTION' ||
      this._state === 'SETTLING' ||
      this._state === 'WORKSHOP' ||
      this._state === 'WORKSHOP_TEST'
    ) {
      this._previousBeforePause =
        this._state === 'AIMING' ||
        this._state === 'BALL_IN_MOTION' ||
        this._state === 'SETTLING'
          ? 'READY'
          : this._state;
      this._state = 'PAUSED';
      return true;
    }
    return false;
  }

  resume(): boolean {
    if (this._state !== 'PAUSED') return false;
    const target = this._previousBeforePause;
    if (!this.canTransitionGame(target)) return false;
    this._state = target;
    return true;
  }

  canTransitionGrab(next: GrabState): boolean {
    if (this._grabState === next) return true;
    return VALID_GRAB_TRANSITIONS[this._grabState].includes(next);
  }

  transitionGrab(next: GrabState): boolean {
    if (!this.canTransitionGrab(next)) {
      return false;
    }
    this._grabState = next;
    return true;
  }

  resetGrab(): void {
    this._grabState = 'IDLE';
  }
}

import {
  Entity,
  VisibilityState,
  XRPlane,
  createSystem,
} from '@iwsdk/core';
import * as THREE from 'three';

import {
  ArenaRootTag,
  BowlingBall,
  GroundSurfaceTag,
} from '../components';
import {
  type ProceduralAssets,
  createBowlingBallMesh,
  createBowlingPinMesh,
  createDwarfCharacterMesh,
  createGroundPlaneMesh,
  createLaneSegmentMesh,
  createMovingGateMesh,
  createPinDeckBackdrop,
  createProceduralAssets,
  createRotatingBumperMesh,
  createSlidingBarrierMesh,
} from '../geometry';
import {
  ARENA_ORIGIN_Z,
  ARENA_TABLE_Y,
  BALL_RADIUS,
  CAMPAIGN_LEVELS,
  DEFAULT_PROGRESS,
  DEFAULT_SETTINGS,
  addWorkshopObstacle,
  appendWorkshopSegment,
  calculateLevelStars,
  compileWorkshopLevel,
  createDefaultWorkshopLayout,
  evaluateShotScoring,
  generatePinFormation,
  removeWorkshopObstacle,
  removeWorkshopSegment,
  repositionWorkshopObstacle,
  repositionWorkshopSegment,
  rotateWorkshopSegment,
  validateWorkshopLayout,
} from '../levels';
import {RolloxStateMachine} from '../stateMachine';
import type {
  CampaignProgress,
  GameSettings,
  GameState,
  LevelConfig,
  ObstacleKind,
  PinFormation,
  ScoreSummary,
  WorkshopLayout,
  WorkshopModuleKind,
} from '../types';
import {AimingSystem} from './AimingSystem';
import {RolloxPhysicsSystem} from './PhysicsSystem';
import {
  type PanelKey,
  type SpatialUIActionHandler,
  SpatialUISystem,
} from './SpatialUISystem';

const SETTINGS_STORAGE_KEY = 'rollox_iwsdk_settings_v1';
const PROGRESS_STORAGE_KEY = 'rollox_iwsdk_progress_v1';
const WORKSHOP_STORAGE_KEY = 'rollox_iwsdk_workshop_v1';

/**
 * Orchestrates Rollox's complete mixed-reality game lifecycle in IWSDK ECS:
 * - 12-state lifecycle + safe pause/resume across XR session interruptions
 * - Seated MR placement (`XRPlane` horizontal table snap + recenter + comfort adjustments)
 * - Level construction (5 campaign levels + Alley Workshop modular builder)
 * - Guided onboarding micro-tutorial (pinch -> pull -> aim -> release)
 * - Shot resolution, bowling scoring (strike/spare/pins), progression persistence
 */
export class GameFlowSystem
  extends createSystem({
    planes: {required: [XRPlane]},
  })
  implements SpatialUIActionHandler
{
  private sm = new RolloxStateMachine();
  private assets!: ProceduralAssets;

  private settings: GameSettings = {...DEFAULT_SETTINGS};
  private progress: CampaignProgress = {
    ...DEFAULT_PROGRESS,
    completedLevels: [],
    bestScores: {},
    bestStars: {},
  };
  private workshopLayout: WorkshopLayout = createDefaultWorkshopLayout();
  private selectedWorkshopSegIdx = 0;

  private arenaOrigin = new THREE.Vector3(0, ARENA_TABLE_Y, ARENA_ORIGIN_Z);
  private arenaYaw = 0;
  private detectedSurfaceY: number | null = null;
  private hasAutoSnappedPlane = false;

  private arenaGroup = new THREE.Group();
  private arenaRootEntity: Entity | null = null;
  private ballEntity: Entity | null = null;
  private groundEntity: Entity | null = null;
  private groundMesh: THREE.Mesh | null = null;
  private levelDisposables: Array<{dispose: () => void}> = [];

  private currentLevelIndex = 0;
  private currentLevelConfig: LevelConfig = CAMPAIGN_LEVELS[0];
  private shotsLeft = CAMPAIGN_LEVELS[0].maxShots;
  private shotsUsed = 0;
  private pinsKnocked = 0;
  private totalPins = 10;
  private levelScore = 0;
  private totalScore = 0;
  private lastSummary: ScoreSummary | undefined;
  private subScreenReturnState: 'MAIN_MENU' | 'PAUSED' = 'MAIN_MENU';

  private onboardingStep: 'pinch' | 'pull' | 'aim' | 'release' = 'pinch';
  private shotStartTime = 0;
  private ballStillTimer = 0;
  private settlingTimer = 0;
  private _ballPos = new THREE.Vector3();
  private _localBallPos = new THREE.Vector3();
  private _headPos = new THREE.Vector3();
  private _headForward = new THREE.Vector3();
  private _quat = new THREE.Quaternion();
  private _yAxis = new THREE.Vector3(0, 1, 0);

  private levelBuildGen = 0;
  private groundSyncTimer = 0;

  init(): void {
    this.loadPersistence();
    this.assets = createProceduralAssets(
      Math.min(8, this.renderer.capabilities.getMaxAnisotropy())
    );

    this.arenaGroup.name = 'RolloxArenaRoot';
    this.arenaRootEntity = this.world
      .createTransformEntity(this.arenaGroup)
      .addComponent(ArenaRootTag);

    const ballVisual = createBowlingBallMesh(this.assets);
    this.ballEntity = this.world
      .createTransformEntity(ballVisual)
      .addComponent(BowlingBall);

    this.groundMesh = createGroundPlaneMesh(16, 16, 4);
    this.groundEntity = this.world
      .createTransformEntity(this.groundMesh)
      .addComponent(GroundSurfaceTag);

    const physics = this.physicsSystem;
    if (physics) {
      physics.audio.volume = this.settings.volume;
      physics.audio.muted = this.settings.muted;
    }

    this.aimingSystem?.setBallEntity(this.ballEntity);
    this.aimingSystem?.setCallbacks({
      getSettings: () => this.settings,
      isAimingAllowed: () =>
        this.sm.state === 'READY' ||
        this.sm.state === 'AIMING' ||
        this.sm.state === 'ONBOARDING' ||
        this.sm.state === 'WORKSHOP_TEST',
      onGrabStateChanged: (grabState) => {
        const ui = this.uiSystem;
        if (!ui) return;
        if (grabState === 'IDLE' || grabState === 'HOVER') {
          ui.updateHudPower(0, grabState, false);
        }
      },
      onGrabStarted: () => {
        this.physicsSystem?.audio.playGrab();
        if (this.sm.state === 'READY') {
          this.sm.transitionGame('AIMING');
        }
        if (this.sm.state === 'ONBOARDING' && this.onboardingStep === 'pinch') {
          this.onboardingStep = 'pull';
          this.uiSystem?.updateOnboarding('pull');
        }
      },
      onAimUpdated: (launch, pullX) => {
        this.uiSystem?.updateHudPower(
          launch.power01,
          'AIMING',
          launch.canLaunch
        );
        if (this.sm.state === 'ONBOARDING') {
          if (this.onboardingStep === 'pull' && launch.power01 >= 0.22) {
            this.onboardingStep = 'aim';
            this.uiSystem?.updateOnboarding('aim');
          } else if (
            this.onboardingStep === 'aim' &&
            (Math.abs(pullX) >= 0.025 || launch.power01 >= 0.35)
          ) {
            this.onboardingStep = 'release';
            this.uiSystem?.updateOnboarding('release');
          }
        }
      },
      onShotReleased: (worldOrigin, worldVel, worldSpin, launch) => {
        this.launchShot(worldOrigin, worldVel, worldSpin, launch.power01);
      },
      onShotCancelled: () => {
        if (this.sm.state === 'AIMING') {
          this.sm.transitionGame('READY');
        }
        this.uiSystem?.updateHudPower(0, 'IDLE', false);
      },
    });

    this.uiSystem?.setActionHandler(this);
    this.syncAllTransforms();
    this.setupXRListeners();
    this.setupKeyboardShortcuts();

    void this.bootstrapAsync();

    this.cleanupFuncs.push(() => {
      this.clearLevelVisuals();
      this.assets.dispose();
      this.arenaRootEntity?.destroy();
      this.ballEntity?.destroy();
      this.groundEntity?.destroy();
    });
  }

  private get physicsSystem(): RolloxPhysicsSystem | undefined {
    return this.world.getSystem(RolloxPhysicsSystem);
  }

  private get aimingSystem(): AimingSystem | undefined {
    return this.world.getSystem(AimingSystem);
  }

  private get uiSystem(): SpatialUISystem | undefined {
    return this.world.getSystem(SpatialUISystem);
  }

  private async bootstrapAsync(): Promise<void> {
    const physics = this.physicsSystem;
    if (physics) {
      await physics.ensureReady();
      if (this.groundMesh) {
        physics.bowlingWorld.setGroundPlaneCollisionMesh(this.groundMesh);
      }
    }

    await this.loadCampaignLevel(0, false);
    this.sm.transitionGame('MAIN_MENU');
    this.refreshPanelsVisibility();
    this.uiSystem?.updateMainMenu(this.progress);
    this.uiSystem?.updateSettings(this.settings);
    this.uiSystem?.updateLevelSelect(this.progress);
  }

  private loadPersistence(): void {
    if (typeof window === 'undefined' || !window.localStorage) return;
    try {
      const sRaw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
      if (sRaw) {
        this.settings = {...DEFAULT_SETTINGS, ...JSON.parse(sRaw)};
      }
      const pRaw = window.localStorage.getItem(PROGRESS_STORAGE_KEY);
      if (pRaw) {
        this.progress = {...DEFAULT_PROGRESS, ...JSON.parse(pRaw)};
      }
      const wRaw = window.localStorage.getItem(WORKSHOP_STORAGE_KEY);
      if (wRaw) {
        this.workshopLayout = JSON.parse(wRaw) as WorkshopLayout;
      }
    } catch {
      // Ignore malformed storage entries
    }
  }

  private saveSettings(): void {
    if (typeof window === 'undefined' || !window.localStorage) return;
    try {
      window.localStorage.setItem(
        SETTINGS_STORAGE_KEY,
        JSON.stringify(this.settings)
      );
    } catch {
      // Ignore storage quota errors
    }
  }

  private saveProgress(): void {
    if (typeof window === 'undefined' || !window.localStorage) return;
    try {
      window.localStorage.setItem(
        PROGRESS_STORAGE_KEY,
        JSON.stringify(this.progress)
      );
    } catch {
      // Ignore storage quota errors
    }
  }

  private saveWorkshop(): void {
    if (typeof window === 'undefined' || !window.localStorage) return;
    try {
      window.localStorage.setItem(
        WORKSHOP_STORAGE_KEY,
        JSON.stringify(this.workshopLayout)
      );
    } catch {
      // Ignore storage quota errors
    }
  }

  private setupXRListeners(): void {
    this.queries.planes.subscribe('qualify', (entity) => {
      if (this.hasAutoSnappedPlane) return;
      const xrPlane = entity.getValue(XRPlane, '_plane') as XRPlane | undefined;
      if (!xrPlane || xrPlane.orientation !== 'horizontal') return;
      const obj = entity.object3D;
      if (!obj) return;
      obj.getWorldPosition(this._ballPos);
      // Snap only to table/desk height planes in comfortable seated range
      if (this._ballPos.y >= 0.52 && this._ballPos.y <= 1.15) {
        this.detectedSurfaceY = this._ballPos.y;
        this.hasAutoSnappedPlane = true;
        this.arenaOrigin.y = this.detectedSurfaceY + this.settings.heightOffset;
        this.syncAllTransforms();
        void this.rebuildCurrentLevel(true);
        this.uiSystem?.showCallout('TABLE SURFACE DETECTED', '#38bdf8', 1600);
      }
    });

    const unsubVis = this.world.visibilityState.subscribe((vis) => {
      if (vis === VisibilityState.NonImmersive) {
        this.hasAutoSnappedPlane = false;
      }
      if (vis === VisibilityState.Hidden || vis === VisibilityState.VisibleBlurred) {
        if (
          this.sm.state === 'READY' ||
          this.sm.state === 'AIMING' ||
          this.sm.state === 'BALL_IN_MOTION' ||
          this.sm.state === 'SETTLING' ||
          this.sm.state === 'WORKSHOP_TEST'
        ) {
          this.onPause();
        }
      }
    });
    this.cleanupFuncs.push(unsubVis);
  }

  private setupKeyboardShortcuts(): void {
    if (typeof window === 'undefined') return;
    const onKeyDown = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === 'r') {
        this.onRecenterTable();
      } else if (k === 'm') {
        this.onToggleMute();
      } else if (k === 'p' || e.key === 'Escape') {
        if (this.sm.state === 'PAUSED') {
          this.onModalPrimary();
        } else if (
          this.sm.state === 'READY' ||
          this.sm.state === 'AIMING' ||
          this.sm.state === 'WORKSHOP_TEST'
        ) {
          this.onPause();
        } else if (
          this.sm.state === 'LEVEL_SELECT' ||
          this.sm.state === 'WORKSHOP'
        ) {
          this.onBackToMenu();
        }
      } else if (e.code === 'Space') {
        if (this.sm.state === 'READY' || this.sm.state === 'WORKSHOP_TEST') {
          this.onResetBall();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    this.cleanupFuncs.push(() => window.removeEventListener('keydown', onKeyDown));
  }

  private syncAllTransforms(): void {
    this.arenaGroup.position.copy(this.arenaOrigin);
    this.arenaGroup.rotation.set(0, this.arenaYaw, 0);
    this.physicsSystem?.setArenaOrigin(this.arenaOrigin, this.arenaYaw);
    this.aimingSystem?.setArenaTransform(this.arenaOrigin, this.arenaYaw);
    this.uiSystem?.syncLayout(this.arenaOrigin, this.arenaYaw);
  }

  private clearLevelVisuals(): void {
    this.physicsSystem?.clearDwarfRigs();
    while (this.arenaGroup.children.length > 0) {
      this.arenaGroup.remove(this.arenaGroup.children[0]);
    }
    for (const d of this.levelDisposables) {
      d.dispose();
    }
    this.levelDisposables = [];
  }

  private async loadCampaignLevel(
    index: number,
    enterReady = true
  ): Promise<void> {
    const safeIdx = Math.max(0, Math.min(CAMPAIGN_LEVELS.length - 1, index));
    this.currentLevelIndex = safeIdx;
    this.currentLevelConfig = CAMPAIGN_LEVELS[safeIdx];
    this.resetRoundStats(this.currentLevelConfig);
    await this.rebuildCurrentLevel(false);

    if (enterReady) {
      this.sm.transitionGame('READY');
      this.refreshPanelsVisibility();
    }
  }

  private resetRoundStats(config: LevelConfig): void {
    this.shotsLeft = config.maxShots;
    this.shotsUsed = 0;
    this.pinsKnocked = 0;
    this.levelScore = 0;
  }

  private async rebuildCurrentLevel(
    preserveRoundState: boolean,
    highlightSegIndex = -1
  ): Promise<void> {
    const gen = ++this.levelBuildGen;
    const physics = this.physicsSystem;
    if (physics) {
      await physics.ensureReady();
    }
    if (gen !== this.levelBuildGen) return;

    this.clearLevelVisuals();
    this.syncAllTransforms();

    const cfg = this.currentLevelConfig;

    // 1. Visual segments
    cfg.segments.forEach((seg, segIdx) => {
      // segment 0 is launch-pad; highlight matches custom workshop segment index + 1
      const highlighted =
        highlightSegIndex >= 0 && segIdx === highlightSegIndex + 1;
      const segMesh = createLaneSegmentMesh(
        seg,
        this.assets,
        this.levelDisposables,
        highlighted
      );
      this.arenaGroup.add(segMesh);
    });

    // 2. Pin Deck Arch Backdrop
    const arch = createPinDeckBackdrop(
      cfg.pinDeck,
      cfg.accentColor,
      this.assets,
      this.levelDisposables
    );
    this.arenaGroup.add(arch);

    // 3. Pin Meshes (placed in world coords in arenaRoot? No — physics updates world position directly,
    // so parent pin meshes to scene or add into arenaGroup? Wait: BowlingWorld sets pin.mesh.position directly
    // in WORLD coordinates! So pins & obstacles MUST be added as children of a world-origin container OR
    // keep them in this.scene via dynamicGroup! Wait — let's create a dedicated world-space dynamicGroup inside arenaGroup? NO! Inside this.scene!)
    const dynamicWorldGroup = new THREE.Group();
    dynamicWorldGroup.name = 'RolloxDynamicEntities';
    this.arenaGroup.add(dynamicWorldGroup);
    // Transform dynamicWorldGroup back to world space identity OR add pin/obstacle meshes to this.scene
    // Simpler and exact: attach world-synced objects directly to a world group tracked in levelDisposables!
    this.arenaGroup.remove(dynamicWorldGroup);
    this.scene.add(dynamicWorldGroup);
    this.levelDisposables.push({
      dispose: () => {
        dynamicWorldGroup.removeFromParent();
      },
    });

    const placements = generatePinFormation(cfg.pinFormation, cfg.pinDeck);
    this.totalPins = placements.length;
    const pinMeshes: THREE.Object3D[] = [];
    for (let i = 0; i < placements.length; i++) {
      const pinMesh = createBowlingPinMesh(this.assets, i);
      dynamicWorldGroup.add(pinMesh);
      pinMeshes.push(pinMesh);
    }

    // 4. Obstacle Meshes
    const obstacleVisuals = new Map<
      string,
      {root: THREE.Object3D | null; gateBar?: THREE.Object3D | null}
    >();
    for (const obs of cfg.obstacles) {
      if (obs.kind === 'dwarf') {
        const rig = createDwarfCharacterMesh(this.levelDisposables);
        dynamicWorldGroup.add(rig.root);
        physics?.registerDwarfRig(rig);
        obstacleVisuals.set(obs.id, {root: rig.root});
      } else if (obs.kind === 'bumper') {
        const bumper = createRotatingBumperMesh(
          obs.radius ?? 0.12,
          this.assets,
          this.levelDisposables
        );
        dynamicWorldGroup.add(bumper);
        obstacleVisuals.set(obs.id, {root: bumper});
      } else if (obs.kind === 'movingGate') {
        const gateRig = createMovingGateMesh(this.assets, this.levelDisposables);
        dynamicWorldGroup.add(gateRig.root);
        obstacleVisuals.set(obs.id, {
          root: gateRig.root,
          gateBar: gateRig.gateBar,
        });
      } else {
        const barrier = createSlidingBarrierMesh(
          this.assets,
          this.levelDisposables
        );
        dynamicWorldGroup.add(barrier);
        obstacleVisuals.set(obs.id, {root: barrier});
      }
    }

    // 5. Physics setup
    if (physics) {
      physics.setBallDynamicSync(false);
      physics.setSimulationActive(true);
      physics.bowlingWorld.buildLevelPhysics(
        cfg,
        this.ballEntity?.object3D ?? null,
        pinMeshes,
        obstacleVisuals
      );
      if (this.groundMesh) {
        physics.bowlingWorld.setGroundPlaneCollisionMesh(this.groundMesh);
      }
    }

    this.aimingSystem?.forceResetToPedestal();

    if (!preserveRoundState) {
      this.resetRoundStats(cfg);
    }
    this.syncHud();
  }

  private syncHud(): void {
    this.uiSystem?.updateHud({
      levelName: this.currentLevelConfig.name,
      levelHint: this.currentLevelConfig.hint,
      pinsKnocked: this.pinsKnocked,
      totalPins: this.totalPins,
      shotsLeft: this.shotsLeft,
      maxShots: this.currentLevelConfig.maxShots,
      totalScore: this.totalScore,
      muted: this.settings.muted,
    });
  }

  private refreshPanelsVisibility(): void {
    const ui = this.uiSystem;
    if (!ui) return;

    const visible = new Set<PanelKey>();
    switch (this.sm.state) {
      case 'MAIN_MENU':
        visible.add('main-menu');
        break;
      case 'LEVEL_SELECT':
        visible.add('level-select');
        break;
      case 'WORKSHOP':
        visible.add('workshop');
        break;
      case 'ONBOARDING':
        visible.add('hud');
        visible.add('onboarding');
        break;
      case 'READY':
      case 'AIMING':
      case 'BALL_IN_MOTION':
      case 'SETTLING':
      case 'WORKSHOP_TEST':
        visible.add('hud');
        break;
      case 'PAUSED':
      case 'RESULT':
        visible.add('hud');
        visible.add('modal');
        break;
      default:
        break;
    }

    ui.setVisiblePanels(visible);
  }

  private launchShot(
    worldOrigin: THREE.Vector3,
    worldVel: THREE.Vector3,
    worldSpin: THREE.Vector3,
    power01: number
  ): void {
    const physics = this.physicsSystem;
    if (!physics) return;

    physics.audio.playLaunch(power01);
    physics.vfx.emitBurst(worldOrigin, 10, [0x7dd3fc, 0xfde047], 0.85, 0.7);
    physics.bowlingWorld.launchBall(worldOrigin, worldVel, worldSpin);
    physics.setBallDynamicSync(true);
    physics.setSimulationActive(true);

    this.shotsUsed += 1;
    this.shotsLeft = Math.max(0, this.shotsLeft - 1);
    this.shotStartTime = performance.now();
    this.ballStillTimer = 0;

    if (this.sm.state === 'ONBOARDING') {
      this.progress.onboardingCompleted = true;
      this.saveProgress();
      this.uiSystem?.showCallout('NICE SHOT! PRACTICE COMPLETE', '#4ade80', 1800);
    }

    if (this.sm.state !== 'WORKSHOP_TEST') {
      this.sm.transitionGame('BALL_IN_MOTION');
    } else {
      // Keep WORKSHOP_TEST state while sub-tracking grab/flight
      this.aimingSystem?.notifyExternalGrabState('IN_FLIGHT');
    }
    this.syncHud();
    this.uiSystem?.updateHudPower(0, 'IN_FLIGHT', false);
  }

  update(delta: number, _time: number): void {
    const state = this.sm.state;
    const physics = this.physicsSystem;
    if (!physics) return;

    // Periodic ground collider sync if physical height changed subtly
    this.groundSyncTimer += delta;
    if (this.groundSyncTimer > 4 && this.groundMesh) {
      this.groundSyncTimer = 0;
    }

    const currentGrabState = this.aimingSystem?.getGrabState();
    const inTestFlight =
      state === 'WORKSHOP_TEST' && currentGrabState === 'IN_FLIGHT';
    const inTestSettling =
      state === 'WORKSHOP_TEST' && currentGrabState === 'SETTLING';

    if (state === 'BALL_IN_MOTION' || inTestFlight) {
      const elapsedSec = (performance.now() - this.shotStartTime) / 1000;
      const {speed, y} = physics.bowlingWorld.getBallWorldState(this._ballPos);

      this._localBallPos
        .copy(this._ballPos)
        .sub(this.arenaOrigin)
        .applyQuaternion(
          this._quat.setFromAxisAngle(this._yAxis, -this.arenaYaw)
        );

      if (speed < 0.09) {
        this.ballStillTimer += delta;
      } else {
        this.ballStillTimer = 0;
      }

      const fellOffTable = y < this.arenaOrigin.y - 0.36;
      const pastBackstop = this._localBallPos.z < -2.35;
      const stoppedOnLane = elapsedSec > 0.35 && this.ballStillTimer > 0.25;
      const timedOut = elapsedSec > 4.2;

      if (fellOffTable || pastBackstop || stoppedOnLane || timedOut) {
        this.settlingTimer = 0;
        if (state === 'BALL_IN_MOTION') {
          this.sm.transitionGame('SETTLING');
        }
        this.aimingSystem?.notifyExternalGrabState('SETTLING');
        this.uiSystem?.updateHudPower(0, 'SETTLING', false);
      }
      return;
    }

    if (state === 'SETTLING' || inTestSettling) {
      this.settlingTimer += delta;
      const evalRes = physics.bowlingWorld.evaluateFallenPins(
        this.arenaOrigin.y - 0.25
      );
      if (evalRes.newlyFallen > 0) {
        this.pinsKnocked = evalRes.totalFallen;
        this.syncHud();
      }

      if (
        (this.settlingTimer > 0.45 && !evalRes.anyPinMoving) ||
        this.settlingTimer > 1.2
      ) {
        this.finalizeShot(state === 'WORKSHOP_TEST');
      }
    }
  }

  private finalizeShot(isWorkshopTest: boolean): void {
    const physics = this.physicsSystem;
    if (!physics) return;

    const evalRes = physics.bowlingWorld.evaluateFallenPins(
      this.arenaOrigin.y - 0.25
    );
    const totalFallen = evalRes.totalFallen;
    const newlyFallen = Math.max(0, totalFallen - this.pinsKnocked);
    this.pinsKnocked = totalFallen;

    const outcome = evaluateShotScoring({
      newlyFallen,
      totalFallen,
      totalPins: this.totalPins,
      shotsUsed: this.shotsUsed,
    });

    this.levelScore += outcome.shotPoints;
    this.totalScore += outcome.shotPoints;

    this.uiSystem?.showCallout(outcome.callout, outcome.calloutColor, 2200);
    if (outcome.isStrike) {
      physics.audio.playStrikeFanfare();
      physics.vfx.emitBurst(
        this._ballPos.set(
          this.arenaOrigin.x + this.currentLevelConfig.pinDeck.x,
          this.arenaOrigin.y + this.currentLevelConfig.pinDeck.y + 0.14,
          this.arenaOrigin.z + this.currentLevelConfig.pinDeck.z
        ),
        34,
        [0xfde047, 0x4ade80, 0x38bdf8, 0xf472b6],
        1.75,
        1.1
      );
    } else if (outcome.isSpare || outcome.isAllCleared) {
      physics.audio.playSpareChime();
      physics.vfx.emitBurst(
        this._ballPos.set(
          this.arenaOrigin.x + this.currentLevelConfig.pinDeck.x,
          this.arenaOrigin.y + this.currentLevelConfig.pinDeck.y + 0.12,
          this.arenaOrigin.z + this.currentLevelConfig.pinDeck.z
        ),
        24,
        [0x4ade80, 0xfde047, 0x7dd3fc],
        1.45,
        0.95
      );
    }

    physics.bowlingWorld.hideFallenPins();
    physics.bowlingWorld.resetStandingPins();
    physics.bowlingWorld.resetBallToPedestal(
      new THREE.Vector3(0, BALL_RADIUS, 0)
    );
    physics.setBallDynamicSync(false);
    this.aimingSystem?.forceResetToPedestal();

    this.syncHud();

    const roundComplete = outcome.isAllCleared || this.shotsLeft <= 0;
    if (roundComplete) {
      const stars = calculateLevelStars(
        this.pinsKnocked,
        this.totalPins,
        this.shotsUsed,
        this.shotsLeft
      );
      if (!isWorkshopTest) {
        const lid = this.currentLevelConfig.id;
        this.progress.bestScores[lid] = Math.max(
          this.progress.bestScores[lid] ?? 0,
          this.levelScore
        );
        this.progress.bestStars[lid] = Math.max(
          this.progress.bestStars[lid] ?? 0,
          stars
        );
        if (stars > 0) {
          if (!this.progress.completedLevels.includes(this.currentLevelIndex)) {
            this.progress.completedLevels.push(this.currentLevelIndex);
          }
          this.progress.unlockedLevelIndex = Math.max(
            this.progress.unlockedLevelIndex,
            Math.min(CAMPAIGN_LEVELS.length - 1, this.currentLevelIndex + 1)
          );
          physics.audio.playLevelWin();
        }
        this.saveProgress();
        this.uiSystem?.updateLevelSelect(this.progress);
        this.uiSystem?.updateMainMenu(this.progress);
      }

      const summary: ScoreSummary = {
        levelId: this.currentLevelConfig.id,
        levelName: this.currentLevelConfig.name,
        pinsKnocked: this.pinsKnocked,
        totalPins: this.totalPins,
        shotsUsed: this.shotsUsed,
        maxShots: this.currentLevelConfig.maxShots,
        levelScore: this.levelScore,
        totalScore: this.totalScore,
        stars,
        callout: outcome.callout,
        isCustomWorkshop: isWorkshopTest,
      };
      this.lastSummary = summary;
      this.sm.transitionGame('RESULT');
      this.uiSystem?.updateModal(
        isWorkshopTest ? 'WORKSHOP_RESULT' : 'RESULT',
        summary
      );
      this.refreshPanelsVisibility();
    } else {
      if (!isWorkshopTest) {
        this.sm.transitionGame('READY');
      }
      this.refreshPanelsVisibility();
      this.uiSystem?.updateHudPower(0, 'IDLE', false);
    }
  }

  // =========================================================================
  // SpatialUIActionHandler Implementation
  // =========================================================================

  onPlayCampaign(): void {
    this.physicsSystem?.audio.playClick();
    if (!this.progress.onboardingCompleted) {
      this.onReplayOnboarding();
      return;
    }
    const startIdx = Math.min(
      this.progress.unlockedLevelIndex,
      CAMPAIGN_LEVELS.length - 1
    );
    void this.loadCampaignLevel(startIdx, true);
  }

  onQuickPlay(): void {
    this.physicsSystem?.audio.playClick();
    void this.loadCampaignLevel(this.currentLevelIndex, true);
  }

  onOpenLevelSelect(): void {
    this.physicsSystem?.audio.playClick();
    this.uiSystem?.updateLevelSelect(this.progress);
    this.sm.transitionGame('LEVEL_SELECT');
    this.refreshPanelsVisibility();
  }

  onSelectLevel(index: number): void {
    this.physicsSystem?.audio.playClick();
    void this.loadCampaignLevel(index, true);
  }

  onOpenWorkshop(): void {
    this.physicsSystem?.audio.playClick();
    this.currentLevelConfig = compileWorkshopLevel(this.workshopLayout);
    this.selectedWorkshopSegIdx = Math.max(
      0,
      Math.min(this.selectedWorkshopSegIdx, this.workshopLayout.segments.length - 1)
    );
    this.sm.transitionGame('WORKSHOP');
    void this.rebuildCurrentLevel(false, this.selectedWorkshopSegIdx);
    this.syncWorkshopUI();
    this.refreshPanelsVisibility();
  }

  onOpenSettings(): void {
    this.physicsSystem?.audio.playClick();
    this.subScreenReturnState =
      this.sm.state === 'PAUSED' ? 'PAUSED' : 'MAIN_MENU';
    this.uiSystem?.updateSettings(this.settings);
    this.uiSystem?.setVisiblePanels(new Set(['settings']));
  }

  onOpenInstructions(): void {
    this.physicsSystem?.audio.playClick();
    this.subScreenReturnState =
      this.sm.state === 'PAUSED' ? 'PAUSED' : 'MAIN_MENU';
    this.uiSystem?.setVisiblePanels(new Set(['instructions']));
  }

  onCloseSubScreen(): void {
    this.physicsSystem?.audio.playClick();
    if (this.subScreenReturnState === 'PAUSED') {
      this.sm.transitionGame('PAUSED');
    } else {
      this.sm.transitionGame('MAIN_MENU');
    }
    this.refreshPanelsVisibility();
  }

  onBackToMenu(): void {
    this.physicsSystem?.audio.playClick();
    this.sm.transitionGame('MAIN_MENU');
    this.aimingSystem?.forceResetToPedestal();
    this.uiSystem?.updateMainMenu(this.progress);
    this.refreshPanelsVisibility();
  }

  onReplayOnboarding(): void {
    this.physicsSystem?.audio.playClick();
    this.onboardingStep = 'pinch';
    this.uiSystem?.updateOnboarding('pinch');
    void this.loadCampaignLevel(0, false).then(() => {
      this.sm.transitionGame('ONBOARDING');
      this.refreshPanelsVisibility();
    });
  }

  onSkipOnboarding(): void {
    this.physicsSystem?.audio.playClick();
    this.progress.onboardingCompleted = true;
    this.saveProgress();
    this.sm.transitionGame('READY');
    this.refreshPanelsVisibility();
  }

  onResetBall(): void {
    this.physicsSystem?.audio.playClick();
    if (
      this.sm.state === 'BALL_IN_MOTION' ||
      this.sm.state === 'SETTLING' ||
      this.sm.state === 'AIMING' ||
      this.sm.state === 'READY' ||
      this.sm.state === 'WORKSHOP_TEST'
    ) {
      this.physicsSystem?.bowlingWorld.resetBallToPedestal(
        new THREE.Vector3(0, BALL_RADIUS, 0)
      );
      this.physicsSystem?.setBallDynamicSync(false);
      this.aimingSystem?.forceResetToPedestal();
      if (this.sm.state !== 'WORKSHOP_TEST') {
        this.sm.transitionGame('READY');
      }
      this.uiSystem?.updateHudPower(0, 'IDLE', false);
      this.uiSystem?.showCallout('BALL RESET TO TEE', '#7dd3fc', 1100);
    }
  }

  onRecenterTable(): void {
    this.physicsSystem?.audio.playClick();
    const cam = this.camera;
    cam.getWorldPosition(this._headPos);
    cam.getWorldDirection(this._headForward);
    this._headForward.y = 0;
    if (this._headForward.lengthSq() < 0.001) {
      this._headForward.set(0, 0, -1);
    } else {
      this._headForward.normalize();
    }

    const baseDist = 0.48 - this.settings.distanceOffset;
    const targetDist = Math.max(0.28, Math.min(0.85, baseDist));
    this.arenaOrigin.set(
      this._headPos.x + this._headForward.x * targetDist,
      (this.detectedSurfaceY ?? ARENA_TABLE_Y) + this.settings.heightOffset,
      this._headPos.z + this._headForward.z * targetDist
    );
    this.arenaYaw = Math.atan2(-this._headForward.x, -this._headForward.z);
    this.syncAllTransforms();
    void this.rebuildCurrentLevel(true);
    this.uiSystem?.showCallout('TABLE RECENTERED', '#38bdf8', 1300);
  }

  onAdjustHeight(deltaM: number): void {
    this.physicsSystem?.audio.playClick();
    this.settings.heightOffset = THREE.MathUtils.clamp(
      Number((this.settings.heightOffset + deltaM).toFixed(2)),
      -0.35,
      0.35
    );
    this.saveSettings();
    this.arenaOrigin.y =
      (this.detectedSurfaceY ?? ARENA_TABLE_Y) + this.settings.heightOffset;
    this.syncAllTransforms();
    void this.rebuildCurrentLevel(true);
  }

  onAdjustDistance(deltaM: number): void {
    this.physicsSystem?.audio.playClick();
    this.settings.distanceOffset = THREE.MathUtils.clamp(
      Number((this.settings.distanceOffset + deltaM).toFixed(2)),
      -0.3,
      0.22
    );
    this.saveSettings();
    this.onRecenterTable();
  }

  onResetPlacement(): void {
    this.physicsSystem?.audio.playClick();
    this.settings.heightOffset = 0;
    this.settings.distanceOffset = 0;
    this.detectedSurfaceY = null;
    this.hasAutoSnappedPlane = false;
    this.saveSettings();
    this.arenaOrigin.set(0, ARENA_TABLE_Y, ARENA_ORIGIN_Z);
    this.arenaYaw = 0;
    this.syncAllTransforms();
    void this.rebuildCurrentLevel(true);
    this.uiSystem?.showCallout('PLACEMENT RESET', '#38bdf8', 1300);
  }

  onToggleMute(): void {
    const physics = this.physicsSystem;
    if (!physics) return;
    this.settings.muted = physics.audio.toggleMute();
    physics.audio.playClick();
    this.saveSettings();
    this.uiSystem?.updateSettings(this.settings);
    this.syncHud();
  }

  onAdjustVolume(delta: number): void {
    const physics = this.physicsSystem;
    if (!physics) return;
    this.settings.volume = THREE.MathUtils.clamp(
      Number((this.settings.volume + delta).toFixed(2)),
      0,
      1
    );
    physics.audio.volume = this.settings.volume;
    physics.audio.playClick();
    this.saveSettings();
    this.uiSystem?.updateSettings(this.settings);
  }

  onSetPowerCurve(curve: 'linear' | 'smooth' | 'snappy'): void {
    this.physicsSystem?.audio.playClick();
    this.settings.powerCurve = curve;
    this.saveSettings();
    this.uiSystem?.updateSettings(this.settings);
  }

  onToggleTrajectory(): void {
    this.physicsSystem?.audio.playClick();
    this.settings.showTrajectory = !this.settings.showTrajectory;
    this.saveSettings();
    this.uiSystem?.updateSettings(this.settings);
  }

  onPause(): void {
    this.physicsSystem?.audio.playClick();
    if (!this.sm.pause()) return;
    this.physicsSystem?.setSimulationActive(false);
    this.aimingSystem?.forceResetToPedestal();
    const summarySnapshot: ScoreSummary = {
      levelId: this.currentLevelConfig.id,
      levelName: this.currentLevelConfig.name,
      pinsKnocked: this.pinsKnocked,
      totalPins: this.totalPins,
      shotsUsed: this.shotsUsed,
      maxShots: this.currentLevelConfig.maxShots,
      levelScore: this.levelScore,
      totalScore: this.totalScore,
      stars: 0,
      callout: 'PAUSED',
      isCustomWorkshop: this.currentLevelConfig.layout === 'custom',
    };
    this.uiSystem?.updateModal('PAUSE', summarySnapshot);
    this.refreshPanelsVisibility();
  }

  onModalPrimary(): void {
    this.physicsSystem?.audio.playClick();
    if (this.sm.state === 'PAUSED') {
      this.sm.resume();
      this.physicsSystem?.setSimulationActive(true);
      this.refreshPanelsVisibility();
      return;
    }

    if (this.lastSummary?.isCustomWorkshop) {
      this.onOpenWorkshop();
      return;
    }

    const hasNext =
      this.lastSummary &&
      this.lastSummary.stars > 0 &&
      this.currentLevelIndex < CAMPAIGN_LEVELS.length - 1;

    if (hasNext) {
      void this.loadCampaignLevel(this.currentLevelIndex + 1, true);
    } else {
      void this.loadCampaignLevel(this.currentLevelIndex, true);
    }
  }

  onModalSecondary(): void {
    this.physicsSystem?.audio.playClick();
    if (
      this.sm.previousBeforePause === 'WORKSHOP_TEST' ||
      this.lastSummary?.isCustomWorkshop
    ) {
      this.onWorkshopTestAlley();
      return;
    }
    void this.loadCampaignLevel(this.currentLevelIndex, true);
  }

  onModalTertiary(): void {
    if (
      this.sm.state === 'PAUSED' &&
      this.sm.previousBeforePause === 'WORKSHOP_TEST'
    ) {
      this.onOpenWorkshop();
      return;
    }
    this.onBackToMenu();
  }

  // =========================================================================
  // Alley Workshop Editor Actions
  // =========================================================================

  private syncWorkshopUI(): void {
    const validation = validateWorkshopLayout(this.workshopLayout);
    this.uiSystem?.updateWorkshop(
      this.workshopLayout,
      this.selectedWorkshopSegIdx,
      validation
    );
    this.currentLevelConfig = compileWorkshopLevel(this.workshopLayout);
    this.saveWorkshop();
    void this.rebuildCurrentLevel(false, this.selectedWorkshopSegIdx);
  }

  onWorkshopAddSegment(kind: WorkshopModuleKind): void {
    this.physicsSystem?.audio.playClick();
    this.workshopLayout = appendWorkshopSegment(this.workshopLayout, kind);
    this.selectedWorkshopSegIdx = Math.max(
      0,
      this.workshopLayout.segments.length - 1
    );
    this.syncWorkshopUI();
  }

  onWorkshopSelectSegOffset(delta: number): void {
    this.physicsSystem?.audio.playClick();
    const len = this.workshopLayout.segments.length;
    if (len === 0) return;
    this.selectedWorkshopSegIdx =
      (this.selectedWorkshopSegIdx + delta + len) % len;
    this.syncWorkshopUI();
  }

  onWorkshopMoveSeg(dx: number, dz: number): void {
    this.physicsSystem?.audio.playClick();
    const seg = this.workshopLayout.segments[this.selectedWorkshopSegIdx];
    if (!seg) return;
    this.workshopLayout = repositionWorkshopSegment(
      this.workshopLayout,
      seg.id,
      dx,
      dz
    );
    this.syncWorkshopUI();
  }

  onWorkshopRotateSeg(deltaYawRad: number): void {
    this.physicsSystem?.audio.playClick();
    const seg = this.workshopLayout.segments[this.selectedWorkshopSegIdx];
    if (!seg) return;
    this.workshopLayout = rotateWorkshopSegment(
      this.workshopLayout,
      seg.id,
      deltaYawRad
    );
    this.syncWorkshopUI();
  }

  onWorkshopDeleteSeg(): void {
    this.physicsSystem?.audio.playClick();
    const seg = this.workshopLayout.segments[this.selectedWorkshopSegIdx];
    this.workshopLayout = removeWorkshopSegment(this.workshopLayout, seg?.id);
    this.selectedWorkshopSegIdx = Math.max(
      0,
      Math.min(
        this.selectedWorkshopSegIdx,
        this.workshopLayout.segments.length - 1
      )
    );
    this.syncWorkshopUI();
  }

  onWorkshopAddObstacle(kind: ObstacleKind): void {
    this.physicsSystem?.audio.playClick();
    this.workshopLayout = addWorkshopObstacle(
      this.workshopLayout,
      kind,
      this.selectedWorkshopSegIdx
    );
    this.syncWorkshopUI();
  }

  onWorkshopMoveObs(dx: number, dz: number): void {
    this.physicsSystem?.audio.playClick();
    const obs =
      this.workshopLayout.obstacles[this.workshopLayout.obstacles.length - 1];
    if (!obs) return;
    this.workshopLayout = repositionWorkshopObstacle(
      this.workshopLayout,
      obs.id,
      dx,
      dz
    );
    this.syncWorkshopUI();
  }

  onWorkshopDeleteObs(): void {
    this.physicsSystem?.audio.playClick();
    this.workshopLayout = removeWorkshopObstacle(this.workshopLayout);
    this.syncWorkshopUI();
  }

  onWorkshopSetPins(formation: PinFormation): void {
    this.physicsSystem?.audio.playClick();
    this.workshopLayout = {...this.workshopLayout, pinFormation: formation};
    this.syncWorkshopUI();
  }

  onWorkshopToggleRails(): void {
    this.physicsSystem?.audio.playClick();
    this.workshopLayout = {
      ...this.workshopLayout,
      railsEnabled: !this.workshopLayout.railsEnabled,
    };
    this.syncWorkshopUI();
  }

  onWorkshopTestAlley(): void {
    const validation = validateWorkshopLayout(this.workshopLayout);
    if (!validation.valid) {
      this.physicsSystem?.audio.playRailTap();
      this.uiSystem?.updateWorkshop(
        this.workshopLayout,
        this.selectedWorkshopSegIdx,
        validation
      );
      this.uiSystem?.showCallout(
        validation.errors[0] ?? 'INVALID WORKSHOP LAYOUT',
        '#fb7185',
        2200
      );
      return;
    }

    this.physicsSystem?.audio.playClick();
    this.currentLevelConfig = compileWorkshopLevel(this.workshopLayout);
    this.resetRoundStats(this.currentLevelConfig);
    this.sm.transitionGame('WORKSHOP_TEST');
    void this.rebuildCurrentLevel(false, -1);
    this.refreshPanelsVisibility();
    this.uiSystem?.showCallout('BOWL YOUR CUSTOM ALLEY!', '#fbbf24', 1700);
  }

  onWorkshopResetLayout(): void {
    this.physicsSystem?.audio.playClick();
    this.workshopLayout = createDefaultWorkshopLayout();
    this.selectedWorkshopSegIdx = 0;
    this.syncWorkshopUI();
  }
}

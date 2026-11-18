import {
  DepthOccludable,
  Entity,
  OcclusionShadersMode,
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
  cycleWorkshopDifficulty,
  evaluateShotScoring,
  generatePinFormation,
  removeWorkshopObstacle,
  removeWorkshopSegment,
  repositionWorkshopObstacle,
  repositionWorkshopSegment,
  rotateWorkshopSegment,
  stepWorkshopShots,
  syncWorkshopIdSeed,
  validateWorkshopLayout,
} from '../levels';
import {
  UI_SCALE_DEFAULT,
  UI_SCALE_STEP,
  clampUiScale,
  stepUiScale,
} from '../pullInteraction';
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

  private arenaBasePos = new THREE.Vector3(0, ARENA_TABLE_Y, ARENA_ORIGIN_Z);
  private arenaOrigin = new THREE.Vector3(0, ARENA_TABLE_Y, ARENA_ORIGIN_Z);
  private arenaYaw = 0;
  private detectedSurfaceY: number | null = null;
  private hasAutoSnappedPlane = false;
  private hasUserPlaced = false;
  private hasPlayedAnyShotThisSession = false;
  private lastPlaneScore = Number.POSITIVE_INFINITY;
  private isDepthOcclusionActive = false;

  private worldRootGroup = new THREE.Group();
  private worldRootEntity: Entity | null = null;
  private tableRootGroup = new THREE.Group();
  private tableRootEntity: Entity | null = null;
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
  private pinsKnockedBeforeShot = 0;
  private totalPins = 10;
  private levelScore = 0;
  private totalScore = 0;
  private lastSummary: ScoreSummary | undefined;
  private subScreenReturnState: 'MAIN_MENU' | 'PAUSED' = 'MAIN_MENU';
  private isSubScreenOpen = false;
  private workshopTestPhase: 'READY' | 'AIMING' | 'BALL_IN_MOTION' | 'SETTLING' = 'READY';

  private onboardingStep: 'pinch' | 'pull' | 'aim' | 'release' = 'pinch';
  private shotSimElapsed = 0;
  private ballStillTimer = 0;
  private ballReachedPinDeck = false;
  private sincePinDeckElapsed = 0;
  private settlingTimer = 0;
  private _ballPos = new THREE.Vector3();
  private _localBallPos = new THREE.Vector3();
  private _headPos = new THREE.Vector3();
  private _headForward = new THREE.Vector3();
  private _quat = new THREE.Quaternion();
  private _yAxis = new THREE.Vector3(0, 1, 0);

  private levelBuildGen = 0;
  private groundMeshRegistered = false;
  private roundResolved = false;
  private isLevelLoading = false;

  init(): void {
    this.loadPersistence();
    this.assets = createProceduralAssets(
      Math.min(8, this.renderer.capabilities.getMaxAnisotropy())
    );

    // Single persistent world-space anchor shared by table, lane, pins, obstacles,
    // aiming guides, ball, and all spatial UI panels. Never parented to camera.
    this.worldRootGroup.name = 'RolloxWorldRoot';
    this.worldRootEntity = this.world
      .createTransformEntity(this.worldRootGroup, {
        parent: this.world.sceneEntity,
        persistent: true,
      })
      .addComponent(ArenaRootTag);

    this.tableRootGroup.name = 'RolloxTableRoot';
    this.tableRootEntity = this.world.createTransformEntity(this.tableRootGroup, {
      parent: this.worldRootEntity,
      persistent: true,
    });

    this.arenaGroup.name = 'RolloxArenaRoot';
    this.arenaRootEntity = this.world.createTransformEntity(this.arenaGroup, {
      parent: this.tableRootEntity,
      persistent: true,
    });

    const ballVisual = createBowlingBallMesh(this.assets);
    this.ballEntity = this.world
      .createTransformEntity(ballVisual, {
        parent: this.tableRootEntity,
        persistent: true,
      })
      .addComponent(BowlingBall);

    this.groundMesh = createGroundPlaneMesh(16, 16, 4);
    this.groundEntity = this.world
      .createTransformEntity(this.groundMesh, {
        parent: this.world.sceneEntity,
        persistent: true,
      })
      .addComponent(GroundSurfaceTag);

    const physics = this.physicsSystem;
    if (physics) {
      physics.audio.volume = this.settings.volume;
      physics.audio.muted = this.settings.muted;
    }

    this.aimingSystem?.setArenaHierarchy(this.tableRootEntity, this.tableRootGroup);
    this.aimingSystem?.setBallEntity(this.ballEntity);
    this.aimingSystem?.setCallbacks({
      getSettings: () => this.settings,
      isAimingAllowed: () =>
        this.sm.state === 'READY' ||
        this.sm.state === 'AIMING' ||
        this.sm.state === 'ONBOARDING' ||
        (this.sm.state === 'WORKSHOP_TEST' &&
          (this.workshopTestPhase === 'READY' ||
            this.workshopTestPhase === 'AIMING')),
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
        } else if (this.sm.state === 'WORKSHOP_TEST') {
          this.workshopTestPhase = 'AIMING';
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
        } else if (this.sm.state === 'WORKSHOP_TEST') {
          this.workshopTestPhase = 'READY';
        }
        this.uiSystem?.updateHudPower(0, 'IDLE', false);
      },
    });

    this.uiSystem?.setActionHandler(this);
    if (this.worldRootEntity) {
      this.uiSystem?.attachPanelsToWorldRoot(this.worldRootEntity);
    }
    this.uiSystem?.setUiScale(this.settings.uiScale);
    this.syncAllTransforms();
    this.setupXRListeners();
    this.setupKeyboardShortcuts();

    void this.bootstrapAsync();

    this.cleanupFuncs.push(() => {
      this.clearLevelVisuals();
      this.assets.dispose();
      this.ballEntity?.destroy();
      this.arenaRootEntity?.destroy();
      this.tableRootEntity?.destroy();
      this.worldRootEntity?.destroy();
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
      if (this.groundMesh && !this.groundMeshRegistered) {
        physics.bowlingWorld.setGroundPlaneCollisionMesh(this.groundMesh);
        this.groundMeshRegistered = true;
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
        const parsed = JSON.parse(sRaw) as Partial<GameSettings>;
        this.settings = {
          ...DEFAULT_SETTINGS,
          ...parsed,
          uiScale: clampUiScale(parsed.uiScale ?? UI_SCALE_DEFAULT),
        };
      }
      const pRaw = window.localStorage.getItem(PROGRESS_STORAGE_KEY);
      if (pRaw) {
        const pParsed = JSON.parse(pRaw) as Partial<CampaignProgress>;
        this.progress = {
          ...DEFAULT_PROGRESS,
          ...pParsed,
          completedLevels: Array.isArray(pParsed.completedLevels)
            ? pParsed.completedLevels
            : [],
          bestScores: pParsed.bestScores ?? {},
          bestStars: pParsed.bestStars ?? {},
        };
      }
      const wRaw = window.localStorage.getItem(WORKSHOP_STORAGE_KEY);
      if (wRaw) {
        const wParsed = JSON.parse(wRaw) as Partial<WorkshopLayout>;
        if (wParsed && Array.isArray(wParsed.segments) && wParsed.segments.length > 0) {
          this.workshopLayout = {
            ...createDefaultWorkshopLayout(),
            ...wParsed,
            segments: wParsed.segments,
            obstacles: Array.isArray(wParsed.obstacles) ? wParsed.obstacles : [],
          };
          syncWorkshopIdSeed(this.workshopLayout);
        }
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

  private hasDepthSensingFeature(session: XRSession | undefined): boolean {
    if (!session) return false;
    const feats = (session as XRSession & {enabledFeatures?: Iterable<string>})
      .enabledFeatures;
    if (!feats) return false;
    for (const f of feats) {
      if (f === 'depth-sensing') return true;
    }
    return false;
  }

  private syncDepthOccludables(): void {
    const targets = [this.arenaRootEntity, this.ballEntity];
    for (const ent of targets) {
      if (!ent) continue;
      if (this.isDepthOcclusionActive) {
        if (!ent.hasComponent(DepthOccludable)) {
          ent.addComponent(DepthOccludable, {
            mode: OcclusionShadersMode.MinMaxSoftOcclusion,
          });
        }
      } else if (ent.hasComponent(DepthOccludable)) {
        ent.removeComponent(DepthOccludable);
      }
    }
    if (!this.isDepthOcclusionActive) {
      this.assets?.restoreOpaqueMaterials();
    }
  }

  private setupXRListeners(): void {
    const onSessionStart = () => {
      this.isDepthOcclusionActive = this.hasDepthSensingFeature(
        this.world.xrSession
      );
      this.syncDepthOccludables();
    };
    const onSessionEnd = () => {
      this.isDepthOcclusionActive = false;
      this.syncDepthOccludables();
    };
    this.renderer.xr.addEventListener('sessionstart', onSessionStart);
    this.renderer.xr.addEventListener('sessionend', onSessionEnd);
    this.cleanupFuncs.push(() => {
      this.renderer.xr.removeEventListener('sessionstart', onSessionStart);
      this.renderer.xr.removeEventListener('sessionend', onSessionEnd);
    });

    this.queries.planes.subscribe('qualify', (entity) => {
      // Strictly ONE-TIME initial surface placement: never move arena or UI once locked,
      // manually placed, or after any shot has been played in this session.
      if (
        this.hasAutoSnappedPlane ||
        this.hasUserPlaced ||
        this.hasPlayedAnyShotThisSession
      ) {
        return;
      }
      if (
        this.sm.state === 'BALL_IN_MOTION' ||
        this.sm.state === 'SETTLING' ||
        this.sm.state === 'AIMING' ||
        this.sm.state === 'RESULT'
      ) {
        return;
      }

      const xrPlane = entity.getValue(XRPlane, '_plane') as XRPlane | undefined;
      if (!xrPlane || xrPlane.orientation !== 'horizontal') return;
      const obj = entity.object3D;
      if (!obj) return;
      obj.getWorldPosition(this._ballPos);

      // Evaluate planes within comfortable seated table height [0.54m .. 1.12m]
      if (this._ballPos.y < 0.54 || this._ballPos.y > 1.12) return;

      this.camera.getWorldPosition(this._headPos);
      this.camera.getWorldDirection(this._headForward);
      this._headForward.y = 0;
      if (this._headForward.lengthSq() < 0.001) {
        this._headForward.set(0, 0, -1);
      } else {
        this._headForward.normalize();
      }
      const focusX = this._headPos.x + this._headForward.x * 0.65;
      const focusZ = this._headPos.z + this._headForward.z * 0.65;
      const xzDist = Math.hypot(this._ballPos.x - focusX, this._ballPos.z - focusZ);
      const heightPenalty = Math.abs(this._ballPos.y - 0.85) * 0.6;
      const score = xzDist + heightPenalty;

      this.lastPlaneScore = score;
      this.detectedSurfaceY = this._ballPos.y;
      this.hasAutoSnappedPlane = true;
      this.arenaBasePos.y = this.detectedSurfaceY;
      this.syncAllTransforms();
      void this.rebuildCurrentLevel(true);
      this.physicsSystem?.vfx.emitBurst(
        this.arenaOrigin,
        12,
        [0x38bdf8, 0x4ade80],
        0.75,
        0.7
      );
      this.uiSystem?.showCallout('TABLE SURFACE LOCKED', '#38bdf8', 1600);
    });

    const unsubVis = this.world.visibilityState.subscribe((vis) => {
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
      } else if (k === '[') {
        this.onAdjustUiScale(-UI_SCALE_STEP);
      } else if (k === ']') {
        this.onAdjustUiScale(UI_SCALE_STEP);
      } else if (k === 'p' || e.key === 'Escape') {
        if (this.isSubScreenOpen) {
          this.onCloseSubScreen();
        } else if (this.sm.state === 'PAUSED') {
          this.onModalResume();
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
        if (
          this.sm.state === 'READY' ||
          (this.sm.state === 'WORKSHOP_TEST' &&
            this.workshopTestPhase === 'READY')
        ) {
          this.onResetBall();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    this.cleanupFuncs.push(() => window.removeEventListener('keydown', onKeyDown));
  }

  private syncAllTransforms(): void {
    this.worldRootGroup.position.copy(this.arenaBasePos);
    this.worldRootGroup.rotation.set(0, this.arenaYaw, 0);
    this.tableRootGroup.position.set(0, this.settings.heightOffset, 0);
    this.arenaGroup.position.set(0, 0, 0);
    this.arenaGroup.rotation.set(0, 0, 0);

    this.arenaOrigin.set(
      this.arenaBasePos.x,
      this.arenaBasePos.y + this.settings.heightOffset,
      this.arenaBasePos.z
    );
    this.physicsSystem?.setArenaOrigin(this.arenaOrigin, this.arenaYaw);
    this.aimingSystem?.setArenaTransform(this.arenaOrigin, this.arenaYaw);
    this.uiSystem?.syncLayout();
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
    if (this.isLevelLoading) return;
    this.isLevelLoading = true;
    try {
      const safeIdx = Math.max(0, Math.min(CAMPAIGN_LEVELS.length - 1, index));
      this.currentLevelIndex = safeIdx;
      this.currentLevelConfig = CAMPAIGN_LEVELS[safeIdx];
      this.resetRoundStats(this.currentLevelConfig);
      await this.rebuildCurrentLevel(false);

      if (enterReady) {
        this.sm.transitionGame('READY');
        this.refreshPanelsVisibility();
        this.uiSystem?.updateHudPower(0, 'IDLE', false);
      }
    } finally {
      this.isLevelLoading = false;
    }
  }

  private resetRoundStats(config: LevelConfig): void {
    this.shotsLeft = config.maxShots;
    this.shotsUsed = 0;
    this.pinsKnocked = 0;
    this.pinsKnockedBeforeShot = 0;
    this.levelScore = 0;
    this.roundResolved = false;
    this.ballStillTimer = 0;
    this.settlingTimer = 0;
  }

  private async rebuildCurrentLevel(
    preserveRoundState: boolean,
    highlightSegIndex = -1
  ): Promise<void> {
    const physics = this.physicsSystem;
    const preservedFallenIndices = preserveRoundState && physics
      ? physics.bowlingWorld.pins.filter((p) => p.fallen).map((p) => p.index)
      : [];

    const gen = ++this.levelBuildGen;
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
      this.levelDisposables,
      cfg.pinDeckYaw ?? 0
    );
    this.arenaGroup.add(arch);

    // 3. Pin & Obstacle Meshes (parented to tableRootGroup inside RolloxWorldRoot)
    const dynamicWorldGroup = new THREE.Group();
    dynamicWorldGroup.name = 'RolloxDynamicEntities';
    this.tableRootGroup.add(dynamicWorldGroup);
    this.levelDisposables.push({
      dispose: () => {
        dynamicWorldGroup.removeFromParent();
      },
    });

    const placements = generatePinFormation(
      cfg.pinFormation,
      cfg.pinDeck,
      cfg.pinDeckYaw ?? 0
    );
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
      physics.setSimulationActive(this.isPhysicsSimulationStateActive());
      physics.bowlingWorld.buildLevelPhysics(
        cfg,
        this.ballEntity?.object3D ?? null,
        pinMeshes,
        obstacleVisuals
      );
      if (!this.groundMeshRegistered && this.groundMesh) {
        physics.bowlingWorld.setGroundPlaneCollisionMesh(this.groundMesh);
        this.groundMeshRegistered = true;
      }
    }

    if (physics && preservedFallenIndices.length > 0) {
      const fallenSet = new Set(preservedFallenIndices);
      for (const pin of physics.bowlingWorld.pins) {
        if (fallenSet.has(pin.index)) {
          pin.fallen = true;
        }
      }
      physics.bowlingWorld.hideFallenPins();
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
      totalScore: this.levelScore,
      muted: this.settings.muted,
    });
  }

  private isPhysicsSimulationStateActive(): boolean {
    const s = this.sm.state;
    return (
      s === 'ONBOARDING' ||
      s === 'READY' ||
      s === 'AIMING' ||
      s === 'BALL_IN_MOTION' ||
      s === 'SETTLING' ||
      s === 'WORKSHOP' ||
      s === 'WORKSHOP_TEST'
    );
  }

  private refreshPanelsVisibility(): void {
    const ui = this.uiSystem;
    if (ui) {
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
          visible.add('modal');
          break;
        default:
          break;
      }

      ui.setVisiblePanels(visible);
    }

    this.physicsSystem?.setSimulationActive(this.isPhysicsSimulationStateActive());
  }

  private launchShot(
    worldOrigin: THREE.Vector3,
    worldVel: THREE.Vector3,
    worldSpin: THREE.Vector3,
    power01: number
  ): void {
    if (this.roundResolved || this.isLevelLoading) return;
    if (this.shotsLeft <= 0) return;

    const physics = this.physicsSystem;
    if (!physics) return;

    const wasOnboarding = this.sm.state === 'ONBOARDING';
    const isWorkshop = this.sm.state === 'WORKSHOP_TEST';
    if (isWorkshop) {
      if (
        this.workshopTestPhase !== 'READY' &&
        this.workshopTestPhase !== 'AIMING'
      ) {
        return;
      }
      this.workshopTestPhase = 'BALL_IN_MOTION';
    } else if (!this.sm.transitionGame('BALL_IN_MOTION')) {
      return;
    }

    physics.audio.playLaunch(power01);
    physics.vfx.emitBurst(worldOrigin, 10, [0x7dd3fc, 0xfde047], 0.85, 0.7);
    physics.bowlingWorld.launchBall(worldOrigin, worldVel, worldSpin);
    physics.setBallDynamicSync(true);
    physics.setSimulationActive(true);

    this.pinsKnockedBeforeShot = this.pinsKnocked;
    this.hasPlayedAnyShotThisSession = true;
    this.shotsUsed += 1;
    this.shotsLeft = Math.max(0, this.shotsLeft - 1);
    this.shotSimElapsed = 0;
    this.ballStillTimer = 0;
    this.ballReachedPinDeck = false;
    this.sincePinDeckElapsed = 0;

    if (wasOnboarding) {
      this.progress.onboardingCompleted = true;
      this.saveProgress();
      this.uiSystem?.showCallout('NICE SHOT! PRACTICE COMPLETE', '#4ade80', 1800);
    }

    if (isWorkshop) {
      this.aimingSystem?.notifyExternalGrabState('IN_FLIGHT');
    }
    this.syncHud();
    this.uiSystem?.updateHudPower(0, 'IN_FLIGHT', false);
  }

  update(delta: number, _time: number): void {
    const state = this.sm.state;
    const physics = this.physicsSystem;
    if (!physics || this.roundResolved || this.isLevelLoading) return;

    const inTestFlight =
      state === 'WORKSHOP_TEST' && this.workshopTestPhase === 'BALL_IN_MOTION';
    const inTestSettling =
      state === 'WORKSHOP_TEST' && this.workshopTestPhase === 'SETTLING';

    if (state === 'BALL_IN_MOTION' || inTestFlight) {
      const simDt = Math.min(0.05, Math.max(0.0001, delta));
      this.shotSimElapsed += simDt;
      const elapsedSec = this.shotSimElapsed;
      const {speed, y} = physics.bowlingWorld.getBallWorldState(this._ballPos);

      this._localBallPos
        .copy(this._ballPos)
        .sub(this.arenaOrigin)
        .applyQuaternion(
          this._quat.setFromAxisAngle(this._yAxis, -this.arenaYaw)
        );

      const deck = this.currentLevelConfig.pinDeck;
      const distToDeck = Math.hypot(
        this._localBallPos.x - deck.x,
        this._localBallPos.z - deck.z
      );
      if (distToDeck <= 0.34) {
        this.ballReachedPinDeck = true;
      }
      if (this.ballReachedPinDeck) {
        this.sincePinDeckElapsed += simDt;
      }

      if (speed < 0.14) {
        this.ballStillTimer += simDt;
      } else {
        this.ballStillTimer = 0;
      }

      const fellOffTable = y < this.arenaOrigin.y - 0.36;
      const pastBackstop = this._localBallPos.z < -2.35;
      const stoppedOnLane = elapsedSec > 0.35 && this.ballStillTimer > 0.25;
      const finishedPinDeckPass =
        this.ballReachedPinDeck && this.sincePinDeckElapsed > 1.05;
      const timedOut = elapsedSec > 3.6;

      if (
        fellOffTable ||
        pastBackstop ||
        stoppedOnLane ||
        finishedPinDeckPass ||
        timedOut
      ) {
        this.settlingTimer = 0;
        if (state === 'BALL_IN_MOTION') {
          this.sm.transitionGame('SETTLING');
        } else {
          this.workshopTestPhase = 'SETTLING';
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
    if (this.roundResolved) return;
    const physics = this.physicsSystem;
    if (!physics) return;

    const evalRes = physics.bowlingWorld.evaluateFallenPins(
      this.arenaOrigin.y - 0.25
    );
    const totalFallen = evalRes.totalFallen;
    const newlyFallen = Math.max(0, totalFallen - this.pinsKnockedBeforeShot);
    this.pinsKnocked = totalFallen;
    this.pinsKnockedBeforeShot = totalFallen;

    const outcome = evaluateShotScoring({
      newlyFallen,
      totalFallen,
      totalPins: this.totalPins,
      shotsUsed: this.shotsUsed,
    });

    this.levelScore += outcome.shotPoints;
    this.totalScore += outcome.shotPoints;

    this.uiSystem?.showCallout(outcome.callout, outcome.calloutColor, 2200);
    const deckBurstPos = this._ballPos
      .set(
        this.currentLevelConfig.pinDeck.x,
        this.currentLevelConfig.pinDeck.y + 0.13,
        this.currentLevelConfig.pinDeck.z
      )
      .applyQuaternion(this._quat.setFromAxisAngle(this._yAxis, this.arenaYaw))
      .add(this.arenaOrigin);

    if (outcome.isStrike) {
      physics.audio.playStrikeFanfare();
      physics.vfx.emitBurst(
        deckBurstPos,
        34,
        [0xfde047, 0x4ade80, 0x38bdf8, 0xf472b6],
        1.75,
        1.1
      );
    } else if (outcome.isSpare || outcome.isAllCleared) {
      physics.audio.playSpareChime();
      physics.vfx.emitBurst(
        deckBurstPos,
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
      this.roundResolved = true;
      physics.setSimulationActive(false);

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

      const bestScore = isWorkshopTest
        ? this.levelScore
        : this.progress.bestScores[this.currentLevelConfig.id] ?? this.levelScore;
      const summary: ScoreSummary = {
        levelId: this.currentLevelConfig.id,
        levelName: this.currentLevelConfig.name,
        pinsKnocked: this.pinsKnocked,
        totalPins: this.totalPins,
        shotsUsed: this.shotsUsed,
        maxShots: this.currentLevelConfig.maxShots,
        levelScore: this.levelScore,
        bestScore,
        totalScore: this.totalScore,
        stars,
        callout: outcome.callout,
        isCustomWorkshop: isWorkshopTest,
      };
      this.lastSummary = summary;
      this.sm.transitionGame('RESULT');
      this.uiSystem?.updateModal(
        isWorkshopTest ? 'WORKSHOP_RESULT' : 'RESULT',
        summary,
        this.currentLevelIndex,
        this.progress.unlockedLevelIndex
      );
      this.refreshPanelsVisibility();
    } else {
      if (!isWorkshopTest) {
        this.sm.transitionGame('READY');
      } else {
        this.workshopTestPhase = 'READY';
      }
      this.refreshPanelsVisibility();
      this.uiSystem?.updateHudPower(0, 'IDLE', false);
    }
  }

  // =========================================================================
  // SpatialUIActionHandler Implementation
  // =========================================================================

  onPlayCampaign(): void {
    this.onOpenLevelSelect();
  }

  onOpenLevelSelect(): void {
    this.physicsSystem?.audio.playClick();
    this.isSubScreenOpen = false;
    this.subScreenReturnState = 'MAIN_MENU';
    this.uiSystem?.updateLevelSelect(this.progress);
    this.sm.transitionGame('LEVEL_SELECT');
    this.refreshPanelsVisibility();
  }

  onSelectLevel(index: number): void {
    const safeIdx = Math.max(0, Math.min(CAMPAIGN_LEVELS.length - 1, index));
    const unlocked =
      safeIdx <= this.progress.unlockedLevelIndex ||
      this.progress.completedLevels.includes(safeIdx);
    if (!unlocked) {
      this.physicsSystem?.audio.playRailTap();
      this.uiSystem?.showCallout(
        'COMPLETE PREVIOUS LEVEL TO UNLOCK',
        '#fbbf24',
        1800
      );
      return;
    }
    this.physicsSystem?.audio.playClick();
    void this.loadCampaignLevel(safeIdx, true);
  }

  onOpenWorkshop(): void {
    this.physicsSystem?.audio.playClick();
    this.isSubScreenOpen = false;
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
    this.isSubScreenOpen = true;
    this.uiSystem?.updateSettings(this.settings);
    this.uiSystem?.setVisiblePanels(new Set(['settings']));
  }

  onCloseSubScreen(): void {
    this.physicsSystem?.audio.playClick();
    this.isSubScreenOpen = false;
    if (this.subScreenReturnState === 'PAUSED') {
      this.sm.transitionGame('PAUSED');
    } else {
      this.sm.transitionGame('MAIN_MENU');
    }
    this.refreshPanelsVisibility();
  }

  onBackToMenu(): void {
    this.physicsSystem?.audio.playClick();
    this.isSubScreenOpen = false;
    this.sm.transitionGame('MAIN_MENU');
    this.aimingSystem?.forceResetToPedestal();
    this.uiSystem?.updateMainMenu(this.progress);
    this.refreshPanelsVisibility();
  }

  onReplayOnboarding(): void {
    this.physicsSystem?.audio.playClick();
    this.isSubScreenOpen = false;
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
      } else {
        this.workshopTestPhase = 'READY';
      }
      this.uiSystem?.updateHudPower(0, 'IDLE', false);
      this.uiSystem?.showCallout('BALL RESET TO TEE', '#7dd3fc', 1100);
    }
  }

  onRecenterTable(): void {
    this.physicsSystem?.audio.playClick();
    this.hasUserPlaced = true;
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
    this.arenaBasePos.set(
      this._headPos.x + this._headForward.x * targetDist,
      this.detectedSurfaceY ?? ARENA_TABLE_Y,
      this._headPos.z + this._headForward.z * targetDist
    );
    this.arenaYaw = Math.atan2(-this._headForward.x, -this._headForward.z);
    this.syncAllTransforms();
    void this.rebuildCurrentLevel(true);
    this.uiSystem?.showCallout('TABLE RECENTERED', '#38bdf8', 1300);
  }

  onAdjustHeight(deltaM: number): void {
    this.physicsSystem?.audio.playClick();
    this.hasUserPlaced = true;
    this.settings.heightOffset = THREE.MathUtils.clamp(
      Number((this.settings.heightOffset + deltaM).toFixed(2)),
      -0.35,
      0.35
    );
    this.saveSettings();
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
    this.hasUserPlaced = false;
    this.lastPlaneScore = Number.POSITIVE_INFINITY;
    this.saveSettings();
    this.arenaBasePos.set(0, ARENA_TABLE_Y, ARENA_ORIGIN_Z);
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

  onAdjustUiScale(delta: number): void {
    this.physicsSystem?.audio.playClick();
    this.settings.uiScale = stepUiScale(this.settings.uiScale, delta);
    this.saveSettings();
    this.uiSystem?.setUiScale(this.settings.uiScale);
    this.uiSystem?.syncLayout();
    this.uiSystem?.updateSettings(this.settings);
  }

  onResetUiScale(): void {
    this.physicsSystem?.audio.playClick();
    this.settings.uiScale = UI_SCALE_DEFAULT;
    this.saveSettings();
    this.uiSystem?.setUiScale(this.settings.uiScale);
    this.uiSystem?.syncLayout();
    this.uiSystem?.updateSettings(this.settings);
    this.uiSystem?.showCallout('MENU SIZE RESET', '#38bdf8', 1100);
  }

  onPause(): void {
    if (this.roundResolved || this.isLevelLoading) return;
    if (!this.sm.pause()) return;
    this.physicsSystem?.audio.playClick();
    this.physicsSystem?.setSimulationActive(false);
    this.physicsSystem?.setBallDynamicSync(false);
    this.physicsSystem?.bowlingWorld.resetBallToPedestal(
      new THREE.Vector3(0, BALL_RADIUS, 0)
    );
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
    this.uiSystem?.updateModal(
      'PAUSE',
      summarySnapshot,
      this.currentLevelIndex,
      this.progress.unlockedLevelIndex
    );
    this.refreshPanelsVisibility();
  }

  onModalResume(): void {
    if (this.sm.state !== 'PAUSED') return;
    this.physicsSystem?.audio.playClick();
    if (!this.sm.resume()) return;
    this.refreshPanelsVisibility();
  }

  onModalNextLevel(): void {
    if (this.sm.state !== 'RESULT' || this.isLevelLoading) return;
    if (this.lastSummary?.isCustomWorkshop) return;
    if (this.currentLevelIndex >= CAMPAIGN_LEVELS.length - 1) return;
    const nextIdx = this.currentLevelIndex + 1;
    const nextUnlocked =
      nextIdx <= this.progress.unlockedLevelIndex ||
      this.progress.completedLevels.includes(nextIdx);
    if (!nextUnlocked) return;
    this.physicsSystem?.audio.playClick();
    void this.loadCampaignLevel(nextIdx, true);
  }

  onModalPlayAgain(): void {
    if (this.isLevelLoading) return;
    if (this.sm.state !== 'RESULT' && this.sm.state !== 'PAUSED') return;
    this.physicsSystem?.audio.playClick();
    const isCustom =
      this.sm.state === 'PAUSED'
        ? this.sm.previousBeforePause === 'WORKSHOP_TEST'
        : Boolean(this.lastSummary?.isCustomWorkshop);
    if (isCustom) {
      this.onWorkshopTestAlley();
    } else {
      void this.loadCampaignLevel(this.currentLevelIndex, true);
    }
  }

  onModalLevelSelect(): void {
    if (this.isLevelLoading) return;
    if (this.sm.state !== 'RESULT' && this.sm.state !== 'PAUSED') return;
    this.roundResolved = false;
    this.physicsSystem?.setBallDynamicSync(false);
    this.aimingSystem?.forceResetToPedestal();
    this.onOpenLevelSelect();
  }

  onModalEditSetup(): void {
    if (this.isLevelLoading) return;
    if (this.sm.state !== 'RESULT' && this.sm.state !== 'PAUSED') return;
    this.onOpenWorkshop();
  }

  onModalMainMenu(): void {
    if (this.isLevelLoading) return;
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

  onWorkshopStepShots(delta: number): void {
    this.physicsSystem?.audio.playClick();
    this.workshopLayout = stepWorkshopShots(this.workshopLayout, delta);
    this.syncWorkshopUI();
  }

  onWorkshopCycleDifficulty(): void {
    this.physicsSystem?.audio.playClick();
    this.workshopLayout = cycleWorkshopDifficulty(this.workshopLayout);
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
    if (this.isLevelLoading) return;
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
    void this.startWorkshopTestAsync();
  }

  private async startWorkshopTestAsync(): Promise<void> {
    if (this.isLevelLoading) return;
    this.isLevelLoading = true;
    try {
      this.currentLevelConfig = compileWorkshopLevel(this.workshopLayout);
      this.resetRoundStats(this.currentLevelConfig);
      this.workshopTestPhase = 'READY';
      this.sm.transitionGame('WORKSHOP_TEST');
      await this.rebuildCurrentLevel(false, -1);
      this.refreshPanelsVisibility();
      this.uiSystem?.updateHudPower(0, 'IDLE', false);
      this.uiSystem?.showCallout('BOWL YOUR CUSTOM ALLEY!', '#fbbf24', 1700);
    } finally {
      this.isLevelLoading = false;
    }
  }

  onWorkshopResetLayout(): void {
    this.physicsSystem?.audio.playClick();
    this.workshopLayout = createDefaultWorkshopLayout();
    this.selectedWorkshopSegIdx = 0;
    this.syncWorkshopUI();
  }
}

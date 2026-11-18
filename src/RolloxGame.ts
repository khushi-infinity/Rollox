import * as THREE from 'three';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import * as xb from 'xrblocks';

import {RolloxAudio} from './audio';
import {
  createBowlingBallMesh,
  createBowlingPinMesh,
  createDwarfCharacterMesh,
  createGroundPlaneMesh,
  createLaneSegmentMesh,
  createPinDeckBackdrop,
  createProceduralAssets,
  createRotatingBumperMesh,
  type DwarfRig,
  type ProceduralAssets,
} from './geometry';
import {
  ARENA_ORIGIN_Z,
  ARENA_TABLE_Y,
  BALL_RADIUS,
  CAMPAIGN_LEVELS,
  DEFAULT_BUILDER_CONFIG,
  buildCustomLevel,
  generatePinFormation,
} from './levels';
import {BowlingWorld} from './physics/BowlingWorld';
import type {
  BallPhase,
  BuilderConfig,
  GamePhase,
  LevelConfig,
  ScoreSummary,
} from './types';
import {RolloxUI} from './ui/RolloxUI';
import {ParticleBurstPool} from './vfx';

const MAX_PULL_DISTANCE = 0.24;
const MIN_LAUNCH_POWER = 0.08;
const TRAJECTORY_DOT_COUNT = 14;

const _vecA = new THREE.Vector3();
const _vecB = new THREE.Vector3();
const _rayOrigin = new THREE.Vector3();
const _rayDir = new THREE.Vector3();
const _quatA = new THREE.Quaternion();
const _plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const _hitPoint = new THREE.Vector3();
const _ray = new THREE.Ray();
const _dummy = new THREE.Object3D();

/**
 * Interactive grab handle around the miniature bowling ball so both direct hand
 * pinches and ray/mouse clicks capture cleanly.
 */
class BallGrabTarget extends xb.MeshScript {
  private onGrabBegin: (event: xb.SelectEvent | xb.ObjectGrabEvent) => void;
  private onGrabEnd: (event: xb.SelectEndEvent | xb.ObjectGrabEvent) => void;
  private onHoverState: (hovered: boolean) => void;

  constructor(
    onGrabBegin: (event: xb.SelectEvent | xb.ObjectGrabEvent) => void,
    onGrabEnd: (event: xb.SelectEndEvent | xb.ObjectGrabEvent) => void,
    onHoverState: (hovered: boolean) => void
  ) {
    super(
      new THREE.SphereGeometry(BALL_RADIUS * 2.1, 16, 12),
      new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0.0,
        depthWrite: false,
      })
    );
    this.name = 'Bowling Ball Grab Target';
    this.onGrabBegin = onGrabBegin;
    this.onGrabEnd = onGrabEnd;
    this.onHoverState = onHoverState;
  }

  override onHoverEnter(event: xb.HoverEvent): void {
    this.onHoverState(true);
    event.stopPropagation();
  }

  override onHoverExit(event: xb.HoverEvent): void {
    this.onHoverState(false);
    event.stopPropagation();
  }

  override onObjectSelectStart(event: xb.SelectEvent): void {
    this.onGrabBegin(event);
    event.stopPropagation();
  }

  override onObjectSelectEnd(event: xb.SelectEndEvent): void {
    this.onGrabEnd(event);
    event.stopPropagation();
  }

  override onObjectGrabStart(event: xb.ObjectGrabEvent): void {
    this.onGrabBegin(event);
    event.stopPropagation();
  }

  override onObjectGrabEnd(event: xb.ObjectGrabEvent): void {
    this.onGrabEnd(event);
    event.stopPropagation();
  }

  override dispose(): void {
    this.geometry.dispose();
    (this.material as THREE.Material).dispose();
    super.dispose();
  }
}

export class RolloxGame extends xb.Script {
  static dependencies = {
    camera: THREE.Camera,
    scene: THREE.Scene,
    user: xb.User,
  };

  private camera!: THREE.Camera;
  private user!: xb.User;

  private audio = new RolloxAudio();
  private vfx = new ParticleBurstPool();
  private bowlingWorld = new BowlingWorld();

  private assets!: ProceduralAssets;
  private ui!: RolloxUI;

  private arenaOrigin = new THREE.Vector3(0, ARENA_TABLE_Y, ARENA_ORIGIN_Z);
  private levelGroup = new THREE.Group();
  private levelDisposables: Array<{dispose: () => void}> = [];
  private groundPlaneMesh: THREE.Mesh | null = null;

  private ballGroup!: THREE.Group;
  private ballGrabTarget!: BallGrabTarget;
  private pedestalRing!: THREE.Mesh;
  private powerRing!: THREE.Mesh;
  private slingshotLine!: THREE.Line;
  private slingshotPositions!: Float32Array;
  private trajectoryDots!: THREE.InstancedMesh;

  private pinMeshes: THREE.Group[] = [];
  private obstacleMeshes = new Map<string, THREE.Object3D>();
  private dwarfRigs: DwarfRig[] = [];

  private phase: GamePhase = 'title';
  private ballPhase: BallPhase = 'ready';
  private showLevelsOverlay = false;
  private onboardingDone = false;

  private currentLevelIndex = 0;
  private currentLevel: LevelConfig = CAMPAIGN_LEVELS[0];
  private builderConfig: BuilderConfig = {...DEFAULT_BUILDER_CONFIG};

  private shotsLeft = 3;
  private shotsUsed = 0;
  private levelScore = 0;
  private totalScore = 0;
  private totalPins = 10;
  private pinsKnocked = 0;

  private rollElapsed = 0;
  private settleElapsed = 0;
  private dwarfWalkClock = 0;
  private ballHovered = false;
  private dwarfHitThisShot = false;
  private uiValidated = false;

  // Active grab / aiming state
  private activeSource: xb.InteractionSource | null = null;
  private grabStartWorld = new THREE.Vector3();
  private currentPullOffset = new THREE.Vector3();
  private currentPower01 = 0;

  // Reusable launch vectors
  private pendingLaunchVel = new THREE.Vector3();
  private pendingSpinVel = new THREE.Vector3();

  override init(deps: {
    camera: THREE.Camera;
    scene: THREE.Scene;
    user: xb.User;
  }): void {
    this.camera = deps.camera;
    this.user = deps.user;

    const webglRenderer = xb.core.renderer as THREE.WebGLRenderer;
    const maxAnisotropy =
      webglRenderer?.capabilities?.getMaxAnisotropy?.() ?? 4;

    if (webglRenderer && 'toneMapping' in webglRenderer) {
      webglRenderer.toneMapping = THREE.ACESFilmicToneMapping;
      webglRenderer.toneMappingExposure = 1.08;
      if (webglRenderer.shadowMap) {
        webglRenderer.shadowMap.enabled = true;
        webglRenderer.shadowMap.type = THREE.PCFSoftShadowMap;
      }
      try {
        const pmrem = new THREE.PMREMGenerator(webglRenderer);
        deps.scene.environment = pmrem.fromScene(
          new RoomEnvironment(),
          0.04
        ).texture;
        pmrem.dispose();
      } catch {
        // Fallback smoothly if serializer/webgpu backend lacks PMREM
      }
    }

    this.setupLighting();
    this.assets = createProceduralAssets(maxAnisotropy);

    this.groundPlaneMesh = createGroundPlaneMesh();
    this.add(this.groundPlaneMesh);
    if (this.bowlingWorld.isReady) {
      this.bowlingWorld.setGroundPlaneCollisionMesh(this.groundPlaneMesh);
    }

    this.add(this.levelGroup);
    this.add(this.vfx);

    this.setupBallAndGuides();
    this.setupUI();

    this.loadLevel(CAMPAIGN_LEVELS[0], 'title');
  }

  override initPhysics(physics: xb.Physics): void {
    this.bowlingWorld.init(physics, {
      onPinImpact: (worldPos, speed) => {
        const strength = Math.min(1, Math.max(0.25, speed / 2.6));
        this.audio.playPinHit(strength);
        this.vfx.emitBurst(
          worldPos,
          5,
          [0xfef08a, 0xfbbf24, 0xf87171, 0xffffff],
          0.85,
          0.8
        );
      },
      onDwarfHit: (worldPos) => {
        if (!this.dwarfHitThisShot) {
          this.dwarfHitThisShot = true;
          this.audio.playDwarfBonk();
          this.vfx.emitBurst(
            worldPos,
            12,
            [0xfb7185, 0xfbbf24, 0x94a3b8],
            1.15,
            1.1
          );
          if (this.phase === 'playing') {
            this.ui.showCallout('BARNABY BLOCKED!', '#fb7185', 1.5);
          }
        }
      },
      onRailHit: (worldPos) => {
        this.audio.playRailTap();
        this.vfx.emitBurst(worldPos, 3, [0x7dd3fc, 0xfde68a], 0.55, 0.55);
      },
    });
    if (this.groundPlaneMesh) {
      this.bowlingWorld.setGroundPlaneCollisionMesh(this.groundPlaneMesh);
    }
    this.bowlingWorld.setArenaOffset(this.arenaOrigin);
    this.rebuildPhysicsForCurrentLevel();
  }

  private setupLighting(): void {
    // Cool sky / warm ground hemisphere fill
    const hemi = new THREE.HemisphereLight(0xdbeafe, 0x5c3d24, 1.35);
    this.add(hemi);

    // Warm key directional light with tight miniature shadow bounds
    const key = new THREE.DirectionalLight(0xfff1d6, 2.3);
    key.position.set(1.1, 2.8, 0.4);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = 6;
    key.shadow.camera.left = -1.4;
    key.shadow.camera.right = 1.4;
    key.shadow.camera.top = 1.6;
    key.shadow.camera.bottom = -1.6;
    key.shadow.bias = -0.0006;
    key.shadow.normalBias = 0.015;
    this.add(key);

    // Subtle cool rim light from behind pin deck
    const rim = new THREE.DirectionalLight(0x7dd3fc, 0.85);
    rim.position.set(-0.9, 1.8, -2.8);
    this.add(rim);
  }

  private setupBallAndGuides(): void {
    this.ballGroup = createBowlingBallMesh(this.assets);
    this.ballGroup.position.set(
      this.arenaOrigin.x,
      this.arenaOrigin.y + BALL_RADIUS,
      this.arenaOrigin.z
    );
    this.add(this.ballGroup);

    this.ballGrabTarget = new BallGrabTarget(
      (event) => this.handleBallGrabStart(event),
      (event) => this.handleBallGrabEnd(event),
      (hovered) => {
        this.ballHovered = hovered;
      }
    );
    this.ballGroup.add(this.ballGrabTarget);

    // Glowing launch pedestal ring on the lane
    const pedGeo = new THREE.RingGeometry(
      BALL_RADIUS * 1.15,
      BALL_RADIUS * 1.5,
      32
    );
    const pedMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.72,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.pedestalRing = new THREE.Mesh(pedGeo, pedMat);
    this.pedestalRing.rotation.x = -Math.PI / 2;
    this.pedestalRing.xb = {pointerEvents: 'none'};
    this.add(this.pedestalRing);

    // Dynamic pullback power halo
    const pwrGeo = new THREE.RingGeometry(
      BALL_RADIUS * 1.6,
      BALL_RADIUS * 2.15,
      32
    );
    const pwrMat = new THREE.MeshBasicMaterial({
      color: 0x4ade80,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.powerRing = new THREE.Mesh(pwrGeo, pwrMat);
    this.powerRing.rotation.x = -Math.PI / 2;
    this.powerRing.visible = false;
    this.powerRing.xb = {pointerEvents: 'none'};
    this.add(this.powerRing);

    // Elastic slingshot tether line
    this.slingshotPositions = new Float32Array(6);
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute(
      'position',
      new THREE.BufferAttribute(this.slingshotPositions, 3)
    );
    const lineMat = new THREE.LineBasicMaterial({
      color: 0xfbbf24,
      transparent: true,
      opacity: 0.9,
    });
    this.slingshotLine = new THREE.Line(lineGeo, lineMat);
    this.slingshotLine.visible = false;
    this.slingshotLine.frustumCulled = false;
    this.slingshotLine.xb = {pointerEvents: 'none'};
    this.add(this.slingshotLine);

    // Dotted trajectory preview
    const dotGeo = new THREE.SphereGeometry(0.009, 10, 8);
    const dotMat = new THREE.MeshBasicMaterial({
      color: 0xfde047,
      transparent: true,
      opacity: 0.85,
    });
    this.trajectoryDots = new THREE.InstancedMesh(
      dotGeo,
      dotMat,
      TRAJECTORY_DOT_COUNT
    );
    this.trajectoryDots.visible = false;
    this.trajectoryDots.frustumCulled = false;
    this.trajectoryDots.xb = {pointerEvents: 'none'};
    this.add(this.trajectoryDots);

    this.syncGuideAnchors();
  }

  private syncGuideAnchors(): void {
    this.pedestalRing.position.set(
      this.arenaOrigin.x,
      this.arenaOrigin.y + 0.002,
      this.arenaOrigin.z
    );
    this.powerRing.position.set(
      this.arenaOrigin.x,
      this.arenaOrigin.y + 0.003,
      this.arenaOrigin.z
    );
  }

  private setupUI(): void {
    this.ui = new RolloxUI(this.builderConfig, {
      onStartPlay: () => {
        this.audio.playClick();
        this.showLevelsOverlay = false;
        this.loadLevel(CAMPAIGN_LEVELS[0], 'playing');
      },
      onSelectLevel: (idx) => {
        this.audio.playClick();
        this.showLevelsOverlay = false;
        this.currentLevelIndex = idx;
        this.loadLevel(CAMPAIGN_LEVELS[idx], 'playing');
      },
      onOpenLevels: () => {
        this.audio.playClick();
        this.showLevelsOverlay = true;
        this.refreshUIPhase();
      },
      onOpenBuilder: () => {
        this.audio.playClick();
        this.showLevelsOverlay = false;
        this.loadLevel(buildCustomLevel(this.builderConfig), 'builder');
      },
      onResetShot: () => {
        this.audio.playClick();
        this.resetBallOnly();
      },
      onReplayLevel: () => {
        this.audio.playClick();
        this.showLevelsOverlay = false;
        this.loadLevel(this.currentLevel, 'playing');
      },
      onNextLevel: () => {
        this.audio.playClick();
        const nextIdx = this.currentLevelIndex + 1;
        if (nextIdx < CAMPAIGN_LEVELS.length) {
          this.currentLevelIndex = nextIdx;
          this.loadLevel(CAMPAIGN_LEVELS[nextIdx], 'playing');
        } else {
          this.currentLevelIndex = 0;
          this.totalScore = 0;
          this.loadLevel(CAMPAIGN_LEVELS[0], 'playing');
        }
      },
      onTogglePause: () => {
        this.audio.playClick();
        this.togglePause();
      },
      onToggleMute: () => {
        return this.audio.toggleMute();
      },
      onRecenterArena: () => {
        this.audio.playClick();
        this.recenterArenaInFrontOfPlayer();
      },
      onBuilderChange: (next) => {
        this.audio.playClick();
        this.builderConfig = next;
        this.loadLevel(buildCustomLevel(this.builderConfig), 'builder');
      },
      onBuilderTest: () => {
        this.audio.playClick();
        this.loadLevel(buildCustomLevel(this.builderConfig), 'playing');
      },
      onBuilderReset: () => {
        this.audio.playClick();
        this.builderConfig = {...DEFAULT_BUILDER_CONFIG};
        this.ui.setBuilderState(this.builderConfig);
        this.loadLevel(buildCustomLevel(this.builderConfig), 'builder');
      },
      onBackToTitle: () => {
        this.audio.playClick();
        this.showLevelsOverlay = false;
        this.loadLevel(CAMPAIGN_LEVELS[this.currentLevelIndex], 'title');
      },
    });
    this.add(this.ui);
  }

  private recenterArenaInFrontOfPlayer(): void {
    this.camera.getWorldPosition(_vecA);
    this.camera.getWorldDirection(_vecB);
    _vecB.y = 0;
    if (_vecB.lengthSq() < 0.001) _vecB.set(0, 0, -1);
    _vecB.normalize();

    // Anchor pedestal 0.48m ahead of user, 0.54m below eye height
    this.arenaOrigin.set(
      _vecA.x + _vecB.x * 0.48,
      Math.max(0.55, _vecA.y - 0.54),
      _vecA.z + _vecB.z * 0.48
    );

    this.bowlingWorld.setArenaOffset(this.arenaOrigin);
    this.syncGuideAnchors();
    this.loadLevel(this.currentLevel, this.phase);
    this.ui.showCallout('TABLE RECENTERED', '#7dd3fc', 1.2);
  }

  private loadLevel(level: LevelConfig, nextPhase: GamePhase): void {
    this.currentLevel = level;
    this.phase = nextPhase;
    this.ballPhase = 'ready';
    this.activeSource = null;
    this.currentPower01 = 0;
    this.rollElapsed = 0;
    this.settleElapsed = 0;
    this.dwarfHitThisShot = false;

    // Clear previous visual meshes cleanly
    for (const d of this.levelDisposables) {
      d.dispose();
    }
    this.levelDisposables = [];
    this.levelGroup.clear();
    this.pinMeshes = [];
    this.obstacleMeshes.clear();
    this.dwarfRigs = [];

    // Position level container at arenaOrigin
    this.levelGroup.position.copy(this.arenaOrigin);

    // Build modular lane segments
    for (const seg of level.segments) {
      const segMesh = createLaneSegmentMesh(
        seg,
        this.assets,
        this.levelDisposables
      );
      this.levelGroup.add(segMesh);
    }

    // Build fantasy pin deck arch & backstop
    const arch = createPinDeckBackdrop(
      level.pinDeck,
      level.accentColor,
      this.assets,
      this.levelDisposables
    );
    this.levelGroup.add(arch);

    // Build pins
    const pinPlacements = generatePinFormation(
      level.pinFormation,
      level.pinDeck
    );
    this.totalPins = pinPlacements.length;
    for (let i = 0; i < pinPlacements.length; i++) {
      const pinMesh = createBowlingPinMesh(this.assets, i);
      pinMesh.position.set(
        this.arenaOrigin.x + pinPlacements[i].x,
        this.arenaOrigin.y + pinPlacements[i].y + 0.0605,
        this.arenaOrigin.z + pinPlacements[i].z
      );
      this.add(pinMesh);
      this.pinMeshes.push(pinMesh);
      this.levelDisposables.push({
        dispose: () => {
          pinMesh.removeFromParent();
          pinMesh.traverse((obj) => {
            if (obj instanceof THREE.Mesh && obj.geometry !== this.assets.pinGeometry) {
              obj.geometry.dispose();
            }
          });
        },
      });
    }

    // Build obstacles
    for (const obs of level.obstacles) {
      if (obs.kind === 'dwarf') {
        const rig = createDwarfCharacterMesh(this.levelDisposables);
        rig.root.position.set(
          this.arenaOrigin.x + obs.x,
          this.arenaOrigin.y + obs.y,
          this.arenaOrigin.z + obs.z
        );
        this.add(rig.root);
        this.obstacleMeshes.set(obs.id, rig.root);
        this.dwarfRigs.push(rig);
        this.levelDisposables.push({
          dispose: () => rig.root.removeFromParent(),
        });
      } else {
        const bumper = createRotatingBumperMesh(
          obs.radius ?? 0.12,
          this.assets,
          this.levelDisposables
        );
        bumper.position.set(
          this.arenaOrigin.x + obs.x,
          this.arenaOrigin.y + obs.y,
          this.arenaOrigin.z + obs.z
        );
        this.add(bumper);
        this.obstacleMeshes.set(obs.id, bumper);
        this.levelDisposables.push({
          dispose: () => bumper.removeFromParent(),
        });
      }
    }

    // Reset round counters
    this.shotsLeft = level.maxShots;
    this.shotsUsed = 0;
    this.levelScore = 0;
    this.pinsKnocked = 0;

    // Sync ball & guides
    this.resetVisualGuides();
    this.ballGroup.position.set(
      this.arenaOrigin.x,
      this.arenaOrigin.y + BALL_RADIUS,
      this.arenaOrigin.z
    );
    this.ballGroup.quaternion.identity();

    this.rebuildPhysicsForCurrentLevel();
    this.refreshUIPhase();
    this.ui.updateHud(
      this.currentLevel,
      this.pinsKnocked,
      this.totalPins,
      this.shotsLeft,
      this.levelScore,
      this.totalScore
    );
    this.ui.updateAimPower(null);
  }

  private rebuildPhysicsForCurrentLevel(): void {
    if (!this.bowlingWorld.isReady) return;
    this.bowlingWorld.buildLevelPhysics(
      this.currentLevel,
      this.ballGroup,
      this.pinMeshes,
      this.obstacleMeshes
    );
  }

  private refreshUIPhase(): void {
    this.ui.setPhase(this.phase, {
      showLevels: this.showLevelsOverlay,
      showOnboarding: !this.onboardingDone && this.phase === 'playing',
    });
  }

  private resetBallOnly(): void {
    if (this.phase !== 'playing' && this.phase !== 'builder') return;
    this.ballPhase = 'ready';
    this.activeSource = null;
    this.currentPower01 = 0;
    this.resetVisualGuides();
    this.bowlingWorld.resetBallToPedestal(new THREE.Vector3(0, BALL_RADIUS, 0));
    this.ui.updateAimPower(null);
  }

  private resetVisualGuides(): void {
    this.powerRing.visible = false;
    this.slingshotLine.visible = false;
    this.trajectoryDots.visible = false;
    this.pedestalRing.visible = true;
  }

  private handleBallGrabStart(
    event: xb.SelectEvent | xb.ObjectGrabEvent
  ): void {
    if (this.phase !== 'playing') return;
    if (this.ballPhase !== 'ready') return;
    if (this.shotsLeft <= 0) return;

    this.activeSource = event.source;
    this.ballPhase = 'aiming';
    this.currentPower01 = 0;
    this.currentPullOffset.set(0, 0, 0);

    // Record grab start point for 3D direct-touch or ray-plane aiming
    if (event.source.type === 'direct-touch') {
      this.getSourceWorldPoint(event.source, this.grabStartWorld);
    } else {
      this.rayIntersectTablePlane(event.source, this.grabStartWorld);
    }

    this.audio.playGrab();
    this.powerRing.visible = true;
    this.slingshotLine.visible = true;
    this.trajectoryDots.visible = true;
  }

  private handleBallGrabEnd(
    event: xb.SelectEndEvent | xb.ObjectGrabEvent
  ): void {
    if (
      this.ballPhase === 'aiming' &&
      this.activeSource &&
      event.source.controller === this.activeSource.controller
    ) {
      this.releaseAimedShot();
    }
  }

  override onSelectStart(event: xb.SelectEvent): void {
    // Allow starting play from Title with Enter/Space or direct click if user grabs ball
    if (
      this.phase === 'playing' &&
      this.ballPhase === 'ready' &&
      event.target === this.ballGrabTarget
    ) {
      this.handleBallGrabStart(event);
    }
  }

  override onSelectEnd(event: xb.SelectEndEvent): void {
    this.handleBallGrabEnd(event);
  }

  override onKeyDown(event: xb.KeyEvent): void {
    if (this.phase === 'title' && (event.code === 'Enter' || event.code === 'Space')) {
      this.audio.playClick();
      this.showLevelsOverlay = false;
      this.loadLevel(CAMPAIGN_LEVELS[0], 'playing');
      return;
    }
    if (event.code === 'KeyR' && this.phase === 'playing') {
      this.audio.playClick();
      this.resetBallOnly();
    } else if (
      (event.code === 'Escape' || event.code === 'KeyP') &&
      (this.phase === 'playing' || this.phase === 'paused')
    ) {
      this.audio.playClick();
      this.togglePause();
    } else if (event.code === 'KeyM') {
      this.audio.toggleMute();
    }
  }

  private togglePause(): void {
    if (this.phase === 'playing') {
      this.phase = 'paused';
      this.refreshUIPhase();
    } else if (this.phase === 'paused') {
      this.phase = 'playing';
      this.refreshUIPhase();
    }
  }

  private getSourceWorldPoint(
    source: xb.InteractionSource,
    out: THREE.Vector3
  ): boolean {
    const handedness =
      source.handedness === 'left'
        ? xb.Handedness.LEFT
        : source.handedness === 'right'
          ? xb.Handedness.RIGHT
          : xb.Handedness.NONE;
    const tip =
      handedness !== xb.Handedness.NONE
        ? this.user.hands?.getIndexTip(handedness)
        : undefined;
    if (tip) {
      tip.getWorldPosition(out);
      return true;
    }
    source.controller.getWorldPosition(out);
    return true;
  }

  private rayIntersectTablePlane(
    source: xb.InteractionSource,
    out: THREE.Vector3
  ): boolean {
    source.controller.getWorldPosition(_rayOrigin);
    source.controller.getWorldQuaternion(_quatA);
    _rayDir.set(0, 0, -1).applyQuaternion(_quatA).normalize();

    const planeY = this.arenaOrigin.y + BALL_RADIUS;
    _plane.set(new THREE.Vector3(0, 1, 0), -planeY);
    _ray.set(_rayOrigin, _rayDir);

    const hit = _ray.intersectPlane(_plane, _hitPoint);
    if (!hit) {
      // Fallback: project forward onto pedestal depth
      out.set(
        this.arenaOrigin.x,
        planeY,
        this.arenaOrigin.z + 0.1
      );
      return false;
    }
    out.copy(_hitPoint);
    return true;
  }

  private updateAiming(): void {
    if (!this.activeSource) return;

    const pedestalX = this.arenaOrigin.x;
    const pedestalY = this.arenaOrigin.y + BALL_RADIUS;
    const pedestalZ = this.arenaOrigin.z;

    if (this.activeSource.type === 'direct-touch') {
      this.getSourceWorldPoint(this.activeSource, _vecA);
      _vecB.subVectors(_vecA, this.grabStartWorld);
    } else {
      this.rayIntersectTablePlane(this.activeSource, _vecA);
      _vecB.subVectors(_vecA, this.grabStartWorld);
    }

    // Pull back (+Z toward player) controls power; lateral X aims slingshot
    const pullZ = THREE.MathUtils.clamp(_vecB.z, 0, MAX_PULL_DISTANCE);
    const pullX = THREE.MathUtils.clamp(_vecB.x, -0.2, 0.2);

    this.currentPullOffset.set(pullX, 0, pullZ);
    const pullMag = Math.hypot(pullX * 0.75, pullZ);
    this.currentPower01 = THREE.MathUtils.clamp(
      pullMag / MAX_PULL_DISTANCE,
      0,
      1
    );

    if (pullZ < 0.014) {
      this.currentPower01 = 0;
    } else {
      this.audio.playPowerTick(this.currentPower01);
    }

    // Position the ball visually at the pulled slingshot point
    const ballX = pedestalX + pullX;
    const ballY = pedestalY;
    const ballZ = pedestalZ + pullZ;
    this.ballGroup.position.set(ballX, ballY, ballZ);
    this.bowlingWorld.setBallKinematicPosition(this.ballGroup.position);

    // Compute launch velocity (slingshot: pulling back-left launches forward-right)
    const dirX = -pullX * 1.45;
    const dirZ = -Math.max(0.08, pullZ);
    const dirLen = Math.hypot(dirX, dirZ) || 1;
    const nx = dirX / dirLen;
    const nz = dirZ / dirLen;

    const launchSpeed = 1.1 + this.currentPower01 * 2.75;
    this.pendingLaunchVel.set(nx * launchSpeed, 0.04, nz * launchSpeed);
    // Natural forward roll + gentle curve spin
    this.pendingSpinVel.set(
      -launchSpeed / BALL_RADIUS,
      -nx * 4.5,
      0
    );

    // Update power halo
    const ringScale = 0.7 + this.currentPower01 * 1.05;
    this.powerRing.scale.setScalar(ringScale);
    const pwrMat = this.powerRing.material as THREE.MeshBasicMaterial;
    if (this.currentPower01 > 0.78) {
      pwrMat.color.setHex(0xf87171);
    } else if (this.currentPower01 > 0.42) {
      pwrMat.color.setHex(0xfde047);
    } else {
      pwrMat.color.setHex(0x4ade80);
    }

    // Update slingshot tether line
    this.slingshotPositions[0] = pedestalX;
    this.slingshotPositions[1] = pedestalY;
    this.slingshotPositions[2] = pedestalZ;
    this.slingshotPositions[3] = ballX;
    this.slingshotPositions[4] = ballY;
    this.slingshotPositions[5] = ballZ;
    this.slingshotLine.geometry.attributes.position.needsUpdate = true;

    // Update dotted trajectory preview
    if (this.currentPower01 >= MIN_LAUNCH_POWER) {
      this.trajectoryDots.visible = true;
      for (let i = 0; i < TRAJECTORY_DOT_COUNT; i++) {
        const t = (i + 1) * 0.042;
        const px = pedestalX + this.pendingLaunchVel.x * t;
        const pz = pedestalZ + this.pendingLaunchVel.z * t;
        const py = pedestalY + 0.008;
        const s = 1 - (i / TRAJECTORY_DOT_COUNT) * 0.55;
        _dummy.position.set(px, py, pz);
        _dummy.scale.setScalar(s);
        _dummy.updateMatrix();
        this.trajectoryDots.setMatrixAt(i, _dummy.matrix);
      }
      this.trajectoryDots.instanceMatrix.needsUpdate = true;
    } else {
      this.trajectoryDots.visible = false;
    }

    this.ui.updateAimPower(this.currentPower01);
  }

  private releaseAimedShot(): void {
    const power = this.currentPower01;
    this.activeSource = null;
    this.resetVisualGuides();

    if (power < MIN_LAUNCH_POWER) {
      // Cancelled / barely pulled: snap back gently without spending a shot
      this.ballPhase = 'ready';
      this.ballGroup.position.set(
        this.arenaOrigin.x,
        this.arenaOrigin.y + BALL_RADIUS,
        this.arenaOrigin.z
      );
      this.bowlingWorld.setBallKinematicPosition(this.ballGroup.position);
      this.ui.updateAimPower(null);
      return;
    }

    if (!this.onboardingDone) {
      this.onboardingDone = true;
      this.ui.hideOnboarding();
    }

    this.shotsUsed++;
    this.shotsLeft = Math.max(0, this.shotsLeft - 1);
    this.dwarfHitThisShot = false;
    this.rollElapsed = 0;
    this.settleElapsed = 0;
    this.ballPhase = 'rolling';

    // Launch from pedestal center along aimed vector
    _vecA.set(
      this.arenaOrigin.x,
      this.arenaOrigin.y + BALL_RADIUS,
      this.arenaOrigin.z
    );
    this.bowlingWorld.launchBall(
      _vecA,
      this.pendingLaunchVel,
      this.pendingSpinVel
    );

    this.audio.playLaunch(power);
    this.vfx.emitBurst(
      _vecA,
      10,
      [0x38bdf8, 0xfde047, 0xffffff],
      0.95,
      0.85
    );

    this.ui.updateHud(
      this.currentLevel,
      this.pinsKnocked,
      this.totalPins,
      this.shotsLeft,
      this.levelScore,
      this.totalScore
    );
    this.ui.updateAimPower(null);
  }

  override physicsStep(): void {
    if (this.phase === 'paused') return;
    const dt = xb.core.physics?.timestep ?? 1 / 45;
    this.bowlingWorld.stepObstaclesAndSync(
      dt,
      this.ballPhase === 'rolling' || this.ballPhase === 'settling'
    );
  }

  override update(): void {
    const dt = Math.min(xb.getDeltaTime(), 0.05);

    if (!this.uiValidated && this.ui) {
      this.uiValidated = true;
      xb.ui.validate(this.ui.titleCard);
      xb.ui.validate(this.ui.hudCard);
    }

    this.ui.tick(dt);
    this.vfx.tick(dt);

    // Title idle visual polish: gently spin marble ball on pedestal
    if (this.phase === 'title') {
      this.ballGroup.rotation.y += dt * 0.65;
    }

    // Subtle hover feedback on ready ball
    if (this.ballPhase === 'ready') {
      const targetScale = this.ballHovered && this.phase === 'playing' ? 1.14 : 1.0;
      const cur = this.ballGroup.scale.x;
      const next = THREE.MathUtils.damp(cur, targetScale, 14, dt);
      this.ballGroup.scale.setScalar(next);
    } else if (this.ballGroup.scale.x !== 1) {
      this.ballGroup.scale.setScalar(1);
    }

    // Animate Dwarf walking limbs smoothly
    if (this.phase !== 'paused' && this.dwarfRigs.length > 0) {
      this.dwarfWalkClock += dt * 7.5;
      const swing = Math.sin(this.dwarfWalkClock) * 0.38;
      for (const rig of this.dwarfRigs) {
        rig.leftLeg.rotation.x = swing;
        rig.rightLeg.rotation.x = -swing;
        rig.hammerArm.rotation.x = -swing * 0.65;
        rig.shieldArm.position.y = 0.068 + Math.abs(Math.sin(this.dwarfWalkClock)) * 0.005;
      }
    }

    if (this.phase !== 'playing') return;

    if (this.ballPhase === 'aiming') {
      this.updateAiming();
      return;
    }

    if (this.ballPhase === 'rolling') {
      this.rollElapsed += dt;
      const ballState = this.bowlingWorld.getBallWorldState(_vecA);
      const fellOffTable = ballState.y < this.arenaOrigin.y - 0.16;
      const passedBack = ballState.z < this.arenaOrigin.z - 1.72;
      const stoppedRolling = this.rollElapsed > 0.65 && ballState.speed < 0.08;
      const timedOut = this.rollElapsed > 4.0;

      if (fellOffTable || passedBack || stoppedRolling || timedOut) {
        this.ballPhase = 'settling';
        this.settleElapsed = 0;
      }
      return;
    }

    if (this.ballPhase === 'settling') {
      this.settleElapsed += dt;
      const check = this.bowlingWorld.evaluateFallenPins(
        this.arenaOrigin.y - 0.12
      );
      if ((!check.anyPinMoving && this.settleElapsed > 0.55) || this.settleElapsed > 1.15) {
        this.finishShotResolution();
      }
    }
  }

  private finishShotResolution(): void {
    const evalResult = this.bowlingWorld.evaluateFallenPins(
      this.arenaOrigin.y - 0.12
    );
    const newlyFallen = evalResult.newlyFallen;
    this.pinsKnocked = evalResult.totalFallen;

    let shotPoints = newlyFallen * 10;
    let callout = newlyFallen > 0 ? `+${newlyFallen} PINS!` : 'GUTTER / MISS';
    let calloutColor = newlyFallen > 0 ? '#7dd3fc' : '#cbd5e1';

    const allDown = this.pinsKnocked >= this.totalPins;
    if (allDown && this.shotsUsed === 1) {
      shotPoints += 50;
      callout = 'STRIKE! +50 BONUS';
      calloutColor = '#fde047';
      this.audio.playStrikeFanfare();
      this.vfx.emitBurst(
        new THREE.Vector3(
          this.arenaOrigin.x + this.currentLevel.pinDeck.x,
          this.arenaOrigin.y + this.currentLevel.pinDeck.y + 0.12,
          this.arenaOrigin.z + this.currentLevel.pinDeck.z
        ),
        28,
        [0xfde047, 0x4ade80, 0x38bdf8, 0xfb7185],
        1.75,
        1.3
      );
    } else if (allDown && this.shotsUsed === 2) {
      shotPoints += 25;
      callout = 'SPARE! +25 BONUS';
      calloutColor = '#4ade80';
      this.audio.playSpareChime();
      this.vfx.emitBurst(
        new THREE.Vector3(
          this.arenaOrigin.x + this.currentLevel.pinDeck.x,
          this.arenaOrigin.y + this.currentLevel.pinDeck.y + 0.1,
          this.arenaOrigin.z + this.currentLevel.pinDeck.z
        ),
        20,
        [0x4ade80, 0xfde047, 0xffffff],
        1.45,
        1.1
      );
    } else if (allDown) {
      shotPoints += 15;
      callout = 'ALL CLEARED! +15';
      calloutColor = '#4ade80';
      this.audio.playSpareChime();
    }

    this.levelScore += shotPoints;
    this.totalScore += shotPoints;
    this.ui.showCallout(callout, calloutColor, 1.85);
    this.ui.updateHud(
      this.currentLevel,
      this.pinsKnocked,
      this.totalPins,
      this.shotsLeft,
      this.levelScore,
      this.totalScore
    );

    // Check round completion
    if (allDown || this.shotsLeft <= 0) {
      const unusedBonus = allDown ? this.shotsLeft * 15 : 0;
      this.levelScore += unusedBonus;
      this.totalScore += unusedBonus;

      const ratio = this.pinsKnocked / Math.max(1, this.totalPins);
      const stars =
        allDown && (this.shotsUsed === 1 || this.shotsLeft >= 1)
          ? 3
          : allDown || ratio >= 0.7
            ? 2
            : ratio >= 0.3
              ? 1
              : 0;

      const summary: ScoreSummary = {
        pinsKnocked: this.pinsKnocked,
        totalPins: this.totalPins,
        shotsUsed: this.shotsUsed,
        maxShots: this.currentLevel.maxShots,
        levelScore: this.levelScore,
        totalScore: this.totalScore,
        stars,
        callout,
      };

      if (allDown) {
        this.audio.playLevelWin();
      }
      this.phase = 'levelComplete';
      this.ballPhase = 'ready';
      this.ui.updateHud(
        this.currentLevel,
        this.pinsKnocked,
        this.totalPins,
        this.shotsLeft,
        this.levelScore,
        this.totalScore
      );
      const hasNext =
        this.currentLevel.index >= 0 &&
        this.currentLevelIndex + 1 < CAMPAIGN_LEVELS.length;
      this.ui.showLevelResult(summary, hasNext);
      this.refreshUIPhase();
      return;
    }

    // Prepare next shot with remaining pins
    this.bowlingWorld.hideFallenPins();
    this.bowlingWorld.resetStandingPins();
    this.resetBallOnly();
  }

  override dispose(): void {
    this.bowlingWorld.dispose();
    this.audio.dispose();
    this.vfx.dispose();
    this.assets?.dispose();
    for (const d of this.levelDisposables) {
      d.dispose();
    }
    this.levelDisposables = [];
    this.pedestalRing?.geometry.dispose();
    (this.pedestalRing?.material as THREE.Material | undefined)?.dispose();
    this.powerRing?.geometry.dispose();
    (this.powerRing?.material as THREE.Material | undefined)?.dispose();
    this.slingshotLine?.geometry.dispose();
    (this.slingshotLine?.material as THREE.Material | undefined)?.dispose();
    this.trajectoryDots?.geometry.dispose();
    (this.trajectoryDots?.material as THREE.Material | undefined)?.dispose();
    this.groundPlaneMesh?.geometry.dispose();
    (this.groundPlaneMesh?.material as THREE.Material | undefined)?.dispose();
    super.dispose();
  }
}

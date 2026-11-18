import {
  Entity,
  Hovered,
  RayInteractable,
  VisibilityState,
  createSystem,
} from '@iwsdk/core';
import * as THREE from 'three';

import {
  BallRayHandle,
  BowlingBall,
} from '../components';
import {
  BALL_RADIUS,
  type LaunchParameters,
  computeLaunchParameters,
} from '../levels';
import {
  type HandSide,
  PULL_CONSTANTS,
  PullStateMachine,
} from '../pullInteraction';
import type {GameSettings, GrabState} from '../types';
import {RolloxPhysicsSystem} from './PhysicsSystem';

const TRAJ_DOT_COUNT = 22;

export interface AimingCallbacks {
  getSettings: () => GameSettings;
  isAimingAllowed: () => boolean;
  onGrabStateChanged: (grabState: GrabState) => void;
  onGrabStarted: () => void;
  onAimUpdated: (
    launch: LaunchParameters,
    pullLocalX: number,
    pullLocalZ: number
  ) => void;
  onShotReleased: (
    worldOrigin: THREE.Vector3,
    worldVelocity: THREE.Vector3,
    worldSpin: THREE.Vector3,
    launch: LaunchParameters
  ) => void;
  onShotCancelled: () => void;
}

interface TrackedInputSample {
  tracked: boolean;
  kind: 'hand-pinch' | 'controller';
  side: HandSide;
  worldPos: THREE.Vector3;
  pinchDistM: number | null;
  selectStart: boolean;
  selectActive: boolean;
}

/**
 * IWSDK ECS System managing Rollox's responsive pinch-pull-aim-release mechanic.
 *
 * Replaces GrabSystem MoveFromTarget distance handles (which suffered from
 * ray-projection drift and self-occlusion premature drops) with a direct
 * PullStateMachine backed by:
 * 1. Direct WebXR Hand joint poses (`thumb-tip` & `index-finger-tip`) with
 *    pinch hysteresis + brief tracking-loss hold grace.
 * 2. WebXR Controller grip poses + trigger/squeeze + haptic ticks.
 * 3. Desktop 2D mouse drag projected smoothly onto the tabletop plane.
 */
export class AimingSystem extends createSystem({}) {
  private callbacks: AimingCallbacks | null = null;

  private rayHandleEntity: Entity | null = null;
  private rayHitMesh!: THREE.Mesh;
  private ballEntity: Entity | null = null;

  private pedestalLocal = new THREE.Vector3(0, BALL_RADIUS, 0);
  private arenaOrigin = new THREE.Vector3(0, 0.94, -0.48);
  private arenaYaw = 0;
  private arenaQuat = new THREE.Quaternion();
  private arenaInvQuat = new THREE.Quaternion();
  private pedestalWorld = new THREE.Vector3(0, 0.94 + BALL_RADIUS, -0.48);

  private pullSM = new PullStateMachine();
  private grabState: GrabState = 'IDLE';
  private lastBallWorldPos = new THREE.Vector3();

  // Desktop 2D mouse drag tracking
  private mouseDrag = {
    active: false,
    pointerId: -1,
    clientX: 0,
    clientY: 0,
  };
  private _raycaster = new THREE.Raycaster();
  private _ndc = new THREE.Vector2();
  private _tablePlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(0.94 + BALL_RADIUS));
  private _mouseHitWorld = new THREE.Vector3();

  // Visual Guides
  private guidesGroup = new THREE.Group();
  private hoverHaloMesh!: THREE.Mesh;
  private hoverHaloMat!: THREE.MeshBasicMaterial;
  private powerRingMesh!: THREE.Mesh;
  private powerRingMat!: THREE.MeshBasicMaterial;
  private aimTargetMesh!: THREE.Mesh;
  private aimTargetMat!: THREE.MeshBasicMaterial;
  private tetherLine!: THREE.Line;
  private tetherGeo!: THREE.BufferGeometry;
  private tetherMat!: THREE.LineBasicMaterial;
  private trajectoryDots: THREE.Mesh[] = [];
  private trajDotGeo!: THREE.SphereGeometry;
  private trajDotMat!: THREE.MeshBasicMaterial;
  private disposables: Array<{dispose: () => void}> = [];

  // Scratch vectors
  private _localPos = new THREE.Vector3();
  private _ballLocal = new THREE.Vector3();
  private _ballWorld = new THREE.Vector3();
  private _worldVel = new THREE.Vector3();
  private _worldSpin = new THREE.Vector3();
  private _thumbWorld = new THREE.Vector3();
  private _indexWorld = new THREE.Vector3();
  private _yAxis = new THREE.Vector3(0, 1, 0);
  private _samples: Record<HandSide, TrackedInputSample> = {
    left: {
      tracked: false,
      kind: 'hand-pinch',
      side: 'left',
      worldPos: new THREE.Vector3(),
      pinchDistM: null,
      selectStart: false,
      selectActive: false,
    },
    right: {
      tracked: false,
      kind: 'hand-pinch',
      side: 'right',
      worldPos: new THREE.Vector3(),
      pinchDistM: null,
      selectStart: false,
      selectActive: false,
    },
  };
  private _prevControllerPressed: Record<HandSide, boolean> = {
    left: false,
    right: false,
  };

  init(): void {
    this.createGrabHandle();
    this.createVisualGuides();
    this.setupMouseListeners();

    this.cleanupFuncs.push(() => {
      this.guidesGroup.removeFromParent();
      for (const d of this.disposables) {
        d.dispose();
      }
      this.disposables = [];
      this.rayHandleEntity?.destroy();
      this.rayHandleEntity = null;
    });
  }

  setCallbacks(callbacks: AimingCallbacks): void {
    this.callbacks = callbacks;
  }

  setBallEntity(entity: Entity | null): void {
    this.ballEntity = entity;
  }

  setArenaTransform(origin: THREE.Vector3, yawRad: number): void {
    this.arenaOrigin.copy(origin);
    this.arenaYaw = yawRad;
    this.arenaQuat.setFromAxisAngle(this._yAxis, yawRad);
    this.arenaInvQuat.copy(this.arenaQuat).invert();

    this.pedestalWorld
      .copy(this.pedestalLocal)
      .applyQuaternion(this.arenaQuat)
      .add(this.arenaOrigin);

    this._tablePlane.set(this._yAxis, -this.pedestalWorld.y);

    this.guidesGroup.position.copy(this.arenaOrigin);
    this.guidesGroup.quaternion.copy(this.arenaQuat);

    if (this.grabState === 'IDLE' || this.grabState === 'HOVER') {
      this.parkHandleAtPedestal();
    }
  }

  getPedestalWorldPosition(out = new THREE.Vector3()): THREE.Vector3 {
    return out.copy(this.pedestalWorld);
  }

  forceResetToPedestal(): void {
    this.pullSM.reset();
    this.mouseDrag.active = false;
    this.mouseDrag.pointerId = -1;
    this.parkHandleAtPedestal();
    this.hideAimGuides();
    this.setGrabState('IDLE');
  }

  getGrabState(): GrabState {
    return this.grabState;
  }

  notifyExternalGrabState(state: GrabState): void {
    this.setGrabState(state);
  }

  private setGrabState(next: GrabState): void {
    if (this.grabState === next) return;
    this.grabState = next;
    this.callbacks?.onGrabStateChanged(next);
  }

  private createGrabHandle(): void {
    const handleGeo = new THREE.SphereGeometry(0.115, 16, 12);
    const handleMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.0,
      depthWrite: false,
    });
    this.disposables.push(handleGeo, handleMat);

    // RayInteractable hit target for IWSDK cursor hover & 2D mouse hit detection
    this.rayHitMesh = new THREE.Mesh(handleGeo, handleMat);
    this.rayHitMesh.name = 'RolloxBallRayHandle';
    this.rayHitMesh.position.copy(this.pedestalWorld);
    this.rayHandleEntity = this.world
      .createTransformEntity(this.rayHitMesh)
      .addComponent(BallRayHandle)
      .addComponent(RayInteractable);
  }

  private createVisualGuides(): void {
    this.guidesGroup.name = 'RolloxAimingGuides';
    this.guidesGroup.position.copy(this.arenaOrigin);
    this.guidesGroup.quaternion.copy(this.arenaQuat);

    // Pre-grab hover halo on launch tee
    const haloGeo = new THREE.RingGeometry(0.048, 0.068, 36);
    haloGeo.rotateX(-Math.PI / 2);
    this.hoverHaloMat = new THREE.MeshBasicMaterial({
      color: 0x7dd3fc,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.0,
      depthWrite: false,
    });
    this.hoverHaloMesh = new THREE.Mesh(haloGeo, this.hoverHaloMat);
    this.hoverHaloMesh.position.set(0, 0.005, 0);
    this.guidesGroup.add(this.hoverHaloMesh);

    // Dynamic tabletop power ring following the pulled ball
    const ringGeo = new THREE.RingGeometry(0.052, 0.074, 36);
    ringGeo.rotateX(-Math.PI / 2);
    this.powerRingMat = new THREE.MeshBasicMaterial({
      color: 0x4ade80,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.88,
      depthWrite: false,
    });
    this.powerRingMesh = new THREE.Mesh(ringGeo, this.powerRingMat);
    this.powerRingMesh.position.set(0, 0.004, 0);
    this.powerRingMesh.visible = false;
    this.guidesGroup.add(this.powerRingMesh);

    // Projected forward aim target reticle on lane
    const targetGeo = new THREE.RingGeometry(0.022, 0.033, 24);
    targetGeo.rotateX(-Math.PI / 2);
    this.aimTargetMat = new THREE.MeshBasicMaterial({
      color: 0xfde047,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    });
    this.aimTargetMesh = new THREE.Mesh(targetGeo, this.aimTargetMat);
    this.aimTargetMesh.visible = false;
    this.guidesGroup.add(this.aimTargetMesh);

    // Slingshot tether line from tee to pulled ball
    this.tetherGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, BALL_RADIUS, 0),
      new THREE.Vector3(0, BALL_RADIUS, 0),
    ]);
    this.tetherMat = new THREE.LineBasicMaterial({
      color: 0xfde047,
      transparent: true,
      opacity: 0.92,
    });
    this.tetherLine = new THREE.Line(this.tetherGeo, this.tetherMat);
    this.tetherLine.visible = false;
    this.guidesGroup.add(this.tetherLine);

    // Aim trajectory dots
    this.trajDotGeo = new THREE.SphereGeometry(0.0085, 10, 8);
    this.trajDotMat = new THREE.MeshBasicMaterial({
      color: 0x7dd3fc,
      transparent: true,
      opacity: 0.88,
    });
    for (let i = 0; i < TRAJ_DOT_COUNT; i++) {
      const dot = new THREE.Mesh(this.trajDotGeo, this.trajDotMat);
      dot.visible = false;
      this.trajectoryDots.push(dot);
      this.guidesGroup.add(dot);
    }

    this.disposables.push(
      haloGeo,
      this.hoverHaloMat,
      ringGeo,
      this.powerRingMat,
      targetGeo,
      this.aimTargetMat,
      this.tetherGeo,
      this.tetherMat,
      this.trajDotGeo,
      this.trajDotMat
    );
    this.scene.add(this.guidesGroup);
  }

  private setupMouseListeners(): void {
    if (typeof window === 'undefined') return;
    const dom = this.renderer.domElement;

    const updateNdcAndPlane = (clientX: number, clientY: number): boolean => {
      const rect = dom.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      this._ndc.set(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1
      );
      this._raycaster.setFromCamera(this._ndc, this.camera);
      return this._raycaster.ray.intersectPlane(this._tablePlane, this._mouseHitWorld) !== null;
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      if (this.world.visibilityState.value !== VisibilityState.NonImmersive) return;
      if (!this.callbacks?.isAimingAllowed()) return;
      if (this.pullSM.active) return;

      const rect = dom.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      this._ndc.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      );
      this._raycaster.setFromCamera(this._ndc, this.camera);

      const isHovered = this.rayHandleEntity?.hasComponent(Hovered) ?? false;
      const directHit = this._raycaster.intersectObject(this.rayHitMesh, false);
      if (!isHovered && directHit.length === 0) return;

      if (!updateNdcAndPlane(e.clientX, e.clientY)) return;

      this.mouseDrag.active = true;
      this.mouseDrag.pointerId = e.pointerId;
      this.mouseDrag.clientX = e.clientX;
      this.mouseDrag.clientY = e.clientY;

      this.worldToArenaLocal(this._mouseHitWorld, this._localPos);
      this.worldToArenaLocal(this.lastBallWorldPos, this._ballLocal);
      this.pullSM.beginGrab('mouse', null, this._localPos, this._ballLocal, true);
      this.setGrabState('GRABBED');
      this.callbacks.onGrabStarted();
      this.setGrabState('AIMING');
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!this.mouseDrag.active) return;
      if (e.pointerId !== this.mouseDrag.pointerId) return;
      this.mouseDrag.clientX = e.clientX;
      this.mouseDrag.clientY = e.clientY;
    };

    const onPointerUp = (e: PointerEvent) => {
      if (!this.mouseDrag.active) return;
      if (e.pointerId !== this.mouseDrag.pointerId) return;
      this.mouseDrag.clientX = e.clientX;
      this.mouseDrag.clientY = e.clientY;
      this.mouseDrag.active = false;
    };

    dom.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);

    this.cleanupFuncs.push(() => {
      dom.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    });
  }

  private parkHandleAtPedestal(): void {
    if (this.rayHandleEntity?.object3D) {
      this.rayHandleEntity.object3D.position.copy(this.pedestalWorld);
      this.rayHandleEntity.object3D.quaternion.identity();
    }
    this.lastBallWorldPos.copy(this.pedestalWorld);
    if (this.ballEntity?.object3D) {
      this.ballEntity.object3D.position.copy(this.pedestalWorld);
    }
  }

  private hideAimGuides(): void {
    this.powerRingMesh.visible = false;
    this.aimTargetMesh.visible = false;
    this.tetherLine.visible = false;
    for (const dot of this.trajectoryDots) {
      dot.visible = false;
    }
  }

  private worldToArenaLocal(worldPos: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    return out
      .copy(worldPos)
      .sub(this.arenaOrigin)
      .applyQuaternion(this.arenaInvQuat);
  }

  private arenaLocalToWorld(
    localPos: {x: number; y: number; z: number},
    out: THREE.Vector3
  ): THREE.Vector3 {
    return out
      .set(localPos.x, localPos.y, localPos.z)
      .applyQuaternion(this.arenaQuat)
      .add(this.arenaOrigin);
  }

  private triggerHaptic(side: HandSide | null, intensity: number, durationMs: number): void {
    if (!side) return;
    const source = this.world.input?.xr?.getPrimaryInputSource(side);
    const actuator = source?.gamepad?.hapticActuators?.[0];
    if (!actuator) return;
    try {
      void actuator.pulse(intensity, durationMs);
    } catch {
      // Ignore unsupported haptic implementations
    }
  }

  private sampleXRInputs(): void {
    const xrInput = this.world.input?.xr;
    const frame = this.world.xrFrame;
    const refSpace = this.world.xrReferenceSpace;
    const playerMatrix = this.world.player?.matrixWorld;

    for (const side of ['left', 'right'] as const) {
      const sample = this._samples[side];
      sample.tracked = false;
      sample.pinchDistM = null;
      sample.selectStart = false;
      sample.selectActive = false;

      if (!xrInput) continue;
      const source = xrInput.getPrimaryInputSource(side);
      const selectState = xrInput.getSelectState(side);

      // 1. Tracked WebXR Hand (`XRHand` joints + select fallback)
      if (source?.hand) {
        sample.kind = 'hand-pinch';
        sample.selectStart = selectState.start;
        sample.selectActive = selectState.active;

        const thumbJoint = source.hand.get('thumb-tip');
        const indexJoint = source.hand.get('index-finger-tip');

        if (frame && refSpace && thumbJoint && indexJoint) {
          const thumbPose = frame.getJointPose?.(thumbJoint, refSpace);
          const indexPose = frame.getJointPose?.(indexJoint, refSpace);
          if (thumbPose && indexPose) {
            const tp = thumbPose.transform.position;
            const ip = indexPose.transform.position;
            this._thumbWorld.set(tp.x, tp.y, tp.z);
            this._indexWorld.set(ip.x, ip.y, ip.z);
            if (playerMatrix) {
              this._thumbWorld.applyMatrix4(playerMatrix);
              this._indexWorld.applyMatrix4(playerMatrix);
            }
            sample.worldPos
              .copy(this._thumbWorld)
              .add(this._indexWorld)
              .multiplyScalar(0.5);
            sample.pinchDistM = this._thumbWorld.distanceTo(this._indexWorld);
            sample.tracked = true;
            continue;
          }
        }

        // Fallback to IWSDK indexTipSpace if XRFrame joint pose unavailable (e.g. emulator)
        const tipObj = this.world.playerSpaceEntities?.indexTipSpaces[side]?.object3D;
        if (tipObj && selectState.active) {
          tipObj.getWorldPosition(sample.worldPos);
          sample.tracked = true;
        }
        continue;
      }

      // 2. Tracked WebXR Controller
      if (source) {
        sample.kind = 'controller';
        const gripObj =
          this.world.playerSpaceEntities?.gripSpaces[side]?.object3D ??
          this.world.playerSpaceEntities?.raySpaces[side]?.object3D;
        if (gripObj) {
          gripObj.getWorldPosition(sample.worldPos);
          const buttons = source.gamepad?.buttons;
          const triggerPressed = Boolean(buttons?.[0]?.pressed);
          const squeezePressed = Boolean(buttons?.[1]?.pressed);
          const pressed = triggerPressed || squeezePressed || selectState.active;
          sample.selectStart = pressed && !this._prevControllerPressed[side];
          sample.selectActive = pressed;
          this._prevControllerPressed[side] = pressed;
          sample.tracked = true;
        }
      } else {
        this._prevControllerPressed[side] = false;
      }
    }
  }

  private tryAcquireXRGrab(): void {
    const rayHovered = this.rayHandleEntity?.hasComponent(Hovered) ?? false;

    for (const side of ['left', 'right'] as const) {
      const sample = this._samples[side];
      if (!sample.tracked) continue;

      const distToBall = sample.worldPos.distanceTo(this.pedestalWorld);
      const nearBall = distToBall <= PULL_CONSTANTS.HAND_NEAR_GRAB_RADIUS_M;

      if (sample.kind === 'hand-pinch') {
        const physicalPinch =
          sample.pinchDistM !== null &&
          sample.pinchDistM <= PULL_CONSTANTS.PINCH_ACQUIRE_GAP_M;
        const nearAcquire = nearBall && (physicalPinch || sample.selectStart || sample.selectActive);
        const rayAcquire = rayHovered && sample.selectStart;

        if (nearAcquire || rayAcquire) {
          this.worldToArenaLocal(sample.worldPos, this._localPos);
          this.worldToArenaLocal(this.lastBallWorldPos, this._ballLocal);
          this.pullSM.beginGrab(
            'hand-pinch',
            side,
            this._localPos,
            this._ballLocal,
            sample.selectActive
          );
          this.setGrabState('GRABBED');
          this.callbacks?.onGrabStarted();
          this.setGrabState('AIMING');
          return;
        }
      } else {
        const nearAcquire = nearBall && sample.selectStart;
        const rayAcquire = rayHovered && sample.selectStart;
        if (nearAcquire || rayAcquire) {
          this.worldToArenaLocal(sample.worldPos, this._localPos);
          this.worldToArenaLocal(this.lastBallWorldPos, this._ballLocal);
          this.pullSM.beginGrab(
            'controller',
            side,
            this._localPos,
            this._ballLocal,
            sample.selectActive
          );
          this.triggerHaptic(side, 0.35, 25);
          this.setGrabState('GRABBED');
          this.callbacks?.onGrabStarted();
          this.setGrabState('AIMING');
          return;
        }
      }
    }
  }

  update(delta: number, time: number): void {
    if (!this.callbacks || !this.rayHandleEntity) {
      return;
    }

    const canAim = this.callbacks.isAimingAllowed();

    if (this.rayHandleEntity.object3D) {
      this.rayHandleEntity.object3D.pointerEvents = canAim ? 'auto' : 'none';
    }

    if (!canAim) {
      if (this.pullSM.active || this.mouseDrag.active) {
        this.forceResetToPedestal();
      } else {
        this.hoverHaloMat.opacity = 0;
        this.hideAimGuides();
      }
      return;
    }

    const dt = Math.max(0.001, Math.min(0.08, delta));
    this.sampleXRInputs();

    // Try acquiring a new XR grab if idle
    if (!this.pullSM.active) {
      this.tryAcquireXRGrab();
    }

    // Active Pull State Machine step
    if (this.pullSM.active) {
      this.hoverHaloMat.opacity = 0;
      const settings = this.callbacks.getSettings();
      const physicsSystem = this.world.getSystem(RolloxPhysicsSystem);

      let tracked = false;
      let pinchDistM: number | null = null;
      let selectActive = false;

      if (this.pullSM.sourceKind === 'mouse') {
        const dom = this.renderer.domElement;
        const rect = dom.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          this._ndc.set(
            ((this.mouseDrag.clientX - rect.left) / rect.width) * 2 - 1,
            -((this.mouseDrag.clientY - rect.top) / rect.height) * 2 + 1
          );
          this._raycaster.setFromCamera(this._ndc, this.camera);
          if (this._raycaster.ray.intersectPlane(this._tablePlane, this._mouseHitWorld)) {
            this.worldToArenaLocal(this._mouseHitWorld, this._localPos);
            tracked = true;
          }
        }
        selectActive = this.mouseDrag.active;
      } else if (this.pullSM.handedness) {
        const sample = this._samples[this.pullSM.handedness];
        tracked = sample.tracked;
        pinchDistM = sample.pinchDistM;
        selectActive = sample.selectActive;
        if (tracked) {
          this.worldToArenaLocal(sample.worldPos, this._localPos);
        }
      }

      const stepRes = this.pullSM.step({
        dt,
        tracked,
        pointerLocal: this._localPos,
        pinchDistM,
        selectActive,
        curve: settings.powerCurve,
      });

      if (stepRes.outcome === 'HOLDING') {
        this.arenaLocalToWorld(stepRes.ballLocal, this._ballWorld);
        this.lastBallWorldPos.copy(this._ballWorld);

        if (this.ballEntity?.object3D) {
          this.ballEntity.object3D.position.copy(this._ballWorld);
        }
        physicsSystem?.bowlingWorld.setBallKinematicPosition(this._ballWorld);

        if (stepRes.launch.power01 > 0.05) {
          physicsSystem?.audio.playPowerTick(stepRes.launch.power01);
        }
        if (stepRes.launch.power01 > 0.2) {
          physicsSystem?.vfx.emitChargeSpark(this._ballWorld, stepRes.launch.power01, dt);
        }
        if (stepRes.crossedPowerTier) {
          this.triggerHaptic(this.pullSM.handedness, 0.28 + stepRes.launch.power01 * 0.35, 18);
        }

        this.updateAimVisuals(
          stepRes.pullX,
          stepRes.pullZ,
          stepRes.launch,
          settings.showTrajectory
        );
        this.callbacks.onAimUpdated(stepRes.launch, stepRes.pullX, stepRes.pullZ);
        return;
      }

      this.hideAimGuides();

      if (stepRes.outcome === 'RELEASE_LAUNCH') {
        this.triggerHaptic(this.pullSM.handedness, 0.65, 40);
        this.setGrabState('RELEASED');

        this.arenaLocalToWorld(stepRes.ballLocal, this._ballWorld);
        this._worldVel
          .set(
            stepRes.launch.velocity.x,
            stepRes.launch.velocity.y,
            stepRes.launch.velocity.z
          )
          .applyQuaternion(this.arenaQuat);

        this._worldSpin
          .set(
            stepRes.launch.spin.x,
            stepRes.launch.spin.y,
            stepRes.launch.spin.z
          )
          .applyQuaternion(this.arenaQuat);

        const releasePos = this._ballWorld.clone();
        const releaseVel = this._worldVel.clone();
        const releaseSpin = this._worldSpin.clone();
        const releaseLaunch = stepRes.launch;

        this.mouseDrag.active = false;
        this.parkHandleAtPedestal();
        this.setGrabState('IN_FLIGHT');
        this.callbacks.onShotReleased(
          releasePos,
          releaseVel,
          releaseSpin,
          releaseLaunch
        );
        return;
      }

      // Cancelled safely back to tee (too light tap or prolonged lost tracking)
      this.mouseDrag.active = false;
      physicsSystem?.bowlingWorld.resetBallToPedestal(this.pedestalLocal);
      this.parkHandleAtPedestal();
      this.setGrabState('IDLE');
      this.callbacks.onShotCancelled();
      return;
    }

    // Idle / Hover state on tee
    this.parkHandleAtPedestal();
    this.hideAimGuides();

    const nearHover =
      (this._samples.left.tracked &&
        this._samples.left.worldPos.distanceTo(this.pedestalWorld) <=
          PULL_CONSTANTS.HAND_NEAR_GRAB_RADIUS_M) ||
      (this._samples.right.tracked &&
        this._samples.right.worldPos.distanceTo(this.pedestalWorld) <=
          PULL_CONSTANTS.HAND_NEAR_GRAB_RADIUS_M);

    const isHovered = nearHover || (this.rayHandleEntity.hasComponent(Hovered) ?? false);

    if (isHovered) {
      this.setGrabState('HOVER');
      this.hoverHaloMat.opacity = 0.78 + Math.sin(time * 6) * 0.16;
      this.hoverHaloMesh.scale.setScalar(1.1 + Math.sin(time * 5) * 0.07);
    } else {
      this.setGrabState('IDLE');
      this.hoverHaloMat.opacity = 0.34 + Math.sin(time * 2.8) * 0.1;
      this.hoverHaloMesh.scale.setScalar(1.0);
    }
  }

  private updateAimVisuals(
    pullX: number,
    pullZ: number,
    launch: LaunchParameters,
    showTrajectory: boolean
  ): void {
    // Power ring beneath pulled ball
    this.powerRingMesh.visible = true;
    this.powerRingMesh.position.set(pullX, 0.004, pullZ);
    const scale = 1 + launch.power01 * 0.9;
    this.powerRingMesh.scale.setScalar(scale);

    const colorHex =
      launch.power01 < 0.35
        ? 0x38bdf8
        : launch.power01 < 0.72
          ? 0x4ade80
          : launch.power01 < 0.92
            ? 0xfbbf24
            : 0xfb7185;
    this.powerRingMat.color.setHex(colorHex);
    this.tetherMat.color.setHex(colorHex);

    // Slingshot tether from tee socket to pulled ball
    this.tetherLine.visible = pullZ > 0.012;
    const posAttr = this.tetherGeo.getAttribute(
      'position'
    ) as THREE.BufferAttribute;
    posAttr.setXYZ(0, 0, BALL_RADIUS * 0.5, 0);
    posAttr.setXYZ(1, pullX, BALL_RADIUS, pullZ);
    posAttr.needsUpdate = true;

    // Projected alley trajectory dots & end target reticle
    const previewActive = showTrajectory && launch.canLaunch;
    let lastX = pullX;
    let lastZ = pullZ;
    for (let i = 0; i < TRAJ_DOT_COUNT; i++) {
      const dot = this.trajectoryDots[i];
      if (!previewActive) {
        dot.visible = false;
        continue;
      }
      dot.visible = true;
      const t = (i + 1) * 0.034;
      const dist = launch.speed * t;
      const x = pullX + launch.dirX * dist;
      const z = pullZ + launch.dirZ * dist;
      dot.position.set(x, BALL_RADIUS * 0.52, z);
      dot.scale.setScalar(Math.max(0.32, 1 - i * 0.03));
      lastX = x;
      lastZ = z;
    }

    this.aimTargetMesh.visible = previewActive;
    if (previewActive) {
      this.aimTargetMesh.position.set(lastX, 0.004, lastZ);
      this.aimTargetMat.color.setHex(colorHex);
    }
  }
}

export {BowlingBall};

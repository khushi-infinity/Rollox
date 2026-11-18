import {
  DistanceGrabbable,
  Entity,
  GrabSystem,
  Grabbed,
  Hovered,
  MovementMode,
  OneHandGrabbable,
  RayInteractable,
  createSystem,
} from '@iwsdk/core';
import * as THREE from 'three';

import {
  BALL_RADIUS,
  MAX_LATERAL_PULL,
  MAX_PULL_DISTANCE,
  type LaunchParameters,
  computeLaunchParameters,
} from '../levels';
import {
  BallNearHandle,
  BallRayHandle,
  BowlingBall,
} from '../components';
import type {GameSettings, GrabState} from '../types';
import {RolloxPhysicsSystem} from './PhysicsSystem';

const TRAJ_DOT_COUNT = 20;

export interface AimingCallbacks {
  getSettings: () => GameSettings;
  isAimingAllowed: () => boolean;
  onGrabStateChanged: (grabState: GrabState) => void;
  onGrabStarted: () => void;
  onAimUpdated: (launch: LaunchParameters, pullLocalX: number, pullLocalZ: number) => void;
  onShotReleased: (
    worldOrigin: THREE.Vector3,
    worldVelocity: THREE.Vector3,
    worldSpin: THREE.Vector3,
    launch: LaunchParameters
  ) => void;
  onShotCancelled: () => void;
}

/**
 * IWSDK ECS System managing hands-first pinch-pull-aim-release bowling mechanics.
 * Uses dual decoupled grab volumes:
 * - BallNearHandle: OneHandGrabbable (pinch-to-grab via IWSDK GrabSystem)
 * - BallRayHandle: RayInteractable + DistanceGrabbable(MoveAtSource) for ray/mouse drag
 */
export class AimingSystem extends createSystem({}) {
  private callbacks: AimingCallbacks | null = null;

  private nearHandleEntity: Entity | null = null;
  private rayHandleEntity: Entity | null = null;
  private ballEntity: Entity | null = null;

  private pedestalLocal = new THREE.Vector3(0, BALL_RADIUS, 0);
  private arenaOrigin = new THREE.Vector3(0, 0.94, -0.48);
  private arenaYaw = 0;
  private arenaQuat = new THREE.Quaternion();
  private arenaInvQuat = new THREE.Quaternion();
  private pedestalWorld = new THREE.Vector3(0, 0.94 + BALL_RADIUS, -0.48);

  private activeGrabMode: 'near' | 'ray' | null = null;
  private grabState: GrabState = 'IDLE';
  private lastLaunch: LaunchParameters = computeLaunchParameters(0, 0, 'smooth');
  private lastBallWorldPos = new THREE.Vector3();
  private hasGrabStartedThisHold = false;

  // Visual Guides
  private guidesGroup = new THREE.Group();
  private hoverHaloMesh!: THREE.Mesh;
  private hoverHaloMat!: THREE.MeshBasicMaterial;
  private powerRingMesh!: THREE.Mesh;
  private powerRingMat!: THREE.MeshBasicMaterial;
  private tetherLine!: THREE.Line;
  private tetherGeo!: THREE.BufferGeometry;
  private tetherMat!: THREE.LineBasicMaterial;
  private trajectoryDots: THREE.Mesh[] = [];
  private trajDotGeo!: THREE.SphereGeometry;
  private trajDotMat!: THREE.MeshBasicMaterial;
  private disposables: Array<{dispose: () => void}> = [];

  // Scratch vectors
  private _handleWorld = new THREE.Vector3();
  private _localDelta = new THREE.Vector3();
  private _ballWorld = new THREE.Vector3();
  private _worldVel = new THREE.Vector3();
  private _worldSpin = new THREE.Vector3();
  private _tipWorld = new THREE.Vector3();
  private _yAxis = new THREE.Vector3(0, 1, 0);

  init(): void {
    this.createGrabHandles();
    this.createVisualGuides();

    this.cleanupFuncs.push(() => {
      this.guidesGroup.removeFromParent();
      for (const d of this.disposables) {
        d.dispose();
      }
      this.disposables = [];
      this.nearHandleEntity?.destroy();
      this.rayHandleEntity?.destroy();
      this.nearHandleEntity = null;
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

    this.guidesGroup.position.copy(this.arenaOrigin);
    this.guidesGroup.quaternion.copy(this.arenaQuat);

    if (this.grabState === 'IDLE' || this.grabState === 'HOVER') {
      this.parkHandlesAtPedestal();
    }
  }

  getPedestalWorldPosition(out = new THREE.Vector3()): THREE.Vector3 {
    return out.copy(this.pedestalWorld);
  }

  forceResetToPedestal(): void {
    const grabSystem = this.world.getSystem(GrabSystem);
    if (grabSystem) {
      if (this.nearHandleEntity) grabSystem.forceRelease(this.nearHandleEntity);
      if (this.rayHandleEntity) grabSystem.forceRelease(this.rayHandleEntity);
    }
    this.activeGrabMode = null;
    this.hasGrabStartedThisHold = false;
    this.lastLaunch = computeLaunchParameters(0, 0, 'smooth');
    this.parkHandlesAtPedestal();
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

  private createGrabHandles(): void {
    const handleGeo = new THREE.SphereGeometry(0.115, 16, 12);
    const handleMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.0,
      depthWrite: false,
    });
    this.disposables.push(handleGeo, handleMat);

    // 1. Direct Near Pinch Grab Handle (OneHandGrabbable; denies rays)
    const nearMesh = new THREE.Mesh(handleGeo, handleMat);
    nearMesh.name = 'RolloxBallNearHandle';
    nearMesh.position.copy(this.pedestalWorld);
    this.nearHandleEntity = this.world
      .createTransformEntity(nearMesh)
      .addComponent(BallNearHandle)
      .addComponent(OneHandGrabbable, {
        rotate: false,
        translate: true,
        translateMin: [-10, -10, -10],
        translateMax: [10, 10, 10],
      });

    // 2. Ray / Mouse Distance Grab Handle (RayInteractable + MoveAtSource; denies near grab)
    const rayMesh = new THREE.Mesh(handleGeo, handleMat);
    rayMesh.name = 'RolloxBallRayHandle';
    rayMesh.position.copy(this.pedestalWorld);
    this.rayHandleEntity = this.world
      .createTransformEntity(rayMesh)
      .addComponent(BallRayHandle)
      .addComponent(RayInteractable)
      .addComponent(DistanceGrabbable, {
        movementMode: MovementMode.MoveAtSource,
        translate: true,
        rotate: false,
        scale: false,
        returnToOrigin: false,
        translateMin: [-10, -10, -10],
        translateMax: [10, 10, 10],
      });
  }

  private createVisualGuides(): void {
    this.guidesGroup.name = 'RolloxAimingGuides';
    this.guidesGroup.position.copy(this.arenaOrigin);
    this.guidesGroup.quaternion.copy(this.arenaQuat);

    // Pre-grab hover halo on launch pad
    const haloGeo = new THREE.RingGeometry(0.048, 0.064, 36);
    haloGeo.rotateX(-Math.PI / 2);
    this.hoverHaloMat = new THREE.MeshBasicMaterial({
      color: 0x7dd3fc,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.0,
    });
    this.hoverHaloMesh = new THREE.Mesh(haloGeo, this.hoverHaloMat);
    this.hoverHaloMesh.position.set(0, 0.004, 0);
    this.guidesGroup.add(this.hoverHaloMesh);

    // Tabletop power gauge ring around launch zone
    const ringGeo = new THREE.RingGeometry(0.056, 0.072, 36);
    ringGeo.rotateX(-Math.PI / 2);
    this.powerRingMat = new THREE.MeshBasicMaterial({
      color: 0x4ade80,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85,
    });
    this.powerRingMesh = new THREE.Mesh(ringGeo, this.powerRingMat);
    this.powerRingMesh.position.set(0, 0.003, 0);
    this.powerRingMesh.visible = false;
    this.guidesGroup.add(this.powerRingMesh);

    // Slingshot tether line from tee to pulled ball
    this.tetherGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, BALL_RADIUS, 0),
      new THREE.Vector3(0, BALL_RADIUS, 0),
    ]);
    this.tetherMat = new THREE.LineBasicMaterial({
      color: 0xfde047,
      transparent: true,
      opacity: 0.9,
    });
    this.tetherLine = new THREE.Line(this.tetherGeo, this.tetherMat);
    this.tetherLine.visible = false;
    this.guidesGroup.add(this.tetherLine);

    // Aim trajectory dots
    this.trajDotGeo = new THREE.SphereGeometry(0.009, 10, 8);
    this.trajDotMat = new THREE.MeshBasicMaterial({
      color: 0x7dd3fc,
      transparent: true,
      opacity: 0.85,
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
      this.tetherGeo,
      this.tetherMat,
      this.trajDotGeo,
      this.trajDotMat
    );
    this.scene.add(this.guidesGroup);
  }

  private parkHandlesAtPedestal(): void {
    if (this.nearHandleEntity?.object3D) {
      this.nearHandleEntity.object3D.position.copy(this.pedestalWorld);
      this.nearHandleEntity.object3D.quaternion.identity();
    }
    if (this.rayHandleEntity?.object3D) {
      this.rayHandleEntity.object3D.position.copy(this.pedestalWorld);
      this.rayHandleEntity.object3D.quaternion.identity();
    }
    this.lastBallWorldPos.copy(this.pedestalWorld);
  }

  private hideAimGuides(): void {
    this.powerRingMesh.visible = false;
    this.tetherLine.visible = false;
    for (const dot of this.trajectoryDots) {
      dot.visible = false;
    }
  }

  private isHandTipNearPedestal(): boolean {
    const spaces = this.world.playerSpaceEntities?.indexTipSpaces;
    if (!spaces) return false;
    for (const side of ['left', 'right'] as const) {
      const tipObj = spaces[side]?.object3D;
      if (!tipObj) continue;
      tipObj.getWorldPosition(this._tipWorld);
      if (this._tipWorld.distanceTo(this.pedestalWorld) < 0.17) {
        return true;
      }
    }
    return false;
  }

  update(_delta: number, time: number): void {
    if (!this.callbacks || !this.nearHandleEntity || !this.rayHandleEntity) {
      return;
    }

    const canAim = this.callbacks.isAimingAllowed();

    // Disable pointer hit-testing on handles whenever aiming is locked out
    if (this.nearHandleEntity.object3D) {
      this.nearHandleEntity.object3D.pointerEvents = canAim ? 'auto' : 'none';
    }
    if (this.rayHandleEntity.object3D) {
      this.rayHandleEntity.object3D.pointerEvents = canAim ? 'auto' : 'none';
    }

    if (!canAim) {
      if (this.activeGrabMode !== null) {
        this.forceResetToPedestal();
      } else {
        this.hoverHaloMat.opacity = 0;
        this.hideAimGuides();
      }
      return;
    }

    const nearGrabbed = this.nearHandleEntity.hasComponent(Grabbed);
    const rayGrabbed = this.rayHandleEntity.hasComponent(Grabbed);

    // Check active grab
    if (nearGrabbed || rayGrabbed) {
      const mode: 'near' | 'ray' = nearGrabbed ? 'near' : 'ray';
      const activeEntity =
        mode === 'near' ? this.nearHandleEntity : this.rayHandleEntity;

      if (!this.hasGrabStartedThisHold) {
        this.hasGrabStartedThisHold = true;
        this.activeGrabMode = mode;
        this.setGrabState('GRABBED');
        this.callbacks.onGrabStarted();
        this.setGrabState('AIMING');
      }

      this.hoverHaloMat.opacity = 0;
      activeEntity.object3D?.getWorldPosition(this._handleWorld);

      // Convert handle displacement from pedestal into arena-local space
      this._localDelta
        .copy(this._handleWorld)
        .sub(this.pedestalWorld)
        .applyQuaternion(this.arenaInvQuat);

      const pullX = THREE.MathUtils.clamp(
        this._localDelta.x,
        -MAX_LATERAL_PULL,
        MAX_LATERAL_PULL
      );
      const pullZ = THREE.MathUtils.clamp(
        this._localDelta.z,
        0,
        MAX_PULL_DISTANCE
      );

      const settings = this.callbacks.getSettings();
      const launch = computeLaunchParameters(pullX, pullZ, settings.powerCurve);
      this.lastLaunch = launch;

      // Update ball visual + kinematic physics position inside clamped table pocket
      this._ballWorld
        .set(pullX, BALL_RADIUS, pullZ)
        .applyQuaternion(this.arenaQuat)
        .add(this.arenaOrigin);
      this.lastBallWorldPos.copy(this._ballWorld);

      if (this.ballEntity?.object3D) {
        this.ballEntity.object3D.position.copy(this._ballWorld);
      }

      const physicsSystem = this.world.getSystem(RolloxPhysicsSystem);
      physicsSystem?.bowlingWorld.setBallKinematicPosition(this._ballWorld);
      if (launch.power01 > 0.05) {
        physicsSystem?.audio.playPowerTick(launch.power01);
      }

      // Visual aiming feedback
      this.updateAimVisuals(pullX, pullZ, launch, settings.showTrajectory);
      this.callbacks.onAimUpdated(launch, pullX, pullZ);
      return;
    }

    // Grab just released!
    if (this.hasGrabStartedThisHold) {
      this.hasGrabStartedThisHold = false;
      this.activeGrabMode = null;
      this.hideAimGuides();

      if (this.lastLaunch.canLaunch) {
        this.setGrabState('RELEASED');

        this._worldVel
          .set(
            this.lastLaunch.velocity.x,
            this.lastLaunch.velocity.y,
            this.lastLaunch.velocity.z
          )
          .applyQuaternion(this.arenaQuat);

        this._worldSpin
          .set(
            this.lastLaunch.spin.x,
            this.lastLaunch.spin.y,
            this.lastLaunch.spin.z
          )
          .applyQuaternion(this.arenaQuat);

        const releasePos = this.lastBallWorldPos.clone();
        const releaseVel = this._worldVel.clone();
        const releaseSpin = this._worldSpin.clone();
        const releaseLaunch = this.lastLaunch;

        this.parkHandlesAtPedestal();
        this.setGrabState('IN_FLIGHT');
        this.callbacks.onShotReleased(
          releasePos,
          releaseVel,
          releaseSpin,
          releaseLaunch
        );
      } else {
        // Gentle tap below minimum power: safely return ball to tee
        const physicsSystem = this.world.getSystem(RolloxPhysicsSystem);
        physicsSystem?.bowlingWorld.resetBallToPedestal(this.pedestalLocal);
        this.parkHandlesAtPedestal();
        this.setGrabState('IDLE');
        this.callbacks.onShotCancelled();
      }
      return;
    }

    // Idle / Hover state on tee
    this.parkHandlesAtPedestal();
    this.hideAimGuides();

    const isHovered =
      this.nearHandleEntity.hasComponent(Hovered) ||
      this.rayHandleEntity.hasComponent(Hovered) ||
      this.isHandTipNearPedestal();

    if (isHovered) {
      this.setGrabState('HOVER');
      this.hoverHaloMat.opacity = 0.72 + Math.sin(time * 6) * 0.18;
      this.hoverHaloMesh.scale.setScalar(1.08 + Math.sin(time * 5) * 0.06);
    } else {
      this.setGrabState('IDLE');
      this.hoverHaloMat.opacity = 0.28 + Math.sin(time * 2.8) * 0.1;
      this.hoverHaloMesh.scale.setScalar(1.0);
    }
  }

  private updateAimVisuals(
    pullX: number,
    pullZ: number,
    launch: LaunchParameters,
    showTrajectory: boolean
  ): void {
    // Power ring
    this.powerRingMesh.visible = true;
    this.powerRingMesh.position.set(pullX, 0.003, pullZ);
    const scale = 1 + launch.power01 * 0.85;
    this.powerRingMesh.scale.setScalar(scale);

    if (launch.power01 < 0.35) {
      this.powerRingMat.color.setHex(0x38bdf8);
    } else if (launch.power01 < 0.72) {
      this.powerRingMat.color.setHex(0x4ade80);
    } else {
      this.powerRingMat.color.setHex(0xfb7185);
    }

    // Slingshot tether
    this.tetherLine.visible = pullZ > 0.015;
    const posAttr = this.tetherGeo.getAttribute(
      'position'
    ) as THREE.BufferAttribute;
    posAttr.setXYZ(0, 0, BALL_RADIUS, 0);
    posAttr.setXYZ(1, pullX, BALL_RADIUS, pullZ);
    posAttr.needsUpdate = true;

    // Parabolic / alley projection dots in arena-local coordinates
    const previewActive = showTrajectory && launch.canLaunch;
    for (let i = 0; i < TRAJ_DOT_COUNT; i++) {
      const dot = this.trajectoryDots[i];
      if (!previewActive) {
        dot.visible = false;
        continue;
      }
      dot.visible = true;
      const t = (i + 1) * 0.036;
      const dist = launch.speed * t;
      const x = pullX + launch.dirX * dist;
      const z = pullZ + launch.dirZ * dist;
      dot.position.set(x, BALL_RADIUS * 0.55, z);
      dot.scale.setScalar(1 - i * 0.032);
    }
  }
}

export {BowlingBall};

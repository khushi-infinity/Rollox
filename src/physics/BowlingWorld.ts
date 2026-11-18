import RAPIER from '@dimforge/rapier3d-simd-compat';
import * as THREE from 'three';

import {
  BALL_RADIUS,
  LANE_DECK_THICKNESS,
  generatePinFormation,
} from '../levels';
import type {LevelConfig, ObstacleSpec} from '../types';

export type CollisionTag =
  | 'ball'
  | 'pin'
  | 'rail'
  | 'dwarf'
  | 'bumper'
  | 'movingGate'
  | 'slidingBarrier'
  | 'deck'
  | 'ground';

export interface PhysicsPinEntity {
  index: number;
  body: RAPIER.RigidBody;
  colliderHandles: number[];
  mesh: THREE.Object3D | null;
  fallen: boolean;
  initialPos: THREE.Vector3;
}

export interface PhysicsObstacleEntity {
  spec: ObstacleSpec;
  body: RAPIER.RigidBody;
  colliderHandles: number[];
  mesh: THREE.Object3D | null;
  gateBarMesh?: THREE.Object3D | null;
  phase: number;
  baseWorldPos: THREE.Vector3;
  currentWorldPos: THREE.Vector3;
}

export interface CollisionCallback {
  onPinImpact: (worldPos: THREE.Vector3, speed: number) => void;
  onDwarfHit: (worldPos: THREE.Vector3) => void;
  onObstacleHit: (worldPos: THREE.Vector3, tag: CollisionTag) => void;
  onRailHit: (worldPos: THREE.Vector3) => void;
}

const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const _quat = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);
const _pinUp = new THREE.Vector3();
const _tmpVec = new THREE.Vector3();

let _rapierInitPromise: Promise<void> | null = null;

export async function ensureRapierInitialized(): Promise<void> {
  if (!_rapierInitPromise) {
    _rapierInitPromise = RAPIER.init();
  }
  await _rapierInitPromise;
}

/**
 * Pure Rapier3D physics simulation backing Rollox's IWSDK RolloxPhysicsSystem.
 * Manages static lane/rail/ramp colliders, trimesh ground floor, CCD bowling ball,
 * two-part compound-collider bowling pins, and kinematic fantasy obstacles.
 */
export class BowlingWorld {
  private world: RAPIER.World | null = null;
  private eventQueue: RAPIER.EventQueue | null = null;

  private staticBodies: RAPIER.RigidBody[] = [];
  private groundBody: RAPIER.RigidBody | null = null;
  private groundColliderHandle: number | null = null;
  private ballBody: RAPIER.RigidBody | null = null;
  private ballColliderHandle: number | null = null;
  private ballMesh: THREE.Object3D | null = null;

  public pins: PhysicsPinEntity[] = [];
  public obstacles: PhysicsObstacleEntity[] = [];

  private colliderTags = new Map<number, CollisionTag>();
  private arenaOffset = new THREE.Vector3();
  private arenaYaw = 0;
  private arenaQuat = new THREE.Quaternion();
  private arenaInvQuat = new THREE.Quaternion();
  private _localQuat = new THREE.Quaternion();
  private callbacks?: CollisionCallback;
  private ballBodyDynamic = false;

  get isReady(): boolean {
    return this.world !== null;
  }

  async init(callbacks?: CollisionCallback): Promise<void> {
    await ensureRapierInitialized();
    this.world = new RAPIER.World({x: 0, y: -9.81, z: 0});
    this.eventQueue = new RAPIER.EventQueue(true);
    this.callbacks = callbacks;
  }

  setCallbacks(callbacks: CollisionCallback): void {
    this.callbacks = callbacks;
  }

  /** Creates a fixed Rapier trimesh ground plane collider for real floor bounces. */
  setGroundPlaneCollisionMesh(groundMesh: THREE.Mesh): void {
    if (!this.world) return;

    if (this.groundBody) {
      if (this.groundColliderHandle !== null) {
        this.colliderTags.delete(this.groundColliderHandle);
      }
      this.world.removeRigidBody(this.groundBody);
      this.groundBody = null;
      this.groundColliderHandle = null;
    }

    const geometry = groundMesh.geometry;
    const posAttr = geometry.getAttribute('position');
    if (!posAttr) return;

    const vertices = new Float32Array(posAttr.count * 3);
    for (let i = 0; i < posAttr.count; i++) {
      vertices[i * 3] = posAttr.getX(i);
      vertices[i * 3 + 1] = posAttr.getY(i);
      vertices[i * 3 + 2] = posAttr.getZ(i);
    }

    const indexAttr = geometry.getIndex();
    let indices: Uint32Array;
    if (indexAttr) {
      indices = new Uint32Array(indexAttr.count);
      for (let i = 0; i < indexAttr.count; i++) {
        indices[i] = indexAttr.getX(i);
      }
    } else {
      indices = new Uint32Array(posAttr.count);
      for (let i = 0; i < posAttr.count; i++) {
        indices[i] = i;
      }
    }

    groundMesh.updateWorldMatrix(true, false);
    groundMesh.getWorldPosition(_tmpVec);
    groundMesh.getWorldQuaternion(_quat);

    const groundBody = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed()
        .setTranslation(_tmpVec.x, _tmpVec.y, _tmpVec.z)
        .setRotation({
          x: _quat.x,
          y: _quat.y,
          z: _quat.z,
          w: _quat.w,
        })
    );
    const groundCol = this.world.createCollider(
      RAPIER.ColliderDesc.trimesh(vertices, indices)
        .setFriction(0.65)
        .setRestitution(0.32)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      groundBody
    );

    this.groundBody = groundBody;
    this.groundColliderHandle = groundCol.handle;
    this.colliderTags.set(groundCol.handle, 'ground');
  }

  setArenaOffset(offset: THREE.Vector3, yawRad = this.arenaYaw): void {
    this.arenaOffset.copy(offset);
    this.arenaYaw = yawRad;
    this.arenaQuat.setFromAxisAngle(_up, yawRad);
    this.arenaInvQuat.copy(this.arenaQuat).invert();
  }

  getArenaOffset(): THREE.Vector3 {
    return this.arenaOffset;
  }

  private localToWorldVec(lx: number, ly: number, lz: number, out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(lx, ly, lz).applyQuaternion(this.arenaQuat).add(this.arenaOffset);
  }

  private syncMeshFromWorldPose(
    mesh: THREE.Object3D,
    wx: number,
    wy: number,
    wz: number,
    qx: number,
    qy: number,
    qz: number,
    qw: number
  ): void {
    _tmpVec
      .set(wx, wy, wz)
      .sub(this.arenaOffset)
      .applyQuaternion(this.arenaInvQuat);
    mesh.position.copy(_tmpVec);
    this._localQuat.set(qx, qy, qz, qw).premultiply(this.arenaInvQuat);
    mesh.quaternion.copy(this._localQuat);
  }

  buildLevelPhysics(
    level: LevelConfig,
    ballMesh: THREE.Object3D | null,
    pinMeshes: Array<THREE.Object3D | null>,
    obstacleVisuals: Map<
      string,
      {root: THREE.Object3D | null; gateBar?: THREE.Object3D | null}
    >
  ): void {
    this.clearLevel();
    if (!this.world) return;

    this.ballMesh = ballMesh;

    // 1. Fixed lane segments, rails & backstop
    for (const seg of level.segments) {
      this.localToWorldVec(seg.x, seg.y, seg.z, _tmpVec);

      _euler.set(seg.pitchX ?? 0, seg.yawY ?? 0, 0, 'YXZ');
      _quat.setFromEuler(_euler);
      _quat.premultiply(this.arenaQuat);

      const segBody = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed()
          .setTranslation(_tmpVec.x, _tmpVec.y, _tmpVec.z)
          .setRotation({
            x: _quat.x,
            y: _quat.y,
            z: _quat.z,
            w: _quat.w,
          })
      );
      this.staticBodies.push(segBody);

      const deckBevel = 0.004;
      const deckCol = this.world.createCollider(
        RAPIER.ColliderDesc.roundCuboid(
          Math.max(0.02, seg.width / 2 - deckBevel),
          Math.max(0.004, LANE_DECK_THICKNESS / 2 - deckBevel),
          Math.max(0.02, seg.length / 2 - deckBevel),
          deckBevel
        )
          .setTranslation(0, -LANE_DECK_THICKNESS / 2, 0)
          .setFriction(0.14)
          .setRestitution(0.05)
          .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min),
        segBody
      );
      this.colliderTags.set(deckCol.handle, 'deck');

      if (seg.hasRails !== false) {
        const railH = 0.048;
        const railW = 0.024;
        for (const side of [-1, 1]) {
          const rx = side * (seg.width / 2 + railW * 0.45);
          const railCol = this.world.createCollider(
            RAPIER.ColliderDesc.cuboid(railW / 2, railH / 2, seg.length / 2)
              .setTranslation(rx, railH / 2 - 0.004, 0)
              .setFriction(0.15)
              .setRestitution(0.65)
              .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
            segBody
          );
          this.colliderTags.set(railCol.handle, 'rail');
        }
      }
    }

    // Backstop wall behind the pin deck
    const pinDeckYaw = level.pinDeckYaw ?? 0;
    const sinDeck = Math.sin(pinDeckYaw);
    const cosDeck = Math.cos(pinDeckYaw);
    this.localToWorldVec(
      level.pinDeck.x - sinDeck * 0.32,
      level.pinDeck.y + 0.06,
      level.pinDeck.z - cosDeck * 0.32,
      _tmpVec
    );
    _euler.set(0, pinDeckYaw, 0, 'YXZ');
    _quat.setFromEuler(_euler);
    _quat.premultiply(this.arenaQuat);
    const backBody = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed()
        .setTranslation(_tmpVec.x, _tmpVec.y, _tmpVec.z)
        .setRotation({
          x: _quat.x,
          y: _quat.y,
          z: _quat.z,
          w: _quat.w,
        })
    );
    this.staticBodies.push(backBody);
    const backCol = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.28, 0.07, 0.025)
        .setFriction(0.4)
        .setRestitution(0.35),
      backBody
    );
    this.colliderTags.set(backCol.handle, 'rail');

    // 2. Bowling Ball
    this.createOrResetBall(new THREE.Vector3(0, BALL_RADIUS, 0));

    // 3. Compound-Collider Bowling Pins
    const placements = generatePinFormation(
      level.pinFormation,
      level.pinDeck,
      pinDeckYaw
    );
    for (let i = 0; i < placements.length; i++) {
      const p = placements[i];
      const mesh = pinMeshes[i] ?? null;
      const worldPos = this.localToWorldVec(p.x, p.y + 0.0595, p.z);

      const pinBody = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(worldPos.x, worldPos.y, worldPos.z)
          .setCcdEnabled(true)
          .setLinearDamping(0.22)
          .setAngularDamping(0.06)
      );

      const baseCol = this.world.createCollider(
        RAPIER.ColliderDesc.cylinder(0.018, 0.0135)
          .setTranslation(0, -0.041, 0)
          .setDensity(1.8)
          .setFriction(0.75)
          .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Max)
          .setRestitution(0.18)
          .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
        pinBody
      );
      const bellyCol = this.world.createCollider(
        RAPIER.ColliderDesc.cylinder(0.022, 0.0205)
          .setTranslation(0, -0.01, 0)
          .setDensity(1.5)
          .setFriction(0.32)
          .setRestitution(0.35)
          .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
        pinBody
      );
      const neckCol = this.world.createCollider(
        RAPIER.ColliderDesc.cylinder(0.036, 0.0125)
          .setTranslation(0, 0.038, 0)
          .setDensity(1.1)
          .setFriction(0.28)
          .setRestitution(0.35)
          .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
        pinBody
      );
      this.colliderTags.set(baseCol.handle, 'pin');
      this.colliderTags.set(bellyCol.handle, 'pin');
      this.colliderTags.set(neckCol.handle, 'pin');

      if (mesh) {
        mesh.position.set(p.x, p.y + 0.0595, p.z);
        mesh.quaternion.identity();
      }

      this.pins.push({
        index: i,
        body: pinBody,
        colliderHandles: [baseCol.handle, bellyCol.handle, neckCol.handle],
        mesh,
        fallen: false,
        initialPos: worldPos.clone(),
      });
    }

    // 4. Kinematic Obstacles (Dwarf, Rotating Bumper, Moving Gate, Sliding Barrier)
    for (const obs of level.obstacles) {
      const visual = obstacleVisuals.get(obs.id);
      const mesh = visual?.root ?? null;

      const baseWorldPos = this.localToWorldVec(obs.x, obs.y, obs.z);

      if (obs.kind === 'dwarf') {
        const body = this.world.createRigidBody(
          RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
            baseWorldPos.x,
            baseWorldPos.y + 0.062,
            baseWorldPos.z
          )
        );
        const col = this.world.createCollider(
          RAPIER.ColliderDesc.roundCuboid(0.042, 0.056, 0.028, 0.008)
            .setFriction(0.25)
            .setRestitution(0.72)
            .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
          body
        );
        this.colliderTags.set(col.handle, 'dwarf');
        this.obstacles.push({
          spec: obs,
          body,
          colliderHandles: [col.handle],
          mesh,
          phase: 0,
          baseWorldPos,
          currentWorldPos: baseWorldPos.clone(),
        });
      } else if (obs.kind === 'bumper') {
        const radius = obs.radius ?? 0.12;
        const body = this.world.createRigidBody(
          RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
            baseWorldPos.x,
            baseWorldPos.y + 0.032,
            baseWorldPos.z
          )
        );
        const colA = this.world.createCollider(
          RAPIER.ColliderDesc.cuboid(radius, 0.016, 0.012)
            .setRestitution(0.85)
            .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
          body
        );
        const colB = this.world.createCollider(
          RAPIER.ColliderDesc.cuboid(0.012, 0.016, radius)
            .setRestitution(0.85)
            .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
          body
        );
        this.colliderTags.set(colA.handle, 'bumper');
        this.colliderTags.set(colB.handle, 'bumper');
        this.obstacles.push({
          spec: obs,
          body,
          colliderHandles: [colA.handle, colB.handle],
          mesh,
          phase: 0,
          baseWorldPos,
          currentWorldPos: baseWorldPos.clone(),
        });
      } else if (obs.kind === 'movingGate') {
        const obsYaw = this.arenaYaw + (obs.yawY ?? 0);
        _euler.set(0, obsYaw, 0, 'YXZ');
        _quat.setFromEuler(_euler);

        // Fixed stone side-pillar colliders matching visual posts at x = ±0.15
        const frameBody = this.world.createRigidBody(
          RAPIER.RigidBodyDesc.fixed()
            .setTranslation(baseWorldPos.x, baseWorldPos.y, baseWorldPos.z)
            .setRotation({
              x: _quat.x,
              y: _quat.y,
              z: _quat.z,
              w: _quat.w,
            })
        );
        this.staticBodies.push(frameBody);
        for (const side of [-1, 1]) {
          const postCol = this.world.createCollider(
            RAPIER.ColliderDesc.cuboid(0.013, 0.08, 0.013)
              .setTranslation(side * 0.15, 0.08, 0)
              .setRestitution(0.55)
              .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
            frameBody
          );
          this.colliderTags.set(postCol.handle, 'movingGate');
        }

        const body = this.world.createRigidBody(
          RAPIER.RigidBodyDesc.kinematicPositionBased()
            .setTranslation(
              baseWorldPos.x,
              baseWorldPos.y + 0.0725,
              baseWorldPos.z
            )
            .setRotation({
              x: _quat.x,
              y: _quat.y,
              z: _quat.z,
              w: _quat.w,
            })
        );
        const col = this.world.createCollider(
          RAPIER.ColliderDesc.cuboid(0.12, 0.022, 0.014)
            .setRestitution(0.55)
            .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
          body
        );
        this.colliderTags.set(col.handle, 'movingGate');
        if (mesh) {
          mesh.position.set(obs.x, obs.y, obs.z);
          mesh.rotation.set(0, obs.yawY ?? 0, 0, 'YXZ');
        }
        if (visual?.gateBar) {
          visual.gateBar.position.y = 0.0725;
        }
        this.obstacles.push({
          spec: obs,
          body,
          colliderHandles: [col.handle],
          mesh,
          gateBarMesh: visual?.gateBar ?? null,
          phase: 0,
          baseWorldPos,
          currentWorldPos: baseWorldPos.clone(),
        });
      } else {
        // slidingBarrier
        const obsYaw = this.arenaYaw + (obs.yawY ?? 0);
        _euler.set(0, obsYaw, 0, 'YXZ');
        _quat.setFromEuler(_euler);
        const body = this.world.createRigidBody(
          RAPIER.RigidBodyDesc.kinematicPositionBased()
            .setTranslation(
              baseWorldPos.x,
              baseWorldPos.y + 0.032,
              baseWorldPos.z
            )
            .setRotation({
              x: _quat.x,
              y: _quat.y,
              z: _quat.z,
              w: _quat.w,
            })
        );
        const col = this.world.createCollider(
          RAPIER.ColliderDesc.cuboid(0.055, 0.032, 0.022)
            .setRestitution(0.75)
            .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
          body
        );
        this.colliderTags.set(col.handle, 'slidingBarrier');
        if (mesh) {
          mesh.position.set(obs.x, obs.y, obs.z);
          mesh.rotation.set(0, obs.yawY ?? 0, 0, 'YXZ');
        }
        this.obstacles.push({
          spec: obs,
          body,
          colliderHandles: [col.handle],
          mesh,
          phase: 0,
          baseWorldPos,
          currentWorldPos: baseWorldPos.clone(),
        });
      }
      if (mesh && (obs.kind === 'dwarf' || obs.kind === 'bumper')) {
        mesh.position.set(obs.x, obs.y, obs.z);
        mesh.rotation.set(0, obs.yawY ?? 0, 0, 'YXZ');
      }
    }
  }

  private createOrResetBall(localPos: THREE.Vector3): void {
    if (!this.world) return;
    if (this.ballBody) {
      if (this.ballColliderHandle !== null) {
        this.colliderTags.delete(this.ballColliderHandle);
      }
      this.world.removeRigidBody(this.ballBody);
      this.ballBody = null;
      this.ballColliderHandle = null;
    }

    this.localToWorldVec(localPos.x, localPos.y, localPos.z, _tmpVec);

    const desc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
      _tmpVec.x,
      _tmpVec.y,
      _tmpVec.z
    );
    this.ballBody = this.world.createRigidBody(desc);
    this.ballBodyDynamic = false;

    const col = this.world.createCollider(
      RAPIER.ColliderDesc.ball(BALL_RADIUS)
        .setDensity(3.2)
        .setFriction(0.16)
        .setRestitution(0.42)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      this.ballBody
    );
    this.ballColliderHandle = col.handle;
    this.colliderTags.set(col.handle, 'ball');
  }

  setBallKinematicPosition(worldPos: THREE.Vector3): void {
    if (!this.ballBody) return;
    if (this.ballBodyDynamic) {
      this.ballBody.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, false);
      this.ballBodyDynamic = false;
    }
    this.ballBody.setNextKinematicTranslation({
      x: worldPos.x,
      y: worldPos.y,
      z: worldPos.z,
    });
    this.ballBody.setTranslation(
      {x: worldPos.x, y: worldPos.y, z: worldPos.z},
      false
    );
  }

  launchBall(
    worldOrigin: THREE.Vector3,
    linearVelocity: THREE.Vector3,
    spinVelocity: THREE.Vector3
  ): void {
    if (!this.world) return;
    if (this.ballBody) {
      if (this.ballColliderHandle !== null) {
        this.colliderTags.delete(this.ballColliderHandle);
      }
      this.world.removeRigidBody(this.ballBody);
    }

    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(worldOrigin.x, worldOrigin.y, worldOrigin.z)
        .setLinvel(linearVelocity.x, linearVelocity.y, linearVelocity.z)
        .setAngvel({x: spinVelocity.x, y: spinVelocity.y, z: spinVelocity.z})
        .setCcdEnabled(true)
        .setLinearDamping(0.12)
        .setAngularDamping(0.14)
    );
    const col = this.world.createCollider(
      RAPIER.ColliderDesc.ball(BALL_RADIUS)
        .setDensity(5.5)
        .setFriction(0.16)
        .setRestitution(0.42)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      body
    );
    this.ballBody = body;
    this.ballColliderHandle = col.handle;
    this.ballBodyDynamic = true;
    this.colliderTags.set(col.handle, 'ball');
  }

  resetBallToPedestal(localPos: THREE.Vector3): void {
    this.createOrResetBall(localPos);
    if (this.ballMesh) {
      this.ballMesh.position.copy(localPos);
      this.ballMesh.quaternion.identity();
    }
  }

  resetStandingPins(): void {
    for (const pin of this.pins) {
      if (pin.fallen) continue;
      pin.body.setTranslation(
        {
          x: pin.initialPos.x,
          y: pin.initialPos.y,
          z: pin.initialPos.z,
        },
        true
      );
      pin.body.setRotation({x: 0, y: 0, z: 0, w: 1}, true);
      pin.body.setLinvel({x: 0, y: 0, z: 0}, true);
      pin.body.setAngvel({x: 0, y: 0, z: 0}, true);
    }
  }

  hideFallenPins(): void {
    for (const pin of this.pins) {
      if (!pin.fallen) continue;
      pin.body.setEnabled(false);
      if (pin.mesh) pin.mesh.visible = false;
    }
  }

  getBallWorldState(outPos: THREE.Vector3): {speed: number; y: number; z: number} {
    if (!this.ballBody) return {speed: 0, y: 0, z: 0};
    const t = this.ballBody.translation();
    outPos.set(t.x, t.y, t.z);
    const v = this.ballBody.linvel();
    const speed = Math.hypot(v.x, v.y, v.z);
    return {speed, y: t.y, z: t.z};
  }

  /**
   * Advances obstacles + Rapier world one fixed timestep and synchronizes Three.js
   * object transforms and collision events.
   */
  step(dt: number, isBallDynamicSync: boolean): void {
    if (!this.world) return;
    this.world.timestep = dt;

    for (const obs of this.obstacles) {
      const spd = obs.spec.speed ?? 1.8;
      obs.phase += dt * spd;
      const obsYaw = this.arenaYaw + (obs.spec.yawY ?? 0);
      const axisX = Math.cos(obsYaw);
      const axisZ = -Math.sin(obsYaw);

      if (obs.spec.kind === 'dwarf') {
        const range = obs.spec.patrolRadius ?? 0.14;
        const offsetX = Math.sin(obs.phase) * range;
        const nx = obs.baseWorldPos.x + axisX * offsetX;
        const ny = obs.baseWorldPos.y;
        const nz = obs.baseWorldPos.z + axisZ * offsetX;
        obs.currentWorldPos.set(nx, ny, nz);
        obs.body.setNextKinematicTranslation({x: nx, y: ny + 0.062, z: nz});
        _euler.set(0, obsYaw, 0);
        _quat.setFromEuler(_euler);
        obs.body.setNextKinematicRotation({
          x: _quat.x,
          y: _quat.y,
          z: _quat.z,
          w: _quat.w,
        });
        if (obs.mesh) {
          const dirSign = Math.cos(obs.phase) >= 0 ? 1 : -1;
          const localObsYaw = obs.spec.yawY ?? 0;
          const localAxisX = Math.cos(localObsYaw);
          const localAxisZ = -Math.sin(localObsYaw);
          obs.mesh.position.set(
            obs.spec.x + localAxisX * offsetX,
            obs.spec.y,
            obs.spec.z + localAxisZ * offsetX
          );
          obs.mesh.rotation.set(0, localObsYaw + dirSign * 0.28, 0, 'YXZ');
        }
      } else if (obs.spec.kind === 'bumper') {
        const angle = obsYaw + obs.phase;
        _euler.set(0, angle, 0);
        _quat.setFromEuler(_euler);
        obs.body.setNextKinematicRotation({
          x: _quat.x,
          y: _quat.y,
          z: _quat.z,
          w: _quat.w,
        });
        if (obs.mesh) {
          obs.mesh.position.set(obs.spec.x, obs.spec.y, obs.spec.z);
          obs.mesh.rotation.set(0, (obs.spec.yawY ?? 0) + obs.phase, 0, 'YXZ');
        }
      } else if (obs.spec.kind === 'movingGate') {
        // Predictable sinusoidal portcullis rise & lower
        const lift = (Math.sin(obs.phase) * 0.5 + 0.5) * 0.095;
        const ny = obs.baseWorldPos.y + 0.025 + lift;
        obs.currentWorldPos.set(obs.baseWorldPos.x, ny, obs.baseWorldPos.z);
        obs.body.setNextKinematicTranslation({
          x: obs.baseWorldPos.x,
          y: ny,
          z: obs.baseWorldPos.z,
        });
        _euler.set(0, obsYaw, 0);
        _quat.setFromEuler(_euler);
        obs.body.setNextKinematicRotation({
          x: _quat.x,
          y: _quat.y,
          z: _quat.z,
          w: _quat.w,
        });
        if (obs.mesh) {
          obs.mesh.position.set(obs.spec.x, obs.spec.y, obs.spec.z);
          obs.mesh.rotation.set(0, obs.spec.yawY ?? 0, 0, 'YXZ');
        }
        if (obs.gateBarMesh) {
          obs.gateBarMesh.position.y = 0.025 + lift;
        }
      } else {
        // slidingBarrier
        const range = obs.spec.patrolRadius ?? 0.13;
        const offsetX = Math.sin(obs.phase) * range;
        const nx = obs.baseWorldPos.x + axisX * offsetX;
        const nz = obs.baseWorldPos.z + axisZ * offsetX;
        obs.currentWorldPos.set(nx, obs.baseWorldPos.y, nz);
        obs.body.setNextKinematicTranslation({
          x: nx,
          y: obs.baseWorldPos.y + 0.032,
          z: nz,
        });
        _euler.set(0, obsYaw, 0);
        _quat.setFromEuler(_euler);
        obs.body.setNextKinematicRotation({
          x: _quat.x,
          y: _quat.y,
          z: _quat.z,
          w: _quat.w,
        });
        if (obs.mesh) {
          const localObsYaw = obs.spec.yawY ?? 0;
          const localAxisX = Math.cos(localObsYaw);
          const localAxisZ = -Math.sin(localObsYaw);
          obs.mesh.position.set(
            obs.spec.x + localAxisX * offsetX,
            obs.spec.y,
            obs.spec.z + localAxisZ * offsetX
          );
          obs.mesh.rotation.set(0, localObsYaw, 0, 'YXZ');
        }
      }
    }

    if (this.eventQueue) {
      this.world.step(this.eventQueue);
    } else {
      this.world.step();
    }

    if (this.ballBody && this.ballMesh && isBallDynamicSync && this.ballBodyDynamic) {
      const t = this.ballBody.translation();
      const r = this.ballBody.rotation();
      this.syncMeshFromWorldPose(this.ballMesh, t.x, t.y, t.z, r.x, r.y, r.z, r.w);
    }

    for (const pin of this.pins) {
      if (!pin.body.isEnabled() || !pin.mesh) continue;
      const t = pin.body.translation();
      const r = pin.body.rotation();
      this.syncMeshFromWorldPose(pin.mesh, t.x, t.y, t.z, r.x, r.y, r.z, r.w);
    }

    if (this.eventQueue && this.callbacks) {
      this.eventQueue.drainCollisionEvents((h1, h2, started) => {
        if (!started) return;
        const tag1 = this.colliderTags.get(h1);
        const tag2 = this.colliderTags.get(h2);
        if (!tag1 || !tag2) return;

        const involvesBall = tag1 === 'ball' || tag2 === 'ball';
        const involvesPin = tag1 === 'pin' || tag2 === 'pin';
        const involvesDwarf = tag1 === 'dwarf' || tag2 === 'dwarf';
        const involvesRail = tag1 === 'rail' || tag2 === 'rail';
        const involvesBumper = tag1 === 'bumper' || tag2 === 'bumper';
        const involvesGate = tag1 === 'movingGate' || tag2 === 'movingGate';
        const involvesBarrier =
          tag1 === 'slidingBarrier' || tag2 === 'slidingBarrier';
        const involvesGround = tag1 === 'ground' || tag2 === 'ground';

        if (this.ballBody) {
          const bt = this.ballBody.translation();
          const bv = this.ballBody.linvel();
          const speed = Math.hypot(bv.x, bv.y, bv.z);
          _tmpVec.set(bt.x, bt.y, bt.z);

          if (involvesBall && involvesDwarf) {
            const dwarfObs = this.obstacles.find((o) =>
              o.colliderHandles.includes(tag1 === 'dwarf' ? h1 : h2)
            );
            this.callbacks?.onDwarfHit(
              dwarfObs ? dwarfObs.currentWorldPos : _tmpVec
            );
          } else if (
            involvesBall &&
            (involvesBumper || involvesGate || involvesBarrier)
          ) {
            const hitTag: CollisionTag = involvesBumper
              ? 'bumper'
              : involvesGate
                ? 'movingGate'
                : 'slidingBarrier';
            this.callbacks?.onObstacleHit(_tmpVec, hitTag);
          } else if (involvesPin && (involvesBall || speed > 0.25)) {
            const pin = this.pins.find((p) =>
              p.colliderHandles.includes(tag1 === 'pin' ? h1 : h2)
            );
            if (pin) {
              const pt = pin.body.translation();
              _tmpVec.set(pt.x, pt.y, pt.z);
            }
            this.callbacks?.onPinImpact(_tmpVec, speed);
          } else if (
            involvesBall &&
            (involvesRail || (involvesGround && speed > 0.35))
          ) {
            this.callbacks?.onRailHit(_tmpVec);
          }
        }
      });
    }
  }

  evaluateFallenPins(minYThreshold: number): {
    newlyFallen: number;
    totalFallen: number;
    anyPinMoving: boolean;
  } {
    let newlyFallen = 0;
    let totalFallen = 0;
    let anyPinMoving = false;

    for (const pin of this.pins) {
      if (pin.fallen) {
        totalFallen++;
        continue;
      }

      const r = pin.body.rotation();
      const t = pin.body.translation();
      _quat.set(r.x, r.y, r.z, r.w);
      _pinUp.copy(_up).applyQuaternion(_quat);

      const v = pin.body.linvel();
      const av = pin.body.angvel();
      const motion =
        Math.hypot(v.x, v.y, v.z) + Math.hypot(av.x, av.y, av.z) * 0.08;
      if (motion > 0.14) {
        anyPinMoving = true;
      }

      const tippedOver = _pinUp.y < 0.68;
      const droppedOffDeck = t.y < pin.initialPos.y - 0.14;
      const fellOffTable = t.y < minYThreshold;

      if (tippedOver || droppedOffDeck || fellOffTable) {
        pin.fallen = true;
        newlyFallen++;
        totalFallen++;
      }
    }

    return {newlyFallen, totalFallen, anyPinMoving};
  }

  clearLevel(): void {
    if (!this.world) return;
    for (const body of this.staticBodies) {
      this.world.removeRigidBody(body);
    }
    this.staticBodies = [];

    if (this.ballBody) {
      this.world.removeRigidBody(this.ballBody);
      this.ballBody = null;
      this.ballColliderHandle = null;
    }

    for (const pin of this.pins) {
      this.world.removeRigidBody(pin.body);
    }
    this.pins = [];

    for (const obs of this.obstacles) {
      this.world.removeRigidBody(obs.body);
    }
    this.obstacles = [];

    this.colliderTags.clear();
    if (this.groundColliderHandle !== null) {
      this.colliderTags.set(this.groundColliderHandle, 'ground');
    }
  }

  dispose(): void {
    this.clearLevel();
    if (this.world && this.groundBody) {
      this.world.removeRigidBody(this.groundBody);
    }
    this.groundBody = null;
    this.groundColliderHandle = null;
    this.colliderTags.clear();
    if (this.eventQueue) {
      this.eventQueue.free();
      this.eventQueue = null;
    }
    if (this.world) {
      this.world.free();
      this.world = null;
    }
  }
}

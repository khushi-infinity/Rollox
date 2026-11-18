import RAPIER from '@dimforge/rapier3d-simd-compat';
import * as THREE from 'three';
import * as xb from 'xrblocks';

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
  | 'deck'
  | 'ground';

export interface PhysicsPinEntity {
  index: number;
  body: RAPIER.RigidBody;
  colliderHandles: number[];
  mesh: THREE.Object3D;
  fallen: boolean;
  initialPos: THREE.Vector3;
}

export interface PhysicsObstacleEntity {
  spec: ObstacleSpec;
  body: RAPIER.RigidBody;
  colliderHandles: number[];
  mesh: THREE.Object3D;
  phase: number;
  baseWorldPos: THREE.Vector3;
  currentWorldPos: THREE.Vector3;
}

export interface CollisionCallback {
  onPinImpact: (worldPos: THREE.Vector3, speed: number) => void;
  onDwarfHit: (worldPos: THREE.Vector3) => void;
  onRailHit: (worldPos: THREE.Vector3) => void;
}

const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const _quat = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);
const _pinUp = new THREE.Vector3();
const _tmpVec = new THREE.Vector3();

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
  private callbacks?: CollisionCallback;
  private ballBodyDynamic = false;

  get isReady(): boolean {
    return this.world !== null;
  }

  init(physics: xb.Physics, callbacks?: CollisionCallback): void {
    this.world = physics.blendedWorld as unknown as RAPIER.World;
    this.eventQueue = physics.eventQueue as unknown as RAPIER.EventQueue;
    this.callbacks = callbacks;
  }

  /**
   * Creates a fixed Rapier trimesh ground plane collider directly from the
   * provided Three.js ground plane mesh so fallen balls/pins collide with the floor.
   */
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

  setArenaOffset(offset: THREE.Vector3): void {
    this.arenaOffset.copy(offset);
  }

  buildLevelPhysics(
    level: LevelConfig,
    ballMesh: THREE.Object3D,
    pinMeshes: THREE.Object3D[],
    obstacleMeshes: Map<string, THREE.Object3D>
  ): void {
    this.clearLevel();
    if (!this.world) return;

    this.ballMesh = ballMesh;

    // 1. Fixed lane segments, rails & backstop
    for (const seg of level.segments) {
      const wx = this.arenaOffset.x + seg.x;
      const wy = this.arenaOffset.y + seg.y;
      const wz = this.arenaOffset.z + seg.z;

      _euler.set(seg.pitchX ?? 0, seg.yawY ?? 0, 0, 'YXZ');
      _quat.setFromEuler(_euler);

      const segBody = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed()
          .setTranslation(wx, wy, wz)
          .setRotation({
            x: _quat.x,
            y: _quat.y,
            z: _quat.z,
            w: _quat.w,
          })
      );
      this.staticBodies.push(segBody);

      // Deck slab collider (top surface at local y = 0)
      const deckCol = this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(
          seg.width / 2,
          LANE_DECK_THICKNESS / 2,
          seg.length / 2
        )
          .setTranslation(0, -LANE_DECK_THICKNESS / 2, 0)
          .setFriction(0.14)
          .setRestitution(0.25),
        segBody
      );
      this.colliderTags.set(deckCol.handle, 'deck');

      if (seg.hasRails !== false) {
        const railH = 0.036;
        const railW = 0.022;
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
    const backBody = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(
        this.arenaOffset.x + level.pinDeck.x,
        this.arenaOffset.y + level.pinDeck.y + 0.06,
        this.arenaOffset.z + level.pinDeck.z - 0.32
      )
    );
    this.staticBodies.push(backBody);
    const backCol = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.28, 0.07, 0.025)
        .setFriction(0.4)
        .setRestitution(0.35),
      backBody
    );
    this.colliderTags.set(backCol.handle, 'rail');

    // 2. Dynamic Bowling Ball (starts kinematic/resting on pedestal until launched)
    this.createOrResetBall(new THREE.Vector3(0, BALL_RADIUS, 0));

    // 3. Dynamic Bowling Pins
    const placements = generatePinFormation(level.pinFormation, level.pinDeck);
    for (let i = 0; i < placements.length; i++) {
      const p = placements[i];
      const mesh = pinMeshes[i];
      if (!mesh) continue;
      const worldPos = new THREE.Vector3(
        this.arenaOffset.x + p.x,
        this.arenaOffset.y + p.y + 0.0605,
        this.arenaOffset.z + p.z
      );

      const pinBody = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(worldPos.x, worldPos.y, worldPos.z)
          .setCcdEnabled(true)
          .setLinearDamping(0.35)
          .setAngularDamping(0.42)
      );

      const baseCol = this.world.createCollider(
        RAPIER.ColliderDesc.cylinder(0.024, 0.0185)
          .setTranslation(0, -0.036, 0)
          .setDensity(3.6)
          .setFriction(0.55)
          .setRestitution(0.22)
          .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
        pinBody
      );
      const neckCol = this.world.createCollider(
        RAPIER.ColliderDesc.cylinder(0.044, 0.0135)
          .setTranslation(0, 0.025, 0)
          .setDensity(0.95)
          .setFriction(0.42)
          .setRestitution(0.32)
          .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
        pinBody
      );
      this.colliderTags.set(baseCol.handle, 'pin');
      this.colliderTags.set(neckCol.handle, 'pin');

      this.pins.push({
        index: i,
        body: pinBody,
        colliderHandles: [baseCol.handle, neckCol.handle],
        mesh,
        fallen: false,
        initialPos: worldPos.clone(),
      });
    }

    // 4. Kinematic Obstacles (Dwarf & Rotating Bumper)
    for (const obs of level.obstacles) {
      const mesh = obstacleMeshes.get(obs.id);
      if (!mesh) continue;

      const baseWorldPos = new THREE.Vector3(
        this.arenaOffset.x + obs.x,
        this.arenaOffset.y + obs.y,
        this.arenaOffset.z + obs.z
      );

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
      } else {
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

    const wx = this.arenaOffset.x + localPos.x;
    const wy = this.arenaOffset.y + localPos.y;
    const wz = this.arenaOffset.z + localPos.z;

    const desc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
      wx,
      wy,
      wz
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
    // Recreate as dynamic with CCD enabled for clean crisp launch
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
        .setLinearDamping(0.18)
        .setAngularDamping(0.22)
    );
    const col = this.world.createCollider(
      RAPIER.ColliderDesc.ball(BALL_RADIUS)
        .setDensity(3.4)
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
      this.ballMesh.position.set(
        this.arenaOffset.x + localPos.x,
        this.arenaOffset.y + localPos.y,
        this.arenaOffset.z + localPos.z
      );
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
      pin.mesh.visible = false;
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

  stepObstaclesAndSync(dt: number, isRollingOrAiming: boolean): void {
    for (const obs of this.obstacles) {
      const spd = obs.spec.speed ?? 1.8;
      obs.phase += dt * spd;

      if (obs.spec.kind === 'dwarf') {
        const range = obs.spec.patrolRadius ?? 0.14;
        const offsetX = Math.sin(obs.phase) * range;
        const nx = obs.baseWorldPos.x + offsetX;
        const ny = obs.baseWorldPos.y;
        const nz = obs.baseWorldPos.z;
        obs.currentWorldPos.set(nx, ny, nz);
        obs.body.setNextKinematicTranslation({x: nx, y: ny + 0.062, z: nz});
        // Face direction of movement slightly while keeping shield angled forward
        const dirSign = Math.cos(obs.phase) >= 0 ? 1 : -1;
        obs.mesh.position.set(nx, ny, nz);
        obs.mesh.rotation.y = dirSign * 0.28;
      } else {
        const angle = obs.phase;
        _euler.set(0, angle, 0);
        _quat.setFromEuler(_euler);
        obs.body.setNextKinematicRotation({
          x: _quat.x,
          y: _quat.y,
          z: _quat.z,
          w: _quat.w,
        });
        obs.mesh.position.set(
          obs.baseWorldPos.x,
          obs.baseWorldPos.y,
          obs.baseWorldPos.z
        );
        obs.mesh.quaternion.copy(_quat);
      }
    }

    if (this.ballBody && this.ballMesh && isRollingOrAiming && this.ballBodyDynamic) {
      const t = this.ballBody.translation();
      const r = this.ballBody.rotation();
      this.ballMesh.position.set(t.x, t.y, t.z);
      this.ballMesh.quaternion.set(r.x, r.y, r.z, r.w);
    }

    for (const pin of this.pins) {
      if (!pin.body.isEnabled()) continue;
      const t = pin.body.translation();
      const r = pin.body.rotation();
      pin.mesh.position.set(t.x, t.y, t.z);
      pin.mesh.quaternion.set(r.x, r.y, r.z, r.w);
    }

    // Drain collision events for tactile sound & particle VFX
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
            (involvesRail || involvesBumper || (involvesGround && speed > 0.35))
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
      const fellOffTable = t.y < minYThreshold;

      if (tippedOver || fellOffTable) {
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
    this.world = null;
    this.eventQueue = null;
  }
}

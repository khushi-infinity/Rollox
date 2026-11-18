import * as THREE from 'three';
import {afterEach, describe, expect, it} from 'vitest';

import {
  BALL_RADIUS,
  CAMPAIGN_LEVELS,
  appendWorkshopSegment,
  compileWorkshopLevel,
  computeLaunchParameters,
  createDefaultWorkshopLayout,
} from './levels';
import {BowlingWorld, type CollisionTag} from './physics/BowlingWorld';
import type {LevelConfig} from './types';

function makeGroundMesh(): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(16, 16, 4, 4);
  geo.rotateX(-Math.PI / 2);
  return new THREE.Mesh(geo, new THREE.MeshBasicMaterial());
}

function makeObstacleVisuals(level: LevelConfig): Map<
  string,
  {root: THREE.Object3D | null; gateBar?: THREE.Object3D | null}
> {
  const map = new Map<
    string,
    {root: THREE.Object3D | null; gateBar?: THREE.Object3D | null}
  >();
  for (const obs of level.obstacles) {
    const root = new THREE.Group();
    if (obs.kind === 'movingGate') {
      const gateBar = new THREE.Group();
      root.add(gateBar);
      map.set(obs.id, {root, gateBar});
    } else {
      map.set(obs.id, {root});
    }
  }
  return map;
}

function stepSeconds(
  world: BowlingWorld,
  seconds: number,
  dt = 1 / 90
): void {
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i++) {
    world.step(dt, true);
  }
}

describe('Rapier3D BowlingWorld Physics Audit', () => {
  const worlds: BowlingWorld[] = [];

  afterEach(() => {
    while (worlds.length > 0) {
      worlds.pop()?.dispose();
    }
  });

  it('builds all 5 campaign levels with exact pin/obstacle counts and ground trimesh', async () => {
    const bw = new BowlingWorld();
    worlds.push(bw);
    await bw.init();
    const ground = makeGroundMesh();
    bw.setGroundPlaneCollisionMesh(ground);
    bw.setArenaOffset(new THREE.Vector3(0, 0.94, -0.48), 0);

    const expectedObstacles = [0, 0, 0, 1, 2];
    for (let i = 0; i < CAMPAIGN_LEVELS.length; i++) {
      const lvl = CAMPAIGN_LEVELS[i];
      const ballMesh = new THREE.Group();
      const pinMeshes = Array.from({length: 10}, () => new THREE.Group());
      const obsVisuals = makeObstacleVisuals(lvl);

      bw.buildLevelPhysics(lvl, ballMesh, pinMeshes, obsVisuals);
      expect(bw.pins).toHaveLength(10);
      expect(bw.obstacles).toHaveLength(expectedObstacles[i]);
      expect(bw.pins.every((p) => !p.fallen)).toBe(true);
    }
  });

  it('knocks down pins cleanly on Level 1 (Meadow Straight) and Level 3 (Skybridge Ramp)', async () => {
    const bw = new BowlingWorld();
    worlds.push(bw);
    await bw.init();
    bw.setGroundPlaneCollisionMesh(makeGroundMesh());
    const arenaOrigin = new THREE.Vector3(0, 0.94, -0.48);
    bw.setArenaOffset(arenaOrigin, 0);

    for (const lvlIdx of [0, 2]) {
      const lvl = CAMPAIGN_LEVELS[lvlIdx];
      const ballMesh = new THREE.Group();
      const pinMeshes = Array.from({length: 10}, () => new THREE.Group());
      bw.buildLevelPhysics(lvl, ballMesh, pinMeshes, makeObstacleVisuals(lvl));

      // Let pins settle for 0.3s and verify none fall spontaneously
      stepSeconds(bw, 0.3);
      const preShot = bw.evaluateFallenPins(arenaOrigin.y - 0.25);
      expect(preShot.totalFallen).toBe(0);

      // Strong centered launch
      const launch = computeLaunchParameters(0, 0.22, 'smooth');
      bw.launchBall(
        new THREE.Vector3(arenaOrigin.x, arenaOrigin.y + BALL_RADIUS, arenaOrigin.z),
        new THREE.Vector3(launch.velocity.x, launch.velocity.y, launch.velocity.z),
        new THREE.Vector3(launch.spin.x, launch.spin.y, launch.spin.z)
      );

      stepSeconds(bw, 1.8);
      const afterShot = bw.evaluateFallenPins(arenaOrigin.y - 0.25);
      expect(afterShot.totalFallen).toBeGreaterThanOrEqual(4);
    }
  });

  it('allows an angled bank shot on Level 2 (Serpent Zigzag) to traverse seams without catching', async () => {
    const bw = new BowlingWorld();
    worlds.push(bw);
    await bw.init();
    bw.setGroundPlaneCollisionMesh(makeGroundMesh());
    const arenaOrigin = new THREE.Vector3(0, 0.94, -0.48);
    bw.setArenaOffset(arenaOrigin, 0);

    const lvl2 = CAMPAIGN_LEVELS[1];
    const ballMesh = new THREE.Group();
    const pinMeshes = Array.from({length: 10}, () => new THREE.Group());
    bw.buildLevelPhysics(lvl2, ballMesh, pinMeshes, makeObstacleVisuals(lvl2));

    stepSeconds(bw, 0.25);
    expect(bw.evaluateFallenPins(arenaOrigin.y - 0.25).totalFallen).toBe(0);

    // Pull slightly right (+X) to bank left down zig-left and curve back right into the pins
    const launch = computeLaunchParameters(0.038, 0.22, 'linear');
    bw.launchBall(
      new THREE.Vector3(arenaOrigin.x, arenaOrigin.y + BALL_RADIUS, arenaOrigin.z),
      new THREE.Vector3(launch.velocity.x, launch.velocity.y, launch.velocity.z),
      new THREE.Vector3(launch.spin.x, launch.spin.y, launch.spin.z)
    );

    const ballPos = new THREE.Vector3();
    let minLocalZ = 0;
    for (let i = 0; i < 200; i++) {
      bw.step(1 / 90, true);
      bw.getBallWorldState(ballPos);
      minLocalZ = Math.min(minLocalZ, ballPos.z - arenaOrigin.z);
    }

    // Ball must reach the pin deck zone (local z <= -1.3) rather than getting trapped at a seam
    expect(minLocalZ).toBeLessThan(-1.3);
    const res = bw.evaluateFallenPins(arenaOrigin.y - 0.25);
    expect(res.totalFallen).toBeGreaterThanOrEqual(1);
  });

  it('syncs all 4 kinematic obstacle bodies & meshes along rotated arenaYaw and prevents gate tunneling', async () => {
    const bw = new BowlingWorld();
    worlds.push(bw);
    const hitTags: CollisionTag[] = [];
    let dwarfHit = false;
    await bw.init({
      onPinImpact: () => {},
      onDwarfHit: () => {
        dwarfHit = true;
      },
      onObstacleHit: (_pos, tag) => {
        hitTags.push(tag);
      },
      onRailHit: () => {},
    });

    const arenaYaw = Math.PI / 4; // 45 deg seated recenter
    const arenaOrigin = new THREE.Vector3(0.25, 0.94, -0.5);
    bw.setArenaOffset(arenaOrigin, arenaYaw);

    const testLevel: LevelConfig = {
      id: 'obstacle-audit',
      index: 99,
      name: 'Obstacle Audit',
      subtitle: 'All 4 Obstacles',
      hint: '',
      layout: 'custom',
      maxShots: 4,
      pinFormation: 'crown6',
      pinDeck: {x: 0, y: 0, z: -1.6},
      segments: [
        {
          id: 'lane',
          x: 0,
          y: 0,
          z: -0.8,
          width: 0.5,
          length: 1.9,
          hasRails: true,
        },
      ],
      obstacles: [
        {id: 'obs-gate', kind: 'movingGate', x: 0, y: 0, z: -0.42, speed: 0.0},
        {id: 'obs-dwarf', kind: 'dwarf', x: 0, y: 0, z: -0.7, patrolRadius: 0.14, speed: 2.0},
        {id: 'obs-bumper', kind: 'bumper', x: 0, y: 0, z: -0.95, radius: 0.12, speed: 2.0},
        {id: 'obs-barrier', kind: 'slidingBarrier', x: 0, y: 0, z: -1.2, patrolRadius: 0.12, speed: 2.0},
      ],
      accentColor: '#38bdf8',
    };

    const tableRoot = new THREE.Group();
    tableRoot.position.copy(arenaOrigin);
    tableRoot.rotation.set(0, arenaYaw, 0);

    const obsVisuals = makeObstacleVisuals(testLevel);
    for (const v of obsVisuals.values()) {
      if (v.root) tableRoot.add(v.root);
    }
    const pinMeshes = Array.from({length: 6}, () => new THREE.Group());
    bw.buildLevelPhysics(testLevel, new THREE.Group(), pinMeshes, obsVisuals);

    // Phase=0 for movingGate => lift = (0*0.5+0.5)*0.095 = 0.0475, bar y = arenaOrigin.y + 0.0725
    // Actually move speed=0 won't lower the gate; set phase just past -PI/2 so bar is lowered (y = 0.025)
    bw.obstacles[0].phase = -Math.PI / 2;
    stepSeconds(bw, 0.4);
    tableRoot.updateMatrixWorld(true);

    // Check mesh-to-physics sync for all 4 obstacles in world space through tableRoot
    const [gate, dwarf, bumper, barrier] = bw.obstacles;
    expect(gate.gateBarMesh?.position.y).toBeCloseTo(
      gate.body.translation().y - arenaOrigin.y,
      3
    );
    const dwarfWorldPos = new THREE.Vector3();
    dwarf.mesh?.getWorldPosition(dwarfWorldPos);
    expect(dwarfWorldPos.x).toBeCloseTo(dwarf.body.translation().x, 4);
    expect(dwarfWorldPos.z).toBeCloseTo(dwarf.body.translation().z, 4);

    const barrierWorldPos = new THREE.Vector3();
    barrier.mesh?.getWorldPosition(barrierWorldPos);
    expect(barrierWorldPos.x).toBeCloseTo(barrier.body.translation().x, 4);
    expect(barrierWorldPos.z).toBeCloseTo(barrier.body.translation().z, 4);

    const bumperWorldQuat = new THREE.Quaternion();
    bumper.mesh?.getWorldQuaternion(bumperWorldQuat);
    expect(Math.abs(bumperWorldQuat.y - bumper.body.rotation().y)).toBeLessThan(0.01);

    // Fire high-speed ball directly at lowered gate along rotated arenaYaw; CCD must deflect, not tunnel
    const forward = new THREE.Vector3(0, 0, -3.8).applyAxisAngle(
      new THREE.Vector3(0, 1, 0),
      arenaYaw
    );
    bw.launchBall(
      new THREE.Vector3(arenaOrigin.x, arenaOrigin.y + BALL_RADIUS, arenaOrigin.z),
      forward,
      new THREE.Vector3(0, 0, 0)
    );
    stepSeconds(bw, 0.35);

    expect(hitTags).toContain('movingGate');
    // Ball local Z relative to rotated arena must NOT have passed cleanly behind gate at z=-0.42
    const ballWorld = new THREE.Vector3();
    bw.getBallWorldState(ballWorld);
    const localBall = ballWorld
      .clone()
      .sub(arenaOrigin)
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), -arenaYaw);
    expect(localBall.z).toBeGreaterThan(-0.43);
    expect(dwarfHit).toBe(false);
  });

  it('respects Workshop railsEnabled toggle, rotated pinDeckYaw, and pin/ball resets', async () => {
    const bw = new BowlingWorld();
    worlds.push(bw);
    await bw.init();
    bw.setGroundPlaneCollisionMesh(makeGroundMesh());
    const arenaOrigin = new THREE.Vector3(0, 0.94, -0.48);
    bw.setArenaOffset(arenaOrigin, 0);

    // Custom workshop layout with 2 left turns and rails OFF
    let ws = createDefaultWorkshopLayout();
    ws = {
      ...ws,
      obstacles: [],
      segments: [ws.segments[0]],
      railsEnabled: false,
    };
    ws = appendWorkshopSegment(ws, 'leftTurn');
    ws = appendWorkshopSegment(ws, 'leftTurn');
    const levelNoRails = compileWorkshopLevel(ws);
    expect(levelNoRails.pinDeckYaw).toBeGreaterThan(0.6);

    bw.buildLevelPhysics(
      levelNoRails,
      new THREE.Group(),
      Array.from({length: 10}, () => new THREE.Group()),
      makeObstacleVisuals(levelNoRails)
    );

    // Angled shot with rails OFF should roll right off the deck onto lower ground
    bw.launchBall(
      new THREE.Vector3(arenaOrigin.x, arenaOrigin.y + BALL_RADIUS, arenaOrigin.z),
      new THREE.Vector3(1.4, 0, -1.6),
      new THREE.Vector3(0, 0, 0)
    );
    stepSeconds(bw, 0.7);
    const ballState = bw.getBallWorldState(new THREE.Vector3());
    expect(ballState.y).toBeLessThan(arenaOrigin.y - 0.1);

    // Now test standing/fallen pin reset & hideFallenPins
    bw.buildLevelPhysics(
      CAMPAIGN_LEVELS[0],
      new THREE.Group(),
      Array.from({length: 10}, () => new THREE.Group()),
      makeObstacleVisuals(CAMPAIGN_LEVELS[0])
    );
    bw.launchBall(
      new THREE.Vector3(arenaOrigin.x, arenaOrigin.y + BALL_RADIUS, arenaOrigin.z),
      new THREE.Vector3(0, 0, -3.5),
      new THREE.Vector3(0, 0, 0)
    );
    stepSeconds(bw, 1.4);
    const evalRes = bw.evaluateFallenPins(arenaOrigin.y - 0.25);
    expect(evalRes.totalFallen).toBeGreaterThan(0);

    bw.hideFallenPins();
    bw.resetStandingPins();
    bw.resetBallToPedestal(new THREE.Vector3(0, BALL_RADIUS, 0));

    for (const p of bw.pins) {
      if (p.fallen) {
        expect(p.body.isEnabled()).toBe(false);
        expect(p.mesh?.visible).toBe(false);
      } else {
        expect(p.body.isEnabled()).toBe(true);
        expect(p.body.translation().y).toBeCloseTo(p.initialPos.y, 3);
      }
    }
    const resetBall = bw.getBallWorldState(new THREE.Vector3());
    expect(resetBall.speed).toBe(0);
    expect(resetBall.z).toBeCloseTo(arenaOrigin.z, 3);
  });
});

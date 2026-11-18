import {createSystem} from '@iwsdk/core';
import * as THREE from 'three';

import {RolloxAudio} from '../audio';
import type {DwarfRig} from '../geometry';
import {BowlingWorld, type CollisionTag} from '../physics/BowlingWorld';
import {ParticleBurstPool} from '../vfx';

const FIXED_STEP = 1 / 90;
const MAX_FRAME_DT = 0.05;
const MAX_SUBSTEPS = 5;

/**
 * IWSDK ECS System driving Rapier3D physics simulation, collision audio/VFX,
 * animated dwarf obstacle limbs, floating fantasy motes, and ball trails.
 */
export class RolloxPhysicsSystem extends createSystem({}) {
  public readonly bowlingWorld = new BowlingWorld();
  public readonly vfx = new ParticleBurstPool();
  public readonly audio = new RolloxAudio();

  private accumulator = 0;
  private simulationActive = true;
  private ballDynamicSync = false;
  private dwarfRigs: DwarfRig[] = [];
  private simTime = 0;
  private ready = false;
  private readyPromise: Promise<void> | null = null;
  private ballPosBuf = new THREE.Vector3();

  init(): void {
    this.vfx.name = 'RolloxVFXPool';
    this.scene.add(this.vfx);

    this.readyPromise = this.bowlingWorld
      .init({
        onPinImpact: (worldPos, speed) => {
          const strength = Math.min(1, Math.max(0.25, speed / 2.6));
          this.audio.playPinHit(strength);
          this.vfx.emitBurst(
            worldPos,
            8,
            [0xfde047, 0xfb923c, 0xfef3c7],
            0.95,
            0.78
          );
        },
        onDwarfHit: (worldPos) => {
          this.audio.playDwarfBonk();
          this.vfx.emitBurst(
            worldPos,
            14,
            [0xfb7185, 0xfbbf24, 0xffffff],
            1.35,
            0.95
          );
          const now = performance.now();
          for (const rig of this.dwarfRigs) {
            rig.hitFlashUntil = now + 260;
          }
        },
        onObstacleHit: (worldPos, _tag: CollisionTag) => {
          this.audio.playObstacleClang();
          this.vfx.emitBurst(
            worldPos,
            10,
            [0x38bdf8, 0xfbbf24, 0xffffff],
            1.15,
            0.85
          );
        },
        onRailHit: (worldPos) => {
          this.audio.playRailTap();
          this.vfx.emitBurst(worldPos, 5, [0x7dd3fc, 0xbae6fd], 0.65, 0.55);
        },
      })
      .then(() => {
        this.ready = true;
      });

    this.cleanupFuncs.push(() => {
      this.vfx.removeFromParent();
      this.vfx.dispose();
      this.bowlingWorld.dispose();
      this.audio.dispose();
    });
  }

  async ensureReady(): Promise<void> {
    if (this.ready) return;
    if (this.readyPromise) await this.readyPromise;
  }

  get isReady(): boolean {
    return this.ready;
  }

  setSimulationActive(active: boolean): void {
    this.simulationActive = active;
  }

  setBallDynamicSync(dynamicSync: boolean): void {
    this.ballDynamicSync = dynamicSync;
  }

  setArenaOrigin(origin: THREE.Vector3, yawRad = 0): void {
    this.bowlingWorld.setArenaOffset(origin, yawRad);
    this.vfx.setArenaOrigin(origin);
  }

  registerDwarfRig(rig: DwarfRig): void {
    this.dwarfRigs.push(rig);
  }

  clearDwarfRigs(): void {
    this.dwarfRigs = [];
  }

  update(delta: number): void {
    const dt = Math.min(MAX_FRAME_DT, Math.max(0.0001, delta));
    this.vfx.tick(dt);

    if (!this.ready || !this.simulationActive) return;

    this.simTime += dt;

    // Animate dwarf legs & hammer swing in sync with patrol
    const nowMs = performance.now();
    for (const rig of this.dwarfRigs) {
      const stride = Math.sin(this.simTime * 11) * 0.45;
      rig.leftLeg.rotation.x = stride;
      rig.rightLeg.rotation.x = -stride;
      rig.hammerArm.rotation.x = Math.sin(this.simTime * 6) * 0.25;
      if (nowMs < rig.hitFlashUntil) {
        rig.root.scale.setScalar(1 + 0.14 * Math.sin(nowMs * 0.06));
      } else {
        rig.root.scale.setScalar(1);
      }
    }

    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= FIXED_STEP && steps < MAX_SUBSTEPS) {
      this.bowlingWorld.step(FIXED_STEP, this.ballDynamicSync);
      this.accumulator -= FIXED_STEP;
      steps++;
    }

    if (this.ballDynamicSync) {
      const {speed} = this.bowlingWorld.getBallWorldState(this.ballPosBuf);
      if (speed > 0.35) {
        this.vfx.emitTrail(this.ballPosBuf, dt);
        this.audio.updateRollingRumble(speed, true);
      }
    }
  }
}

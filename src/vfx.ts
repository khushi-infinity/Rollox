import * as THREE from 'three';

const POOL_SIZE = 120;
const _dummy = new THREE.Object3D();
const _color = new THREE.Color();

interface ParticleState {
  active: boolean;
  life: number;
  maxLife: number;
  px: number;
  py: number;
  pz: number;
  vx: number;
  vy: number;
  vz: number;
  scale: number;
  rx: number;
  ry: number;
  vrx: number;
  vry: number;
}

/**
 * Zero-GC pooled InstancedMesh particle bursts for pin strikes, ball launches,
 * and dwarf shield deflections.
 */
export class ParticleBurstPool extends THREE.Group {
  private mesh: THREE.InstancedMesh;
  private particles: ParticleState[] = [];
  private cursor = 0;

  constructor() {
    super();
    this.name = 'Rollox VFX Pool';
    this.xb = {pointerEvents: 'none'};

    const geometry = new THREE.OctahedronGeometry(0.012, 0);
    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.3,
      metalness: 0.2,
      emissive: 0x332200,
      emissiveIntensity: 0.35,
    });
    this.mesh = new THREE.InstancedMesh(geometry, material, POOL_SIZE);
    this.mesh.frustumCulled = false;
    this.mesh.xb = {pointerEvents: 'none'};

    for (let i = 0; i < POOL_SIZE; i++) {
      this.particles.push({
        active: false,
        life: 0,
        maxLife: 1,
        px: 0,
        py: -10,
        pz: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        scale: 0,
        rx: 0,
        ry: 0,
        vrx: 0,
        vry: 0,
      });
      _dummy.position.set(0, -10, 0);
      _dummy.scale.setScalar(0);
      _dummy.updateMatrix();
      this.mesh.setMatrixAt(i, _dummy.matrix);
      _color.setHex(0xfbbf24);
      this.mesh.setColorAt(i, _color);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.add(this.mesh);
  }

  emitBurst(
    origin: THREE.Vector3,
    count: number,
    palette: number[],
    speed = 1.2,
    baseScale = 1
  ): void {
    let colorDirty = false;
    for (let n = 0; n < count; n++) {
      const idx = this.cursor;
      this.cursor = (this.cursor + 1) % POOL_SIZE;
      const p = this.particles[idx];

      const theta = Math.random() * Math.PI * 2;
      const upBias = 0.4 + Math.random() * 0.85;
      const spd = speed * (0.45 + Math.random() * 0.8);

      p.active = true;
      p.life = 0;
      p.maxLife = 0.42 + Math.random() * 0.42;
      p.px = origin.x + (Math.random() - 0.5) * 0.04;
      p.py = origin.y + Math.random() * 0.04;
      p.pz = origin.z + (Math.random() - 0.5) * 0.04;
      p.vx = Math.cos(theta) * spd * 0.7;
      p.vy = upBias * spd;
      p.vz = Math.sin(theta) * spd * 0.7;
      p.scale = baseScale * (0.65 + Math.random() * 0.7);
      p.rx = Math.random() * Math.PI;
      p.ry = Math.random() * Math.PI;
      p.vrx = (Math.random() - 0.5) * 14;
      p.vry = (Math.random() - 0.5) * 14;

      const hex = palette[n % palette.length];
      _color.setHex(hex);
      this.mesh.setColorAt(idx, _color);
      colorDirty = true;
    }
    if (colorDirty && this.mesh.instanceColor) {
      this.mesh.instanceColor.needsUpdate = true;
    }
  }

  tick(dt: number): void {
    let anyActive = false;
    const gravity = -3.8;
    for (let i = 0; i < POOL_SIZE; i++) {
      const p = this.particles[i];
      if (!p.active) continue;
      anyActive = true;
      p.life += dt;
      if (p.life >= p.maxLife) {
        p.active = false;
        _dummy.position.set(0, -10, 0);
        _dummy.scale.setScalar(0);
        _dummy.updateMatrix();
        this.mesh.setMatrixAt(i, _dummy.matrix);
        continue;
      }

      p.vy += gravity * dt;
      p.px += p.vx * dt;
      p.py += p.vy * dt;
      p.pz += p.vz * dt;
      p.rx += p.vrx * dt;
      p.ry += p.vry * dt;

      const t = p.life / p.maxLife;
      const s = p.scale * (1 - t * t);
      _dummy.position.set(p.px, p.py, p.pz);
      _dummy.rotation.set(p.rx, p.ry, 0);
      _dummy.scale.setScalar(Math.max(0.001, s));
      _dummy.updateMatrix();
      this.mesh.setMatrixAt(i, _dummy.matrix);
    }
    if (anyActive) {
      this.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

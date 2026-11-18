import * as THREE from 'three';

const POOL_SIZE = 140;
const MOTES_COUNT = 26;
const TRAIL_SIZE = 24;

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

interface AmbientMote {
  baseX: number;
  baseY: number;
  baseZ: number;
  phase: number;
  speed: number;
  radius: number;
}

/**
 * Zero-GC pooled InstancedMesh particle bursts, rolling trail sparks,
 * and subtle floating fantasy motes around the miniature alley.
 */
export class ParticleBurstPool extends THREE.Group {
  private burstMesh: THREE.InstancedMesh;
  private particles: ParticleState[] = [];
  private cursor = 0;

  private trailMesh: THREE.InstancedMesh;
  private trailParticles: ParticleState[] = [];
  private trailCursor = 0;
  private trailCooldown = 0;
  private chargeCooldown = 0;

  private motesMesh: THREE.InstancedMesh;
  private motes: AmbientMote[] = [];
  private moteOrigin = new THREE.Vector3();
  private moteClock = 0;
  private moteTickParity = 0;
  private lowLagMode = false;

  constructor() {
    super();
    this.name = 'Rollox VFX Pool';

    const burstGeo = new THREE.OctahedronGeometry(0.012, 0);
    const burstMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.3,
      metalness: 0.2,
      emissive: 0x332200,
      emissiveIntensity: 0.4,
    });
    this.burstMesh = new THREE.InstancedMesh(burstGeo, burstMat, POOL_SIZE);
    this.burstMesh.frustumCulled = false;

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
      this.burstMesh.setMatrixAt(i, _dummy.matrix);
      _color.setHex(0xfbbf24);
      this.burstMesh.setColorAt(i, _color);
    }
    this.burstMesh.instanceMatrix.needsUpdate = true;
    if (this.burstMesh.instanceColor) this.burstMesh.instanceColor.needsUpdate = true;
    this.add(this.burstMesh);

    // Ball motion trail sparks
    const trailGeo = new THREE.SphereGeometry(0.0085, 8, 6);
    const trailMat = new THREE.MeshBasicMaterial({
      color: 0x7dd3fc,
      transparent: true,
      opacity: 0.72,
    });
    this.trailMesh = new THREE.InstancedMesh(trailGeo, trailMat, TRAIL_SIZE);
    this.trailMesh.frustumCulled = false;
    for (let i = 0; i < TRAIL_SIZE; i++) {
      this.trailParticles.push({
        active: false,
        life: 0,
        maxLife: 0.35,
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
      this.trailMesh.setMatrixAt(i, _dummy.matrix);
    }
    this.trailMesh.instanceMatrix.needsUpdate = true;
    this.add(this.trailMesh);

    // Subtle enchanted motes floating over the miniature alley
    const moteGeo = new THREE.OctahedronGeometry(0.005, 0);
    const moteMat = new THREE.MeshBasicMaterial({
      color: 0xfef08a,
      transparent: true,
      opacity: 0.65,
    });
    this.motesMesh = new THREE.InstancedMesh(moteGeo, moteMat, MOTES_COUNT);
    this.motesMesh.frustumCulled = false;
    for (let i = 0; i < MOTES_COUNT; i++) {
      this.motes.push({
        baseX: (Math.random() - 0.5) * 0.65,
        baseY: 0.08 + Math.random() * 0.32,
        baseZ: -Math.random() * 1.65,
        phase: Math.random() * Math.PI * 2,
        speed: 0.55 + Math.random() * 0.6,
        radius: 0.02 + Math.random() * 0.025,
      });
    }
    this.add(this.motesMesh);
  }

  setArenaOrigin(origin: THREE.Vector3): void {
    this.moteOrigin.copy(origin);
  }

  setLowLagMode(lowLag: boolean): void {
    this.lowLagMode = lowLag;
    this.motesMesh.visible = !lowLag;
  }

  emitTrail(pos: THREE.Vector3, dt: number): void {
    this.trailCooldown -= dt;
    if (this.trailCooldown > 0) return;
    this.trailCooldown = 0.026;

    const idx = this.trailCursor;
    this.trailCursor = (this.trailCursor + 1) % TRAIL_SIZE;
    const p = this.trailParticles[idx];
    p.active = true;
    p.life = 0;
    p.maxLife = 0.28;
    p.px = pos.x + (Math.random() - 0.5) * 0.015;
    p.py = pos.y - 0.012 + Math.random() * 0.015;
    p.pz = pos.z + (Math.random() - 0.5) * 0.015;
    p.vx = 0;
    p.vy = 0.05;
    p.vz = 0;
    p.scale = 0.9;
  }

  emitChargeSpark(pos: THREE.Vector3, power01: number, dt: number): void {
    this.chargeCooldown -= dt;
    const interval = Math.max(0.032, 0.095 - power01 * 0.055);
    if (this.chargeCooldown > 0) return;
    this.chargeCooldown = interval;

    const idx = this.cursor;
    this.cursor = (this.cursor + 1) % POOL_SIZE;
    const p = this.particles[idx];
    const angle = Math.random() * Math.PI * 2;
    const radius = 0.048 + power01 * 0.025;

    p.active = true;
    p.life = 0;
    p.maxLife = 0.28 + Math.random() * 0.14;
    p.px = pos.x + Math.cos(angle) * radius;
    p.py = pos.y - 0.01 + Math.random() * 0.025;
    p.pz = pos.z + Math.sin(angle) * radius;
    p.vx = -Math.sin(angle) * 0.18;
    p.vy = 0.35 + power01 * 0.45;
    p.vz = Math.cos(angle) * 0.18;
    p.scale = 0.35 + power01 * 0.3;
    p.rx = Math.random() * Math.PI;
    p.ry = Math.random() * Math.PI;
    p.vrx = 6;
    p.vry = 8;

    const hex =
      power01 < 0.35 ? 0x38bdf8 : power01 < 0.72 ? 0x4ade80 : 0xfde047;
    _color.setHex(hex);
    this.burstMesh.setColorAt(idx, _color);
    if (this.burstMesh.instanceColor) {
      this.burstMesh.instanceColor.needsUpdate = true;
    }
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
      this.burstMesh.setColorAt(idx, _color);
      colorDirty = true;
    }
    if (colorDirty && this.burstMesh.instanceColor) {
      this.burstMesh.instanceColor.needsUpdate = true;
    }
  }

  tick(dt: number): void {
    let anyBurstActive = false;
    const gravity = -3.8;
    for (let i = 0; i < POOL_SIZE; i++) {
      const p = this.particles[i];
      if (!p.active) continue;
      anyBurstActive = true;
      p.life += dt;
      if (p.life >= p.maxLife) {
        p.active = false;
        _dummy.position.set(0, -10, 0);
        _dummy.scale.setScalar(0);
        _dummy.updateMatrix();
        this.burstMesh.setMatrixAt(i, _dummy.matrix);
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
      this.burstMesh.setMatrixAt(i, _dummy.matrix);
    }
    if (anyBurstActive) {
      this.burstMesh.instanceMatrix.needsUpdate = true;
    }

    let anyTrailActive = false;
    for (let i = 0; i < TRAIL_SIZE; i++) {
      const p = this.trailParticles[i];
      if (!p.active) continue;
      anyTrailActive = true;
      p.life += dt;
      if (p.life >= p.maxLife) {
        p.active = false;
        _dummy.position.set(0, -10, 0);
        _dummy.scale.setScalar(0);
        _dummy.updateMatrix();
        this.trailMesh.setMatrixAt(i, _dummy.matrix);
        continue;
      }
      p.py += p.vy * dt;
      const s = p.scale * (1 - p.life / p.maxLife);
      _dummy.position.set(p.px, p.py, p.pz);
      _dummy.rotation.set(0, 0, 0);
      _dummy.scale.setScalar(Math.max(0.001, s));
      _dummy.updateMatrix();
      this.trailMesh.setMatrixAt(i, _dummy.matrix);
    }
    if (anyTrailActive) {
      this.trailMesh.instanceMatrix.needsUpdate = true;
    }

    // Subtle floating fantasy motes (throttled and skippable in low-lag mode)
    if (!this.lowLagMode && this.motesMesh.visible) {
      this.moteClock += dt;
      this.moteTickParity = (this.moteTickParity + 1) & 1;
      if (this.moteTickParity === 0) {
        for (let i = 0; i < MOTES_COUNT; i++) {
          const m = this.motes[i];
          const t = this.moteClock * m.speed + m.phase;
          _dummy.position.set(
            this.moteOrigin.x + m.baseX + Math.sin(t) * m.radius,
            this.moteOrigin.y + m.baseY + Math.cos(t * 1.3) * (m.radius * 0.7),
            this.moteOrigin.z + m.baseZ + Math.cos(t * 0.8) * m.radius
          );
          _dummy.rotation.set(t, t * 0.7, 0);
          _dummy.scale.setScalar(0.65 + 0.35 * Math.sin(t * 2));
          _dummy.updateMatrix();
          this.motesMesh.setMatrixAt(i, _dummy.matrix);
        }
        this.motesMesh.instanceMatrix.needsUpdate = true;
      }
    }
  }

  dispose(): void {
    this.burstMesh.geometry.dispose();
    (this.burstMesh.material as THREE.Material).dispose();
    this.trailMesh.geometry.dispose();
    (this.trailMesh.material as THREE.Material).dispose();
    this.motesMesh.geometry.dispose();
    (this.motesMesh.material as THREE.Material).dispose();
  }
}

import * as THREE from 'three';

import {
  BALL_RADIUS,
  LANE_DECK_THICKNESS,
  PIN_BASE_RADIUS,
  PIN_HEIGHT,
} from './levels';
import type {LaneSegmentSpec} from './types';

export interface ProceduralAssets {
  laneTexture: THREE.CanvasTexture;
  ballTexture: THREE.CanvasTexture;
  pinTexture: THREE.CanvasTexture;
  woodDarkMat: THREE.MeshStandardMaterial;
  laneMat: THREE.MeshStandardMaterial;
  brassMat: THREE.MeshStandardMaterial;
  stoneMat: THREE.MeshStandardMaterial;
  ballMat: THREE.MeshPhysicalMaterial;
  pinMat: THREE.MeshPhysicalMaterial;
  glowMat: THREE.MeshStandardMaterial;
  pinGeometry: THREE.LatheGeometry;
  ballGeometry: THREE.SphereGeometry;
  dispose: () => void;
}

function createLaneCanvasTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#c88c4b';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const numPlanks = 12;
  const plankW = canvas.width / numPlanks;
  for (let i = 0; i < numPlanks; i++) {
    const shade = (i % 3) * 8 - 8;
    ctx.fillStyle = `rgb(${202 + shade}, ${142 + shade}, ${78 + shade})`;
    ctx.fillRect(i * plankW, 0, plankW - 1, canvas.height);

    ctx.strokeStyle = 'rgba(110, 62, 24, 0.14)';
    ctx.lineWidth = 1.5;
    for (let g = 0; g < 6; g++) {
      const gx = i * plankW + ((g + 0.5) / 6) * plankW;
      ctx.beginPath();
      ctx.moveTo(gx, 0);
      ctx.bezierCurveTo(
        gx + 3,
        340,
        gx - 3,
        680,
        gx + (g % 2 ? 2 : -2),
        canvas.height
      );
      ctx.stroke();
    }

    ctx.fillStyle = 'rgba(85, 45, 16, 0.3)';
    ctx.fillRect(i * plankW, 0, 1.5, canvas.height);
  }

  // Aiming chevrons
  ctx.fillStyle = 'rgba(105, 46, 16, 0.45)';
  const centerX = canvas.width / 2;
  for (let i = -3; i <= 3; i++) {
    const cx = centerX + i * 44;
    const cy = 620 + Math.abs(i) * 34;
    ctx.beginPath();
    ctx.moveTo(cx, cy - 16);
    ctx.lineTo(cx + 12, cy + 8);
    ctx.lineTo(cx, cy + 2);
    ctx.lineTo(cx - 12, cy + 8);
    ctx.closePath();
    ctx.fill();
  }

  // Approach foul line
  ctx.fillStyle = 'rgba(138, 36, 26, 0.55)';
  ctx.fillRect(0, 960, canvas.width, 14);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

function createBallCanvasTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  const grad = ctx.createLinearGradient(0, 0, 512, 256);
  grad.addColorStop(0, '#1e3a8a');
  grad.addColorStop(0.5, '#0f766e');
  grad.addColorStop(1, '#312e81');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 256);

  for (let i = 0; i < 18; i++) {
    ctx.strokeStyle =
      i % 2 === 0 ? 'rgba(56, 189, 248, 0.35)' : 'rgba(251, 191, 36, 0.28)';
    ctx.lineWidth = 4 + (i % 5) * 3;
    ctx.beginPath();
    const y0 = (i / 18) * 256;
    ctx.moveTo(0, y0);
    ctx.bezierCurveTo(170, y0 + 48, 340, y0 - 48, 512, y0);
    ctx.stroke();
  }

  ctx.fillStyle = '#090d1a';
  for (const [dx, dy, r] of [
    [256, 92, 11],
    [232, 122, 9],
    [280, 122, 9],
  ]) {
    ctx.beginPath();
    ctx.arc(dx, dy, r, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

function createPinCanvasTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#f8f2e6';
  ctx.fillRect(0, 0, 256, 256);

  ctx.fillStyle = '#d9c6a3';
  ctx.fillRect(0, 232, 256, 24);

  ctx.fillStyle = '#dc2626';
  ctx.fillRect(0, 58, 256, 18);
  ctx.fillRect(0, 86, 256, 12);
  ctx.fillStyle = '#eab308';
  ctx.fillRect(0, 78, 256, 4);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

function createPinLatheGeometry(): THREE.LatheGeometry {
  const pts: THREE.Vector2[] = [
    new THREE.Vector2(0.0, 0.0),
    new THREE.Vector2(0.72 * PIN_BASE_RADIUS, 0.0),
    new THREE.Vector2(0.88 * PIN_BASE_RADIUS, 0.08 * PIN_HEIGHT),
    new THREE.Vector2(1.02 * PIN_BASE_RADIUS, 0.25 * PIN_HEIGHT),
    new THREE.Vector2(1.0 * PIN_BASE_RADIUS, 0.38 * PIN_HEIGHT),
    new THREE.Vector2(0.76 * PIN_BASE_RADIUS, 0.56 * PIN_HEIGHT),
    new THREE.Vector2(0.46 * PIN_BASE_RADIUS, 0.72 * PIN_HEIGHT),
    new THREE.Vector2(0.56 * PIN_BASE_RADIUS, 0.85 * PIN_HEIGHT),
    new THREE.Vector2(0.54 * PIN_BASE_RADIUS, 0.94 * PIN_HEIGHT),
    new THREE.Vector2(0.32 * PIN_BASE_RADIUS, 0.985 * PIN_HEIGHT),
    new THREE.Vector2(0.0, PIN_HEIGHT),
  ];
  const geo = new THREE.LatheGeometry(pts, 24);
  geo.computeVertexNormals();
  return geo;
}

export function createProceduralAssets(
  maxAnisotropy = 4
): ProceduralAssets {
  const laneTexture = createLaneCanvasTexture(maxAnisotropy);
  const ballTexture = createBallCanvasTexture(maxAnisotropy);
  const pinTexture = createPinCanvasTexture(maxAnisotropy);

  const woodDarkMat = new THREE.MeshStandardMaterial({
    color: 0x4b2e1b,
    roughness: 0.72,
    metalness: 0.05,
  });

  const laneMat = new THREE.MeshStandardMaterial({
    map: laneTexture,
    roughness: 0.26,
    metalness: 0.08,
  });

  const brassMat = new THREE.MeshStandardMaterial({
    color: 0xd4a145,
    roughness: 0.28,
    metalness: 0.85,
  });

  const stoneMat = new THREE.MeshStandardMaterial({
    color: 0x4a5568,
    roughness: 0.85,
    metalness: 0.05,
  });

  const ballMat = new THREE.MeshPhysicalMaterial({
    map: ballTexture,
    roughness: 0.14,
    metalness: 0.12,
    clearcoat: 1.0,
    clearcoatRoughness: 0.08,
  });

  const pinMat = new THREE.MeshPhysicalMaterial({
    map: pinTexture,
    roughness: 0.28,
    metalness: 0.04,
    clearcoat: 0.6,
    clearcoatRoughness: 0.2,
  });

  const glowMat = new THREE.MeshStandardMaterial({
    color: 0x7dd3fc,
    emissive: 0x38bdf8,
    emissiveIntensity: 1.2,
    roughness: 0.2,
    metalness: 0.1,
  });

  const pinGeometry = createPinLatheGeometry();
  const ballGeometry = new THREE.SphereGeometry(BALL_RADIUS, 32, 24);

  return {
    laneTexture,
    ballTexture,
    pinTexture,
    woodDarkMat,
    laneMat,
    brassMat,
    stoneMat,
    ballMat,
    pinMat,
    glowMat,
    pinGeometry,
    ballGeometry,
    dispose: () => {
      laneTexture.dispose();
      ballTexture.dispose();
      pinTexture.dispose();
      woodDarkMat.dispose();
      laneMat.dispose();
      brassMat.dispose();
      stoneMat.dispose();
      ballMat.dispose();
      pinMat.dispose();
      glowMat.dispose();
      pinGeometry.dispose();
      ballGeometry.dispose();
    },
  };
}

export function createBowlingBallMesh(assets: ProceduralAssets): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Rollox Bowling Ball';

  const sphere = new THREE.Mesh(assets.ballGeometry, assets.ballMat);
  sphere.castShadow = true;
  sphere.receiveShadow = true;
  group.add(sphere);

  return group;
}

export function createBowlingPinMesh(
  assets: ProceduralAssets,
  index: number
): THREE.Group {
  const group = new THREE.Group();
  group.name = `Bowling Pin ${index + 1}`;

  const body = new THREE.Mesh(assets.pinGeometry, assets.pinMat);
  body.position.y = -PIN_HEIGHT * 0.42;
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  const footRing = new THREE.Mesh(
    new THREE.TorusGeometry(PIN_BASE_RADIUS * 0.78, 0.0018, 8, 20),
    assets.brassMat
  );
  footRing.rotation.x = Math.PI / 2;
  footRing.position.y = -PIN_HEIGHT * 0.42 + 0.002;
  group.add(footRing);

  return group;
}

export function createLaneSegmentMesh(
  spec: LaneSegmentSpec,
  assets: ProceduralAssets,
  disposables: Array<{dispose: () => void}>,
  highlighted = false
): THREE.Group {
  const group = new THREE.Group();
  group.name = `Lane Segment ${spec.id}`;
  group.position.set(spec.x, spec.y, spec.z);
  group.rotation.set(spec.pitchX ?? 0, spec.yawY ?? 0, 0, 'YXZ');

  const deckGeo = new THREE.BoxGeometry(
    spec.width,
    LANE_DECK_THICKNESS,
    spec.length
  );
  disposables.push(deckGeo);
  const deck = new THREE.Mesh(deckGeo, assets.laneMat);
  deck.position.y = -LANE_DECK_THICKNESS / 2;
  deck.receiveShadow = true;
  deck.castShadow = true;
  group.add(deck);

  const apronGeo = new THREE.BoxGeometry(
    spec.width + 0.036,
    LANE_DECK_THICKNESS * 0.85,
    spec.length + 0.01
  );
  disposables.push(apronGeo);
  const apron = new THREE.Mesh(apronGeo, assets.woodDarkMat);
  apron.position.y = -LANE_DECK_THICKNESS * 0.65;
  apron.receiveShadow = true;
  apron.castShadow = true;
  group.add(apron);

  if (spec.hasRails !== false) {
    const railH = 0.032;
    const railW = 0.022;
    const railGeo = new THREE.BoxGeometry(railW, railH, spec.length);
    const trimGeo = new THREE.BoxGeometry(railW * 0.55, 0.005, spec.length);
    disposables.push(railGeo, trimGeo);

    for (const side of [-1, 1]) {
      const rx = side * (spec.width / 2 + railW * 0.45);
      const rail = new THREE.Mesh(railGeo, assets.woodDarkMat);
      rail.position.set(rx, railH / 2 - 0.004, 0);
      rail.castShadow = true;
      rail.receiveShadow = true;
      group.add(rail);

      const trim = new THREE.Mesh(trimGeo, assets.brassMat);
      trim.position.set(rx, railH - 0.002, 0);
      group.add(trim);
    }
  }

  if (spec.y > 0.02) {
    const legH = spec.y;
    const legGeo = new THREE.CylinderGeometry(0.02, 0.026, legH, 10);
    disposables.push(legGeo);
    for (const sx of [-1, 1]) {
      for (const sz of [-0.35, 0.35]) {
        const leg = new THREE.Mesh(legGeo, assets.stoneMat);
        leg.position.set(
          sx * (spec.width * 0.42),
          -LANE_DECK_THICKNESS - legH / 2,
          sz * spec.length
        );
        leg.castShadow = true;
        group.add(leg);
      }
    }
  }

  if (highlighted) {
    const outlineGeo = new THREE.BoxGeometry(
      spec.width + 0.055,
      LANE_DECK_THICKNESS + 0.02,
      spec.length + 0.02
    );
    const outlineMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      wireframe: true,
      transparent: true,
      opacity: 0.75,
    });
    disposables.push(outlineGeo, outlineMat);
    const outline = new THREE.Mesh(outlineGeo, outlineMat);
    outline.position.y = -LANE_DECK_THICKNESS * 0.4;
    group.add(outline);
  }

  return group;
}

export function createPinDeckBackdrop(
  deckPos: {x: number; y: number; z: number},
  accentColor: string,
  assets: ProceduralAssets,
  disposables: Array<{dispose: () => void}>
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Pin Deck Fantasy Arch';
  group.position.set(deckPos.x, deckPos.y, deckPos.z - 0.24);

  const archMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(accentColor),
    emissive: new THREE.Color(accentColor),
    emissiveIntensity: 0.7,
    roughness: 0.3,
  });
  disposables.push(archMat);

  const backGeo = new THREE.BoxGeometry(0.5, 0.11, 0.045);
  disposables.push(backGeo);
  const backWall = new THREE.Mesh(backGeo, assets.woodDarkMat);
  backWall.position.set(0, 0.055, -0.08);
  backWall.castShadow = true;
  backWall.receiveShadow = true;
  group.add(backWall);

  const pillarGeo = new THREE.BoxGeometry(0.048, 0.24, 0.048);
  const capGeo = new THREE.CylinderGeometry(0.032, 0.036, 0.02, 8);
  const lanternGeo = new THREE.OctahedronGeometry(0.018, 0);
  disposables.push(pillarGeo, capGeo, lanternGeo);

  for (const side of [-1, 1]) {
    const pillar = new THREE.Mesh(pillarGeo, assets.stoneMat);
    pillar.position.set(side * 0.23, 0.12, 0);
    pillar.castShadow = true;
    group.add(pillar);

    const cap = new THREE.Mesh(capGeo, assets.brassMat);
    cap.position.set(side * 0.23, 0.245, 0);
    group.add(cap);

    const lantern = new THREE.Mesh(lanternGeo, archMat);
    lantern.position.set(side * 0.23, 0.28, 0);
    group.add(lantern);
  }

  const lintelGeo = new THREE.TorusGeometry(0.23, 0.02, 8, 24, Math.PI);
  const gemGeo = new THREE.OctahedronGeometry(0.025, 0);
  disposables.push(lintelGeo, gemGeo);

  const lintel = new THREE.Mesh(lintelGeo, assets.woodDarkMat);
  lintel.position.set(0, 0.24, 0);
  lintel.castShadow = true;
  group.add(lintel);

  const keystone = new THREE.Mesh(gemGeo, archMat);
  keystone.position.set(0, 0.47, 0);
  group.add(keystone);

  return group;
}

export interface DwarfRig {
  root: THREE.Group;
  leftLeg: THREE.Mesh;
  rightLeg: THREE.Mesh;
  shieldArm: THREE.Group;
  hammerArm: THREE.Group;
  hitFlashUntil: number;
}

export function createDwarfCharacterMesh(
  disposables: Array<{dispose: () => void}>
): DwarfRig {
  const root = new THREE.Group();
  root.name = 'Barnaby the Dwarf Guardian';

  const skinMat = new THREE.MeshStandardMaterial({
    color: 0xf4bfa0,
    roughness: 0.65,
  });
  const tunicMat = new THREE.MeshStandardMaterial({
    color: 0xb91c1c,
    roughness: 0.72,
  });
  const beardMat = new THREE.MeshStandardMaterial({
    color: 0xd97706,
    roughness: 0.85,
  });
  const ironMat = new THREE.MeshStandardMaterial({
    color: 0x94a3b8,
    roughness: 0.28,
    metalness: 0.85,
  });
  const shieldWoodMat = new THREE.MeshStandardMaterial({
    color: 0x78350f,
    roughness: 0.6,
  });
  const bootMat = new THREE.MeshStandardMaterial({
    color: 0x292524,
    roughness: 0.8,
  });
  disposables.push(
    skinMat,
    tunicMat,
    beardMat,
    ironMat,
    shieldWoodMat,
    bootMat
  );

  const legGeo = new THREE.CapsuleGeometry(0.013, 0.018, 4, 8);
  const torsoGeo = new THREE.CylinderGeometry(0.026, 0.032, 0.056, 12);
  const beltGeo = new THREE.CylinderGeometry(0.033, 0.033, 0.012, 12);
  const headGeo = new THREE.SphereGeometry(0.024, 14, 12);
  const beardGeo = new THREE.ConeGeometry(0.024, 0.044, 10);
  const helmetGeo = new THREE.SphereGeometry(
    0.026,
    14,
    10,
    0,
    Math.PI * 2,
    0,
    Math.PI * 0.55
  );
  const hornGeo = new THREE.ConeGeometry(0.006, 0.022, 8);
  const shieldGeo = new THREE.CylinderGeometry(0.034, 0.034, 0.01, 16);
  const shieldBossGeo = new THREE.SphereGeometry(0.01, 10, 8);
  const hammerHandleGeo = new THREE.CylinderGeometry(0.004, 0.004, 0.055, 8);
  const hammerHeadGeo = new THREE.BoxGeometry(0.024, 0.016, 0.016);
  disposables.push(
    legGeo,
    torsoGeo,
    beltGeo,
    headGeo,
    beardGeo,
    helmetGeo,
    hornGeo,
    shieldGeo,
    shieldBossGeo,
    hammerHandleGeo,
    hammerHeadGeo
  );

  const leftLeg = new THREE.Mesh(legGeo, bootMat);
  leftLeg.position.set(-0.014, 0.018, 0);
  leftLeg.castShadow = true;
  root.add(leftLeg);

  const rightLeg = new THREE.Mesh(legGeo, bootMat);
  rightLeg.position.set(0.014, 0.018, 0);
  rightLeg.castShadow = true;
  root.add(rightLeg);

  const torso = new THREE.Mesh(torsoGeo, tunicMat);
  torso.position.y = 0.06;
  torso.castShadow = true;
  root.add(torso);

  const belt = new THREE.Mesh(beltGeo, bootMat);
  belt.position.y = 0.048;
  root.add(belt);

  const head = new THREE.Mesh(headGeo, skinMat);
  head.position.y = 0.104;
  head.castShadow = true;
  root.add(head);

  const beard = new THREE.Mesh(beardGeo, beardMat);
  beard.rotation.x = Math.PI;
  beard.position.set(0, 0.082, 0.016);
  root.add(beard);

  const helmet = new THREE.Mesh(helmetGeo, ironMat);
  helmet.position.y = 0.107;
  helmet.castShadow = true;
  root.add(helmet);

  for (const side of [-1, 1]) {
    const horn = new THREE.Mesh(hornGeo, beardMat);
    horn.position.set(side * 0.025, 0.125, 0);
    horn.rotation.z = -side * 0.65;
    root.add(horn);
  }

  const shieldArm = new THREE.Group();
  shieldArm.position.set(-0.032, 0.068, 0.018);
  const shield = new THREE.Mesh(shieldGeo, shieldWoodMat);
  shield.rotation.x = Math.PI / 2;
  shield.castShadow = true;
  const shieldBoss = new THREE.Mesh(shieldBossGeo, ironMat);
  shieldBoss.position.z = 0.006;
  shieldArm.add(shield, shieldBoss);
  root.add(shieldArm);

  const hammerArm = new THREE.Group();
  hammerArm.position.set(0.036, 0.072, 0.01);
  const handle = new THREE.Mesh(hammerHandleGeo, shieldWoodMat);
  handle.position.y = 0.02;
  const hammerHead = new THREE.Mesh(hammerHeadGeo, ironMat);
  hammerHead.position.y = 0.045;
  hammerArm.add(handle, hammerHead);
  root.add(hammerArm);

  return {root, leftLeg, rightLeg, shieldArm, hammerArm, hitFlashUntil: 0};
}

export function createRotatingBumperMesh(
  radius: number,
  assets: ProceduralAssets,
  disposables: Array<{dispose: () => void}>
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Rotating Rune Bumper';

  const hubGeo = new THREE.CylinderGeometry(0.024, 0.03, 0.055, 16);
  const capGeo = new THREE.OctahedronGeometry(0.022, 0);
  const armGeo = new THREE.BoxGeometry(radius * 2, 0.024, 0.022);
  disposables.push(hubGeo, capGeo, armGeo);

  const hub = new THREE.Mesh(hubGeo, assets.brassMat);
  hub.position.y = 0.028;
  hub.castShadow = true;
  group.add(hub);

  const gem = new THREE.Mesh(capGeo, assets.glowMat);
  gem.position.y = 0.068;
  group.add(gem);

  const armA = new THREE.Mesh(armGeo, assets.woodDarkMat);
  armA.position.y = 0.032;
  armA.castShadow = true;
  group.add(armA);

  const armB = new THREE.Mesh(armGeo, assets.woodDarkMat);
  armB.rotation.y = Math.PI / 2;
  armB.position.y = 0.032;
  armB.castShadow = true;
  group.add(armB);

  return group;
}

export interface MovingGateRig {
  root: THREE.Group;
  gateBar: THREE.Group;
}

/** Builds a vertical rising/lowering fantasy rune portcullis gate obstacle. */
export function createMovingGateMesh(
  assets: ProceduralAssets,
  disposables: Array<{dispose: () => void}>
): MovingGateRig {
  const root = new THREE.Group();
  root.name = 'Moving Rune Gate';

  const postGeo = new THREE.BoxGeometry(0.026, 0.16, 0.026);
  const lintelGeo = new THREE.BoxGeometry(0.32, 0.022, 0.03);
  const barGeo = new THREE.BoxGeometry(0.24, 0.044, 0.024);
  const runeGeo = new THREE.OctahedronGeometry(0.015, 0);
  disposables.push(postGeo, lintelGeo, barGeo, runeGeo);

  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(postGeo, assets.stoneMat);
    post.position.set(side * 0.15, 0.08, 0);
    post.castShadow = true;
    root.add(post);
  }
  const lintel = new THREE.Mesh(lintelGeo, assets.woodDarkMat);
  lintel.position.set(0, 0.165, 0);
  lintel.castShadow = true;
  root.add(lintel);

  const gateBar = new THREE.Group();
  gateBar.position.set(0, 0.035, 0);
  const bar = new THREE.Mesh(barGeo, assets.brassMat);
  bar.castShadow = true;
  const rune = new THREE.Mesh(runeGeo, assets.glowMat);
  rune.position.set(0, 0.028, 0.014);
  gateBar.add(bar, rune);
  root.add(gateBar);

  return {root, gateBar};
}

/** Builds a horizontal sliding stone & brass barrier block obstacle. */
export function createSlidingBarrierMesh(
  assets: ProceduralAssets,
  disposables: Array<{dispose: () => void}>
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Sliding Rune Barrier';

  const blockGeo = new THREE.BoxGeometry(0.11, 0.062, 0.042);
  const capGeo = new THREE.BoxGeometry(0.116, 0.012, 0.048);
  const coreGeo = new THREE.OctahedronGeometry(0.016, 0);
  disposables.push(blockGeo, capGeo, coreGeo);

  const block = new THREE.Mesh(blockGeo, assets.stoneMat);
  block.position.y = 0.032;
  block.castShadow = true;
  block.receiveShadow = true;
  group.add(block);

  const cap = new THREE.Mesh(capGeo, assets.brassMat);
  cap.position.y = 0.066;
  cap.castShadow = true;
  group.add(cap);

  const core = new THREE.Mesh(coreGeo, assets.glowMat);
  core.position.y = 0.084;
  group.add(core);

  return group;
}

export function createGroundPlaneMesh(
  width = 16,
  depth = 16,
  segments = 4
): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(width, depth, segments, segments);
  geometry.rotateX(-Math.PI / 2);
  geometry.computeVertexNormals();

  const material = new THREE.ShadowMaterial({
    color: 0x000000,
    opacity: 0.28,
  });

  const groundMesh = new THREE.Mesh(geometry, material);
  groundMesh.name = 'GroundPlaneCollisionMesh';
  groundMesh.position.set(0, 0, 0);
  groundMesh.receiveShadow = true;
  return groundMesh;
}

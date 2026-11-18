import type {
  CampaignProgress,
  GameSettings,
  LaneSegmentSpec,
  LevelConfig,
  ObstacleKind,
  ObstacleSpec,
  PinFormation,
  PinPlacement,
  PowerCurveMode,
  ShotOutcome,
  WorkshopDifficulty,
  WorkshopLayout,
  WorkshopModuleKind,
  WorkshopObstacleNode,
  WorkshopSegmentNode,
  WorkshopValidationResult,
} from './types';

export const ARENA_TABLE_Y = 0.94;
export const ARENA_ORIGIN_Z = -0.48;
export const BALL_RADIUS = 0.042;
export const PIN_HEIGHT = 0.14;
export const PIN_BASE_RADIUS = 0.021;
export const LANE_DECK_THICKNESS = 0.036;

export const MAX_PULL_DISTANCE = 0.24;
export const MIN_LAUNCH_POWER = 0.08;
export const MAX_LATERAL_PULL = 0.2;

export const DEFAULT_SETTINGS: GameSettings = {
  volume: 0.85,
  muted: false,
  powerCurve: 'smooth',
  showTrajectory: true,
  heightOffset: 0,
  distanceOffset: 0,
  uiScale: 1.0,
  lowLagMode: false,
};

export const DEFAULT_PROGRESS: CampaignProgress = {
  unlockedLevelIndex: 0,
  completedLevels: [],
  bestScores: {},
  bestStars: {},
  onboardingCompleted: false,
};

export interface WorkshopModuleMetadata {
  kind: WorkshopModuleKind;
  label: string;
  width: number;
  length: number;
  elevationDelta: number;
  yawDelta: number;
  pitchX: number;
}

export const WORKSHOP_MODULE_CATALOG: Record<
  WorkshopModuleKind,
  WorkshopModuleMetadata
> = {
  straight: {
    kind: 'straight',
    label: 'Straight',
    width: 0.42,
    length: 0.44,
    elevationDelta: 0,
    yawDelta: 0,
    pitchX: 0,
  },
  short: {
    kind: 'short',
    label: 'Short',
    width: 0.42,
    length: 0.26,
    elevationDelta: 0,
    yawDelta: 0,
    pitchX: 0,
  },
  leftTurn: {
    kind: 'leftTurn',
    label: 'Left Turn',
    width: 0.42,
    length: 0.44,
    elevationDelta: 0,
    yawDelta: 0.34,
    pitchX: 0,
  },
  rightTurn: {
    kind: 'rightTurn',
    label: 'Right Turn',
    width: 0.42,
    length: 0.44,
    elevationDelta: 0,
    yawDelta: -0.34,
    pitchX: 0,
  },
  zigzag: {
    kind: 'zigzag',
    label: 'Zigzag',
    width: 0.44,
    length: 0.46,
    elevationDelta: 0,
    yawDelta: -0.28,
    pitchX: 0,
  },
  rampUp: {
    kind: 'rampUp',
    label: 'Ramp Up',
    width: 0.4,
    length: 0.4,
    elevationDelta: 0.085,
    yawDelta: 0,
    pitchX: 0.215,
  },
  rampDown: {
    kind: 'rampDown',
    label: 'Ramp Down',
    width: 0.4,
    length: 0.4,
    elevationDelta: -0.085,
    yawDelta: 0,
    pitchX: -0.215,
  },
  elevatedBridge: {
    kind: 'elevatedBridge',
    label: 'Elevated Bridge',
    width: 0.38,
    length: 0.42,
    elevationDelta: 0,
    yawDelta: 0,
    pitchX: 0,
  },
};

export function generatePinFormation(
  formation: PinFormation,
  deck: {x: number; y: number; z: number},
  yawY = 0
): PinPlacement[] {
  const spacingX = 0.074;
  const spacingZ = 0.066;
  const cosY = Math.cos(yawY);
  const sinY = Math.sin(yawY);
  const pushLocal = (
    list: PinPlacement[],
    localX: number,
    localZ: number
  ): void => {
    list.push({
      x: deck.x + localX * cosY + localZ * sinY,
      y: deck.y,
      z: deck.z - localX * sinY + localZ * cosY,
    });
  };
  const placements: PinPlacement[] = [];

  if (formation === 'standard10') {
    for (let row = 0; row < 4; row++) {
      const count = row + 1;
      for (let col = 0; col < count; col++) {
        const offsetX = (col - (count - 1) / 2) * spacingX;
        const offsetZ = -row * spacingZ;
        pushLocal(placements, offsetX, offsetZ);
      }
    }
    return placements;
  }

  if (formation === 'diamond9') {
    const rows = [1, 2, 3, 2, 1];
    rows.forEach((count, row) => {
      for (let col = 0; col < count; col++) {
        pushLocal(
          placements,
          (col - (count - 1) / 2) * spacingX,
          -row * (spacingZ * 0.85)
        );
      }
    });
    return placements;
  }

  if (formation === 'split8') {
    const coords = [
      [-1.5, 0],
      [1.5, 0],
      [-1.8, -1.2],
      [-1.0, -1.2],
      [1.0, -1.2],
      [1.8, -1.2],
      [-1.4, -2.4],
      [1.4, -2.4],
    ];
    for (const [cx, cz] of coords) {
      pushLocal(placements, cx * spacingX, cz * spacingZ);
    }
    return placements;
  }

  // crown6
  const crown = [
    [0, 0],
    [-0.9, -0.9],
    [0.9, -0.9],
    [-1.4, -1.9],
    [0, -1.9],
    [1.4, -1.9],
  ];
  for (const [cx, cz] of crown) {
    pushLocal(placements, cx * spacingX, cz * spacingZ);
  }
  return placements;
}

export const CAMPAIGN_LEVELS: LevelConfig[] = [
  {
    id: 'meadow-straight',
    index: 0,
    name: 'Meadow Straight',
    subtitle: 'Level 1 | Classic Miniature Alley',
    hint: 'Pinch the ball, pull back toward you, aim sideways, and release!',
    layout: 'straight',
    maxShots: 3,
    pinFormation: 'standard10',
    pinDeck: {x: 0, y: 0, z: -1.28},
    accentColor: '#4ade80',
    segments: [
      {
        id: 'launch-pad',
        x: 0,
        y: 0,
        z: -0.14,
        width: 0.44,
        length: 0.44,
        hasRails: true,
      },
      {
        id: 'main-lane',
        x: 0,
        y: 0,
        z: -0.88,
        width: 0.42,
        length: 1.06,
        hasRails: true,
      },
      {
        id: 'pin-deck',
        x: 0,
        y: 0,
        z: -1.48,
        width: 0.48,
        length: 0.42,
        hasRails: true,
      },
    ],
    obstacles: [],
  },
  {
    id: 'serpent-zigzag',
    index: 1,
    name: 'Serpent Zigzag',
    subtitle: 'Level 2 | Angled Bank Curves',
    hint: 'Bank shots off the rails or thread the diagonal S-curve cleanly.',
    layout: 'zigzag',
    maxShots: 3,
    pinFormation: 'standard10',
    pinDeck: {x: 0.1, y: 0, z: -1.42},
    accentColor: '#38bdf8',
    segments: [
      {
        id: 'launch-pad',
        x: 0,
        y: 0,
        z: -0.14,
        width: 0.46,
        length: 0.44,
        hasRails: true,
      },
      {
        id: 'zig-left',
        x: -0.06,
        y: 0,
        z: -0.6,
        width: 0.46,
        length: 0.5,
        yawY: 0.24,
        hasRails: true,
        bankSide: 'left',
      },
      {
        id: 'zig-right',
        x: 0.02,
        y: 0,
        z: -1.1,
        width: 0.52,
        length: 0.58,
        yawY: -0.26,
        hasRails: true,
        bankSide: 'right',
      },
      {
        id: 'pin-deck',
        x: 0.1,
        y: 0,
        z: -1.56,
        width: 0.54,
        length: 0.46,
        hasRails: true,
      },
    ],
    obstacles: [],
  },
  {
    id: 'skybridge-ramp',
    index: 2,
    name: 'Skybridge Ramp',
    subtitle: 'Level 3 | Elevated Crest & Drop',
    hint: 'Use medium-to-strong pullback to climb the timber ramp smoothly!',
    layout: 'elevated',
    maxShots: 3,
    pinFormation: 'standard10',
    pinDeck: {x: 0, y: 0.06, z: -1.34},
    accentColor: '#fbbf24',
    segments: [
      {
        id: 'launch-pad',
        x: 0,
        y: 0,
        z: -0.16,
        width: 0.44,
        length: 0.48,
        hasRails: true,
      },
      {
        id: 'ramp-up',
        x: 0,
        y: 0.055,
        z: -0.58,
        width: 0.38,
        length: 0.42,
        pitchX: 0.27,
        hasRails: true,
      },
      {
        id: 'crest-bridge',
        x: 0,
        y: 0.105,
        z: -0.92,
        width: 0.36,
        length: 0.32,
        hasRails: true,
      },
      {
        id: 'ramp-down',
        x: 0,
        y: 0.082,
        z: -1.16,
        width: 0.4,
        length: 0.24,
        pitchX: -0.2,
        hasRails: true,
      },
      {
        id: 'pin-deck',
        x: 0,
        y: 0.06,
        z: -1.48,
        width: 0.5,
        length: 0.46,
        hasRails: true,
      },
    ],
    obstacles: [],
  },
  {
    id: 'dwarfs-crossing',
    index: 3,
    name: "Dwarf's Crossing",
    subtitle: 'Level 4 | Mind the Shield Guardian',
    hint: 'Time your release around Barnaby the Dwarf as he patrols the lane!',
    layout: 'straight',
    maxShots: 4,
    pinFormation: 'standard10',
    pinDeck: {x: 0, y: 0, z: -1.32},
    accentColor: '#fb7185',
    segments: [
      {
        id: 'launch-pad',
        x: 0,
        y: 0,
        z: -0.14,
        width: 0.44,
        length: 0.44,
        hasRails: true,
      },
      {
        id: 'main-lane',
        x: 0,
        y: 0,
        z: -0.88,
        width: 0.46,
        length: 1.08,
        hasRails: true,
      },
      {
        id: 'pin-deck',
        x: 0,
        y: 0,
        z: -1.48,
        width: 0.48,
        length: 0.42,
        hasRails: true,
      },
    ],
    obstacles: [
      {
        id: 'barnaby-dwarf',
        kind: 'dwarf',
        x: 0,
        y: 0,
        z: -0.82,
        patrolRadius: 0.155,
        speed: 1.85,
      },
    ],
  },
  {
    id: 'crown-gauntlet',
    index: 4,
    name: 'Crown Gauntlet',
    subtitle: 'Level 5 | Ramp, Spinner & Guardian',
    hint: 'Climb the ramp, slip past the Rune Bumper, and evade Barnaby!',
    layout: 'gauntlet',
    maxShots: 4,
    pinFormation: 'standard10',
    pinDeck: {x: 0, y: 0.055, z: -1.36},
    accentColor: '#c084fc',
    segments: [
      {
        id: 'launch-pad',
        x: 0,
        y: 0,
        z: -0.16,
        width: 0.44,
        length: 0.46,
        hasRails: true,
      },
      {
        id: 'ramp-up',
        x: 0,
        y: 0.028,
        z: -0.5,
        width: 0.42,
        length: 0.28,
        pitchX: 0.21,
        hasRails: true,
      },
      {
        id: 'upper-arena',
        x: 0,
        y: 0.055,
        z: -1.04,
        width: 0.48,
        length: 0.86,
        hasRails: true,
      },
      {
        id: 'pin-deck',
        x: 0,
        y: 0.055,
        z: -1.52,
        width: 0.5,
        length: 0.44,
        hasRails: true,
      },
    ],
    obstacles: [
      {
        id: 'rune-spinner',
        kind: 'bumper',
        x: 0,
        y: 0.055,
        z: -0.78,
        speed: 1.9,
        radius: 0.125,
      },
      {
        id: 'barnaby-dwarf',
        kind: 'dwarf',
        x: 0,
        y: 0.055,
        z: -1.08,
        patrolRadius: 0.16,
        speed: 2.1,
      },
    ],
  },
];

// ============================================================================
// Power Curve, Trajectory & Bowling Scoring Helpers (Pure / Unit-Tested)
// ============================================================================

export function applyPowerCurve(raw01: number, mode: PowerCurveMode): number {
  const t = Math.max(0, Math.min(1, raw01));
  if (mode === 'linear') return t;
  if (mode === 'snappy') return Math.pow(t, 0.72);
  // smooth S-curve easing for comfortable precision at low/mid pullback
  return t * t * (3 - 2 * t);
}

export interface LaunchParameters {
  power01: number;
  dirX: number;
  dirZ: number;
  speed: number;
  velocity: {x: number; y: number; z: number};
  spin: {x: number; y: number; z: number};
  canLaunch: boolean;
}

export function computeLaunchParameters(
  pullDeltaX: number,
  pullDeltaZ: number,
  curve: PowerCurveMode
): LaunchParameters {
  const pullZ = Math.max(0, Math.min(MAX_PULL_DISTANCE, pullDeltaZ));
  const pullX = Math.max(-MAX_LATERAL_PULL, Math.min(MAX_LATERAL_PULL, pullDeltaX));
  const pullMag = Math.hypot(pullX * 0.75, pullZ);
  const rawPower = pullZ < 0.014 ? 0 : Math.min(1, pullMag / MAX_PULL_DISTANCE);
  const power01 = applyPowerCurve(rawPower, curve);

  const dirX = -pullX * 1.45;
  const dirZ = -Math.max(0.08, pullZ);
  const len = Math.hypot(dirX, dirZ) || 1;
  const nx = dirX / len;
  const nz = dirZ / len;

  const speed = 1.15 + power01 * 2.65;
  return {
    power01,
    dirX: nx,
    dirZ: nz,
    speed,
    velocity: {
      x: nx * speed,
      y: 0,
      z: nz * speed,
    },
    spin: {
      x: -speed / BALL_RADIUS,
      y: -nx * 4.5,
      z: 0,
    },
    canLaunch: power01 >= MIN_LAUNCH_POWER,
  };
}

/**
 * Computes arcade-bowling shot score and callout cleanly aligned with
 * Rollox's multi-shot single-rack levels (Strike = all cleared on shot 1,
 * Spare = all cleared on shot 2, Clear = cleared on shot 3+, plus Open Frame).
 */
export function evaluateShotScoring(params: {
  newlyFallen: number;
  totalFallen: number;
  totalPins: number;
  shotsUsed: number;
}): ShotOutcome {
  const {newlyFallen, totalFallen, totalPins, shotsUsed} = params;
  const safeNew = Math.max(0, newlyFallen);
  const allDown = totalFallen >= totalPins && totalPins > 0;

  let shotPoints = safeNew * 10;
  if (allDown && shotsUsed === 1) {
    shotPoints += 50;
    return {
      shotPoints,
      isStrike: true,
      isSpare: false,
      isAllCleared: true,
      callout: 'STRIKE! +50 BONUS',
      calloutColor: '#fde047',
    };
  }
  if (allDown && shotsUsed === 2) {
    shotPoints += 25;
    return {
      shotPoints,
      isStrike: false,
      isSpare: true,
      isAllCleared: true,
      callout: 'SPARE! +25 BONUS',
      calloutColor: '#4ade80',
    };
  }
  if (allDown) {
    shotPoints += 15;
    return {
      shotPoints,
      isStrike: false,
      isSpare: false,
      isAllCleared: true,
      callout: 'ALL CLEARED! +15',
      calloutColor: '#4ade80',
    };
  }
  if (safeNew > 0) {
    return {
      shotPoints,
      isStrike: false,
      isSpare: false,
      isAllCleared: false,
      callout: `+${safeNew} ${safeNew === 1 ? 'PIN' : 'PINS'}!`,
      calloutColor: '#7dd3fc',
    };
  }
  return {
    shotPoints: 0,
    isStrike: false,
    isSpare: false,
    isAllCleared: false,
    callout: 'OPEN FRAME / MISS',
    calloutColor: '#cbd5e1',
  };
}

export function calculateLevelStars(
  pinsKnocked: number,
  totalPins: number,
  shotsUsed: number,
  shotsLeft: number
): number {
  const allDown = totalPins > 0 && pinsKnocked >= totalPins;
  const ratio = pinsKnocked / Math.max(1, totalPins);
  if (allDown && (shotsUsed === 1 || shotsLeft >= 1)) return 3;
  if (allDown || ratio >= 0.7) return 2;
  if (ratio >= 0.3) return 1;
  return 0;
}

// ============================================================================
// Modular Alley Workshop Engine
// ============================================================================

let _workshopIdSeq = 1;
function nextWorkshopId(prefix: string): string {
  return `${prefix}-${_workshopIdSeq++}`;
}

/** Advances the workshop ID sequence past any IDs restored from localStorage. */
export function syncWorkshopIdSeed(layout: WorkshopLayout): void {
  let maxId = _workshopIdSeq - 1;
  for (const seg of layout.segments ?? []) {
    const m = /-(\d+)$/.exec(seg.id);
    if (m) maxId = Math.max(maxId, Number(m[1]));
  }
  for (const obs of layout.obstacles ?? []) {
    const m = /-(\d+)$/.exec(obs.id);
    if (m) maxId = Math.max(maxId, Number(m[1]));
  }
  _workshopIdSeq = Math.max(_workshopIdSeq, maxId + 1);
}

export interface SocketPose {
  x: number;
  y: number;
  z: number;
  yawY: number;
}

/** Computes the entry (near +Z) socket of a workshop segment in arena-local space. */
export function getSegmentEntrySocket(seg: WorkshopSegmentNode): SocketPose {
  const cosY = Math.cos(seg.yawY);
  const sinY = Math.sin(seg.yawY);
  const halfLen = (seg.length * Math.cos(seg.pitchX)) / 2;
  return {
    x: seg.x + sinY * halfLen,
    y: seg.y - seg.elevationDelta / 2,
    z: seg.z + cosY * halfLen,
    yawY: seg.yawY,
  };
}

/** Computes the exit (far -Z) socket where the next module cleanly snaps. */
export function getSegmentExitSocket(seg: WorkshopSegmentNode): SocketPose {
  const cosY = Math.cos(seg.yawY);
  const sinY = Math.sin(seg.yawY);
  const halfLen = (seg.length * Math.cos(seg.pitchX)) / 2;
  return {
    x: seg.x - sinY * halfLen,
    y: seg.y + seg.elevationDelta / 2,
    z: seg.z - cosY * halfLen,
    yawY: seg.yawY,
  };
}

/** Creates a WorkshopSegmentNode snapped seamlessly onto an existing socket. */
export function createSnappedSegment(
  kind: WorkshopModuleKind,
  entrySocket: SocketPose,
  snappedToId?: string | null
): WorkshopSegmentNode {
  const meta = WORKSHOP_MODULE_CATALOG[kind];
  const yaw = entrySocket.yawY + meta.yawDelta;
  const halfLen = (meta.length * Math.cos(meta.pitchX)) / 2;
  const sinY = Math.sin(yaw);
  const cosY = Math.cos(yaw);

  return {
    id: nextWorkshopId('seg'),
    kind,
    x: entrySocket.x - sinY * halfLen,
    y: entrySocket.y + meta.elevationDelta / 2,
    z: entrySocket.z - cosY * halfLen,
    yawY: yaw,
    pitchX: meta.pitchX,
    width: meta.width,
    length: meta.length,
    elevationDelta: meta.elevationDelta,
    yawDelta: meta.yawDelta,
    snappedToId: snappedToId ?? null,
  };
}

export function createDefaultWorkshopLayout(): WorkshopLayout {
  const launchSocket: SocketPose = {x: 0, y: 0, z: -0.34, yawY: 0};
  const seg1 = createSnappedSegment('straight', launchSocket, 'launch-pad');
  const seg2 = createSnappedSegment('straight', getSegmentExitSocket(seg1), seg1.id);

  return {
    segments: [seg1, seg2],
    obstacles: [
      {
        id: nextWorkshopId('obs'),
        kind: 'dwarf',
        x: seg1.x,
        y: seg1.y,
        z: seg1.z - 0.14,
        yawY: seg1.yawY,
        patrolRadius: 0.14,
        speed: 1.85,
        radius: 0.08,
      },
    ],
    pinFormation: 'standard10',
    railsEnabled: true,
    maxShots: 4,
    difficulty: 'normal',
  };
}

export const WORKSHOP_DIFFICULTY_MULTIPLIER: Record<WorkshopDifficulty, number> = {
  relaxed: 0.65,
  normal: 1.0,
  fast: 1.4,
};

export function stepWorkshopShots(
  layout: WorkshopLayout,
  delta: number
): WorkshopLayout {
  const current = Math.round(layout.maxShots || 4);
  const next = Math.max(2, Math.min(6, current + delta));
  return {...layout, maxShots: next};
}

export function cycleWorkshopDifficulty(
  layout: WorkshopLayout
): WorkshopLayout {
  const order: WorkshopDifficulty[] = ['relaxed', 'normal', 'fast'];
  const current = layout.difficulty ?? 'normal';
  const next = order[(order.indexOf(current) + 1) % order.length];
  return {...layout, difficulty: next};
}

export function formatWorkshopDifficulty(
  difficulty?: WorkshopDifficulty
): string {
  switch (difficulty ?? 'normal') {
    case 'relaxed':
      return 'Relaxed';
    case 'fast':
      return 'Fast';
    default:
      return 'Normal';
  }
}

export function appendWorkshopSegment(
  layout: WorkshopLayout,
  kind: WorkshopModuleKind
): WorkshopLayout {
  if (layout.segments.length >= 6) return layout;
  const last = layout.segments[layout.segments.length - 1];
  const exitSocket: SocketPose = last
    ? getSegmentExitSocket(last)
    : {x: 0, y: 0, z: -0.34, yawY: 0};
  const node = createSnappedSegment(kind, exitSocket, last?.id ?? 'launch-pad');
  return {
    ...layout,
    segments: [...layout.segments, node],
  };
}

export function removeWorkshopSegment(
  layout: WorkshopLayout,
  segmentId?: string
): WorkshopLayout {
  if (layout.segments.length <= 1) return layout;
  const idx = segmentId
    ? layout.segments.findIndex((s) => s.id === segmentId)
    : layout.segments.length - 1;
  if (idx < 0) return layout;
  const remaining = layout.segments.filter((_, i) => i !== idx);
  return {...layout, segments: remaining};
}

export function repositionWorkshopSegment(
  layout: WorkshopLayout,
  segmentId: string,
  deltaX: number,
  deltaZ: number
): WorkshopLayout {
  return {
    ...layout,
    segments: layout.segments.map((seg) =>
      seg.id === segmentId
        ? {
            ...seg,
            x: Number((seg.x + deltaX).toFixed(3)),
            z: Number((seg.z + deltaZ).toFixed(3)),
            snappedToId: null,
          }
        : seg
    ),
  };
}

export function rotateWorkshopSegment(
  layout: WorkshopLayout,
  segmentId: string,
  deltaYawRad: number
): WorkshopLayout {
  return {
    ...layout,
    segments: layout.segments.map((seg) =>
      seg.id === segmentId
        ? {...seg, yawY: Number((seg.yawY + deltaYawRad).toFixed(3))}
        : seg
    ),
  };
}

export function addWorkshopObstacle(
  layout: WorkshopLayout,
  kind: ObstacleKind,
  targetSegmentIndex?: number
): WorkshopLayout {
  if (layout.obstacles.length >= 4) return layout;
  const segIndex =
    targetSegmentIndex ??
    Math.min(
      Math.max(0, layout.segments.length - 1),
      layout.obstacles.length % Math.max(1, layout.segments.length)
    );
  const host = layout.segments[segIndex];
  const x = host ? host.x : 0;
  const y = host ? host.y : 0;
  const z = host ? host.z : -0.78;
  const yawY = host ? host.yawY : 0;

  const newObs: WorkshopObstacleNode = {
    id: nextWorkshopId('obs'),
    kind,
    x,
    y,
    z,
    yawY,
    patrolRadius: kind === 'movingGate' ? 0.065 : 0.14,
    speed: kind === 'bumper' ? 1.85 : kind === 'movingGate' ? 2.1 : 1.9,
    radius: kind === 'bumper' ? 0.115 : 0.1,
  };
  return {
    ...layout,
    obstacles: [...layout.obstacles, newObs],
  };
}

export function removeWorkshopObstacle(
  layout: WorkshopLayout,
  obstacleId?: string
): WorkshopLayout {
  if (layout.obstacles.length === 0) return layout;
  if (!obstacleId) {
    return {...layout, obstacles: layout.obstacles.slice(0, -1)};
  }
  return {
    ...layout,
    obstacles: layout.obstacles.filter((o) => o.id !== obstacleId),
  };
}

export function repositionWorkshopObstacle(
  layout: WorkshopLayout,
  obstacleId: string,
  deltaX: number,
  deltaZ: number
): WorkshopLayout {
  return {
    ...layout,
    obstacles: layout.obstacles.map((o) =>
      o.id === obstacleId
        ? {
            ...o,
            x: Number((o.x + deltaX).toFixed(3)),
            z: Number((o.z + deltaZ).toFixed(3)),
          }
        : o
    ),
  };
}

/** Validates custom Alley Workshop layout before allowing launch. */
export function validateWorkshopLayout(
  layout: WorkshopLayout
): WorkshopValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (layout.segments.length === 0) {
    errors.push('Add at least 1 lane module between the launch pad and pin deck.');
    return {valid: false, errors, warnings};
  }

  // 1. Connectivity check from Launch Pad exit (x=0, y=0, z=-0.34)
  const launchExit = {x: 0, y: 0, z: -0.34};
  const firstEntry = getSegmentEntrySocket(layout.segments[0]);
  const startGapXZ = Math.hypot(
    firstEntry.x - launchExit.x,
    firstEntry.z - launchExit.z
  );
  const startGapY = Math.abs(firstEntry.y - launchExit.y);
  if (startGapXZ > 0.16 || startGapY > 0.08) {
    errors.push(
      'First lane module is disconnected from the launch pedestal.'
    );
  }

  // 2. Inter-segment chain connectivity & overlap checks
  for (let i = 0; i < layout.segments.length; i++) {
    const cur = layout.segments[i];
    if (cur.y < -0.14 || cur.y > 0.45) {
      errors.push(`Module ${i + 1} (${cur.kind}) height is outside safe table range.`);
    }
    if (i > 0) {
      const prevExit = getSegmentExitSocket(layout.segments[i - 1]);
      const curEntry = getSegmentEntrySocket(cur);
      const gapXZ = Math.hypot(curEntry.x - prevExit.x, curEntry.z - prevExit.z);
      const gapY = Math.abs(curEntry.y - prevExit.y);
      if (gapXZ > 0.16 || gapY > 0.08) {
        errors.push(`Gap detected between lane modules ${i} and ${i + 1}.`);
      }
    }
    for (let j = i + 1; j < layout.segments.length; j++) {
      const other = layout.segments[j];
      const dist = Math.hypot(cur.x - other.x, cur.z - other.z);
      const minAllowed = (cur.length + other.length) * 0.28;
      if (dist < minAllowed && Math.abs(cur.y - other.y) < 0.06) {
        errors.push(`Lane modules ${i + 1} and ${j + 1} overlap each other.`);
      }
    }
  }

  // 3. Pin placement reachability check
  const lastExit = getSegmentExitSocket(layout.segments[layout.segments.length - 1]);
  if (lastExit.z > -0.45) {
    errors.push('Alley must extend forward toward the pin deck.');
  }

  // 4. Obstacle placement validation (must sit reasonably near a lane surface, not overlapping launch pad or pins)
  const pinCenterX = lastExit.x - Math.sin(lastExit.yawY) * 0.22;
  const pinCenterZ = lastExit.z - Math.cos(lastExit.yawY) * 0.22;
  for (let i = 0; i < layout.obstacles.length; i++) {
    const obs = layout.obstacles[i];
    if (obs.z > -0.35) {
      errors.push(`Obstacle ${i + 1} sits inside the ball launch zone.`);
    }
    const distToLastExit = Math.hypot(obs.x - pinCenterX, obs.z - pinCenterZ);
    if (distToLastExit < 0.16) {
      errors.push(`Obstacle ${i + 1} overlaps the bowling pin deck.`);
    }
    const nearAnySeg = layout.segments.some(
      (s) =>
        Math.hypot(obs.x - s.x, obs.z - s.z) < Math.max(s.width, s.length) * 0.72 &&
        Math.abs(obs.y - s.y) < 0.09
    );
    if (!nearAnySeg) {
      errors.push(`Obstacle ${i + 1} is floating off the modular lane.`);
    }
  }

  if (layout.obstacles.length === 0) {
    warnings.push('No obstacles placed - great for clean target practice!');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/** Converts a validated WorkshopLayout into a runnable LevelConfig for BowlingWorld. */
export function compileWorkshopLevel(layout: WorkshopLayout): LevelConfig {
  const launchPad: LaneSegmentSpec = {
    id: 'launch-pad',
    x: 0,
    y: 0,
    z: -0.14,
    width: 0.44,
    length: 0.42,
    hasRails: layout.railsEnabled,
  };

  const middleSegments: LaneSegmentSpec[] = layout.segments.map((node) => ({
    id: node.id,
    x: node.x,
    y: node.y,
    z: node.z,
    width: node.width,
    length: node.length,
    pitchX: node.pitchX,
    yawY: node.yawY,
    hasRails: layout.railsEnabled,
  }));

  const last = layout.segments[layout.segments.length - 1];
  const exitSocket: SocketPose = last
    ? getSegmentExitSocket(last)
    : {x: 0, y: 0, z: -0.88, yawY: 0};

  const sinY = Math.sin(exitSocket.yawY);
  const cosY = Math.cos(exitSocket.yawY);

  const pinDeckSeg: LaneSegmentSpec = {
    id: 'pin-deck',
    x: exitSocket.x - sinY * 0.22,
    y: exitSocket.y,
    z: exitSocket.z - cosY * 0.22,
    width: 0.5,
    length: 0.46,
    yawY: exitSocket.yawY,
    hasRails: layout.railsEnabled,
  };

  const pinDeck = {
    x: exitSocket.x - sinY * 0.14,
    y: exitSocket.y,
    z: exitSocket.z - cosY * 0.14,
  };

  const difficulty = layout.difficulty ?? 'normal';
  const speedScale = WORKSHOP_DIFFICULTY_MULTIPLIER[difficulty];
  const obstacles: ObstacleSpec[] = layout.obstacles.map((o) => ({
    id: o.id,
    kind: o.kind,
    x: o.x,
    y: o.y,
    z: o.z,
    yawY: o.yawY,
    patrolRadius: o.patrolRadius,
    speed: Number(((o.speed || 1.85) * speedScale).toFixed(2)),
    radius: o.radius,
  }));

  const safeShots = Math.max(2, Math.min(6, Math.round(layout.maxShots || 4)));

  return {
    id: 'custom-workshop',
    index: -1,
    name: 'Custom Alley',
    subtitle: `${formatWorkshopDifficulty(difficulty)} | ${safeShots} Shots`,
    hint: 'Pinch, pull back, aim, and release to bowl your custom lane.',
    layout: 'custom',
    maxShots: safeShots,
    pinFormation: layout.pinFormation,
    pinDeck,
    pinDeckYaw: exitSocket.yawY,
    segments: [launchPad, ...middleSegments, pinDeckSeg],
    obstacles,
    accentColor: '#f59e0b',
  };
}

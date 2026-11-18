import type {
  BuilderConfig,
  LaneSegmentSpec,
  LevelConfig,
  ObstacleSpec,
  PinFormation,
  PinPlacement,
} from './types';

export const ARENA_TABLE_Y = 0.96;
export const ARENA_ORIGIN_Z = -0.46; // Launch pedestal Z in world space
export const BALL_RADIUS = 0.042;
export const PIN_HEIGHT = 0.14;
export const PIN_BASE_RADIUS = 0.021;
export const LANE_DECK_THICKNESS = 0.036;

export function generatePinFormation(
  formation: PinFormation,
  deck: {x: number; y: number; z: number}
): PinPlacement[] {
  const spacingX = 0.074;
  const spacingZ = 0.066;
  const placements: PinPlacement[] = [];

  if (formation === 'standard10') {
    for (let row = 0; row < 4; row++) {
      const count = row + 1;
      for (let col = 0; col < count; col++) {
        const offsetX = (col - (count - 1) / 2) * spacingX;
        const offsetZ = -row * spacingZ;
        placements.push({
          x: deck.x + offsetX,
          y: deck.y,
          z: deck.z + offsetZ,
        });
      }
    }
    return placements;
  }

  if (formation === 'diamond9') {
    const rows = [1, 2, 3, 2, 1];
    rows.forEach((count, row) => {
      for (let col = 0; col < count; col++) {
        placements.push({
          x: deck.x + (col - (count - 1) / 2) * spacingX,
          y: deck.y,
          z: deck.z - row * (spacingZ * 0.85),
        });
      }
    });
    return placements;
  }

  if (formation === 'split710') {
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
      placements.push({
        x: deck.x + cx * spacingX,
        y: deck.y,
        z: deck.z + cz * spacingZ,
      });
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
    placements.push({
      x: deck.x + cx * spacingX,
      y: deck.y,
      z: deck.z + cz * spacingZ,
    });
  }
  return placements;
}

export const CAMPAIGN_LEVELS: LevelConfig[] = [
  {
    id: 'meadow-straight',
    index: 0,
    name: 'Meadow Straight',
    subtitle: 'Level 1 · Classic Miniature Alley',
    hint: 'Pinch or drag the ball back, aim sideways, and release to bowl!',
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
    subtitle: 'Level 2 · Angled Bank Curves',
    hint: 'Use the wooden bank rails or aim diagonally through the bend.',
    layout: 'zigzag',
    maxShots: 3,
    pinFormation: 'standard10',
    pinDeck: {x: 0.16, y: 0, z: -1.32},
    accentColor: '#38bdf8',
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
        id: 'zig-left',
        x: -0.1,
        y: 0,
        z: -0.58,
        width: 0.4,
        length: 0.56,
        yawY: 0.34,
        hasRails: true,
        bankSide: 'left',
      },
      {
        id: 'zig-right',
        x: 0.04,
        y: 0,
        z: -1.04,
        width: 0.42,
        length: 0.62,
        yawY: -0.36,
        hasRails: true,
        bankSide: 'right',
      },
      {
        id: 'pin-deck',
        x: 0.16,
        y: 0,
        z: -1.46,
        width: 0.48,
        length: 0.44,
        hasRails: true,
      },
    ],
    obstacles: [],
  },
  {
    id: 'skybridge-ramp',
    index: 2,
    name: 'Skybridge Ramp',
    subtitle: 'Level 3 · Elevated Crest & Drop',
    hint: 'Dial in your pullback power to crest the bridge smoothly!',
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
    subtitle: 'Level 4 · Mind the Shield Guardian',
    hint: 'Time your release around Barnaby the Dwarf as he patrols the bridge!',
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
    subtitle: 'Level 5 · Ramp, Spinner & Guardian',
    hint: 'Clear the elevated ramp, slip past the spinning mill, and dodge Barnaby!',
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

export const DEFAULT_BUILDER_CONFIG: BuilderConfig = {
  layout: 'straight',
  obstacleMode: 'dwarf',
  pinFormation: 'standard10',
  railsEnabled: true,
};

export function buildCustomLevel(config: BuilderConfig): LevelConfig {
  const baseTemplate =
    config.layout === 'zigzag'
      ? CAMPAIGN_LEVELS[1]
      : config.layout === 'elevated'
        ? CAMPAIGN_LEVELS[2]
        : CAMPAIGN_LEVELS[0];

  const segments: LaneSegmentSpec[] = baseTemplate.segments.map((seg) => ({
    ...seg,
    hasRails: config.railsEnabled,
  }));

  const deckY = baseTemplate.pinDeck.y;
  const obstacles: ObstacleSpec[] = [];

  if (config.obstacleMode === 'dwarf' || config.obstacleMode === 'both') {
    obstacles.push({
      id: 'custom-dwarf',
      kind: 'dwarf',
      x: config.layout === 'zigzag' ? 0.02 : 0,
      y: config.layout === 'elevated' ? 0.105 : 0,
      z: config.layout === 'elevated' ? -0.92 : -0.84,
      patrolRadius: 0.145,
      speed: 1.85,
    });
  }

  if (config.obstacleMode === 'bumper' || config.obstacleMode === 'both') {
    obstacles.push({
      id: 'custom-bumper',
      kind: 'bumper',
      x: config.layout === 'zigzag' ? -0.04 : 0,
      y: config.layout === 'elevated' ? deckY : 0,
      z: config.layout === 'elevated' ? -1.16 : -0.66,
      speed: 1.8,
      radius: 0.115,
    });
  }

  return {
    id: 'custom-alley',
    index: -1,
    name: 'Custom Workshop Alley',
    subtitle: 'Custom Builder Mode',
    hint: 'Test your handcrafted miniature alley! Edit pieces anytime.',
    layout: config.layout,
    maxShots: 4,
    pinFormation: config.pinFormation,
    pinDeck: {...baseTemplate.pinDeck},
    segments,
    obstacles,
    accentColor: '#f59e0b',
  };
}

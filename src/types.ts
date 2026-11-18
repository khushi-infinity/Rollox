export type GamePhase =
  | 'title'
  | 'playing'
  | 'paused'
  | 'levelComplete'
  | 'builder';

export type BallPhase = 'ready' | 'aiming' | 'rolling' | 'settling';

export type LaneLayoutKind = 'straight' | 'zigzag' | 'elevated' | 'gauntlet';

export type PinFormation = 'standard10' | 'diamond9' | 'split710' | 'crown6';

export type ObstacleKind = 'dwarf' | 'bumper';

export interface LaneSegmentSpec {
  id: string;
  /** Center position relative to arena origin (table surface y = 0). */
  x: number;
  y: number;
  z: number;
  width: number;
  length: number;
  /** Pitch rotation around X in radians (positive tilts front up, negative slopes down toward pins). */
  pitchX?: number;
  /** Yaw rotation around Y in radians for angled zigzag sections. */
  yawY?: number;
  /** Whether to render raised wooden gutters along the left/right edges of this segment. */
  hasRails?: boolean;
  /** Optional angled bank wall on left or right ('left' | 'right' | 'both'). */
  bankSide?: 'left' | 'right';
}

export interface ObstacleSpec {
  id: string;
  kind: ObstacleKind;
  /** Center position relative to arena origin. */
  x: number;
  y: number;
  z: number;
  /** Lateral patrol range (half-width in meters) for dwarf obstacle. */
  patrolRadius?: number;
  /** Patrol speed in radians/sec (dwarf) or spin speed in rad/sec (bumper). */
  speed?: number;
  /** Radius of rotating bumper arms. */
  radius?: number;
}

export interface PinPlacement {
  x: number;
  y: number;
  z: number;
}

export interface LevelConfig {
  id: string;
  index: number;
  name: string;
  subtitle: string;
  hint: string;
  layout: LaneLayoutKind;
  maxShots: number;
  pinFormation: PinFormation;
  /** Pin deck world-local position relative to arena origin. */
  pinDeck: {x: number; y: number; z: number};
  segments: LaneSegmentSpec[];
  obstacles: ObstacleSpec[];
  accentColor: string;
}

export interface BuilderConfig {
  layout: 'straight' | 'zigzag' | 'elevated';
  obstacleMode: 'none' | 'dwarf' | 'bumper' | 'both';
  pinFormation: PinFormation;
  railsEnabled: boolean;
}

export interface ScoreSummary {
  pinsKnocked: number;
  totalPins: number;
  shotsUsed: number;
  maxShots: number;
  levelScore: number;
  totalScore: number;
  stars: number;
  callout: string;
}

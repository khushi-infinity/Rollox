export type GameState =
  | 'LOADING'
  | 'MAIN_MENU'
  | 'ONBOARDING'
  | 'LEVEL_SELECT'
  | 'READY'
  | 'AIMING'
  | 'BALL_IN_MOTION'
  | 'SETTLING'
  | 'RESULT'
  | 'PAUSED'
  | 'WORKSHOP'
  | 'WORKSHOP_TEST';

export type GrabState =
  | 'IDLE'
  | 'HOVER'
  | 'GRABBED'
  | 'AIMING'
  | 'RELEASED'
  | 'IN_FLIGHT'
  | 'SETTLING'
  | 'RESULT';

export type LaneLayoutKind =
  | 'straight'
  | 'zigzag'
  | 'elevated'
  | 'gauntlet'
  | 'custom';

export type PinFormation = 'standard10' | 'diamond9' | 'split8' | 'crown6';

export type ObstacleKind = 'dwarf' | 'bumper' | 'movingGate' | 'slidingBarrier';

export type WorkshopModuleKind =
  | 'straight'
  | 'leftTurn'
  | 'rightTurn'
  | 'zigzag'
  | 'rampUp'
  | 'rampDown'
  | 'elevatedBridge'
  | 'short';

export type PowerCurveMode = 'linear' | 'smooth' | 'snappy';

export interface LaneSegmentSpec {
  id: string;
  /** Center position relative to arena origin (pedestal surface y = 0). */
  x: number;
  y: number;
  z: number;
  width: number;
  length: number;
  /** Pitch rotation around X in radians (positive tilts far edge up, negative slopes down). */
  pitchX?: number;
  /** Yaw rotation around Y in radians for angled turns / zigzag sections. */
  yawY?: number;
  /** Whether to render raised wooden gutters along left/right edges. */
  hasRails?: boolean;
  /** Optional angled bank wall indicator. */
  bankSide?: 'left' | 'right';
}

export interface ObstacleSpec {
  id: string;
  kind: ObstacleKind;
  /** Center position relative to arena origin. */
  x: number;
  y: number;
  z: number;
  /** Lateral patrol half-width (dwarf/slidingBarrier) or vertical stroke (movingGate). */
  patrolRadius?: number;
  /** Movement speed in radians/sec or spin speed in rad/sec. */
  speed?: number;
  /** Radius of rotating bumper arms or gate width half-span. */
  radius?: number;
  /** Optional Y rotation in radians to align obstacle with angled lanes. */
  yawY?: number;
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
  /** Pin deck front-pin reference position relative to arena origin. */
  pinDeck: {x: number; y: number; z: number};
  segments: LaneSegmentSpec[];
  obstacles: ObstacleSpec[];
  accentColor: string;
}

export interface WorkshopSegmentNode {
  id: string;
  kind: WorkshopModuleKind;
  x: number;
  y: number;
  z: number;
  yawY: number;
  pitchX: number;
  width: number;
  length: number;
  elevationDelta: number;
  yawDelta: number;
  snappedToId?: string | null;
}

export interface WorkshopObstacleNode {
  id: string;
  kind: ObstacleKind;
  x: number;
  y: number;
  z: number;
  yawY: number;
  patrolRadius: number;
  speed: number;
  radius: number;
}

export interface WorkshopLayout {
  segments: WorkshopSegmentNode[];
  obstacles: WorkshopObstacleNode[];
  pinFormation: PinFormation;
  railsEnabled: boolean;
  maxShots: number;
}

export interface WorkshopValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface GameSettings {
  volume: number;
  muted: boolean;
  powerCurve: PowerCurveMode;
  showTrajectory: boolean;
  heightOffset: number;
  distanceOffset: number;
}

export interface CampaignProgress {
  unlockedLevelIndex: number;
  completedLevels: number[];
  bestScores: Record<string, number>;
  bestStars: Record<string, number>;
  onboardingCompleted: boolean;
}

export interface ShotOutcome {
  shotPoints: number;
  isStrike: boolean;
  isSpare: boolean;
  isAllCleared: boolean;
  callout: string;
  calloutColor: string;
}

export interface ScoreSummary {
  levelId: string;
  levelName: string;
  pinsKnocked: number;
  totalPins: number;
  shotsUsed: number;
  maxShots: number;
  levelScore: number;
  totalScore: number;
  stars: number;
  callout: string;
  isCustomWorkshop: boolean;
}

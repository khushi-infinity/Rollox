import {CAMPAIGN_LEVELS} from './levels';
import type {CampaignProgress, ScoreSummary} from './types';

export const MENU_BUTTON_COOLDOWN_MS = 220;
export const PANEL_TRANSITION_LOCK_MS = 240;

/**
 * Pure click-debounce & panel-transition guard preventing XR poke/ray bounce,
 * stationary-finger re-triggers, and cross-screen bleed-through clicks.
 */
export class MenuInteractionGuard {
  private lastClickByButton = new Map<string, number>();
  private transitionUnlockAtMs = 0;

  notifyPanelTransition(
    nowMs: number,
    lockMs = PANEL_TRANSITION_LOCK_MS
  ): void {
    this.transitionUnlockAtMs = Math.max(
      this.transitionUnlockAtMs,
      nowMs + Math.max(0, lockMs)
    );
  }

  canActivate(
    buttonId: string,
    nowMs: number,
    cooldownMs = MENU_BUTTON_COOLDOWN_MS
  ): boolean {
    if (nowMs < this.transitionUnlockAtMs) {
      return false;
    }
    const last = this.lastClickByButton.get(buttonId);
    if (last !== undefined && nowMs - last < cooldownMs) {
      return false;
    }
    this.lastClickByButton.set(buttonId, nowMs);
    return true;
  }

  reset(): void {
    this.lastClickByButton.clear();
    this.transitionUnlockAtMs = 0;
  }
}

export type LevelCardStatus = 'COMPLETED' | 'CURRENT' | 'UNLOCKED' | 'LOCKED';

export interface LevelCardState {
  index: number;
  id: string;
  name: string;
  subtitle: string;
  unlocked: boolean;
  completed: boolean;
  isCurrent: boolean;
  status: LevelCardStatus;
  statusBadge: string;
  buttonLabel: string;
  bestScore: number;
  stars: number;
}

export function getCampaignLevelCardState(
  levelIndex: number,
  progress: CampaignProgress
): LevelCardState {
  const safeIdx = Math.max(0, Math.min(CAMPAIGN_LEVELS.length - 1, levelIndex));
  const lvl = CAMPAIGN_LEVELS[safeIdx];
  const completed = progress.completedLevels.includes(safeIdx);
  const unlocked = safeIdx <= progress.unlockedLevelIndex || completed;
  const isCurrent = unlocked && safeIdx === progress.unlockedLevelIndex && !completed;
  const status: LevelCardStatus = completed
    ? 'COMPLETED'
    : isCurrent
      ? 'CURRENT'
      : unlocked
        ? 'UNLOCKED'
        : 'LOCKED';

  const statusBadge =
    status === 'COMPLETED'
      ? 'COMPLETED'
      : status === 'CURRENT'
        ? 'CURRENT'
        : status === 'UNLOCKED'
          ? 'UNLOCKED'
          : 'LOCKED';

  const buttonLabel = !unlocked
    ? 'Locked'
    : completed
      ? 'Replay'
      : 'Play';

  return {
    index: safeIdx,
    id: lvl.id,
    name: lvl.name,
    subtitle: lvl.subtitle.replace(/^Level \d+ [|·] /, ''),
    unlocked,
    completed,
    isCurrent,
    status,
    statusBadge,
    buttonLabel,
    bestScore: progress.bestScores[lvl.id] ?? 0,
    stars: progress.bestStars[lvl.id] ?? 0,
  };
}

export interface ResultsPresentation {
  eyebrow: string;
  levelLabel: string;
  title: string;
  bannerText: string;
  showBanner: boolean;
  hasNextLevel: boolean;
  isCampaignComplete: boolean;
  showPlayAgain: boolean;
  showNextLevel: boolean;
  showEditSetup: boolean;
  showMainMenu: boolean;
  playAgainLabel: string;
  nextLevelLabel: string;
  editSetupLabel: string;
  mainMenuLabel: string;
  primaryLabel: string;
  secondaryLabel: string;
  tertiaryLabel: string;
}

export function buildResultsPresentation(params: {
  summary: ScoreSummary;
  levelIndex: number;
  totalLevels: number;
  unlockedLevelIndex?: number;
}): ResultsPresentation {
  const {summary, levelIndex, totalLevels, unlockedLevelIndex = 0} = params;
  if (summary.isCustomWorkshop) {
    return {
      eyebrow: 'CUSTOM GAME COMPLETE',
      levelLabel: `Custom Game: ${summary.levelName}`,
      title: summary.callout,
      bannerText: `Custom lane finished in ${summary.shotsUsed} ${summary.shotsUsed === 1 ? 'shot' : 'shots'}.`,
      showBanner: true,
      hasNextLevel: false,
      isCampaignComplete: false,
      showPlayAgain: true,
      showNextLevel: false,
      showEditSetup: true,
      showMainMenu: true,
      playAgainLabel: 'Play Again',
      nextLevelLabel: 'Next Level',
      editSetupLabel: 'Edit Setup',
      mainMenuLabel: 'Main Menu',
      primaryLabel: 'Play Again',
      secondaryLabel: 'Edit Setup',
      tertiaryLabel: 'Main Menu',
    };
  }

  const cleared = summary.stars > 0;
  const isFinalLevel = levelIndex >= totalLevels - 1;
  const isCampaignComplete = cleared && isFinalLevel;
  const hasNextLevel =
    !isFinalLevel && (cleared || unlockedLevelIndex > levelIndex);

  if (isCampaignComplete) {
    return {
      eyebrow: 'ROUND COMPLETE',
      levelLabel: `Level ${levelIndex + 1}: ${summary.levelName}`,
      title: summary.callout,
      bannerText: 'CAMPAIGN COMPLETE! You conquered every Rollox alley!',
      showBanner: true,
      hasNextLevel: false,
      isCampaignComplete: true,
      showPlayAgain: true,
      showNextLevel: false,
      showEditSetup: false,
      showMainMenu: true,
      playAgainLabel: 'Play Again',
      nextLevelLabel: 'Next Level',
      editSetupLabel: 'Edit Setup',
      mainMenuLabel: 'Main Menu',
      primaryLabel: 'Play Again',
      secondaryLabel: 'Level Select',
      tertiaryLabel: 'Main Menu',
    };
  }

  return {
    eyebrow: 'ROUND COMPLETE',
    levelLabel: `Level ${levelIndex + 1}: ${summary.levelName}`,
    title: summary.callout,
    bannerText: cleared
      ? 'Level cleared - next challenge unlocked!'
      : 'Knock at least 30% of the pins to unlock the next level.',
    showBanner: true,
    hasNextLevel,
    isCampaignComplete: false,
    showPlayAgain: true,
    showNextLevel: hasNextLevel,
    showEditSetup: false,
    showMainMenu: true,
    playAgainLabel: 'Play Again',
    nextLevelLabel: 'Next Level',
    editSetupLabel: 'Edit Setup',
    mainMenuLabel: 'Main Menu',
    primaryLabel: hasNextLevel ? 'Next Level' : 'Play Again',
    secondaryLabel: hasNextLevel ? 'Play Again' : 'Main Menu',
    tertiaryLabel: 'Main Menu',
  };
}

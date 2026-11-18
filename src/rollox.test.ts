import {describe, expect, it} from 'vitest';

import {
  CAMPAIGN_LEVELS,
  MAX_LATERAL_PULL,
  MAX_PULL_DISTANCE,
  MIN_LAUNCH_POWER,
  WORKSHOP_MODULE_CATALOG,
  addWorkshopObstacle,
  appendWorkshopSegment,
  calculateLevelStars,
  compileWorkshopLevel,
  computeLaunchParameters,
  createDefaultWorkshopLayout,
  cycleWorkshopDifficulty,
  evaluateShotScoring,
  generatePinFormation,
  getSegmentExitSocket,
  removeWorkshopObstacle,
  removeWorkshopSegment,
  repositionWorkshopObstacle,
  repositionWorkshopSegment,
  rotateWorkshopSegment,
  stepWorkshopShots,
  syncWorkshopIdSeed,
  validateWorkshopLayout,
} from './levels';
import {
  MENU_BUTTON_COOLDOWN_MS,
  MenuInteractionGuard,
  PANEL_TRANSITION_LOCK_MS,
  buildResultsPresentation,
  getCampaignLevelCardState,
} from './menuInteraction';
import {RolloxStateMachine} from './stateMachine';
import type {CampaignProgress, ScoreSummary, WorkshopModuleKind} from './types';

describe('RolloxStateMachine', () => {
  it('enforces valid lifecycle transitions and pause/resume restoration', () => {
    const sm = new RolloxStateMachine();
    expect(sm.state).toBe('LOADING');
    expect(sm.transitionGame('MAIN_MENU')).toBe(true);
    expect(sm.transitionGame('READY')).toBe(true);
    expect(sm.transitionGame('AIMING')).toBe(true);

    // Pause from AIMING should resume back to READY safely
    expect(sm.pause()).toBe(true);
    expect(sm.state).toBe('PAUSED');
    expect(sm.previousBeforePause).toBe('READY');
    expect(sm.resume()).toBe(true);
    expect(sm.state).toBe('READY');
  });

  it('preserves WORKSHOP_TEST across pause/resume and rejects invalid transitions', () => {
    const sm = new RolloxStateMachine();
    sm.transitionGame('MAIN_MENU');
    sm.transitionGame('WORKSHOP');
    sm.transitionGame('WORKSHOP_TEST');
    expect(sm.pause()).toBe(true);
    expect(sm.previousBeforePause).toBe('WORKSHOP_TEST');
    expect(sm.resume()).toBe(true);
    expect(sm.state).toBe('WORKSHOP_TEST');

    const fresh = new RolloxStateMachine();
    expect(fresh.transitionGame('RESULT')).toBe(false);
    expect(fresh.state).toBe('LOADING');
  });

  it('supports rapid grab/release from ONBOARDING/READY and Play Again from Custom Game RESULT', () => {
    const sm = new RolloxStateMachine();
    sm.transitionGame('MAIN_MENU');
    sm.transitionGame('ONBOARDING');
    expect(sm.transitionGame('BALL_IN_MOTION')).toBe(true);
    expect(sm.transitionGame('SETTLING')).toBe(true);
    expect(sm.transitionGame('READY')).toBe(true);
    expect(sm.transitionGame('BALL_IN_MOTION')).toBe(true);
    expect(sm.transitionGame('SETTLING')).toBe(true);
    expect(sm.transitionGame('RESULT')).toBe(true);

    // Custom Game Play Again restarts directly into WORKSHOP_TEST
    expect(sm.transitionGame('WORKSHOP_TEST')).toBe(true);
    expect(sm.transitionGame('RESULT')).toBe(true);
    expect(sm.transitionGame('WORKSHOP')).toBe(true);
  });
});

describe('Launch Physics & Curves', () => {
  it('cancels launches below MIN_LAUNCH_POWER and clamps pullback pocket', () => {
    const tap = computeLaunchParameters(0, 0.005, 'smooth');
    expect(tap.canLaunch).toBe(false);
    expect(tap.power01).toBe(0);

    const full = computeLaunchParameters(
      MAX_LATERAL_PULL * 3,
      MAX_PULL_DISTANCE * 3,
      'linear'
    );
    expect(full.canLaunch).toBe(true);
    expect(full.power01).toBeCloseTo(1, 4);
    expect(full.velocity.z).toBeLessThan(0);
    // Pulling ball right (+X) aims shot left (-X)
    expect(full.dirX).toBeLessThan(0);
  });

  it('applies linear, smooth, and snappy curves monotonically', () => {
    const linear = computeLaunchParameters(0, MAX_PULL_DISTANCE * 0.5, 'linear');
    const smooth = computeLaunchParameters(0, MAX_PULL_DISTANCE * 0.5, 'smooth');
    const snappy = computeLaunchParameters(0, MAX_PULL_DISTANCE * 0.5, 'snappy');
    expect(linear.power01).toBeGreaterThanOrEqual(MIN_LAUNCH_POWER);
    expect(snappy.power01).toBeGreaterThan(smooth.power01);
    expect(smooth.power01).toBeCloseTo(0.5, 3);
  });
});

describe('Campaign Levels, Pin Formations & Scoring', () => {
  it('defines 5 valid campaign levels and all 4 pin formations cleanly', () => {
    expect(CAMPAIGN_LEVELS).toHaveLength(5);
    CAMPAIGN_LEVELS.forEach((lvl, idx) => {
      expect(lvl.index).toBe(idx);
      expect(lvl.segments.length).toBeGreaterThanOrEqual(3);
      expect(lvl.segments[0].id).toBe('launch-pad');
    });

    expect(generatePinFormation('standard10', {x: 0, y: 0, z: -1.3})).toHaveLength(10);
    expect(generatePinFormation('diamond9', {x: 0, y: 0, z: -1.3})).toHaveLength(9);
    expect(generatePinFormation('split8', {x: 0, y: 0, z: -1.3})).toHaveLength(8);
    expect(generatePinFormation('crown6', {x: 0, y: 0, z: -1.3})).toHaveLength(6);

    // Rotated pin deck rotates placements around deck origin
    const rotated = generatePinFormation('crown6', {x: 0, y: 0, z: -1.3}, Math.PI / 2);
    expect(rotated[0].x).toBeCloseTo(0, 5);
    expect(rotated[0].z).toBeCloseTo(-1.3, 5);
    expect(rotated[3].x).toBeLessThan(-0.1);
  });

  it('awards Strike, Spare, All Cleared, Partial, Miss, and Stars accurately', () => {
    const strike = evaluateShotScoring({
      newlyFallen: 10,
      totalFallen: 10,
      totalPins: 10,
      shotsUsed: 1,
    });
    expect(strike.isStrike).toBe(true);
    expect(strike.shotPoints).toBe(150);
    expect(calculateLevelStars(10, 10, 1, 2)).toBe(3);

    const spare = evaluateShotScoring({
      newlyFallen: 4,
      totalFallen: 10,
      totalPins: 10,
      shotsUsed: 2,
    });
    expect(spare.isSpare).toBe(true);
    expect(spare.shotPoints).toBe(65);
    expect(calculateLevelStars(10, 10, 2, 1)).toBe(3);

    const clearedThird = evaluateShotScoring({
      newlyFallen: 2,
      totalFallen: 10,
      totalPins: 10,
      shotsUsed: 3,
    });
    expect(clearedThird.isAllCleared).toBe(true);
    expect(clearedThird.shotPoints).toBe(35);
    expect(calculateLevelStars(10, 10, 3, 0)).toBe(2);

    const partial = evaluateShotScoring({
      newlyFallen: 3,
      totalFallen: 7,
      totalPins: 10,
      shotsUsed: 2,
    });
    expect(partial.shotPoints).toBe(30);
    expect(calculateLevelStars(7, 10, 3, 0)).toBe(2);

    const miss = evaluateShotScoring({
      newlyFallen: 0,
      totalFallen: 3,
      totalPins: 10,
      shotsUsed: 3,
    });
    expect(miss.shotPoints).toBe(0);
    expect(miss.callout).toContain('MISS');
    expect(calculateLevelStars(3, 10, 3, 0)).toBe(1);
    expect(calculateLevelStars(2, 10, 3, 0)).toBe(0);
  });
});

describe('Alley Workshop Builder, Custom Game Settings & Persistence', () => {
  it('supports all 8 module kinds, enforces caps, and rotates/moves/deletes safely', () => {
    const allKinds = Object.keys(WORKSHOP_MODULE_CATALOG) as WorkshopModuleKind[];
    expect(allKinds).toHaveLength(8);

    // Snap each module cleanly after a default segment
    for (const kind of allKinds) {
      let ws = createDefaultWorkshopLayout();
      ws = removeWorkshopSegment(ws); // 1 straight segment
      ws = appendWorkshopSegment(ws, kind);
      expect(ws.segments).toHaveLength(2);
      const val = validateWorkshopLayout(ws);
      expect(val.valid).toBe(true);
    }

    // Cap at 6 segments and 4 obstacles
    let full = createDefaultWorkshopLayout();
    for (let i = 0; i < 8; i++) {
      full = appendWorkshopSegment(full, 'short');
      full = addWorkshopObstacle(full, 'slidingBarrier');
    }
    expect(full.segments).toHaveLength(6);
    expect(full.obstacles).toHaveLength(4);

    // Rotate segment + verify validation catches extreme broken rotation / disconnection
    const firstId = full.segments[0].id;
    const rotated = rotateWorkshopSegment(full, firstId, 0.8);
    expect(validateWorkshopLayout(rotated).valid).toBe(false);

    // Obstacle movement & removal
    const obsId = full.obstacles[full.obstacles.length - 1].id;
    const floating = repositionWorkshopObstacle(full, obsId, 1.2, 0);
    expect(validateWorkshopLayout(floating).valid).toBe(false);
    const trimmed = removeWorkshopObstacle(floating, obsId);
    expect(trimmed.obstacles).toHaveLength(3);
  });

  it('catches obstacle overlap against rotated Workshop pin decks and prevents duplicate IDs after restore', () => {
    let layout = createDefaultWorkshopLayout();
    layout = {
      ...layout,
      obstacles: [],
      segments: [layout.segments[0]],
    };
    layout = appendWorkshopSegment(layout, 'leftTurn');
    layout = appendWorkshopSegment(layout, 'leftTurn');
    const lastExit = getSegmentExitSocket(layout.segments[layout.segments.length - 1]);
    // Place obstacle directly on the rotated pin deck center
    const overlapping = {
      ...layout,
      obstacles: [
        {
          id: 'obs-42',
          kind: 'bumper' as const,
          x: lastExit.x - Math.sin(lastExit.yawY) * 0.22,
          y: lastExit.y,
          z: lastExit.z - Math.cos(lastExit.yawY) * 0.22,
          yawY: lastExit.yawY,
          patrolRadius: 0.14,
          speed: 1.85,
          radius: 0.115,
        },
      ],
    };
    const res = validateWorkshopLayout(overlapping);
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes('pin deck'))).toBe(true);

    // Sync seed past obs-42 and verify new segment/obstacle IDs never collide
    syncWorkshopIdSeed(overlapping);
    const addedSeg = appendWorkshopSegment(overlapping, 'straight');
    const newSegId = addedSeg.segments[addedSeg.segments.length - 1].id;
    const segNum = Number(newSegId.split('-')[1]);
    expect(segNum).toBeGreaterThan(42);
  });

  it('compiles custom Workshop shots, difficulty speed scaling, rails toggle & pin formations', () => {
    let layout = createDefaultWorkshopLayout();
    layout = {...layout, railsEnabled: false, pinFormation: 'split8'};
    layout = stepWorkshopShots(layout, 2); // 4 -> 6 clamped
    layout = stepWorkshopShots(layout, 4);
    expect(layout.maxShots).toBe(6);
    layout = stepWorkshopShots(layout, -5);
    expect(layout.maxShots).toBe(2);

    const normalSpeed = compileWorkshopLevel(layout).obstacles[0].speed!;
    const fastLayout = cycleWorkshopDifficulty(layout);
    expect(fastLayout.difficulty).toBe('fast');
    const fastSpeed = compileWorkshopLevel(fastLayout).obstacles[0].speed!;
    expect(fastSpeed).toBeGreaterThan(normalSpeed);

    const relaxedLayout = cycleWorkshopDifficulty(fastLayout);
    expect(relaxedLayout.difficulty).toBe('relaxed');
    const relaxedSpeed = compileWorkshopLevel(relaxedLayout).obstacles[0].speed!;
    expect(relaxedSpeed).toBeLessThan(normalSpeed);

    const compiled = compileWorkshopLevel(layout);
    expect(compiled.layout).toBe('custom');
    expect(compiled.maxShots).toBe(2);
    expect(compiled.pinFormation).toBe('split8');
    expect(compiled.segments.every((s) => s.hasRails === false)).toBe(true);

    // Moving a segment breaks connectivity
    const broken = repositionWorkshopSegment(layout, layout.segments[0].id, 0.8, 0);
    expect(validateWorkshopLayout(broken).valid).toBe(false);
  });
});

describe('Menu Interaction Stability, Level Locks & Results Presentation', () => {
  it('enforces single-click cooldown and panel transition lock to stop repeated triggers', () => {
    const guard = new MenuInteractionGuard();

    // First click succeeds; rapid bounce within cooldown rejects
    expect(guard.canActivate('hud:hud-height-up', 1000)).toBe(true);
    expect(guard.canActivate('hud:hud-height-up', 1080)).toBe(false);
    expect(guard.canActivate('hud:hud-height-up', 1000 + MENU_BUTTON_COOLDOWN_MS)).toBe(true);

    // Switching panels locks all buttons briefly to prevent bleed-through clicks
    guard.notifyPanelTransition(2000);
    expect(guard.canActivate('level-select:btn-lvl-0', 2050)).toBe(false);
    expect(
      guard.canActivate('level-select:btn-lvl-0', 2000 + PANEL_TRANSITION_LOCK_MS)
    ).toBe(true);
  });

  it('distinguishes completed, current, unlocked, and locked campaign levels cleanly', () => {
    const progress: CampaignProgress = {
      unlockedLevelIndex: 2,
      completedLevels: [0, 1],
      bestScores: {'meadow-straight': 150, 'serpent-zigzag': 110},
      bestStars: {'meadow-straight': 3, 'serpent-zigzag': 2},
      onboardingCompleted: true,
    };

    const c0 = getCampaignLevelCardState(0, progress);
    expect(c0.status).toBe('COMPLETED');
    expect(c0.unlocked).toBe(true);
    expect(c0.buttonLabel).toBe('Replay');

    const c2 = getCampaignLevelCardState(2, progress);
    expect(c2.status).toBe('CURRENT');
    expect(c2.unlocked).toBe(true);
    expect(c2.buttonLabel).toBe('Play');

    const c3 = getCampaignLevelCardState(3, progress);
    expect(c3.status).toBe('LOCKED');
    expect(c3.unlocked).toBe(false);
    expect(c3.buttonLabel).toBe('Locked');
  });

  it('formats Campaign Results, Final Level Completion banner, and Custom Game Results cleanly', () => {
    const lvl1Summary: ScoreSummary = {
      levelId: 'meadow-straight',
      levelName: 'Meadow Straight',
      pinsKnocked: 10,
      totalPins: 10,
      shotsUsed: 1,
      maxShots: 3,
      levelScore: 150,
      bestScore: 150,
      totalScore: 150,
      stars: 3,
      callout: 'STRIKE! +50 BONUS',
      isCustomWorkshop: false,
    };
    const midPres = buildResultsPresentation({
      summary: lvl1Summary,
      levelIndex: 0,
      totalLevels: 5,
      unlockedLevelIndex: 1,
    });
    expect(midPres.eyebrow).toBe('LEVEL COMPLETED!');
    expect(midPres.bannerTone).toBe('success');
    expect(midPres.hasNextLevel).toBe(true);
    expect(midPres.showNextLevel).toBe(true);
    expect(midPres.showPlayAgain).toBe(true);
    expect(midPres.showOtherLevels).toBe(true);
    expect(midPres.showEditSetup).toBe(false);
    expect(midPres.showMainMenu).toBe(true);
    expect(midPres.levelLabel).toBe('Level 1: Meadow Straight');
    expect(midPres.nextLevelLabel).toBe('Next Level');
    expect(midPres.playAgainLabel).toBe('Play Again');
    expect(midPres.otherLevelsLabel).toBe('Other Levels');
    expect(midPres.mainMenuLabel).toBe('Main Menu');
    expect(midPres.primaryLabel).toBe('Next Level');
    expect(midPres.secondaryLabel).toBe('Play Again');
    expect(midPres.tertiaryLabel).toBe('Main Menu');

    const failedZeroPres = buildResultsPresentation({
      summary: {...lvl1Summary, stars: 0, pinsKnocked: 0, callout: 'MISS'},
      levelIndex: 0,
      totalLevels: 5,
      unlockedLevelIndex: 0,
    });
    expect(failedZeroPres.eyebrow).toBe('LEVEL NOT COMPLETED');
    expect(failedZeroPres.title).toBe('NO PINS KNOCKED');
    expect(failedZeroPres.bannerTone).toBe('warning');
    expect(failedZeroPres.showNextLevel).toBe(false);
    expect(failedZeroPres.showPlayAgain).toBe(true);
    expect(failedZeroPres.playAgainLabel).toBe('Try Again');
    expect(failedZeroPres.showOtherLevels).toBe(true);
    expect(failedZeroPres.otherLevelsLabel).toBe('Other Levels');
    expect(failedZeroPres.showMainMenu).toBe(true);
    expect(failedZeroPres.primaryLabel).toBe('Try Again');
    expect(failedZeroPres.secondaryLabel).toBe('Other Levels');

    const failedPartialPres = buildResultsPresentation({
      summary: {...lvl1Summary, stars: 0, pinsKnocked: 1, callout: 'NICE TRY'},
      levelIndex: 0,
      totalLevels: 5,
      unlockedLevelIndex: 1,
    });
    expect(failedPartialPres.eyebrow).toBe('LEVEL NOT COMPLETED');
    expect(failedPartialPres.title).toBe('ALMOST THERE!');
    expect(failedPartialPres.showNextLevel).toBe(false);
    expect(failedPartialPres.playAgainLabel).toBe('Try Again');
    expect(failedPartialPres.showOtherLevels).toBe(true);

    const finalPres = buildResultsPresentation({
      summary: {...lvl1Summary, levelName: 'Crown Gauntlet'},
      levelIndex: 4,
      totalLevels: 5,
      unlockedLevelIndex: 4,
    });
    expect(finalPres.isCampaignComplete).toBe(true);
    expect(finalPres.eyebrow).toBe('CAMPAIGN COMPLETE!');
    expect(finalPres.bannerTone).toBe('gold');
    expect(finalPres.hasNextLevel).toBe(false);
    expect(finalPres.showNextLevel).toBe(false);
    expect(finalPres.showPlayAgain).toBe(true);
    expect(finalPres.showOtherLevels).toBe(true);
    expect(finalPres.showMainMenu).toBe(true);
    expect(finalPres.bannerText).toContain('CAMPAIGN COMPLETE');
    expect(finalPres.primaryLabel).toBe('Play Again');

    const customPres = buildResultsPresentation({
      summary: {...lvl1Summary, isCustomWorkshop: true},
      levelIndex: 0,
      totalLevels: 5,
    });
    expect(customPres.eyebrow).toBe('CUSTOM GAME COMPLETE');
    expect(customPres.levelLabel).toBe('Custom Game: Meadow Straight');
    expect(customPres.showPlayAgain).toBe(true);
    expect(customPres.showNextLevel).toBe(false);
    expect(customPres.showOtherLevels).toBe(false);
    expect(customPres.showEditSetup).toBe(true);
    expect(customPres.showMainMenu).toBe(true);
    expect(customPres.primaryLabel).toBe('Play Again');
    expect(customPres.secondaryLabel).toBe('Edit Setup');
    expect(customPres.tertiaryLabel).toBe('Main Menu');
  });
});

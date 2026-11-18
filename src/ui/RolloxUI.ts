import * as THREE from 'three';
import * as xb from 'xrblocks';

import {CAMPAIGN_LEVELS} from '../levels';
import type {
  BuilderConfig,
  GamePhase,
  LevelConfig,
  PinFormation,
  ScoreSummary,
} from '../types';

export interface RolloxUICallbacks {
  onStartPlay: () => void;
  onSelectLevel: (index: number) => void;
  onOpenLevels: () => void;
  onOpenBuilder: () => void;
  onResetShot: () => void;
  onReplayLevel: () => void;
  onNextLevel: () => void;
  onTogglePause: () => void;
  onToggleMute: () => boolean;
  onRecenterArena: () => void;
  onBuilderChange: (next: BuilderConfig) => void;
  onBuilderTest: () => void;
  onBuilderReset: () => void;
  onBackToTitle: () => void;
}

export class RolloxUI extends THREE.Group {
  public titleCard: xb.UICard;
  public hudCard: xb.UICard;
  public levelsCard: xb.UICard;
  public modalCard: xb.UICard;
  public builderCard: xb.UICard;
  public onboardingCard: xb.UICard;
  public calloutCard: xb.UICard;

  private hudLevelTitle: xb.UIText;
  private hudLevelHint: xb.UIText;
  private hudPinsText: xb.UIText;
  private hudShotsText: xb.UIText;
  private hudScoreText: xb.UIText;
  private hudTotalText: xb.UIText;
  private hudPowerText: xb.UIText;
  private muteButton: xb.UIButton;

  private modalTitle: xb.UIText;
  private modalStars: xb.UIText;
  private modalDetails: xb.UIText;
  private modalPrimaryBtn: xb.UIButton;
  private modalSecondaryBtn: xb.UIButton;

  private builderSummaryText: xb.UIText;
  private calloutText: xb.UIText;

  private levelButtons: xb.UIButton[] = [];
  private builderState: BuilderConfig;
  private callbacks: RolloxUICallbacks;
  private calloutTimer = 0;

  constructor(initialBuilder: BuilderConfig, callbacks: RolloxUICallbacks) {
    super();
    this.name = 'Rollox Spatial UI';
    this.builderState = {...initialBuilder};
    this.callbacks = callbacks;

    xb.ui.theme = 'glimmerAmber';

    // 1. Title Screen Card (sits cleanly above the miniature lane so live 3D alley is the hero)
    this.titleCard = new xb.UICard({
      size: {width: 0.72, height: 'auto'},
      manipulation: true,
      edge: true,
      style: {
        flexDirection: 'column',
        alignItems: 'center',
        gap: 14,
        padding: 24,
      },
      children: [
        new xb.UIText({
          text: 'ROLLOX',
          style: {
            fontSize: 44,
            fontWeight: 'bold',
            color: '#fbbf24',
            textAlign: 'center',
          },
        }),
        new xb.UIText({
          text: 'Miniature Mixed-Reality Bowling',
          style: {
            fontSize: 20,
            opacity: 0.88,
            textAlign: 'center',
          },
        }),
        new xb.UIPanel({
          style: {
            width: '100%',
            flexDirection: 'row',
            gap: 12,
            marginTop: 6,
          },
          children: [
            new xb.UIButton({
              label: 'Play Campaign',
              icon: 'play_arrow',
              style: {flexGrow: 1, height: 52},
              onClick: () => this.callbacks.onStartPlay(),
            }),
            new xb.UIButton({
              label: 'Select Lane',
              icon: 'layers',
              style: {flexGrow: 1, height: 52},
              onClick: () => this.callbacks.onOpenLevels(),
            }),
            new xb.UIButton({
              label: 'Custom Builder',
              icon: 'build',
              style: {flexGrow: 1, height: 52},
              onClick: () => this.callbacks.onOpenBuilder(),
            }),
          ],
        }),
        new xb.UIText({
          text: 'Pinch or drag ball back to aim · Release to bowl · R Reset · Esc Pause',
          style: {
            fontSize: 15,
            opacity: 0.72,
            textAlign: 'center',
          },
        }),
      ],
    });
    this.titleCard.position.set(0, 1.56, -1.08);
    this.add(this.titleCard);

    // 2. Compact Scoreboard & Controls Dock (upper-left flank, leaving lane 100% unobstructed)
    this.hudLevelTitle = new xb.UIText({
      text: '1. Meadow Straight',
      style: {fontSize: 22, fontWeight: 'bold', color: '#fbbf24'},
    });
    this.hudLevelHint = new xb.UIText({
      text: 'Pinch & pull ball back to bowl.',
      style: {fontSize: 14, opacity: 0.82, lineHeight: 1.3},
    });
    this.hudPinsText = new xb.UIText({
      text: 'Pins: 0 / 10',
      style: {fontSize: 18, fontWeight: 'bold'},
    });
    this.hudShotsText = new xb.UIText({
      text: 'Shots: 3',
      style: {fontSize: 18, fontWeight: 'bold'},
    });
    this.hudScoreText = new xb.UIText({
      text: 'Score: 0',
      style: {fontSize: 18, fontWeight: 'bold', color: '#fde68a'},
    });
    this.hudTotalText = new xb.UIText({
      text: 'Total: 0',
      style: {fontSize: 16, opacity: 0.8},
    });
    this.hudPowerText = new xb.UIText({
      text: 'Power: Ready',
      style: {fontSize: 15, color: '#7dd3fc'},
    });

    this.muteButton = new xb.UIButton({
      label: 'Audio',
      icon: 'volume_up',
      style: {flexGrow: 1, height: 42},
      onClick: () => {
        const muted = this.callbacks.onToggleMute();
        this.muteButton.icon = muted ? 'volume_off' : 'volume_up';
        this.muteButton.label = muted ? 'Muted' : 'Audio';
      },
    });

    this.hudCard = new xb.UICard({
      size: {width: 0.44, height: 'auto'},
      manipulation: true,
      edge: true,
      style: {
        flexDirection: 'column',
        gap: 10,
        padding: 16,
      },
      children: [
        this.hudLevelTitle,
        this.hudLevelHint,
        new xb.UIPanel({
          style: {
            width: '100%',
            flexDirection: 'row',
            justifyContent: 'space-between',
            padding: 10,
            borderRadius: 14,
            backgroundColor: 'rgba(255, 255, 255, 0.08)',
          },
          children: [this.hudPinsText, this.hudShotsText],
        }),
        new xb.UIPanel({
          style: {
            width: '100%',
            flexDirection: 'row',
            justifyContent: 'space-between',
            padding: 10,
            borderRadius: 14,
            backgroundColor: 'rgba(255, 255, 255, 0.08)',
          },
          children: [this.hudScoreText, this.hudTotalText],
        }),
        this.hudPowerText,
        new xb.UIPanel({
          style: {width: '100%', flexDirection: 'row', gap: 8},
          children: [
            new xb.UIButton({
              label: 'Reset',
              icon: 'restart_alt',
              style: {flexGrow: 1, height: 42},
              onClick: () => this.callbacks.onResetShot(),
            }),
            new xb.UIButton({
              label: 'Lanes',
              icon: 'layers',
              style: {flexGrow: 1, height: 42},
              onClick: () => this.callbacks.onOpenLevels(),
            }),
          ],
        }),
        new xb.UIPanel({
          style: {width: '100%', flexDirection: 'row', gap: 8},
          children: [
            new xb.UIButton({
              label: 'Build',
              icon: 'build',
              style: {flexGrow: 1, height: 42},
              onClick: () => this.callbacks.onOpenBuilder(),
            }),
            this.muteButton,
            new xb.UIButton({
              label: 'Pause',
              icon: 'pause',
              style: {flexGrow: 1, height: 42},
              onClick: () => this.callbacks.onTogglePause(),
            }),
          ],
        }),
        new xb.UIButton({
          label: 'Recenter Table',
          icon: 'tune',
          style: {width: '100%', height: 40},
          onClick: () => this.callbacks.onRecenterArena(),
        }),
      ],
    });
    this.hudCard.position.set(-0.58, 1.36, -1.04);
    this.hudCard.rotation.y = 0.34;
    this.hudCard.visible = false;
    this.add(this.hudCard);

    // 3. Level Select Card
    const levelRows = CAMPAIGN_LEVELS.map((lvl, idx) => {
      const btn = new xb.UIButton({
        label: `${idx + 1}. ${lvl.name} (${lvl.maxShots} shots)`,
        style: {width: '100%', height: 44},
        onClick: () => this.callbacks.onSelectLevel(idx),
      });
      this.levelButtons.push(btn);
      return btn;
    });

    this.levelsCard = new xb.UICard({
      size: {width: 0.56, height: 'auto'},
      manipulation: true,
      edge: true,
      style: {flexDirection: 'column', gap: 10, padding: 20},
      children: [
        new xb.UIText({
          text: 'Select Miniature Lane',
          style: {fontSize: 26, fontWeight: 'bold', textAlign: 'center'},
        }),
        ...levelRows,
        new xb.UIButton({
          label: 'Back',
          icon: 'close',
          style: {width: '100%', height: 44},
          onClick: () => this.callbacks.onBackToTitle(),
        }),
      ],
    });
    this.levelsCard.position.set(0, 1.44, -0.96);
    this.levelsCard.visible = false;
    this.add(this.levelsCard);

    // 4. Pause / Level Complete Result Modal
    this.modalTitle = new xb.UIText({
      text: 'Level Complete!',
      style: {
        fontSize: 28,
        fontWeight: 'bold',
        color: '#fbbf24',
        textAlign: 'center',
      },
    });
    this.modalStars = new xb.UIText({
      text: '★★★',
      style: {fontSize: 34, color: '#fde047', textAlign: 'center'},
    });
    this.modalDetails = new xb.UIText({
      text: 'Pins: 10 / 10\nLevel Score: 150',
      style: {
        fontSize: 18,
        lineHeight: 1.4,
        whiteSpace: 'pre-line',
        textAlign: 'center',
      },
    });
    this.modalPrimaryBtn = new xb.UIButton({
      label: 'Next Level',
      icon: 'play_arrow',
      style: {flexGrow: 1, height: 48},
      onClick: () => this.callbacks.onNextLevel(),
    });
    this.modalSecondaryBtn = new xb.UIButton({
      label: 'Replay',
      icon: 'restart_alt',
      style: {flexGrow: 1, height: 48},
      onClick: () => this.callbacks.onReplayLevel(),
    });

    this.modalCard = new xb.UICard({
      size: {width: 0.54, height: 'auto'},
      manipulation: true,
      edge: true,
      style: {flexDirection: 'column', gap: 12, padding: 22},
      children: [
        this.modalTitle,
        this.modalStars,
        this.modalDetails,
        new xb.UIPanel({
          style: {width: '100%', flexDirection: 'row', gap: 10},
          children: [this.modalPrimaryBtn, this.modalSecondaryBtn],
        }),
        new xb.UIButton({
          label: 'Main Menu',
          icon: 'close',
          style: {width: '100%', height: 42},
          onClick: () => this.callbacks.onBackToTitle(),
        }),
      ],
    });
    this.modalCard.position.set(0, 1.42, -0.94);
    this.modalCard.visible = false;
    this.add(this.modalCard);

    // 5. Custom Modular Builder Card (right flank so player watches pieces update live!)
    this.builderSummaryText = new xb.UIText({
      text: '',
      style: {fontSize: 15, opacity: 0.85, textAlign: 'center'},
    });

    this.builderCard = new xb.UICard({
      size: {width: 0.48, height: 'auto'},
      manipulation: true,
      edge: true,
      style: {flexDirection: 'column', gap: 10, padding: 18},
      children: [
        new xb.UIText({
          text: 'Alley Workshop',
          style: {
            fontSize: 24,
            fontWeight: 'bold',
            color: '#fbbf24',
            textAlign: 'center',
          },
        }),
        this.builderSummaryText,
        new xb.UIText({
          text: 'Lane Piece',
          style: {fontSize: 15, fontWeight: 'bold'},
        }),
        new xb.UIPanel({
          style: {width: '100%', flexDirection: 'row', gap: 6},
          children: [
            new xb.UIButton({
              label: 'Straight',
              style: {flexGrow: 1, height: 40},
              onClick: () => this.updateBuilder({layout: 'straight'}),
            }),
            new xb.UIButton({
              label: 'Zigzag',
              style: {flexGrow: 1, height: 40},
              onClick: () => this.updateBuilder({layout: 'zigzag'}),
            }),
            new xb.UIButton({
              label: 'Ramp',
              style: {flexGrow: 1, height: 40},
              onClick: () => this.updateBuilder({layout: 'elevated'}),
            }),
          ],
        }),
        new xb.UIText({
          text: 'Obstacles',
          style: {fontSize: 15, fontWeight: 'bold'},
        }),
        new xb.UIPanel({
          style: {width: '100%', flexDirection: 'row', gap: 6},
          children: [
            new xb.UIButton({
              label: 'None',
              style: {flexGrow: 1, height: 40},
              onClick: () => this.updateBuilder({obstacleMode: 'none'}),
            }),
            new xb.UIButton({
              label: 'Dwarf',
              style: {flexGrow: 1, height: 40},
              onClick: () => this.updateBuilder({obstacleMode: 'dwarf'}),
            }),
            new xb.UIButton({
              label: 'Spinner',
              style: {flexGrow: 1, height: 40},
              onClick: () => this.updateBuilder({obstacleMode: 'bumper'}),
            }),
            new xb.UIButton({
              label: 'Both',
              style: {flexGrow: 1, height: 40},
              onClick: () => this.updateBuilder({obstacleMode: 'both'}),
            }),
          ],
        }),
        new xb.UIText({
          text: 'Pin Setup',
          style: {fontSize: 15, fontWeight: 'bold'},
        }),
        new xb.UIPanel({
          style: {width: '100%', flexDirection: 'row', gap: 6},
          children: [
            this.makePinBtn('10 Pins', 'standard10'),
            this.makePinBtn('Diamond 9', 'diamond9'),
            this.makePinBtn('Split 8', 'split710'),
            this.makePinBtn('Crown 6', 'crown6'),
          ],
        }),
        new xb.UIButton({
          label: 'Toggle Side Rails',
          icon: 'tune',
          style: {width: '100%', height: 40},
          onClick: () =>
            this.updateBuilder({railsEnabled: !this.builderState.railsEnabled}),
        }),
        new xb.UIPanel({
          style: {width: '100%', flexDirection: 'row', gap: 8, marginTop: 4},
          children: [
            new xb.UIButton({
              label: 'Test Alley',
              icon: 'play_arrow',
              style: {flexGrow: 1, height: 46},
              onClick: () => this.callbacks.onBuilderTest(),
            }),
            new xb.UIButton({
              label: 'Reset',
              icon: 'restart_alt',
              style: {flexGrow: 1, height: 46},
              onClick: () => this.callbacks.onBuilderReset(),
            }),
          ],
        }),
        new xb.UIButton({
          label: 'Back to Menu',
          icon: 'close',
          style: {width: '100%', height: 40},
          onClick: () => this.callbacks.onBackToTitle(),
        }),
      ],
    });
    this.builderCard.position.set(0.58, 1.36, -1.0);
    this.builderCard.rotation.y = -0.34;
    this.builderCard.visible = false;
    this.add(this.builderCard);
    this.refreshBuilderSummary();

    // 6. Lightweight First-Shot Onboarding Hint beside the launch pedestal
    this.onboardingCard = new xb.UICard({
      size: {width: 0.34, height: 'auto'},
      pointerEvents: 'none',
      style: {padding: 12, gap: 4},
      children: [
        new xb.UIText({
          text: 'Pinch or Drag Ball Back',
          style: {
            fontSize: 18,
            fontWeight: 'bold',
            color: '#fbbf24',
            textAlign: 'center',
          },
        }),
        new xb.UIText({
          text: 'Pull back for power · Aim sideways · Release!',
          style: {fontSize: 13, opacity: 0.88, textAlign: 'center'},
        }),
      ],
    });
    this.onboardingCard.position.set(0.32, 1.09, -0.52);
    this.onboardingCard.rotation.y = -0.28;
    this.onboardingCard.visible = false;
    this.add(this.onboardingCard);

    // 7. Shot Feedback Callout Banner above pin deck
    this.calloutText = new xb.UIText({
      text: 'STRIKE!',
      style: {
        fontSize: 34,
        fontWeight: 'bold',
        color: '#fde047',
        textAlign: 'center',
      },
    });
    this.calloutCard = new xb.UICard({
      size: {width: 0.44, height: 'auto'},
      pointerEvents: 'none',
      style: {padding: 12},
      children: [this.calloutText],
    });
    this.calloutCard.position.set(0, 1.34, -1.62);
    this.calloutCard.visible = false;
    this.add(this.calloutCard);
  }

  private makePinBtn(label: string, formation: PinFormation): xb.UIButton {
    return new xb.UIButton({
      label,
      style: {flexGrow: 1, height: 40},
      onClick: () => this.updateBuilder({pinFormation: formation}),
    });
  }

  private updateBuilder(patch: Partial<BuilderConfig>): void {
    this.builderState = {...this.builderState, ...patch};
    this.refreshBuilderSummary();
    this.callbacks.onBuilderChange({...this.builderState});
  }

  public setBuilderState(state: BuilderConfig): void {
    this.builderState = {...state};
    this.refreshBuilderSummary();
  }

  private refreshBuilderSummary(): void {
    const rails = this.builderState.railsEnabled ? 'Rails ON' : 'No Rails';
    this.builderSummaryText.text = `${this.builderState.layout.toUpperCase()} · ${this.builderState.obstacleMode.toUpperCase()} · ${this.builderState.pinFormation} · ${rails}`;
  }

  setPhase(
    phase: GamePhase,
    options?: {showLevels?: boolean; isPauseModal?: boolean; showOnboarding?: boolean}
  ): void {
    const showLevels = options?.showLevels ?? false;
    this.titleCard.visible = phase === 'title' && !showLevels;
    this.levelsCard.visible = showLevels;
    this.hudCard.visible = phase === 'playing' || phase === 'paused' || phase === 'builder';
    this.builderCard.visible = phase === 'builder' && !showLevels;
    this.modalCard.visible =
      (phase === 'paused' || phase === 'levelComplete') && !showLevels;
    this.onboardingCard.visible =
      phase === 'playing' && Boolean(options?.showOnboarding);

    if (phase === 'paused') {
      this.modalTitle.text = 'Game Paused';
      this.modalStars.text = '🎳';
      this.modalDetails.text = 'Take a breather or adjust your shot.';
      this.modalPrimaryBtn.label = 'Resume';
      this.modalPrimaryBtn.icon = 'play_arrow';
      this.modalPrimaryBtn.onClick = () => this.callbacks.onTogglePause();
      this.modalSecondaryBtn.label = 'Restart Lane';
      this.modalSecondaryBtn.onClick = () => this.callbacks.onReplayLevel();
    }
  }

  showLevelResult(summary: ScoreSummary, hasNextLevel: boolean): void {
    this.modalTitle.text =
      summary.pinsKnocked === summary.totalPins ? 'Lane Cleared!' : 'Round Complete';
    this.modalStars.text =
      '★'.repeat(summary.stars) + '☆'.repeat(3 - summary.stars);
    this.modalDetails.text =
      `${summary.callout}\n` +
      `Pins: ${summary.pinsKnocked} / ${summary.totalPins} · Shots: ${summary.shotsUsed}/${summary.maxShots}\n` +
      `Lane Score: ${summary.levelScore} · Campaign: ${summary.totalScore}`;

    if (hasNextLevel) {
      this.modalPrimaryBtn.label = 'Next Level';
      this.modalPrimaryBtn.icon = 'play_arrow';
      this.modalPrimaryBtn.onClick = () => this.callbacks.onNextLevel();
    } else {
      this.modalPrimaryBtn.label = 'Play Again';
      this.modalPrimaryBtn.icon = 'play_arrow';
      this.modalPrimaryBtn.onClick = () => this.callbacks.onReplayLevel();
    }
    this.modalSecondaryBtn.label = 'Replay';
    this.modalSecondaryBtn.onClick = () => this.callbacks.onReplayLevel();
  }

  updateHud(
    level: LevelConfig,
    pinsKnocked: number,
    totalPins: number,
    shotsLeft: number,
    levelScore: number,
    totalScore: number
  ): void {
    this.hudLevelTitle.text =
      level.index >= 0
        ? `${level.index + 1}/${CAMPAIGN_LEVELS.length} · ${level.name}`
        : level.name;
    this.hudLevelHint.text = level.hint;
    this.hudPinsText.text = `Pins: ${pinsKnocked} / ${totalPins}`;
    this.hudShotsText.text = `Shots: ${shotsLeft}`;
    this.hudScoreText.text = `Score: ${levelScore}`;
    this.hudTotalText.text = `Total: ${totalScore}`;
  }

  updateAimPower(power01: number | null): void {
    if (power01 === null) {
      this.hudPowerText.text = 'Power: Ready to Grab';
      this.hudPowerText.style.color = '#7dd3fc';
      return;
    }
    const pct = Math.round(power01 * 100);
    this.hudPowerText.text = `Power: ${pct}%`;
    this.hudPowerText.style.color =
      pct > 80 ? '#f87171' : pct > 45 ? '#fde047' : '#4ade80';
  }

  showCallout(message: string, color = '#fde047', duration = 1.9): void {
    this.calloutText.text = message;
    this.calloutText.style.color = color;
    this.calloutCard.visible = true;
    this.calloutTimer = duration;
  }

  hideOnboarding(): void {
    this.onboardingCard.visible = false;
  }

  tick(dt: number): void {
    if (this.calloutTimer > 0) {
      this.calloutTimer -= dt;
      if (this.calloutTimer <= 0) {
        this.calloutCard.visible = false;
      }
    }
  }
}

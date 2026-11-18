import {
  Entity,
  PokeInteractable,
  RayInteractable,
  UIKitMLAsset,
  VisibilityState,
  createSystem,
} from '@iwsdk/core';
import * as THREE from 'three';

import {SpatialPanelTag} from '../components';
import {CAMPAIGN_LEVELS} from '../levels';
import {UI_SCALE_DEFAULT, UI_SCALE_STEP, clampUiScale} from '../pullInteraction';
import type {
  CampaignProgress,
  GameSettings,
  GrabState,
  ObstacleKind,
  PinFormation,
  ScoreSummary,
  WorkshopLayout,
  WorkshopModuleKind,
  WorkshopValidationResult,
} from '../types';

export type PanelKey =
  | 'main-menu'
  | 'hud'
  | 'level-select'
  | 'workshop'
  | 'settings'
  | 'instructions'
  | 'modal'
  | 'onboarding'
  | 'callout';

export type ModalMode = 'PAUSE' | 'RESULT' | 'WORKSHOP_RESULT';

export interface SpatialUIActionHandler {
  onPlayCampaign: () => void;
  onQuickPlay: () => void;
  onOpenLevelSelect: () => void;
  onSelectLevel: (index: number) => void;
  onOpenWorkshop: () => void;
  onOpenSettings: () => void;
  onOpenInstructions: () => void;
  onBackToMenu: () => void;
  onCloseSubScreen: () => void;
  onReplayOnboarding: () => void;
  onSkipOnboarding: () => void;
  onResetBall: () => void;
  onRecenterTable: () => void;
  onAdjustHeight: (deltaM: number) => void;
  onAdjustDistance: (deltaM: number) => void;
  onResetPlacement: () => void;
  onToggleMute: () => void;
  onAdjustVolume: (delta: number) => void;
  onSetPowerCurve: (curve: 'linear' | 'smooth' | 'snappy') => void;
  onToggleTrajectory: () => void;
  onAdjustUiScale: (delta: number) => void;
  onResetUiScale: () => void;
  onPause: () => void;
  onModalPrimary: () => void;
  onModalSecondary: () => void;
  onModalTertiary: () => void;
  // Workshop actions
  onWorkshopAddSegment: (kind: WorkshopModuleKind) => void;
  onWorkshopSelectSegOffset: (delta: number) => void;
  onWorkshopMoveSeg: (dx: number, dz: number) => void;
  onWorkshopRotateSeg: (deltaYawRad: number) => void;
  onWorkshopDeleteSeg: () => void;
  onWorkshopAddObstacle: (kind: ObstacleKind) => void;
  onWorkshopMoveObs: (dx: number, dz: number) => void;
  onWorkshopDeleteObs: () => void;
  onWorkshopSetPins: (formation: PinFormation) => void;
  onWorkshopToggleRails: () => void;
  onWorkshopTestAlley: () => void;
  onWorkshopResetLayout: () => void;
}

interface ManagedPanel {
  key: PanelKey;
  nodeId: string;
  entity: Entity;
  asset: UIKitMLAsset;
  baseOffset: THREE.Vector3;
  offset: THREE.Vector3;
  yawRad: number;
  pitchRad: number;
  baseWidthM: number;
  baseHeightM: number;
}

const NODE_ID_BY_KEY: Record<PanelKey, string> = {
  'main-menu': 'main-menu-panel',
  hud: 'hud-panel',
  'level-select': 'level-select-panel',
  workshop: 'workshop-panel',
  settings: 'settings-panel',
  instructions: 'instructions-panel',
  modal: 'modal-panel',
  onboarding: 'onboarding-panel',
  callout: 'callout-panel',
};

const INTERACTIVE_PANELS = new Set<PanelKey>([
  'main-menu',
  'hud',
  'level-select',
  'workshop',
  'settings',
  'instructions',
  'modal',
  'onboarding',
]);

/**
 * IWSDK ECS System managing all 9 UIKitML spatial UI panels, Horizon kit buttons,
 * hand poke + ray pointer hit filtering, table-locked spatial synchronization,
 * callout toast timers, and 2D XR entry dock state.
 */
export class SpatialUISystem extends createSystem({}) {
  private panels = new Map<PanelKey, ManagedPanel>();
  private handler: SpatialUIActionHandler | null = null;
  private calloutHideAt = 0;
  private currentUiScale = UI_SCALE_DEFAULT;

  private _offset = new THREE.Vector3();
  private _quatY = new THREE.Quaternion();
  private _yAxis = new THREE.Vector3(0, 1, 0);

  init(): void {
    (Object.keys(NODE_ID_BY_KEY) as PanelKey[]).forEach((key) => {
      const nodeId = NODE_ID_BY_KEY[key];
      const entity = this.world.getSceneEntity(nodeId);
      const asset = this.world.getSceneObject<UIKitMLAsset>(nodeId);
      if (!entity || !asset) {
        console.warn(`[SpatialUISystem] Missing scene node '${nodeId}'`);
        return;
      }

      const w = entity.hasComponent(SpatialPanelTag)
        ? entity.getValue(SpatialPanelTag, 'targetWidthM') ?? 0.56
        : 0.56;
      const h = entity.hasComponent(SpatialPanelTag)
        ? entity.getValue(SpatialPanelTag, 'targetHeightM') ?? 0.44
        : 0.44;
      asset.document.setTargetDimensions(
        w * this.currentUiScale,
        h * this.currentUiScale
      );

      const ox = entity.hasComponent(SpatialPanelTag)
        ? entity.getValue(SpatialPanelTag, 'offsetX') ?? 0
        : 0;
      const oy = entity.hasComponent(SpatialPanelTag)
        ? entity.getValue(SpatialPanelTag, 'offsetY') ?? 0.4
        : 0.4;
      const oz = entity.hasComponent(SpatialPanelTag)
        ? entity.getValue(SpatialPanelTag, 'offsetZ') ?? -0.5
        : -0.5;
      const yawDeg = entity.hasComponent(SpatialPanelTag)
        ? entity.getValue(SpatialPanelTag, 'yawDeg') ?? 0
        : 0;
      const pitchDeg = entity.hasComponent(SpatialPanelTag)
        ? entity.getValue(SpatialPanelTag, 'pitchDeg') ?? 0
        : 0;

      if (INTERACTIVE_PANELS.has(key)) {
        if (!entity.hasComponent(RayInteractable)) {
          entity.addComponent(RayInteractable);
        }
        if (!entity.hasComponent(PokeInteractable)) {
          entity.addComponent(PokeInteractable);
        }
      } else {
        asset.pointerEvents = 'none';
      }

      this.panels.set(key, {
        key,
        nodeId,
        entity,
        asset,
        baseOffset: new THREE.Vector3(ox, oy, oz),
        offset: new THREE.Vector3(ox, oy, oz),
        yawRad: THREE.MathUtils.degToRad(yawDeg),
        pitchRad: THREE.MathUtils.degToRad(pitchDeg),
        baseWidthM: w,
        baseHeightM: h,
      });
    });

    this.bindUIListeners();
    this.setVisiblePanels(new Set());
    this.wire2DDock();
  }

  setActionHandler(handler: SpatialUIActionHandler): void {
    this.handler = handler;
  }

  /**
   * Scales all spatial UI panels uniformly using UIKitDocument.setTargetDimensions
   * while keeping text crisp, interaction colliders aligned, and the 3D bowling
   * arena completely unscaled.
   */
  setUiScale(rawScale: number): number {
    this.currentUiScale = clampUiScale(rawScale);
    const extraLift = Math.max(0, this.currentUiScale - 1.0);

    for (const [key, panel] of this.panels.entries()) {
      panel.asset.document.setTargetDimensions(
        panel.baseWidthM * this.currentUiScale,
        panel.baseHeightM * this.currentUiScale
      );
      panel.offset.copy(panel.baseOffset);
      panel.offset.y += extraLift * (key === 'callout' ? 0.1 : 0.085);
    }

    const label = `${Math.round(this.currentUiScale * 100)}%`;
    this.setText('settings', 'set-scale-val', label);
    this.setText('main-menu', 'menu-scale-val', label);
    return this.currentUiScale;
  }

  private setText(panelKey: PanelKey, id: string, text: string): void {
    const el = this.panels.get(panelKey)?.asset.getElementById(id);
    el?.setProperties({text});
  }

  private setProps(
    panelKey: PanelKey,
    id: string,
    props: Record<string, unknown>
  ): void {
    const el = this.panels.get(panelKey)?.asset.getElementById(id);
    el?.setProperties(props);
  }

  private bindClick(panelKey: PanelKey, id: string, fn: () => void): void {
    const el = this.panels.get(panelKey)?.asset.getElementById(id);
    if (!el) return;
    const listener = () => fn();
    el.addEventListener('click', listener);
    this.cleanupFuncs.push(() => el.removeEventListener('click', listener));
  }

  private bindUIListeners(): void {
    // Main Menu
    this.bindClick('main-menu', 'btn-play-campaign', () =>
      this.handler?.onPlayCampaign()
    );
    this.bindClick('main-menu', 'btn-quick-play', () =>
      this.handler?.onQuickPlay()
    );
    this.bindClick('main-menu', 'btn-alley-workshop', () =>
      this.handler?.onOpenWorkshop()
    );
    this.bindClick('main-menu', 'btn-level-select', () =>
      this.handler?.onOpenLevelSelect()
    );
    this.bindClick('main-menu', 'btn-settings', () =>
      this.handler?.onOpenSettings()
    );
    this.bindClick('main-menu', 'btn-instructions', () =>
      this.handler?.onOpenInstructions()
    );
    this.bindClick('main-menu', 'btn-menu-recenter', () =>
      this.handler?.onRecenterTable()
    );
    this.bindClick('main-menu', 'btn-menu-xr', () => {
      if (this.world.visibilityState.value === VisibilityState.NonImmersive) {
        this.world.launchXR();
      } else {
        this.world.exitXR();
      }
    });
    this.bindClick('main-menu', 'menu-scale-down', () =>
      this.handler?.onAdjustUiScale(-UI_SCALE_STEP)
    );
    this.bindClick('main-menu', 'menu-scale-up', () =>
      this.handler?.onAdjustUiScale(UI_SCALE_STEP)
    );
    this.bindClick('main-menu', 'menu-scale-reset', () =>
      this.handler?.onResetUiScale()
    );

    // HUD
    this.bindClick('hud', 'hud-reset-ball', () => this.handler?.onResetBall());
    this.bindClick('hud', 'hud-recenter', () =>
      this.handler?.onRecenterTable()
    );
    this.bindClick('hud', 'hud-height-up', () =>
      this.handler?.onAdjustHeight(0.05)
    );
    this.bindClick('hud', 'hud-height-down', () =>
      this.handler?.onAdjustHeight(-0.05)
    );
    this.bindClick('hud', 'hud-mute', () => this.handler?.onToggleMute());
    this.bindClick('hud', 'hud-pause', () => this.handler?.onPause());

    // Level Select
    this.bindClick('level-select', 'levels-back', () =>
      this.handler?.onCloseSubScreen()
    );
    for (let i = 0; i < CAMPAIGN_LEVELS.length; i++) {
      this.bindClick('level-select', `btn-lvl-${i}`, () =>
        this.handler?.onSelectLevel(i)
      );
    }

    // Settings
    this.bindClick('settings', 'set-back', () =>
      this.handler?.onCloseSubScreen()
    );
    this.bindClick('settings', 'set-vol-down', () =>
      this.handler?.onAdjustVolume(-0.15)
    );
    this.bindClick('settings', 'set-vol-up', () =>
      this.handler?.onAdjustVolume(0.15)
    );
    this.bindClick('settings', 'set-mute-btn', () =>
      this.handler?.onToggleMute()
    );
    this.bindClick('settings', 'set-curve-linear', () =>
      this.handler?.onSetPowerCurve('linear')
    );
    this.bindClick('settings', 'set-curve-smooth', () =>
      this.handler?.onSetPowerCurve('smooth')
    );
    this.bindClick('settings', 'set-curve-snappy', () =>
      this.handler?.onSetPowerCurve('snappy')
    );
    this.bindClick('settings', 'set-traj-toggle', () =>
      this.handler?.onToggleTrajectory()
    );
    this.bindClick('settings', 'set-scale-down', () =>
      this.handler?.onAdjustUiScale(-UI_SCALE_STEP)
    );
    this.bindClick('settings', 'set-scale-up', () =>
      this.handler?.onAdjustUiScale(UI_SCALE_STEP)
    );
    this.bindClick('settings', 'set-scale-reset', () =>
      this.handler?.onResetUiScale()
    );
    this.bindClick('settings', 'set-h-down', () =>
      this.handler?.onAdjustHeight(-0.05)
    );
    this.bindClick('settings', 'set-h-up', () =>
      this.handler?.onAdjustHeight(0.05)
    );
    this.bindClick('settings', 'set-d-near', () =>
      this.handler?.onAdjustDistance(0.08)
    );
    this.bindClick('settings', 'set-d-far', () =>
      this.handler?.onAdjustDistance(-0.08)
    );
    this.bindClick('settings', 'set-recenter', () =>
      this.handler?.onRecenterTable()
    );
    this.bindClick('settings', 'set-reset-place', () =>
      this.handler?.onResetPlacement()
    );

    // Instructions
    this.bindClick('instructions', 'inst-back', () =>
      this.handler?.onCloseSubScreen()
    );
    this.bindClick('instructions', 'inst-start-tutorial', () =>
      this.handler?.onReplayOnboarding()
    );

    // Modal (Pause & Result)
    this.bindClick('modal', 'modal-primary-btn', () =>
      this.handler?.onModalPrimary()
    );
    this.bindClick('modal', 'modal-secondary-btn', () =>
      this.handler?.onModalSecondary()
    );
    this.bindClick('modal', 'modal-settings-btn', () =>
      this.handler?.onOpenSettings()
    );
    this.bindClick('modal', 'modal-tertiary-btn', () =>
      this.handler?.onModalTertiary()
    );

    // Onboarding
    this.bindClick('onboarding', 'onb-skip-btn', () =>
      this.handler?.onSkipOnboarding()
    );

    // Workshop
    this.bindClick('workshop', 'ws-back-menu', () =>
      this.handler?.onBackToMenu()
    );
    this.bindClick('workshop', 'ws-add-straight', () =>
      this.handler?.onWorkshopAddSegment('straight')
    );
    this.bindClick('workshop', 'ws-add-short', () =>
      this.handler?.onWorkshopAddSegment('short')
    );
    this.bindClick('workshop', 'ws-add-left', () =>
      this.handler?.onWorkshopAddSegment('leftTurn')
    );
    this.bindClick('workshop', 'ws-add-right', () =>
      this.handler?.onWorkshopAddSegment('rightTurn')
    );
    this.bindClick('workshop', 'ws-add-zigzag', () =>
      this.handler?.onWorkshopAddSegment('zigzag')
    );
    this.bindClick('workshop', 'ws-add-ramp-up', () =>
      this.handler?.onWorkshopAddSegment('rampUp')
    );
    this.bindClick('workshop', 'ws-add-ramp-down', () =>
      this.handler?.onWorkshopAddSegment('rampDown')
    );
    this.bindClick('workshop', 'ws-add-bridge', () =>
      this.handler?.onWorkshopAddSegment('elevatedBridge')
    );

    this.bindClick('workshop', 'ws-seg-prev', () =>
      this.handler?.onWorkshopSelectSegOffset(-1)
    );
    this.bindClick('workshop', 'ws-seg-next', () =>
      this.handler?.onWorkshopSelectSegOffset(1)
    );
    this.bindClick('workshop', 'ws-seg-left', () =>
      this.handler?.onWorkshopMoveSeg(-0.04, 0)
    );
    this.bindClick('workshop', 'ws-seg-right', () =>
      this.handler?.onWorkshopMoveSeg(0.04, 0)
    );
    this.bindClick('workshop', 'ws-seg-fwd', () =>
      this.handler?.onWorkshopMoveSeg(0, -0.04)
    );
    this.bindClick('workshop', 'ws-seg-back', () =>
      this.handler?.onWorkshopMoveSeg(0, 0.04)
    );
    this.bindClick('workshop', 'ws-seg-rot-l', () =>
      this.handler?.onWorkshopRotateSeg(0.14)
    );
    this.bindClick('workshop', 'ws-seg-rot-r', () =>
      this.handler?.onWorkshopRotateSeg(-0.14)
    );
    this.bindClick('workshop', 'ws-seg-del', () =>
      this.handler?.onWorkshopDeleteSeg()
    );

    this.bindClick('workshop', 'ws-obs-dwarf', () =>
      this.handler?.onWorkshopAddObstacle('dwarf')
    );
    this.bindClick('workshop', 'ws-obs-bumper', () =>
      this.handler?.onWorkshopAddObstacle('bumper')
    );
    this.bindClick('workshop', 'ws-obs-gate', () =>
      this.handler?.onWorkshopAddObstacle('movingGate')
    );
    this.bindClick('workshop', 'ws-obs-barrier', () =>
      this.handler?.onWorkshopAddObstacle('slidingBarrier')
    );
    this.bindClick('workshop', 'ws-obs-move-l', () =>
      this.handler?.onWorkshopMoveObs(-0.04, 0)
    );
    this.bindClick('workshop', 'ws-obs-move-r', () =>
      this.handler?.onWorkshopMoveObs(0.04, 0)
    );
    this.bindClick('workshop', 'ws-obs-del', () =>
      this.handler?.onWorkshopDeleteObs()
    );

    this.bindClick('workshop', 'ws-pins-10', () =>
      this.handler?.onWorkshopSetPins('standard10')
    );
    this.bindClick('workshop', 'ws-pins-9', () =>
      this.handler?.onWorkshopSetPins('diamond9')
    );
    this.bindClick('workshop', 'ws-pins-8', () =>
      this.handler?.onWorkshopSetPins('split8')
    );
    this.bindClick('workshop', 'ws-pins-6', () =>
      this.handler?.onWorkshopSetPins('crown6')
    );
    this.bindClick('workshop', 'ws-rails-toggle', () =>
      this.handler?.onWorkshopToggleRails()
    );
    this.bindClick('workshop', 'ws-test-alley', () =>
      this.handler?.onWorkshopTestAlley()
    );
    this.bindClick('workshop', 'ws-reset-layout', () =>
      this.handler?.onWorkshopResetLayout()
    );
  }

  private wire2DDock(): void {
    const dock = document.getElementById('xr-entry-dock');
    const enterBtn = document.getElementById('btn-enter-xr') as HTMLButtonElement | null;
    const recenterBtn = document.getElementById(
      'btn-desktop-recenter'
    ) as HTMLButtonElement | null;

    if (enterBtn) {
      const onEnterClick = () => {
        if (this.world.visibilityState.value === VisibilityState.NonImmersive) {
          this.world.launchXR();
        } else {
          this.world.exitXR();
        }
      };
      enterBtn.addEventListener('click', onEnterClick);
      this.cleanupFuncs.push(() =>
        enterBtn.removeEventListener('click', onEnterClick)
      );
    }

    if (recenterBtn) {
      const onRecenterClick = () => this.handler?.onRecenterTable();
      recenterBtn.addEventListener('click', onRecenterClick);
      this.cleanupFuncs.push(() =>
        recenterBtn.removeEventListener('click', onRecenterClick)
      );
    }

    const unsub = this.world.visibilityState.subscribe((vis) => {
      const is2D = vis === VisibilityState.NonImmersive;
      if (dock) {
        dock.style.display = is2D ? 'flex' : 'none';
      }
      if (enterBtn) {
        enterBtn.textContent = is2D
          ? 'Enter Mixed Reality'
          : 'Exit Mixed Reality';
      }
      this.setText(
        'main-menu',
        'btn-menu-xr-label',
        is2D ? 'Enter Mixed Reality' : 'Exit Mixed Reality'
      );
    });
    this.cleanupFuncs.push(unsub);
  }

  syncLayout(arenaOrigin: THREE.Vector3, arenaYawRad: number): void {
    this._quatY.setFromAxisAngle(this._yAxis, arenaYawRad);
    for (const panel of this.panels.values()) {
      this._offset.copy(panel.offset).applyQuaternion(this._quatY).add(arenaOrigin);
      panel.asset.position.copy(this._offset);
      panel.asset.rotation.set(
        panel.pitchRad,
        arenaYawRad + panel.yawRad,
        0,
        'YXZ'
      );
    }
  }

  setVisiblePanels(visibleSet: Set<PanelKey>): void {
    for (const [key, panel] of this.panels.entries()) {
      const visible = visibleSet.has(key);
      panel.asset.visible = visible;
      if (INTERACTIVE_PANELS.has(key)) {
        panel.asset.pointerEvents = visible ? 'auto' : 'none';
      } else {
        panel.asset.pointerEvents = 'none';
      }
    }
  }

  updateMainMenu(progress: CampaignProgress): void {
    const unlockedCount = Math.min(
      CAMPAIGN_LEVELS.length,
      progress.unlockedLevelIndex + 1
    );
    const completed = progress.completedLevels.length;
    this.setText(
      'main-menu',
      'menu-progress-badge',
      `Cleared: ${completed} / ${CAMPAIGN_LEVELS.length} | Unlocked: ${unlockedCount}`
    );
  }

  updateHud(params: {
    levelName: string;
    levelHint: string;
    pinsKnocked: number;
    totalPins: number;
    shotsLeft: number;
    maxShots: number;
    totalScore: number;
    muted: boolean;
  }): void {
    this.setText('hud', 'hud-level-name', params.levelName);
    this.setText('hud', 'hud-level-hint', params.levelHint);
    this.setText(
      'hud',
      'hud-pins-val',
      `${params.pinsKnocked} / ${params.totalPins}`
    );
    this.setText(
      'hud',
      'hud-shots-val',
      `${params.shotsLeft} / ${params.maxShots}`
    );
    this.setText('hud', 'hud-score-val', `${params.totalScore}`);
    this.setText(
      'hud',
      'hud-mute-label',
      params.muted ? 'Muted' : 'Sound'
    );
  }

  updateHudPower(power01: number, grabState: GrabState, canLaunch: boolean): void {
    const pct = Math.round(power01 * 100);
    const text =
      grabState === 'AIMING'
        ? canLaunch
          ? `POWER ${pct}% | RELEASE`
          : 'PULL BACK FURTHER'
        : grabState === 'HOVER'
          ? 'PINCH BALL TO GRAB'
          : grabState === 'IN_FLIGHT'
            ? 'BALL IN MOTION'
            : grabState === 'SETTLING'
              ? 'COUNTING PINS...'
              : 'READY TO BOWL';

    this.setText('hud', 'hud-power-text', text);
    this.setText('hud', 'hud-grab-state', grabState);

    const fillColor =
      power01 < 0.35 ? '#38bdf8' : power01 < 0.72 ? '#4ade80' : '#fb7185';
    this.setProps('hud', 'hud-power-fill', {
      width: `${Math.max(0, Math.min(100, pct))}%`,
      backgroundColor: fillColor,
    });
  }

  updateLevelSelect(progress: CampaignProgress): void {
    for (let i = 0; i < CAMPAIGN_LEVELS.length; i++) {
      const lvl = CAMPAIGN_LEVELS[i];
      const bestScore = progress.bestScores[lvl.id] ?? 0;
      const stars = progress.bestStars[lvl.id] ?? 0;
      const starTxt = `${'*'.repeat(stars)}${'-'.repeat(3 - stars)}`;
      const unlocked = i <= progress.unlockedLevelIndex;
      this.setText('level-select', `lvl-name-${i}`, `${i + 1}. ${lvl.name}`);
      this.setText(
        'level-select',
        `lvl-best-${i}`,
        `${lvl.subtitle.replace(/^Level \d+ [|·] /, '')} | Best: ${bestScore}`
      );
      this.setText('level-select', `lvl-stars-${i}`, starTxt);
      if (i > 0) {
        this.setText(
          'level-select',
          `btn-lvl-label-${i}`,
          unlocked ? 'Play' : 'Quick'
        );
      }
    }
  }

  updateSettings(settings: GameSettings): void {
    this.setText(
      'settings',
      'set-vol-val',
      `${Math.round(settings.volume * 100)}%`
    );
    this.setText(
      'settings',
      'set-mute-label',
      settings.muted ? 'Mute: ON' : 'Mute: OFF'
    );
    this.setText(
      'settings',
      'set-traj-label',
      settings.showTrajectory ? 'Trajectory: ON' : 'Trajectory: OFF'
    );
    const scalePct = `${Math.round(clampUiScale(settings.uiScale) * 100)}%`;
    this.setText('settings', 'set-scale-val', scalePct);
    this.setText('main-menu', 'menu-scale-val', scalePct);
    for (const mode of ['linear', 'smooth', 'snappy'] as const) {
      this.setProps('settings', `set-curve-${mode}`, {
        backgroundColor:
          settings.powerCurve === mode ? '#0284c7' : '#1e293b',
      });
    }
  }

  updateWorkshop(
    layout: WorkshopLayout,
    selectedSegIdx: number,
    validation: WorkshopValidationResult
  ): void {
    const seg = layout.segments[selectedSegIdx];
    this.setText(
      'workshop',
      'ws-summary',
      `${layout.segments.length} Modules | ${layout.obstacles.length} Obstacles | ${layout.pinFormation}`
    );
    this.setText(
      'workshop',
      'ws-selected-seg',
      seg
        ? `Segment #${selectedSegIdx + 1} (${seg.kind})`
        : 'No segments'
    );
    this.setText(
      'workshop',
      'ws-rails-label',
      layout.railsEnabled ? 'Rails: ON' : 'Rails: OFF'
    );

    const statusMsg = validation.valid
      ? validation.warnings[0] ?? 'Valid modular lane ready to bowl!'
      : validation.errors[0] ?? 'Fix disconnected or overlapping modules.';

    this.setText('workshop', 'ws-validation-text', statusMsg);
    this.setProps('workshop', 'ws-validation-box', {
      backgroundColor: validation.valid ? '#14532d' : '#450a0a',
      borderColor: validation.valid ? '#4ade80' : '#f87171',
    });
    this.setProps('workshop', 'ws-test-alley', {
      backgroundColor: validation.valid ? '#0284c7' : '#334155',
    });
  }

  updateOnboarding(step: 'pinch' | 'pull' | 'aim' | 'release'): void {
    const map = {
      pinch: {
        badge: 'GUIDED PRACTICE | STEP 1 OF 4',
        title: '1. Pinch the Glowing Ball',
        body: 'Hold thumb and index finger together on the glowing ball (or click & drag with mouse).',
        idx: 1,
      },
      pull: {
        badge: 'GUIDED PRACTICE | STEP 2 OF 4',
        title: '2. Pull Back to Charge',
        body: 'Draw the ball toward yourself along the table to build launch power.',
        idx: 2,
      },
      aim: {
        badge: 'GUIDED PRACTICE | STEP 3 OF 4',
        title: '3. Aim Left or Right',
        body: 'Slide your pinched hand sideways to line up the trajectory dots with the head pin.',
        idx: 3,
      },
      release: {
        badge: 'GUIDED PRACTICE | STEP 4 OF 4',
        title: '4. Open Pinch to Bowl!',
        body: 'Release your pinch cleanly to send the ball rolling down the lane!',
        idx: 4,
      },
    }[step];

    this.setText('onboarding', 'onb-step-badge', map.badge);
    this.setText('onboarding', 'onb-title', map.title);
    this.setText('onboarding', 'onb-body', map.body);

    for (let i = 1; i <= 4; i++) {
      this.setProps('onboarding', `onb-pill-${i}`, {
        backgroundColor:
          i === map.idx ? '#0284c7' : i < map.idx ? '#14532d' : '#1e293b',
        borderColor:
          i === map.idx ? '#38bdf8' : i < map.idx ? '#4ade80' : '#334155',
      });
    }
  }

  updateModal(mode: ModalMode, summary?: ScoreSummary): void {
    if (mode === 'PAUSE') {
      this.setText('modal', 'modal-eyebrow', 'GAME PAUSED');
      this.setText('modal', 'modal-title', 'Take a Breather');
      this.setText('modal', 'modal-stars', 'SEATED AR BOWLING');
      this.setText(
        'modal',
        'modal-summary',
        'Your miniature lane stays anchored right where you left it.'
      );
      this.setText(
        'modal',
        'modal-pins-val',
        summary ? `${summary.pinsKnocked} / ${summary.totalPins}` : '0 / 10'
      );
      this.setText(
        'modal',
        'modal-score-val',
        summary ? `${summary.levelScore}` : '0'
      );
      this.setText(
        'modal',
        'modal-total-val',
        summary ? `${summary.totalScore}` : '0'
      );
      this.setText('modal', 'modal-primary-label', 'Resume Game');
      this.setText(
        'modal',
        'modal-secondary-label',
        summary?.isCustomWorkshop ? 'Restart Test' : 'Restart Level'
      );
      this.setText(
        'modal',
        'modal-tertiary-label',
        summary?.isCustomWorkshop ? 'Back to Workshop' : 'Main Menu'
      );
      this.setProps('modal', 'modal-settings-btn', {display: 'flex'});
      return;
    }

    if (!summary) return;
    this.setProps('modal', 'modal-settings-btn', {display: 'none'});
    const isWorkshop = mode === 'WORKSHOP_RESULT';
    const hasNext =
      !isWorkshop &&
      summary.stars > 0 &&
      CAMPAIGN_LEVELS.some((l) => l.id === summary.levelId && l.index < CAMPAIGN_LEVELS.length - 1);

    this.setText(
      'modal',
      'modal-eyebrow',
      isWorkshop ? 'ALLEY WORKSHOP TEST' : summary.levelName.toUpperCase()
    );
    this.setText('modal', 'modal-title', summary.callout);
    this.setText(
      'modal',
      'modal-stars',
      `${'*'.repeat(summary.stars)}${'-'.repeat(3 - summary.stars)} (${summary.stars} / 3)`
    );
    this.setText(
      'modal',
      'modal-summary',
      summary.pinsKnocked >= summary.totalPins
        ? `Clean sweep in ${summary.shotsUsed} ${summary.shotsUsed === 1 ? 'shot' : 'shots'}!`
        : `Knocked ${summary.pinsKnocked} of ${summary.totalPins} pins in ${summary.shotsUsed} shots.`
    );
    this.setText(
      'modal',
      'modal-pins-val',
      `${summary.pinsKnocked} / ${summary.totalPins}`
    );
    this.setText('modal', 'modal-score-val', `${summary.levelScore}`);
    this.setText('modal', 'modal-total-val', `${summary.totalScore}`);
    this.setText(
      'modal',
      'modal-primary-label',
      isWorkshop
        ? 'Back to Workshop'
        : hasNext
          ? 'Next Level'
          : 'Play Again'
    );
    this.setText(
      'modal',
      'modal-secondary-label',
      isWorkshop ? 'Bowl Test Again' : 'Replay Level'
    );
    this.setText('modal', 'modal-tertiary-label', 'Main Menu');
  }

  showCallout(text: string, colorHex = '#fde047', durationMs = 2100): void {
    const panel = this.panels.get('callout');
    if (!panel) return;
    this.setText('callout', 'callout-text', text);
    this.setProps('callout', 'callout-card', {borderColor: colorHex});
    this.setProps('callout', 'callout-text', {color: colorHex});
    panel.asset.visible = true;
    this.calloutHideAt = performance.now() + durationMs;
  }

  update(_delta: number): void {
    const callout = this.panels.get('callout');
    if (callout?.asset.visible && performance.now() > this.calloutHideAt) {
      callout.asset.visible = false;
    }
  }
}

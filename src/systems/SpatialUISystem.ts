import {
  Entity,
  LevelTag,
  PokeInteractable,
  RayInteractable,
  Transform,
  UIKitMLAsset,
  VisibilityState,
  createSystem,
} from '@iwsdk/core';
import * as THREE from 'three';

import {SpatialPanelTag} from '../components';
import {
  CAMPAIGN_LEVELS,
  formatWorkshopDifficulty,
} from '../levels';
import {
  MenuInteractionGuard,
  buildResultsPresentation,
  getCampaignLevelCardState,
} from '../menuInteraction';
import {
  UI_SCALE_DEFAULT,
  UI_SCALE_STEP,
  clampUiScale,
} from '../pullInteraction';
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
import {
  type XRCapabilityReport,
  exitXRSessionSafely,
  launchXRSessionWithDiagnostics,
  probeXRCapabilities,
} from '../xrDiagnostics';

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
  onOpenLevelSelect: () => void;
  onSelectLevel: (index: number) => void;
  onOpenWorkshop: () => void;
  onOpenSettings: () => void;
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
  onToggleLowLagMode: () => void;
  onAdjustUiScale: (delta: number) => void;
  onResetUiScale: () => void;
  onPause: () => void;
  onEmergencyUnstick: () => void;
  onEmergencyMainMenu: () => void;
  onModalResume: () => void;
  onModalNextLevel: () => void;
  onModalPlayAgain: () => void;
  onModalLevelSelect: () => void;
  onModalEditSetup: () => void;
  onModalMainMenu: () => void;
  // Custom Game / Workshop actions
  onWorkshopAddSegment: (kind: WorkshopModuleKind) => void;
  onWorkshopSelectSegOffset: (delta: number) => void;
  onWorkshopMoveSeg: (dx: number, dz: number) => void;
  onWorkshopRotateSeg: (deltaYawRad: number) => void;
  onWorkshopDeleteSeg: () => void;
  onWorkshopAddObstacle: (kind: ObstacleKind) => void;
  onWorkshopMoveObs: (dx: number, dz: number) => void;
  onWorkshopDeleteObs: () => void;
  onWorkshopSetPins: (formation: PinFormation) => void;
  onWorkshopStepShots: (delta: number) => void;
  onWorkshopCycleDifficulty: () => void;
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

// Exclude gameplay 'hud' and 'onboarding' from direct-touch PokeInteractable so hands
// pinching or pulling near the bowling table can never hit TouchPointer hysteresis.
const POKE_ENABLED_PANELS = new Set<PanelKey>([
  'main-menu',
  'level-select',
  'workshop',
  'settings',
  'instructions',
  'modal',
]);

/**
 * IWSDK ECS System managing spatial UIKitML panels, interaction stability guards
 * (per-button debounce + cross-screen transition lock + stationary height anchor),
 * live WebXR capability probing/diagnostics, and 2D XR entry dock state.
 */
export class SpatialUISystem extends createSystem({}) {
  private panels = new Map<PanelKey, ManagedPanel>();
  private handler: SpatialUIActionHandler | null = null;
  private calloutHideAt = 0;
  private currentUiScale = UI_SCALE_DEFAULT;
  private visiblePanelsSignature = '';
  private interactionGuard = new MenuInteractionGuard();

  private xrReport: XRCapabilityReport | null = null;
  private xrLaunching = false;
  private xrLastError: string | null = null;
  private xrEnabledFeaturesNote: string | null = null;

  private attachedToWorldRoot = false;
  private worldRootEntity: Entity | null = null;
  private _anchor = new THREE.Vector3();
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

      // Interactive components are attached dynamically only while visible
      asset.pointerEvents = 'none';

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

  attachPanelsToWorldRoot(worldRootEntity: Entity): void {
    this.worldRootEntity = worldRootEntity;
    const rootObj = worldRootEntity.object3D;
    for (const panel of this.panels.values()) {
      if (rootObj && panel.asset.parent !== rootObj) {
        rootObj.add(panel.asset);
      }
      if (panel.entity.hasComponent(LevelTag)) {
        panel.entity.removeComponent(LevelTag);
      }
      if (panel.entity.hasComponent(Transform)) {
        panel.entity.setValue(Transform, 'parent', worldRootEntity);
      }
    }
    this.attachedToWorldRoot = true;
    this.syncLayout();
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
    const panel = this.panels.get(panelKey);
    const el = panel?.asset.getElementById(id);
    if (!panel || !el) return;
    const guardKey = `${panelKey}:${id}`;
    const listener = () => {
      if (!panel.asset.visible) return;
      if (!this.interactionGuard.canActivate(guardKey, performance.now())) {
        return;
      }
      fn();
    };
    el.addEventListener('click', listener);
    this.cleanupFuncs.push(() => el.removeEventListener('click', listener));
  }

  private bindUIListeners(): void {
    // Simplified Main Menu: Play -> Custom Game -> Settings -> Enter/Exit MR
    this.bindClick('main-menu', 'btn-play', () =>
      this.handler?.onPlayCampaign()
    );
    this.bindClick('main-menu', 'btn-custom-game', () =>
      this.handler?.onOpenWorkshop()
    );
    this.bindClick('main-menu', 'btn-settings', () =>
      this.handler?.onOpenSettings()
    );
    this.bindClick('main-menu', 'btn-menu-xr', () => {
      void this.handleEnterOrExitXR();
    });

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
    this.bindClick('settings', 'set-lowlag-toggle', () =>
      this.handler?.onToggleLowLagMode()
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
    this.bindClick('settings', 'set-practice-btn', () =>
      this.handler?.onReplayOnboarding()
    );
    this.bindClick('settings', 'set-reset-place', () =>
      this.handler?.onResetPlacement()
    );

    // Instructions (kept for backwards scene asset completeness)
    this.bindClick('instructions', 'inst-back', () =>
      this.handler?.onCloseSubScreen()
    );
    this.bindClick('instructions', 'inst-start-tutorial', () =>
      this.handler?.onReplayOnboarding()
    );

    // Modal (Pause & Post-Game Results)
    this.bindClick('modal', 'modal-resume-btn', () =>
      this.handler?.onModalResume()
    );
    this.bindClick('modal', 'modal-next-btn', () =>
      this.handler?.onModalNextLevel()
    );
    this.bindClick('modal', 'modal-play-again-btn', () =>
      this.handler?.onModalPlayAgain()
    );
    this.bindClick('modal', 'modal-levels-btn', () =>
      this.handler?.onModalLevelSelect()
    );
    this.bindClick('modal', 'modal-edit-setup-btn', () =>
      this.handler?.onModalEditSetup()
    );
    this.bindClick('modal', 'modal-settings-btn', () =>
      this.handler?.onOpenSettings()
    );
    this.bindClick('modal', 'modal-main-menu-btn', () =>
      this.handler?.onModalMainMenu()
    );

    // Onboarding
    this.bindClick('onboarding', 'onb-skip-btn', () =>
      this.handler?.onSkipOnboarding()
    );

    // Custom Game Setup / Alley Workshop
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
    this.bindClick('workshop', 'ws-shots-down', () =>
      this.handler?.onWorkshopStepShots(-1)
    );
    this.bindClick('workshop', 'ws-shots-up', () =>
      this.handler?.onWorkshopStepShots(1)
    );
    this.bindClick('workshop', 'ws-diff-cycle', () =>
      this.handler?.onWorkshopCycleDifficulty()
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

  private async refreshXRCapabilities(): Promise<void> {
    this.xrReport = await probeXRCapabilities({
      xrDefaults: this.world.xrDefaults,
    });
    this.syncXRDiagnosticsUI();
  }

  private async handleEnterOrExitXR(): Promise<void> {
    if (this.world.session != null) {
      await exitXRSessionSafely(this.world);
      this.xrLastError = null;
      this.xrEnabledFeaturesNote = null;
      this.syncXRDiagnosticsUI();
      return;
    }

    if (this.xrLaunching || this.world.sessionRequestPending) {
      return;
    }

    if (!this.xrReport) {
      await this.refreshXRCapabilities();
    }

    if (this.xrReport && !this.xrReport.immersiveArSupported) {
      this.xrLastError = this.xrReport.detailMessage;
      this.syncXRDiagnosticsUI();
      this.showCallout('IMMERSIVE-AR UNSUPPORTED HERE', '#fbbf24', 2400);
      return;
    }

    this.xrLaunching = true;
    this.xrLastError = null;
    this.xrEnabledFeaturesNote = null;
    this.syncXRDiagnosticsUI();

    const result = await launchXRSessionWithDiagnostics(this.world, {
      onSessionEnded: () => {
        this.xrLaunching = false;
        this.xrEnabledFeaturesNote = null;
        this.syncXRDiagnosticsUI();
      },
      onVisibilityChanged: () => {
        this.syncXRDiagnosticsUI();
      },
    });

    this.xrLaunching = false;

    if (!result.ok) {
      if (!result.duplicatePrevented) {
        this.xrLastError =
          result.errorMessage ?? 'Failed to start Mixed Reality session.';
        this.showCallout('MIXED REALITY LAUNCH FAILED', '#fb7185', 2600);
      }
      this.syncXRDiagnosticsUI();
      return;
    }

    const grantedCount = result.enabledFeatures.length;
    const skipped = result.unsupportedRequestedFeatures;
    if (grantedCount > 0) {
      this.xrEnabledFeaturesNote =
        skipped.length > 0
          ? `Session active (${result.enabledFeatures.join(', ')}) | Optional unavailable: ${skipped.join(', ')}`
          : `Session active (${result.enabledFeatures.join(', ')})`;
    } else {
      this.xrEnabledFeaturesNote = 'Mixed Reality immersive-ar session active.';
    }
    this.syncXRDiagnosticsUI();
  }

  private syncXRDiagnosticsUI(): void {
    const dock = document.getElementById('xr-entry-dock');
    const badge = document.getElementById('xr-status-badge');
    const diagText = document.getElementById('xr-diagnostic-text');
    const enterBtn = document.getElementById(
      'btn-enter-xr'
    ) as HTMLButtonElement | null;

    const vis = this.world.visibilityState.value;
    const is2D = vis === VisibilityState.NonImmersive && this.world.session == null;

    if (dock) {
      dock.style.display = is2D ? 'flex' : 'none';
    }

    let tone = this.xrReport?.statusTone ?? 'checking';
    let badgeText = this.xrReport?.statusBadge ?? 'CHECKING WEBXR...';
    let detail =
      this.xrReport?.detailMessage ??
      'Checking navigator.xr and immersive-ar support...';
    let buttonLabel = 'Enter Mixed Reality';
    let disabled = false;

    if (!is2D) {
      tone = 'active';
      badgeText = 'SESSION ACTIVE';
      detail =
        this.xrEnabledFeaturesNote ??
        'Mixed Reality immersive-ar session active.';
      buttonLabel = 'Exit Mixed Reality';
      disabled = false;
    } else if (this.xrLaunching || this.world.sessionRequestPending) {
      tone = 'loading';
      badgeText = 'STARTING XR...';
      detail = 'Requesting immersive-ar session and permissions...';
      buttonLabel = 'Starting Mixed Reality...';
      disabled = true;
    } else if (this.xrLastError) {
      tone = 'error';
      badgeText = 'XR LAUNCH ERROR';
      detail = this.xrLastError;
      buttonLabel = 'Retry Mixed Reality';
      disabled = !(this.xrReport?.immersiveArSupported ?? true);
    } else if (this.xrReport && !this.xrReport.immersiveArSupported) {
      tone = this.xrReport.statusTone;
      badgeText = this.xrReport.statusBadge;
      detail = this.xrReport.detailMessage;
      buttonLabel = 'Mixed Reality Unavailable';
      disabled = true;
    }

    if (badge) {
      badge.textContent = badgeText;
      badge.setAttribute('data-tone', tone);
    }
    if (diagText) {
      diagText.textContent = detail;
      diagText.setAttribute('data-tone', tone);
    }
    if (enterBtn) {
      enterBtn.textContent = buttonLabel;
      enterBtn.disabled = disabled;
    }

    this.setText('main-menu', 'menu-xr-status', detail);
    this.setText(
      'main-menu',
      'btn-menu-xr-label',
      !is2D
        ? 'EXIT MIXED REALITY'
        : this.xrLaunching
          ? 'STARTING MIXED REALITY...'
          : 'ENTER MIXED REALITY'
    );
    this.setProps('main-menu', 'btn-menu-xr', {
      backgroundColor: disabled
        ? '#334155'
        : !is2D
          ? '#991b1b'
          : '#1e293b',
    });
  }

  private wire2DDock(): void {
    const enterBtn = document.getElementById(
      'btn-enter-xr'
    ) as HTMLButtonElement | null;
    const recenterBtn = document.getElementById(
      'btn-desktop-recenter'
    ) as HTMLButtonElement | null;

    const unstickBtn = document.getElementById(
      'btn-desktop-unstick'
    ) as HTMLButtonElement | null;
    const perfBtn = document.getElementById(
      'btn-perf-mode'
    ) as HTMLButtonElement | null;
    const menuBtn = document.getElementById(
      'btn-desktop-menu'
    ) as HTMLButtonElement | null;

    if (enterBtn) {
      const onEnterClick = () => {
        void this.handleEnterOrExitXR();
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

    if (unstickBtn) {
      const onUnstickClick = () => this.handler?.onEmergencyUnstick();
      unstickBtn.addEventListener('click', onUnstickClick);
      this.cleanupFuncs.push(() =>
        unstickBtn.removeEventListener('click', onUnstickClick)
      );
    }

    if (perfBtn) {
      const onPerfClick = () => this.handler?.onToggleLowLagMode();
      perfBtn.addEventListener('click', onPerfClick);
      this.cleanupFuncs.push(() =>
        perfBtn.removeEventListener('click', onPerfClick)
      );
    }

    if (menuBtn) {
      const onMenuClick = () => this.handler?.onEmergencyMainMenu();
      menuBtn.addEventListener('click', onMenuClick);
      this.cleanupFuncs.push(() =>
        menuBtn.removeEventListener('click', onMenuClick)
      );
    }

    const unsub = this.world.visibilityState.subscribe(() => {
      this.syncXRDiagnosticsUI();
    });
    this.cleanupFuncs.push(unsub);

    void this.refreshXRCapabilities();
  }

  /**
   * Synchronizes spatial panels inside the unified persistent RolloxWorldRoot.
   * Because all panels live at fixed local offsets under RolloxWorldRoot, their
   * positions remain completely locked relative to the world-anchored bowling
   * alley across gameplay, results, level changes, and headset movement.
   */
  syncLayout(
    arenaOrigin?: THREE.Vector3,
    arenaYawRad = 0,
    uiAnchorY?: number
  ): void {
    if (this.attachedToWorldRoot || !arenaOrigin) {
      for (const panel of this.panels.values()) {
        panel.asset.position.copy(panel.offset);
        panel.asset.rotation.set(panel.pitchRad, panel.yawRad, 0, 'YXZ');
      }
      return;
    }

    const baseY = uiAnchorY ?? arenaOrigin.y;
    this._anchor.set(arenaOrigin.x, baseY, arenaOrigin.z);
    this._quatY.setFromAxisAngle(this._yAxis, arenaYawRad);
    for (const panel of this.panels.values()) {
      this._offset.copy(panel.offset).applyQuaternion(this._quatY).add(this._anchor);
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
    const nextSig = Array.from(visibleSet).sort().join('|');
    if (nextSig !== this.visiblePanelsSignature) {
      this.visiblePanelsSignature = nextSig;
      this.interactionGuard.notifyPanelTransition(performance.now());
    }

    for (const [key, panel] of this.panels.entries()) {
      const visible = visibleSet.has(key);
      panel.asset.visible = visible;

      const allowRay = visible && INTERACTIVE_PANELS.has(key);
      const allowPoke = visible && POKE_ENABLED_PANELS.has(key);

      if (allowRay) {
        if (!panel.entity.hasComponent(RayInteractable)) {
          panel.entity.addComponent(RayInteractable);
        }
      } else if (panel.entity.hasComponent(RayInteractable)) {
        panel.entity.removeComponent(RayInteractable);
      }

      if (allowPoke) {
        if (!panel.entity.hasComponent(PokeInteractable)) {
          panel.entity.addComponent(PokeInteractable);
        }
      } else if (panel.entity.hasComponent(PokeInteractable)) {
        panel.entity.removeComponent(PokeInteractable);
      }

      panel.asset.pointerEvents = allowRay ? 'auto' : 'none';
    }
  }

  updateMainMenu(progress: CampaignProgress): void {
    const completed = progress.completedLevels.length;
    this.setText(
      'main-menu',
      'menu-progress-badge',
      `Cleared: ${completed} / ${CAMPAIGN_LEVELS.length}`
    );
    this.syncXRDiagnosticsUI();
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
          ? `POWER ${pct}% | RELEASE TO ROLL`
          : 'PULL BACK | B TO CANCEL'
        : grabState === 'HOVER'
          ? 'PINCH / TRIGGER TO GRAB'
          : grabState === 'IN_FLIGHT'
            ? 'BALL ROLLING... (RESET IF STUCK)'
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
      const card = getCampaignLevelCardState(i, progress);
      const starTxt = `${'*'.repeat(card.stars)}${'-'.repeat(3 - card.stars)}`;

      this.setText('level-select', `lvl-name-${i}`, `${i + 1}. ${card.name}`);
      this.setText('level-select', `lvl-status-${i}`, card.statusBadge);
      this.setText(
        'level-select',
        `lvl-best-${i}`,
        `${card.subtitle} | Best: ${card.bestScore}`
      );
      this.setText('level-select', `lvl-stars-${i}`, starTxt);
      this.setText('level-select', `btn-lvl-label-${i}`, card.buttonLabel);

      const statusColor =
        card.status === 'COMPLETED'
          ? '#4ade80'
          : card.status === 'CURRENT'
            ? '#38bdf8'
            : card.status === 'UNLOCKED'
              ? '#bae6fd'
              : '#64748b';
      const borderColor =
        card.status === 'COMPLETED'
          ? '#22c55e'
          : card.status === 'CURRENT'
            ? '#38bdf8'
            : card.unlocked
              ? '#334155'
              : '#1e293b';
      const cardBg = card.unlocked ? '#182338' : '#111827';
      const btnBg = !card.unlocked
        ? '#1e293b'
        : card.status === 'CURRENT'
          ? '#0284c7'
          : card.status === 'COMPLETED'
            ? '#166534'
            : '#334155';

      this.setProps('level-select', `lvl-status-${i}`, {color: statusColor});
      this.setProps('level-select', `lvl-card-${i}`, {
        backgroundColor: cardBg,
        borderColor,
      });
      this.setProps('level-select', `btn-lvl-${i}`, {
        backgroundColor: btnBg,
      });
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
    const lowLag = Boolean(settings.lowLagMode);
    this.setText(
      'settings',
      'set-lowlag-label',
      lowLag ? 'Low-Lag: ON' : 'Low-Lag: OFF'
    );
    this.setProps('settings', 'set-lowlag-toggle', {
      backgroundColor: lowLag ? '#14532d' : '#1e293b',
      color: '#f8fafc',
    });
    const perfBtn = document.getElementById('btn-perf-mode');
    if (perfBtn) {
      perfBtn.textContent = lowLag ? 'Low-Lag: ON' : 'Low-Lag: OFF';
      perfBtn.setAttribute('data-active', String(lowLag));
    }

    const scalePct = `${Math.round(clampUiScale(settings.uiScale) * 100)}%`;
    this.setText('settings', 'set-scale-val', scalePct);
    for (const mode of ['linear', 'smooth', 'snappy'] as const) {
      this.setProps('settings', `set-curve-${mode}`, {
        backgroundColor:
          settings.powerCurve === mode ? '#0284c7' : '#1e293b',
        color: '#f8fafc',
      });
    }
  }

  updateWorkshop(
    layout: WorkshopLayout,
    selectedSegIdx: number,
    validation: WorkshopValidationResult
  ): void {
    const seg = layout.segments[selectedSegIdx];
    const safeShots = Math.max(2, Math.min(6, Math.round(layout.maxShots || 4)));
    const diffLabel = formatWorkshopDifficulty(layout.difficulty);
    const pinCountLabel =
      layout.pinFormation === 'standard10'
        ? '10 Pins'
        : layout.pinFormation === 'diamond9'
          ? 'Diamond 9'
          : layout.pinFormation === 'split8'
            ? 'Split 8'
            : 'Crown 6';

    this.setText(
      'workshop',
      'ws-summary',
      `${layout.segments.length} Modules | ${layout.obstacles.length} Obstacles | ${pinCountLabel} | ${safeShots} Shots (${diffLabel})`
    );
    this.setText(
      'workshop',
      'ws-selected-seg',
      seg
        ? `Module #${selectedSegIdx + 1} (${seg.kind})`
        : 'No modules'
    );
    this.setText('workshop', 'ws-shots-val', `${safeShots} Shots`);
    this.setText('workshop', 'ws-diff-label', `Speed: ${diffLabel}`);
    this.setText(
      'workshop',
      'ws-rails-label',
      layout.railsEnabled ? 'Rails: ON' : 'Rails: OFF'
    );
    this.setProps('workshop', 'ws-rails-toggle', {
      backgroundColor: layout.railsEnabled ? '#14532d' : '#334155',
    });

    const pinButtonMap: Record<PinFormation, string> = {
      standard10: 'ws-pins-10',
      diamond9: 'ws-pins-9',
      split8: 'ws-pins-8',
      crown6: 'ws-pins-6',
    };
    (Object.keys(pinButtonMap) as PinFormation[]).forEach((formation) => {
      this.setProps('workshop', pinButtonMap[formation], {
        backgroundColor:
          layout.pinFormation === formation ? '#0284c7' : '#1e293b',
      });
    });

    const statusMsg = validation.valid
      ? validation.warnings[0] ?? 'Valid custom lane - ready to Start Game!'
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

  updateModal(
    mode: ModalMode,
    summary?: ScoreSummary,
    levelIndex = 0,
    unlockedLevelIndex = 0
  ): void {
    if (mode === 'PAUSE') {
      this.setText('modal', 'modal-eyebrow', 'GAME PAUSED');
      this.setProps('modal', 'modal-eyebrow', {color: '#38bdf8'});
      this.setText(
        'modal',
        'modal-level-name',
        summary
          ? summary.isCustomWorkshop
            ? `Custom Game: ${summary.levelName}`
            : `Level ${levelIndex + 1}: ${summary.levelName}`
          : `Level ${levelIndex + 1}`
      );
      this.setText(
        'modal',
        'modal-title',
        summary ? summary.levelName : 'Take a Breather'
      );
      this.setProps('modal', 'modal-title', {color: '#fde047'});
      this.setText('modal', 'modal-stars', 'SEATED MIXED-REALITY BOWLING');
      this.setProps('modal', 'modal-banner-box', {display: 'none'});
      this.setText(
        'modal',
        'modal-summary',
        'Your lane stays anchored where you left it.'
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
      this.setText('modal', 'modal-best-label', 'SHOTS USED');
      this.setText(
        'modal',
        'modal-best-val',
        summary ? `${summary.shotsUsed} / ${summary.maxShots}` : '0 / 3'
      );

      this.setProps('modal', 'modal-resume-btn', {
        display: 'flex',
        backgroundColor: '#0284c7',
        color: '#ffffff',
      });
      this.setProps('modal', 'modal-next-btn', {display: 'none'});
      this.setProps('modal', 'modal-play-again-btn', {
        display: 'flex',
        backgroundColor: '#334155',
        color: '#f8fafc',
      });
      this.setText(
        'modal',
        'modal-play-again-label',
        summary?.isCustomWorkshop ? 'Restart Custom Game' : 'Restart Level'
      );
      this.setProps('modal', 'modal-levels-btn', {
        display: summary?.isCustomWorkshop ? 'none' : 'flex',
        backgroundColor: '#334155',
        color: '#f8fafc',
      });
      this.setText('modal', 'modal-levels-label', 'Other Levels');
      this.setProps('modal', 'modal-edit-setup-btn', {
        display: summary?.isCustomWorkshop ? 'flex' : 'none',
        backgroundColor: '#334155',
        color: '#f8fafc',
      });
      this.setText('modal', 'modal-edit-setup-label', 'Edit Setup');
      this.setProps('modal', 'modal-settings-btn', {
        display: 'flex',
        backgroundColor: '#334155',
        color: '#f8fafc',
      });
      this.setProps('modal', 'modal-main-menu-btn', {
        display: 'flex',
        backgroundColor: '#334155',
        color: '#f8fafc',
      });
      this.setText('modal', 'modal-main-menu-label', 'Main Menu');
      return;
    }

    if (!summary) return;
    this.setProps('modal', 'modal-resume-btn', {display: 'none'});
    this.setProps('modal', 'modal-settings-btn', {display: 'none'});

    const pres = buildResultsPresentation({
      summary,
      levelIndex,
      totalLevels: CAMPAIGN_LEVELS.length,
      unlockedLevelIndex,
    });

    const eyebrowColor =
      pres.bannerTone === 'warning'
        ? '#fbbf24'
        : pres.bannerTone === 'gold'
          ? '#fde047'
          : '#38bdf8';
    const titleColor = pres.bannerTone === 'warning' ? '#fbbf24' : '#fde047';
    const bannerBg =
      pres.bannerTone === 'warning'
        ? '#451a03'
        : pres.bannerTone === 'gold'
          ? '#1e3a8a'
          : '#14532d';
    const bannerBorder =
      pres.bannerTone === 'warning'
        ? '#f59e0b'
        : pres.bannerTone === 'gold'
          ? '#fde047'
          : '#4ade80';
    const bannerTextColor =
      pres.bannerTone === 'warning' ? '#fef3c7' : '#ecfdf5';

    this.setText('modal', 'modal-eyebrow', pres.eyebrow);
    this.setProps('modal', 'modal-eyebrow', {color: eyebrowColor});
    this.setText('modal', 'modal-level-name', pres.levelLabel);
    this.setText('modal', 'modal-title', pres.title);
    this.setProps('modal', 'modal-title', {color: titleColor});
    this.setText(
      'modal',
      'modal-stars',
      `${'*'.repeat(summary.stars)}${'-'.repeat(3 - summary.stars)} (${summary.stars} / 3 STARS)`
    );
    this.setProps('modal', 'modal-banner-box', {
      display: pres.showBanner ? 'flex' : 'none',
      backgroundColor: bannerBg,
      borderColor: bannerBorder,
    });
    this.setText('modal', 'modal-banner-text', pres.bannerText);
    this.setProps('modal', 'modal-banner-text', {color: bannerTextColor});
    this.setText(
      'modal',
      'modal-summary',
      summary.pinsKnocked >= summary.totalPins
        ? `Clean sweep in ${summary.shotsUsed} ${summary.shotsUsed === 1 ? 'shot' : 'shots'}!`
        : `Knocked ${summary.pinsKnocked} of ${summary.totalPins} pins in ${summary.shotsUsed} of ${summary.maxShots} shots.`
    );
    this.setText(
      'modal',
      'modal-pins-val',
      `${summary.pinsKnocked} / ${summary.totalPins}`
    );
    this.setText('modal', 'modal-score-val', `${summary.levelScore}`);
    if (summary.isCustomWorkshop) {
      this.setText('modal', 'modal-best-label', 'SHOTS USED');
      this.setText(
        'modal',
        'modal-best-val',
        `${summary.shotsUsed} / ${summary.maxShots}`
      );
    } else {
      this.setText('modal', 'modal-best-label', 'BEST SCORE');
      this.setText(
        'modal',
        'modal-best-val',
        `${summary.bestScore ?? summary.levelScore}`
      );
    }

    this.setProps('modal', 'modal-next-btn', {
      display: pres.showNextLevel ? 'flex' : 'none',
      backgroundColor: '#0284c7',
      color: '#ffffff',
    });
    this.setText('modal', 'modal-next-label', pres.nextLevelLabel);

    this.setProps('modal', 'modal-play-again-btn', {
      display: pres.showPlayAgain ? 'flex' : 'none',
      backgroundColor: pres.showNextLevel ? '#334155' : '#0284c7',
      color: '#ffffff',
    });
    this.setText('modal', 'modal-play-again-label', pres.playAgainLabel);

    this.setProps('modal', 'modal-levels-btn', {
      display: pres.showOtherLevels ? 'flex' : 'none',
      backgroundColor: '#334155',
      color: '#f8fafc',
    });
    this.setText('modal', 'modal-levels-label', pres.otherLevelsLabel);

    this.setProps('modal', 'modal-edit-setup-btn', {
      display: pres.showEditSetup ? 'flex' : 'none',
      backgroundColor: '#334155',
      color: '#f8fafc',
    });
    this.setText('modal', 'modal-edit-setup-label', pres.editSetupLabel);

    this.setProps('modal', 'modal-main-menu-btn', {
      display: pres.showMainMenu ? 'flex' : 'none',
      backgroundColor: '#334155',
      color: '#f8fafc',
    });
    this.setText('modal', 'modal-main-menu-label', pres.mainMenuLabel);
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

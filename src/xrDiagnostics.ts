import {
  SessionMode,
  VisibilityState,
  buildSessionInit,
  normalizeReferenceSpec,
  resolveReferenceSpaceType,
  type World,
} from '@iwsdk/core';
import * as THREE from 'three';

export interface XRSystemLike {
  isSessionSupported(mode: XRSessionMode): Promise<boolean>;
  requestSession(
    mode: XRSessionMode,
    options?: XRSessionInit
  ): Promise<XRSession>;
}

export type XRStatusTone =
  | 'checking'
  | 'ready'
  | 'loading'
  | 'active'
  | 'unsupported'
  | 'error';

export interface XRCapabilityReport {
  hasNavigatorXR: boolean;
  isSecureContext: boolean;
  immersiveArSupported: boolean;
  requiredFeatures: string[];
  optionalFeatures: string[];
  supportedButtonEnabled: boolean;
  statusTone: XRStatusTone;
  statusBadge: string;
  detailMessage: string;
}

export interface XRLaunchResult {
  ok: boolean;
  alreadyActive?: boolean;
  duplicatePrevented?: boolean;
  session?: XRSession;
  enabledFeatures: string[];
  unsupportedRequestedFeatures: string[];
  errorCode?: string;
  errorMessage?: string;
}

export interface XRLaunchWorldLike {
  xrEnabled?: boolean;
  session?: XRSession;
  sessionRequestPending?: boolean;
  xrDefaults?: {
    sessionMode?: SessionMode;
    referenceSpace?: Parameters<typeof normalizeReferenceSpec>[0];
    features?: Record<string, unknown>;
    restoreCameraOnExit?: boolean;
  };
  visibilityState: {value: VisibilityState};
  camera: THREE.Camera;
  renderer: {
    xr: {
      enabled: boolean;
      getDepthSensingMesh?: () => unknown;
      setReferenceSpaceType: (type: XRReferenceSpaceType) => void;
      setSession: (session: XRSession) => Promise<void>;
    };
  };
}

export const ROLLOX_REQUESTED_FEATURES = [
  'hand-tracking',
  'plane-detection',
  'depth-sensing',
] as const;

export function buildSafeImmersiveARSessionInit(
  worldDefaults?: XRLaunchWorldLike['xrDefaults'],
  includeDepthDict = true
): XRSessionInit {
  const rawFeatures = {...(worldDefaults?.features ?? {})};
  // Force optional semantics for all non-baseline capabilities so missing runtime
  // features (like depth-sensing on Quest 2 or desktop) never block AR startup.
  const sanitizedFeatures: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(rawFeatures)) {
    if (val === false || val === undefined) continue;
    if (key === 'depthSensing') {
      if (!includeDepthDict) {
        sanitizedFeatures.depthSensing = true;
      } else if (typeof val === 'object' && val !== null) {
        sanitizedFeatures.depthSensing = {...(val as object), required: false};
      } else {
        sanitizedFeatures.depthSensing = true;
      }
      continue;
    }
    sanitizedFeatures[key] =
      typeof val === 'object' && val !== null
        ? {...(val as object), required: false}
        : true;
  }

  return buildSessionInit({
    sessionMode: SessionMode.ImmersiveAR,
    referenceSpace: worldDefaults?.referenceSpace,
    features: sanitizedFeatures,
  } as Parameters<typeof buildSessionInit>[0]);
}

export async function probeXRCapabilities(env?: {
  xr?: XRSystemLike | null;
  isSecureContext?: boolean;
  xrDefaults?: XRLaunchWorldLike['xrDefaults'];
}): Promise<XRCapabilityReport> {
  const isSecureContext =
    env?.isSecureContext ??
    (typeof window !== 'undefined' ? window.isSecureContext !== false : true);
  const xr =
    env && 'xr' in env
      ? env.xr
      : typeof navigator !== 'undefined'
        ? (navigator.xr as XRSystemLike | undefined)
        : undefined;

  const sessionInit = buildSafeImmersiveARSessionInit(env?.xrDefaults, true);
  const requiredFeatures = Array.from(sessionInit.requiredFeatures ?? []).map(
    String
  );
  const optionalFeatures = Array.from(sessionInit.optionalFeatures ?? []).map(
    String
  );

  if (!isSecureContext) {
    return {
      hasNavigatorXR: !!xr,
      isSecureContext: false,
      immersiveArSupported: false,
      requiredFeatures,
      optionalFeatures,
      supportedButtonEnabled: false,
      statusTone: 'unsupported',
      statusBadge: 'HTTPS REQUIRED',
      detailMessage:
        'WebXR Mixed Reality requires HTTPS (use VITE_HTTPS=true over LAN for Quest).',
    };
  }

  if (!xr || typeof xr.isSessionSupported !== 'function') {
    return {
      hasNavigatorXR: false,
      isSecureContext,
      immersiveArSupported: false,
      requiredFeatures,
      optionalFeatures,
      supportedButtonEnabled: false,
      statusTone: 'unsupported',
      statusBadge: 'NO WEBXR API',
      detailMessage:
        'navigator.xr is unavailable in this browser. Desktop mouse play remains active.',
    };
  }

  try {
    const supported = await xr.isSessionSupported('immersive-ar');
    if (!supported) {
      return {
        hasNavigatorXR: true,
        isSecureContext,
        immersiveArSupported: false,
        requiredFeatures,
        optionalFeatures,
        supportedButtonEnabled: false,
        statusTone: 'unsupported',
        statusBadge: 'AR UNSUPPORTED',
        detailMessage:
          "Browser reports 'immersive-ar' is unsupported on this device.",
      };
    }

    return {
      hasNavigatorXR: true,
      isSecureContext,
      immersiveArSupported: true,
      requiredFeatures,
      optionalFeatures,
      supportedButtonEnabled: true,
      statusTone: 'ready',
      statusBadge: 'IMMERSIVE-AR READY',
      detailMessage: `immersive-ar ready | Optional: ${ROLLOX_REQUESTED_FEATURES.join(', ')}`,
    };
  } catch (error) {
    const msg = formatXRErrorMessage(error);
    return {
      hasNavigatorXR: true,
      isSecureContext,
      immersiveArSupported: false,
      requiredFeatures,
      optionalFeatures,
      supportedButtonEnabled: false,
      statusTone: 'error',
      statusBadge: 'XR CHECK FAILED',
      detailMessage: `Failed checking immersive-ar support: ${msg}`,
    };
  }
}

export function formatXRErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const code = error.name && error.name !== 'Error' ? `${error.name}: ` : '';
    return `${code}${error.message || 'Unknown WebXR error'}`;
  }
  return String(error || 'Unknown WebXR error');
}

export function inspectGrantedXRFeatures(
  session: Pick<XRSession, 'enabledFeatures'> | undefined,
  requested: readonly string[] = ROLLOX_REQUESTED_FEATURES
): {
  enabledFeatures: string[];
  unsupportedRequestedFeatures: string[];
} {
  const grantedSet = new Set<string>();
  const raw = (session as XRSession & {enabledFeatures?: Iterable<string>})
    ?.enabledFeatures;
  if (raw) {
    for (const f of raw) {
      grantedSet.add(String(f));
    }
  }
  const enabledFeatures = Array.from(grantedSet);
  const unsupportedRequestedFeatures =
    enabledFeatures.length > 0
      ? requested.filter((f) => !grantedSet.has(f))
      : [];
  return {enabledFeatures, unsupportedRequestedFeatures};
}

let _moduleLaunchInFlight = false;

export async function launchXRSessionWithDiagnostics(
  world: XRLaunchWorldLike | World,
  options?: {
    xr?: XRSystemLike | null;
    onSessionEnded?: () => void;
    onVisibilityChanged?: (state: VisibilityState) => void;
  }
): Promise<XRLaunchResult> {
  const w = world as XRLaunchWorldLike;
  if (w.xrEnabled === false) {
    return {
      ok: false,
      enabledFeatures: [],
      unsupportedRequestedFeatures: [],
      errorCode: 'XRDisabledError',
      errorMessage: 'XR is disabled in world configuration.',
    };
  }

  if (w.session != null) {
    const inspected = inspectGrantedXRFeatures(w.session);
    return {
      ok: true,
      alreadyActive: true,
      session: w.session,
      ...inspected,
    };
  }

  if (w.sessionRequestPending || _moduleLaunchInFlight) {
    return {
      ok: false,
      duplicatePrevented: true,
      enabledFeatures: [],
      unsupportedRequestedFeatures: [],
      errorCode: 'DuplicateLaunchError',
      errorMessage: 'An XR session request is already in progress.',
    };
  }

  const xr =
    options && 'xr' in options
      ? options.xr
      : typeof navigator !== 'undefined'
        ? (navigator.xr as XRSystemLike | undefined)
        : undefined;

  if (!xr || typeof xr.requestSession !== 'function') {
    return {
      ok: false,
      enabledFeatures: [],
      unsupportedRequestedFeatures: [],
      errorCode: 'NoWebXRError',
      errorMessage:
        'navigator.xr.requestSession is unavailable in this browser.',
    };
  }

  _moduleLaunchInFlight = true;
  w.sessionRequestPending = true;
  w.renderer.xr.enabled = true;

  let session: XRSession | undefined;
  try {
    const primaryInit = buildSafeImmersiveARSessionInit(w.xrDefaults, true);
    try {
      session = await xr.requestSession('immersive-ar', primaryInit);
    } catch (primaryErr) {
      const errName = primaryErr instanceof Error ? primaryErr.name : '';
      // Some runtimes reject depthSensing preference dictionary even when 'depth-sensing'
      // is optional; retry cleanly once without the depthSensing dictionary if NotSupportedError.
      if (errName === 'NotSupportedError' && primaryInit.depthSensing) {
        const fallbackInit = buildSafeImmersiveARSessionInit(
          w.xrDefaults,
          false
        );
        session = await xr.requestSession('immersive-ar', fallbackInit);
      } else {
        throw primaryErr;
      }
    }

    if (!session) {
      return {
        ok: false,
        enabledFeatures: [],
        unsupportedRequestedFeatures: [],
        errorCode: 'NullSessionError',
        errorMessage: 'Browser returned an empty XR session.',
      };
    }

    const refSpec = normalizeReferenceSpec(w.xrDefaults?.referenceSpace);
    const resolvedRef = await resolveReferenceSpaceType(
      session,
      refSpec.type,
      refSpec.required ? [] : refSpec.fallbackOrder
    );

    const savedPos = w.camera.position.clone();
    const savedQuat = w.camera.quaternion.clone();
    const restoreCameraOnExit = w.xrDefaults?.restoreCameraOnExit !== false;

    w.renderer.xr.getDepthSensingMesh = () => null;
    w.renderer.xr.setReferenceSpaceType(resolvedRef);
    await w.renderer.xr.setSession(session);

    const mapVisibility = (raw?: XRVisibilityState): VisibilityState => {
      if (raw === 'hidden') return VisibilityState.Hidden;
      if (raw === 'visible-blurred') return VisibilityState.VisibleBlurred;
      return VisibilityState.Visible;
    };

    const onVisibilityChange = () => {
      const next = mapVisibility(session?.visibilityState);
      w.visibilityState.value = next;
      options?.onVisibilityChanged?.(next);
    };

    const onEnd = () => {
      session?.removeEventListener('end', onEnd);
      session?.removeEventListener('visibilitychange', onVisibilityChange);
      if (w.session === session) {
        w.session = undefined;
      }
      if (restoreCameraOnExit) {
        w.camera.position.copy(savedPos);
        w.camera.quaternion.copy(savedQuat);
      }
      w.visibilityState.value = VisibilityState.NonImmersive;
      options?.onVisibilityChanged?.(VisibilityState.NonImmersive);
      options?.onSessionEnded?.();
    };

    session.addEventListener('visibilitychange', onVisibilityChange);
    session.addEventListener('end', onEnd);

    w.session = session;
    const initialVis = mapVisibility(session.visibilityState);
    w.visibilityState.value = initialVis;
    options?.onVisibilityChanged?.(initialVis);

    const inspected = inspectGrantedXRFeatures(session);
    return {
      ok: true,
      session,
      ...inspected,
    };
  } catch (error) {
    if (session) {
      try {
        await session.end();
      } catch {
        // Ignore cleanup end failures
      }
    }
    const errorCode = error instanceof Error ? error.name : 'XRLaunchError';
    const errorMessage = formatXRErrorMessage(error);
    console.error('[Rollox XR] Failed to launch immersive-ar session:', error);
    return {
      ok: false,
      enabledFeatures: [],
      unsupportedRequestedFeatures: [],
      errorCode,
      errorMessage,
    };
  } finally {
    _moduleLaunchInFlight = false;
    w.sessionRequestPending = false;
  }
}

export async function exitXRSessionSafely(
  world: Pick<XRLaunchWorldLike, 'session'>
): Promise<void> {
  if (!world.session) return;
  try {
    await world.session.end();
  } catch (error) {
    console.error('[Rollox XR] Failed to exit XR session cleanly:', error);
  }
}

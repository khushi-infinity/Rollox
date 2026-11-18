import {VisibilityState} from '@iwsdk/core';
import {signal} from '@preact/signals-core';
import * as THREE from 'three';
import {describe, expect, it, vi} from 'vitest';

import {
  type XRLaunchWorldLike,
  type XRSystemLike,
  exitXRSessionSafely,
  launchXRSessionWithDiagnostics,
  probeXRCapabilities,
} from './xrDiagnostics';

type EventHandler = (event: unknown) => void;

function makeMockSession(opts?: {
  enabledFeatures?: string[];
  visibilityState?: XRVisibilityState;
  supportedSpaces?: XRReferenceSpaceType[];
}) {
  const listeners = new Map<string, Set<EventHandler>>();
  const supportedSpaces = opts?.supportedSpaces ?? ['local-floor', 'local'];

  const session = {
    enabledFeatures: opts?.enabledFeatures ?? [
      'local-floor',
      'hand-tracking',
      'plane-detection',
      'anchors',
      'hit-test',
    ],
    visibilityState: opts?.visibilityState ?? ('visible' as XRVisibilityState),
    addEventListener: vi.fn((type: string, fn: EventHandler) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)?.add(fn);
    }),
    removeEventListener: vi.fn((type: string, fn: EventHandler) => {
      listeners.get(type)?.delete(fn);
    }),
    requestReferenceSpace: vi.fn(async (type: XRReferenceSpaceType) => {
      if (!supportedSpaces.includes(type)) {
        throw new Error(`Unsupported reference space ${type}`);
      }
      return {} as XRReferenceSpace;
    }),
    end: vi.fn(async () => {
      session.emit('end');
    }),
    emit(type: string) {
      for (const fn of Array.from(listeners.get(type) ?? [])) {
        fn({type, session});
      }
    },
  };
  return session as unknown as XRSession & {
    emit: (type: string) => void;
    visibilityState: XRVisibilityState;
  };
}

function makeMockWorld(): XRLaunchWorldLike {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 1.48, 0.36);
  camera.quaternion.setFromEuler(new THREE.Euler(-0.3, 0, 0));

  return {
    xrEnabled: true,
    session: undefined,
    sessionRequestPending: false,
    xrDefaults: {
      features: {
        handTracking: true,
        anchors: true,
        planeDetection: true,
        meshDetection: true,
        hitTest: true,
        depthSensing: {usage: 'gpu-optimized', format: 'float32'},
      },
      restoreCameraOnExit: true,
    },
    visibilityState: signal<VisibilityState>(VisibilityState.NonImmersive),
    camera,
    renderer: {
      xr: {
        enabled: false,
        setReferenceSpaceType: vi.fn(),
        setSession: vi.fn(async () => {}),
      },
    },
  };
}

describe('WebXR Runtime Diagnostics & Session Lifecycle', () => {
  it('detects navigator.xr availability, insecure contexts, and immersive-ar support via feature detection', async () => {
    const insecure = await probeXRCapabilities({
      isSecureContext: false,
      xr: null,
    });
    expect(insecure.immersiveArSupported).toBe(false);
    expect(insecure.supportedButtonEnabled).toBe(false);
    expect(insecure.detailMessage).toContain('HTTPS');

    const noXr = await probeXRCapabilities({
      isSecureContext: true,
      xr: undefined,
    });
    expect(noXr.hasNavigatorXR).toBe(false);
    expect(noXr.immersiveArSupported).toBe(false);
    expect(noXr.supportedButtonEnabled).toBe(false);

    const unsupportedXr: XRSystemLike = {
      isSessionSupported: vi.fn(async () => false),
      requestSession: vi.fn(),
    };
    const arOff = await probeXRCapabilities({
      isSecureContext: true,
      xr: unsupportedXr,
    });
    expect(arOff.hasNavigatorXR).toBe(true);
    expect(arOff.immersiveArSupported).toBe(false);
    expect(arOff.supportedButtonEnabled).toBe(false);

    const supportedXr: XRSystemLike = {
      isSessionSupported: vi.fn(async (mode) => mode === 'immersive-ar'),
      requestSession: vi.fn(),
    };
    const arOn = await probeXRCapabilities({
      isSecureContext: true,
      xr: supportedXr,
      xrDefaults: makeMockWorld().xrDefaults,
    });
    expect(arOn.immersiveArSupported).toBe(true);
    expect(arOn.supportedButtonEnabled).toBe(true);
    expect(arOn.requiredFeatures).toEqual([]);
    expect(arOn.optionalFeatures).toContain('hand-tracking');
    expect(arOn.optionalFeatures).toContain('depth-sensing');
  });

  it('launches immersive-ar cleanly, keeps optional features optional, and reports granted vs skipped features', async () => {
    const world = makeMockWorld();
    const session = makeMockSession({
      enabledFeatures: ['local-floor', 'hand-tracking', 'plane-detection'],
    });
    const xr: XRSystemLike = {
      isSessionSupported: vi.fn(async () => true),
      requestSession: vi.fn(async () => session),
    };

    const result = await launchXRSessionWithDiagnostics(world, {xr});
    expect(result.ok).toBe(true);
    expect(result.session).toBe(session);
    expect(world.session).toBe(session);
    expect(world.sessionRequestPending).toBe(false);
    expect(world.visibilityState.value).toBe(VisibilityState.Visible);
    expect(xr.requestSession).toHaveBeenCalledWith(
      'immersive-ar',
      expect.objectContaining({
        requiredFeatures: [],
        optionalFeatures: expect.arrayContaining([
          'hand-tracking',
          'plane-detection',
          'depth-sensing',
        ]),
      })
    );
    expect(result.enabledFeatures).toContain('hand-tracking');
    expect(result.unsupportedRequestedFeatures).toContain('depth-sensing');
  });

  it('catches requestSession rejections cleanly and surfaces diagnostic error messages without leaving pending lock stuck', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const world = makeMockWorld();
    const deniedErr = new Error('User declined WebXR permission');
    deniedErr.name = 'NotAllowedError';
    const xr: XRSystemLike = {
      isSessionSupported: vi.fn(async () => true),
      requestSession: vi.fn(async () => {
        throw deniedErr;
      }),
    };

    const res = await launchXRSessionWithDiagnostics(world, {xr});
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe('NotAllowedError');
    expect(res.errorMessage).toContain('User declined WebXR permission');
    expect(world.session).toBeUndefined();
    expect(world.sessionRequestPending).toBe(false);
    expect(world.visibilityState.value).toBe(VisibilityState.NonImmersive);
    errSpy.mockRestore();
  });

  it('prevents duplicate concurrent launch requests while a session request is in flight', async () => {
    const world = makeMockWorld();
    const session = makeMockSession();
    let resolveSession!: (s: XRSession) => void;
    const xr: XRSystemLike = {
      isSessionSupported: vi.fn(async () => true),
      requestSession: vi.fn(
        () =>
          new Promise<XRSession>((resolve) => {
            resolveSession = resolve;
          })
      ),
    };

    const firstPromise = launchXRSessionWithDiagnostics(world, {xr});
    const duplicate = await launchXRSessionWithDiagnostics(world, {xr});
    expect(duplicate.ok).toBe(false);
    expect(duplicate.duplicatePrevented).toBe(true);
    expect(xr.requestSession).toHaveBeenCalledTimes(1);

    resolveSession(session);
    const first = await firstPromise;
    expect(first.ok).toBe(true);
    expect(world.session).toBe(session);
  });

  it('tracks session visibility transitions and restores world & camera cleanly on session exit', async () => {
    const world = makeMockWorld();
    const initialCamPos = world.camera.position.clone();
    const session = makeMockSession();
    const onEnded = vi.fn();
    const xr: XRSystemLike = {
      isSessionSupported: vi.fn(async () => true),
      requestSession: vi.fn(async () => session),
    };

    await launchXRSessionWithDiagnostics(world, {
      xr,
      onSessionEnded: onEnded,
    });

    // Simulate WebXR runtime mutating camera while in immersive session
    world.camera.position.set(1.2, 2.5, -3.1);

    // Visibility transitions
    session.visibilityState = 'visible-blurred';
    session.emit('visibilitychange');
    expect(world.visibilityState.value).toBe(VisibilityState.VisibleBlurred);

    session.visibilityState = 'hidden';
    session.emit('visibilitychange');
    expect(world.visibilityState.value).toBe(VisibilityState.Hidden);

    session.visibilityState = 'visible';
    session.emit('visibilitychange');
    expect(world.visibilityState.value).toBe(VisibilityState.Visible);

    // Session exit restores state & camera
    await exitXRSessionSafely(world);
    expect(world.session).toBeUndefined();
    expect(world.visibilityState.value).toBe(VisibilityState.NonImmersive);
    expect(world.camera.position.distanceTo(initialCamPos)).toBeCloseTo(0, 5);
    expect(onEnded).toHaveBeenCalledTimes(1);
  });
});

# PROJECT_STATUS.md — Rollox

## 1. Project Objective
Build **Rollox**, a hands-first miniature mixed-reality bowling game for Meta Quest using **Meta Immersive Web SDK (`@iwsdk/core@1.1.0`)**, Three.js, Rapier3D physics, and Horizon UIKitML spatial UI. Players sit comfortably and pinch a miniature bowling ball directly in front of them, pull back to charge shot power, move sideways to aim, and open their pinch to bowl down handcrafted and Custom Game fantasy lanes anchored onto real-world tables via WebXR passthrough.

## 2. Technology Stack & Installed Versions
- **XR Framework**: `@iwsdk/core@1.1.0` (Meta IWSDK ECS, `immersive-ar` passthrough, `DepthSensingSystem`, `XRPlane` scene understanding, `UIKitMLAsset`, Horizon spatial UI, IWER desktop emulator)
- **3D Engine**: `three@0.185.0` (`super-three` via `@iwsdk/core`, procedural PBR bump & roughness maps, `IBLTexture: room`, `LatheGeometry` pins, `InstancedMesh` VFX)
- **Physics Engine**: `@dimforge/rapier3d-simd-compat@^0.19.3` (fixed 90Hz stepped physics, CCD ball, compound pin colliders, kinematic obstacles, trimesh/height ramps)
- **Spatial UI**: `@pmndrs/uikit@^1.0.74`, `@pmndrs/uikit-horizon@^1.0.74`, `@preact/signals-core@^1.14.0`
- **Build & Test**: TypeScript `^5.8.3`, Vite `^7.1.4`, Vitest `^3.2.4`

## 3. Current Working Features
- **WebXR Runtime Diagnostics & Session Launch Resilience (`/src/xrDiagnostics.ts`)**:
  - Real feature detection via `navigator.xr` and `navigator.xr.isSessionSupported('immersive-ar')` (no user-agent sniffing).
  - Requests only active WebXR capabilities (`hand-tracking`, `plane-detection`, `depth-sensing`) as optional features while disabling unused `meshDetection`, `anchors`, `hitTest`, and `environmentRaycast` in `/iwsdk.config.json` to prevent Quest room-mesh rebuild churn and failed anchor retry loops.
  - Loading state, duplicate launch prevention, explicit `try/catch` error surfacing in both the 2D XR entry dock and Main Menu, reference-space resolution, camera restore on exit, and granted-vs-skipped feature reporting.
- **Spatial Anchoring Stability & Frame Pacing (`/src/systems/GameFlowSystem.ts`, `/src/systems/RolloxPhysicsSystem.ts`, `/src/geometry.ts`)**:
  - Locks `RolloxWorldRoot` (`RolloxTableRoot`, `RolloxArenaRoot`, `RolloxDynamicEntities`, `RolloxAimingGuides`, bowling ball, ray reticle, and all 9 spatial UIKitML panels) in world space (never camera-parented) with a strict one-time `XRPlane` initial placement guard (`hasAutoSnappedPlane || hasUserPlaced || hasPlayedAnyShotThisSession`).
  - Pauses Rapier3D physics stepping during `MAIN_MENU`, `LEVEL_SELECT`, `PAUSED`, and `RESULT`, registers the ground trimesh collider once, avoids recursive `DepthOccludable` `onBeforeCompile` shader wrapping via `restoreOpaqueMaterials()`, and resolves ball runs cleanly once past the pin deck (`ballReachedPinDeck`).
- **Interaction-Stable Spatial UI (`/src/menuInteraction.ts`, `/src/systems/SpatialUISystem.ts`)**:
  - Decouples spatial UI panel vertical anchoring (`detectedSurfaceY ?? ARENA_TABLE_Y`) from table `heightOffset` (`Higher` / `Lower`) so adjusting table height moves only the 3D bowling arena.
  - Per-button single-click cooldown (`220ms`) and cross-screen transition lock (`240ms`) prevent XR poke/ray bounce and accidental bleed-through clicks.
  - Fallen pins remain hidden across mid-round height/distance/recenter adjustments.
- **Streamlined Menu, Campaign, Incomplete-Level, Pause & Custom Game Flows**:
  - **Main Menu**: Clean primary navigation (`PLAY`, `CUSTOM GAME`, `SETTINGS`, `ENTER/EXIT MIXED REALITY`).
  - **Campaign Level Selection**: Displays all 5 levels clearly marking `COMPLETED`, `CURRENT`, `UNLOCKED`, and `LOCKED` states, enforcing level locks while launching unlocked levels immediately.
  - **Pause Modal**: Displays `Resume Game`, `Restart Level` / `Restart Custom Game`, `Other Levels` (campaign) or `Edit Setup` (custom), `Settings & Menu Size`, and `Main Menu`.
  - **Post-Game Results & Incomplete-Level Modal**: Displays Final Score, Best Score / Shots Used, Pins Knocked Down, and Stars Earned. When a campaign level is **not completed** (`stars === 0`), displays an amber `'LEVEL NOT COMPLETED'` modal (`'NO PINS KNOCKED'` or `'ALMOST THERE!'`) with **`Try Again`**, **`Other Levels`**, and **`Main Menu`** (hiding `Next Level`). Completed campaign rounds show **`Next Level`** (or `'CAMPAIGN COMPLETE!'` on Level 5), **`Play Again`**, **`Other Levels`**, and **`Main Menu`**. Custom Game rounds show **`Play Again`**, **`Edit Setup`**, and **`Main Menu`**.
- **Hands-First Pinch-Pull-Aim-Release (`PullStateMachine` + `AimingSystem`)**:
  - Preserved intact with XRHand joint pinch hysteresis, tracking-loss grace window, smooth pull following, controller haptics, and desktop mouse drag fallback.

## 4. Key Source Files
- `/src/xrDiagnostics.ts` & `/src/xrDiagnostics.test.ts` — WebXR runtime probing, resilient `immersive-ar` launcher, error surfacing, and unit tests.
- `/src/menuInteraction.ts` & `/src/rollox.test.ts` — `MenuInteractionGuard` click debounce/transition lock, level card states, incomplete/complete Results presentation, and unit tests.
- `/src/systems/SpatialUISystem.ts`, `/src/systems/GameFlowSystem.ts`, `/src/systems/RolloxPhysicsSystem.ts` — IWSDK UI orchestration, persistent world-root anchoring, idle physics gating, shot completion, campaign progression, and Custom Game flow.
- `/src/geometry.ts` — Procedural PBR textures, arena geometry, and clean `restoreOpaqueMaterials()` shader teardown.
- `/src/levels.ts`, `/src/types.ts`, `/src/pullInteraction.ts`, `/src/systems/AimingSystem.ts`, `/src/physics/BowlingWorld.ts` — Core physics, aiming, levels, and modular Alley Workshop compiler.
- `/iwsdk.config.json`, `/index.html`, `/src/index.css`, `/public/ui/*.uikitml`, `/public/scenes/main.iwsdk.scene.json` — Scene understanding config, spatial UI panels, and 2D XR dock.

## 5. Verification Status
- Verified via `npm test` (28/28 tests across 4 files), `npm run build` (`compile_applet`), `npm run lint` (`lint_applet`), and headless Chromium + IWER runtime E2E verification (see latest turn report).

## 6. Requires Physical Meta Quest Headset Verification
- Real-world Meta Quest Browser `immersive-ar` passthrough startup over HTTPS (`VITE_HTTPS=true npm run dev`), physical hand-tracking poke/ray interaction on the incomplete-level / pause / results modals, `depth-sensing` occlusion blending, sustained Quest framerate after failed rounds, and `XRPlane` initial tabletop locking.

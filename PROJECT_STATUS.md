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
  - Keeps requested capabilities (`hand-tracking`, `plane-detection`, `anchors`, `hit-test`, `mesh-detection`, `depth-sensing`) strictly optional so missing runtime capabilities never block session creation.
  - Loading state, duplicate launch prevention, explicit `try/catch` error surfacing in both the 2D XR entry dock and Main Menu, reference-space resolution, camera restore on exit, and granted-vs-skipped feature reporting.
- **Interaction-Stable Spatial UI (`/src/menuInteraction.ts`, `/src/systems/SpatialUISystem.ts`)**:
  - Decouples spatial UI panel vertical anchoring (`detectedSurfaceY ?? ARENA_TABLE_Y`) from table `heightOffset` (`Higher` / `Lower`) so adjusting table height moves only the 3D bowling arena — preventing panel drift or runaway re-triggers under stationary hands/rays.
  - Per-button single-click cooldown (`220ms`) and cross-screen transition lock (`240ms`) prevent XR poke/ray bounce and accidental bleed-through clicks.
  - Fallen pins remain hidden across mid-round height/distance/recenter adjustments.
- **Streamlined Menu, Campaign Flow, Results & Custom Game**:
  - **Main Menu**: Clean primary navigation (`PLAY`, `CUSTOM GAME`, `SETTINGS`, `ENTER/EXIT MIXED REALITY`).
  - **Campaign Level Selection**: Displays all 5 levels clearly marking `COMPLETED`, `CURRENT`, `UNLOCKED`, and `LOCKED` states, enforcing level locks while launching unlocked levels immediately.
  - **Post-Game Results Screen**: Shows Final Score, Best Score / Shots Used, Pins Knocked Down, Stars Earned, and clean actions (`Next Level` / `Play Again` / `Main Menu`, with a `CAMPAIGN COMPLETE!` banner replacing `Next Level` on Level 5).
  - **Custom Game Setup (Alley Workshop)**: Configure modular lanes (8 module types), Obstacles (`dwarf`, `bumper`, `movingGate`, `slidingBarrier`), Pin Arrangements (`standard10`, `diamond9`, `split8`, `crown6`), Gameplay Settings (Attempts `2–6`, Obstacle Speed `Relaxed`/`Normal`/`Fast`, Side Rails ON/OFF), live validation, `Play Again` / `Edit Custom Game` / `Main Menu` results flow.
- **Hands-First Pinch-Pull-Aim-Release (`PullStateMachine` + `AimingSystem`)**:
  - Preserved intact with XRHand joint pinch hysteresis, tracking-loss grace window, smooth pull following, controller haptics, and desktop mouse drag fallback.

## 4. Key Source Files
- `/src/xrDiagnostics.ts` & `/src/xrDiagnostics.test.ts` — WebXR runtime probing, resilient `immersive-ar` launcher, error surfacing, and unit tests.
- `/src/menuInteraction.ts` — `MenuInteractionGuard` click debounce/transition lock, level card states, and Results formatting helpers.
- `/src/systems/SpatialUISystem.ts` & `/src/systems/GameFlowSystem.ts` — IWSDK UI orchestration, decoupled Y anchor, WebXR dock/menu sync, campaign progression, and Custom Game flow.
- `/src/levels.ts`, `/src/types.ts`, `/src/pullInteraction.ts`, `/src/systems/AimingSystem.ts`, `/src/physics/BowlingWorld.ts` — Core physics, aiming, levels, and modular Alley Workshop compiler.
- `/index.html`, `/src/index.css`, `/public/ui/*.uikitml`, `/public/scenes/main.iwsdk.scene.json` — Upgraded spatial UI panels and 2D XR dock.

## 5. Verification Status
- Verified via `npm run lint`, `npm test`, `npm run build`, and headless Chromium runtime inspection (see latest turn report).

## 6. Requires Physical Meta Quest Headset Verification
- Real-world Meta Quest Browser `immersive-ar` passthrough startup over HTTPS (`VITE_HTTPS=true npm run dev`), real hand-tracking poke/ray menu clicking stability, `depth-sensing` occlusion blending, and `XRPlane` tabletop locking.

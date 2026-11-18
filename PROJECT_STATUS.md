# PROJECT_STATUS.md — Rollox

## 1. Project Objective
Build **Rollox**, a hands-first miniature mixed-reality bowling game for Meta Quest using **Meta Immersive Web SDK (`@iwsdk/core@1.1.0`)**, Three.js, Rapier3D physics, and Horizon UIKitML spatial UI. Players sit comfortably and pinch a miniature bowling ball directly in front of them, pull back to charge shot power, move sideways to aim, and open their pinch to bowl down handcrafted and Workshop-built fantasy lanes anchored onto real-world tables via WebXR passthrough.

## 2. Technology Stack & Installed Versions
- **XR Framework**: `@iwsdk/core@1.1.0` (Meta IWSDK ECS, `immersive-ar` passthrough, `DepthSensingSystem`, `XRPlane` scene understanding, `UIKitMLAsset`, Horizon spatial UI, IWER desktop emulator)
- **3D Engine**: `three@0.186.0` (procedural PBR wood/stone bump & roughness maps, `IBLTexture: room` PMREM reflections, `LatheGeometry` pins, `InstancedMesh` VFX)
- **Physics Engine**: `@dimforge/rapier3d-simd-compat@^0.19.3` (fixed 90Hz stepped physics, CCD ball, compound pin colliders, kinematic obstacles, trimesh/height ramps)
- **Spatial UI**: `@pmndrs/uikit@^1.0.64`, `@preact/signals-core@^1.14.0`
- **Build & Test**: TypeScript `^7.0.2`, Vite `^7.3.8`, Vitest `3.2.7`

## 3. Current Working Features
- **Hands-First Pinch-Pull-Aim-Release (`PullStateMachine` + `AimingSystem`)**:
  - Direct WebXR `XRHand` joint tracking (`thumb-tip` & `index-finger-tip` midpoint and millimeter distance) with pinch hysteresis (`2.8cm` acquire / `4.8cm` release), `48ms` release debounce, and `240ms` tracking-loss hold grace (cancels safely instead of misfiring).
  - Seamless WebXR controller grip + haptic power ticks, plus 2D desktop mouse tabletop ray-plane drag fallback.
  - Smooth framerate-independent ball attachment throughout full backward pull with zero snap-forward or auto-release.
- **Mixed-Reality Passthrough & Tabletop Craft**:
  - True transparent `immersive-ar` session with `IBLTexture` (`room` PMREM), warm key directional shadows, and `ShadowCatcher` ground shadow projection.
  - Conditional `DepthSensingSystem` + `MinMaxSoftOcclusion` enabled automatically when WebXR runtime grants `'depth-sensing'`.
  - Ranked horizontal `XRPlane` tabletop locking right in front of the player's seated gaze.
  - Sculpted tee cradle, rubberized table pads, procedural lane bump/roughness maps, brass rail brackets, lantern glow cones, cushioned pin-pit bumper, orbital charge sparks, and layered Web Audio.
- **Spatial Menu & Interface Scaling**:
  - Live **Zoom In (`+`) / Zoom Out (`-`) / Reset** controls in Main Menu, Settings (`Menu & UI Scale`), and Pause Modal (`Settings & Menu Size`), plus `[` / `]` keyboard shortcuts.
  - Clamped to `[0.7, 1.5]` (`70%`–`150%`), persisted in `localStorage`, driven via `UIKitDocument.setTargetDimensions` so text stays crisp and `RayInteractable`/`PokeInteractable` hitboxes stay aligned without scaling the 3D bowling arena.
- **5 Campaign Levels + Modular Alley Workshop**:
  - *Meadow Straight*, *Serpent Zigzag*, *Skybridge Ramp*, *Dwarf's Crossing*, and *Crown Gauntlet*, plus interactive snap-together Workshop builder with 8 modules, 4 obstacle types, 4 pin formations, validation, and live test mode.

## 4. Key Source Files
- `/iwsdk.config.json` & `/public/scenes/main.iwsdk.scene.json` — IWSDK `ar` config (`handTracking`, `planeDetection`, `depthSensing`) & `IBLTexture: room` scene setup.
- `/src/pullInteraction.ts` — Pure `PullStateMachine` (pinch hysteresis, tracking grace, exponential follow damping) & UI scale bounds/step helpers.
- `/src/systems/AimingSystem.ts` — Multi-modal XR hand/controller/mouse aiming, haptics, and glowing aim reticle/trajectory guides.
- `/src/systems/GameFlowSystem.ts` — 12-state lifecycle, conditional `DepthOccludable`, `XRPlane` scoring, level building, and persisted settings/UI scale.
- `/src/systems/SpatialUISystem.ts` — 9 UIKitML spatial panels, `setUiScale` via `setTargetDimensions`, callouts, and 2D dock.
- `/src/geometry.ts`, `/src/vfx.ts`, `/src/audio.ts` — Procedural PBR textures/bump/roughness maps, tabletop hardware, `emitChargeSpark`, and harmonic Web Audio.
- `/src/physics/BowlingWorld.ts`, `/src/levels.ts`, `/src/types.ts` — Rapier3D simulation, level definitions, and Workshop compiler.
- `/public/ui/*.uikitml` — Horizon spatial UI definitions (with scale controls in `main-menu.uikitml`, `settings-panel.uikitml`, and `modal-panel.uikitml`).

## 5. Verification Status
- `npm run lint` (`tsc --noEmit`): 0 errors.
- `npm test` (`vitest run`): 19/19 tests passed across `src/pull.test.ts`, `src/physics.test.ts`, and `src/rollox.test.ts`.
- `npm run build` (`vite build`): succeeded cleanly.
- Headless Chromium live check on `http://localhost:3000/`: WebGL canvas mounted, 0 page errors, 0 HTTP 404s, `[` / `]` UI scale adjustments persisted accurately in `localStorage`.

## 6. Requires Physical Meta Quest Headset Verification
- Real-world Quest 3/3S hand-tracking pinch ergonomics, chest-proximity self-occlusion comfort, `depth-sensing` real-world hand/table occlusion blending, `XRPlane` table locking in physical rooms, and standalone 72/90Hz headset frame pacing.

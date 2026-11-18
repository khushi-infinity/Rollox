# PROJECT_STATUS.md — Rollox

## 1. Project Objective
Build **Rollox**, a polished, hands-first miniature mixed-reality bowling game designed for seated play. Players grab a miniature bowling ball via pinch/drag, pull back for shot power, move sideways to aim, release to launch using real Rapier3D physics, knock down 10 pins across creative modular miniature fantasy lanes (including a patrolling Dwarf Guardian and rotating Rune Bumper), and design their own alleys in a Custom Workshop Builder.

## 2. Technology Stack & Installed Versions
- **XR Framework**: `xrblocks@0.24.0` (WebXR, spatial UI, hand tracking, simulator, `xb.Script` / `xb.MeshScript`)
- **3D Engine**: `three@0.186.0` (procedural PBR materials, `RoomEnvironment` PMREM reflections, `LatheGeometry` pins, `InstancedMesh` VFX)
- **Physics Engine**: `@dimforge/rapier3d-simd-compat@^0.19.3` (integrated via `options.physics.RAPIER` and `xb.Physics`)
- **Spatial UI**: `@pmndrs/uikit@^1.0.64`, `@preact/signals-core@^1.14.0`, `lit@^3.3.1` (`xb.UICard`, `xb.UIPanel`, `xb.UIText`, `xb.UIButton`)
- **Build & Language**: TypeScript `^7.0.2`, Vite `^8.3.0`

> **Note on SDK Alignment**: The repository was initialized as an **XR Blocks (`xrblocks@0.24.0`)** + Three.js + Rapier3D WebXR project. All implementations use the verified installed `xrblocks` APIs rather than inventing non-existent SDK methods.

## 3. Current Working Features
- **Milestone 0 (Project Audit)**: Verified baseline TypeScript + Vite build, inspected `xrblocks@0.24.0` `Script`, `Physics`, `Hands`, `Input`, `Options`, and `UI` modules.
- **Milestone 1 (Playable Bowling Core)**:
  - Miniature tabletop bowling world anchored in seated reach (`ARENA_TABLE_Y = 0.96`, `ARENA_ORIGIN_Z = -0.46`).
  - Pinch-pull-release ball mechanic supporting both WebXR hand tracking (`direct-touch` & `hand-ray`) and Desktop Simulator mouse drag.
  - Real Rapier3D rigid-body physics (`CCD` ball, compound low-center-of-mass bowling pins, fixed lane segments & rails).
  - Pin-fall detection, shot-by-shot scoring (`STRIKE!`, `SPARE!`, per-pin points, unused shot bonuses), and shot/level reset.
- **Milestone 2 (Game Feel)**:
  - Dynamic pullback power ring, elastic slingshot tether, and 14-dot trajectory preview.
  - Procedural Web Audio synthesizer (`RolloxAudio`) for grab, power ticks, launch whoosh, impulse-scaled hardwood pin hits, dwarf shield bonks, rail taps, and strike/spare fanfares + Mute toggle.
  - Zero-GC pooled `InstancedMesh` particle bursts (`ParticleBurstPool`).
  - First-shot onboarding card, callout banners, and "Recenter Table" button.
- **Milestone 3 (Level Variety & Obstacles)**:
  - 5 handcrafted campaign levels: *Meadow Straight*, *Serpent Zigzag*, *Skybridge Ramp*, *Dwarf's Crossing*, and *Crown Gauntlet*.
  - Animated 10-part procedural **Barnaby the Dwarf Guardian** (`kinematicPositionBased` Rapier body patrolling predictably across the lane) and **Rotating Rune Bumper**.
- **Milestone 4 (Custom Builder)**:
  - Spatial **Alley Workshop** card allowing live switching of lane layout (`Straight`, `Zigzag`, `Ramp`), obstacles (`None`, `Dwarf`, `Spinner`, `Both`), pin formations (`10 Pins`, `Diamond 9`, `Split 8`, `Crown 6`), side rails toggle, live `Test Alley`, and `Reset`.

## 4. Files & Modules Created or Modified
- `/metadata.json` — App title & description.
- `/index.html` — Page title & OpenGraph metadata.
- `/src/types.ts` — Shared TypeScript interfaces for phases, levels, obstacles, builder, and score summaries.
- `/src/levels.ts` — Campaign level definitions, pin formation math, and `buildCustomLevel`.
- `/src/audio.ts` — Procedural Web Audio sound synthesizer (`RolloxAudio`).
- `/src/vfx.ts` — Pooled `InstancedMesh` particle burst system (`ParticleBurstPool`).
- `/src/geometry.ts` — Procedural `CanvasTexture` PBR materials, `LatheGeometry` pins, modular lane segments, fantasy arch backdrop, 10-part Dwarf Guardian rig, and Rotating Bumper.
- `/src/physics/BowlingWorld.ts` — Rapier3D physics integration (`init`, `buildLevelPhysics`, `launchBall`, `stepObstaclesAndSync`, `evaluateFallenPins`).
- `/src/ui/RolloxUI.ts` — XR Blocks spatial `UICard` system (Title, Scoreboard HUD, Level Select, Pause/Results modal, Onboarding, Callouts, Workshop Builder).
- `/src/RolloxGame.ts` — Main `xb.Script` orchestrating aiming, physics, VFX/audio, scoring, and state machine.
- `/src/index.ts` — XR Blocks entry point enabling hands, reticles, and Rapier physics.

## 5. Commands to Run the Project
- `npm run dev` — Start Vite dev server on port `3000`.
- `npm run lint` — TypeScript check (`tsc --noEmit`).
- `npm run build` — Production build (`vite build`).

## 6. Tests & Checks Completed
- **Milestone 0 Baseline**: `npm run lint && npm run build` passed on the initial template scaffold (`exit code 0`).
- **Final Verification (`tsc --noEmit` via `lint_applet` + `vite build` via `compile_applet`)**: Passed with zero TypeScript or bundler errors after resolving `xb.core.renderer` access in `src/RolloxGame.ts`, passing `{x, y, z}` to Rapier's `RigidBodyDesc.setAngvel` in `src/physics/BowlingWorld.ts`, and adding `onObjectSelectEnd` / `onObjectGrabEnd` handlers on `BallGrabTarget` for reliable direct-touch and ray release.

## 7. Known Bugs & Limitations
- Physical headset hand-tracking ergonomics (pinch comfort, real-world table height alignment) and live interactive browser playtesting have not yet been executed on a physical Meta Quest or Android XR headset; desktop build and strict TypeScript checks are verified.

## 8. Exact Next Recommended Task
- Launch in the XR Blocks Desktop Simulator (`npm run dev`) or open in a WebXR-capable headset browser (Meta Quest / Android XR) to playtest all 5 campaign lanes, custom builder combinations, and hand-pinch pullback comfort (`MAX_PULL_DISTANCE` and `launchSpeed` in `src/RolloxGame.ts`).

## 9. Important SDK/API Decisions & References
- Uses `xrblocks@0.24.0` `xb.Script` / `xb.MeshScript` lifecycle (`init`, `initPhysics`, `physicsStep`, `update`, `onSelectStart`, `onSelectEnd`, `onObjectSelectStart`, `onObjectGrabStart`).
- Default `options.simulator.defaultMode` is preserved (`SimulatorMode.USER`) per XR Blocks guidelines.
- Spatial UI uses world-space `xb.UICard` with `size: { width, height: 'auto' }` so every menu works inside both WebXR headsets and the desktop simulator.

## 10. Do Not Overwrite Without Care
- Keep compound pin collider setup in `src/physics/BowlingWorld.ts` (heavy base + lighter neck) to preserve realistic pin stability and toppling physics.
- Keep `options.physics.RAPIER = RAPIER` and `options.physics.useEventQueue = true` in `src/index.ts`.

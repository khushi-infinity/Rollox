# Rollox

**Hands-first miniature mixed-reality bowling for Meta Quest — powered by Meta Immersive Web SDK (`@iwsdk/core`), Rapier3D physics, Three.js, and Horizon Spatial UI.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Meta IWSDK](https://img.shields.io/badge/Meta%20IWSDK-1.1.0-0ea5e9)](#tech-stack)
[![Three.js](https://img.shields.io/badge/Three.js-0.185.0-black)](#tech-stack)
[![Rapier3D](https://img.shields.io/badge/Rapier3D-0.19.3-f97316)](#tech-stack)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178c6)](#tech-stack)

---

## Table of Contents

1. [What Is Rollox?](#what-is-rollox)
2. [Inspiration & Design Philosophy](#inspiration--design-philosophy)
3. [Key Features](#key-features)
4. [Tech Stack](#tech-stack)
5. [System Architecture](#system-architecture)
   - [ECS World & System Pipeline](#ecs-world--system-pipeline)
   - [Persistent World-Space Anchoring Hierarchy](#persistent-world-space-anchoring-hierarchy)
   - [Physics Simulation (Rapier3D)](#physics-simulation-rapier3d)
   - [Pinch-Pull-Aim-Release State Machine](#pinch-pull-aim-release-state-machine)
   - [Spatial UI & Interaction Stability](#spatial-ui--interaction-stability)
   - [WebXR Runtime Diagnostics & Performance Controls](#webxr-runtime-diagnostics--performance-controls)
6. [User Flow & Game Lifecycle](#user-flow--game-lifecycle)
   - [High-Level Navigation Flow](#high-level-navigation-flow)
   - [In-Round Shot & Recovery Loop](#in-round-shot--recovery-loop)
   - [12-State Game Lifecycle Machine](#12-state-game-lifecycle-machine)
7. [Campaign Levels & Alley Workshop](#campaign-levels--alley-workshop)
   - [5 Handcrafted Campaign Levels](#5-handcrafted-campaign-levels)
   - [Scoring & Star Progression](#scoring--star-progression)
   - [Custom Game — Alley Workshop Builder](#custom-game--alley-workshop-builder)
8. [Controls, Gestures & Escape Hatches](#controls-gestures--escape-hatches)
9. [Project Structure](#project-structure)
10. [Getting Started](#getting-started)
    - [Prerequisites](#prerequisites)
    - [Local Desktop Development](#local-desktop-development)
    - [Testing on Meta Quest (HTTPS Mixed Reality)](#testing-on-meta-quest-https-mixed-reality)
    - [Available Scripts](#available-scripts)
11. [Testing & Verification](#testing--verification)
12. [Persistence Schema](#persistence-schema)
13. [License](#license)

---

## What Is Rollox?

**Rollox** is a seated, tabletop-scale mixed-reality bowling experience designed from the ground up for **Meta Quest** hand tracking, Touch controllers, and desktop WebXR development.

Instead of requiring a large room-scale playspace or full-arm bowling swings that risk hitting real furniture, Rollox shrinks a fantasy wooden bowling alley down onto the real table or desk directly in front of you via WebXR **`immersive-ar` passthrough**. You reach out with your bare hand (or controller), **pinch the glowing miniature bowling ball**, **pull it back toward yourself** like a precision slingshot to charge speed, **slide sideways** to curve and aim along a live trajectory preview, and **open your pinch** to send the ball rolling down ramps, banked zigzag corners, rotating rune bumpers, and patrolling dwarf guardians into real rigid-body bowling pins.

Zero external 3D models or audio files are needed to run Rollox: every timber plank, painted bowling pin, dwarf guardian rig, PBR wood/roughness map, Web Audio impact synth, and GPU-instanced spark burst is generated procedurally in TypeScript.

---

## Inspiration & Design Philosophy

Rollox grew out of three core ideas in spatial computing and tabletop gaming:

1. **Tactile Tabletop Toys & Miniature Sports**: Classic tabletop dexterity games (carrom, marble tracks, miniature skittles, and tabletop pinball) feel immediately intuitive when brought into mixed reality because your real desk acts as the physical stage.
2. **Seated-First, Zero-Fatigue XR Ergonomics**: Many VR bowling games demand standing room and wide throwing arcs that cause fatigue or accidental collisions in small spaces. A pinch-pull-aim-release tabletop mechanic keeps every motion compact, accurate, comfortable while seated, and equally expressive with bare hands or controllers.
3. **Real Physics Meets Fantasy Architecture**: Traditional bowling alleys are flat rectangles; in miniature mixed reality, lanes can bend into banked zigzags, climb timber skybridges, feature moving mechanical gates, and even be constructed on the fly by the player in the **Alley Workshop**.
4. **Resilience Over Fragility**: Hand-tracking occlusion glitches, dropped `selectend` events, accidental double-pokes on floating menus, and low-FPS spikes frequently ruin WebXR experiences. Rollox treats input hysteresis, tracking-loss grace windows, zero-rebuild recentering, and escape hatches ("Unstick Ball", Low-Lag Mode, shot-refund pause/reset) as first-class architecture rather than afterthoughts.

---

## Key Features

- **Real WebXR Mixed Reality (`immersive-ar`)**: Live passthrough on Meta Quest Browser with optional `hand-tracking`, `plane-detection` (one-time horizontal tabletop snapping), and GPU `depth-sensing` (`HardOcclusion`) so real hands and furniture can occlude virtual geometry.
- **Hands-First Pinch-Pull-Aim-Release**: Dedicated `PullStateMachine` using `XRHand` joint distances (`thumb-tip` to `index-finger-tip`) with pinch hysteresis, occlusion grace holds, physical cancel gestures, controller trigger/grip support with haptic pulses, and full desktop mouse drag fallback.
- **Deterministic 90Hz Rapier3D Rigid-Body Physics**: Continuous Collision Detection (CCD) bowling ball, compound bowling pin colliders, dynamic pin knockdown detection, kinematic moving obstacles, and trimesh floor fallback.
- **5-Level Fantasy Campaign**: Progressive challenge spanning straight lanes, banked S-curves, elevated timber ramps, patrolling shield guardian **Barnaby the Dwarf**, and a multi-hazard gauntlet.
- **Alley Workshop (Custom Game Builder)**: Modular spatial track editor with 8 snap-together lane pieces, 4 animated obstacle types, 4 pin formations, configurable shot counts, obstacle speeds, rail toggles, real-time connectivity/overlap validation, and instant Play/Test mode.
- **Anchored Horizon Spatial UI**: 9 UIKitML panels (`@pmndrs/uikit-horizon`) locked to a single persistent world root (`RolloxWorldRoot`) so menus never drift with head movement, guarded by click-debounce cooldowns and panel transition locks.
- **Procedural Visuals, VFX & Synthesized Web Audio**: Custom procedural PBR wood grain/bump/roughness textures, `LatheGeometry` pins, zero-GC `InstancedMesh` particle bursts/trails/fantasy motes, and a real-time Web Audio synthesizer for grabs, power ticks, rolling rumbles, pin strikes, rail taps, dwarf bonks, and win fanfares.
- **Built-in Performance & Recovery Controls**: Toggleable **Low-Lag Performance Mode** (disables dynamic shadows, depth occlusion shader passes, and ambient motes), real-time slow-frame detection hints, zero-rebuild arena recentering, wall-clock shot timeouts, and one-click recovery buttons (`Unstick Ball`, `Reset Ball`, `Pause`, `Menu`).

---

## Tech Stack

| Layer | Technology / Package | Version | Role in Rollox |
| :--- | :--- | :--- | :--- |
| **XR Engine & ECS** | `@iwsdk/core` | `1.1.0` | Meta Immersive Web SDK — ECS world, `immersive-ar` session lifecycle, `DepthSensingSystem`, `XRPlane` scene understanding, `UIKitMLAsset`, Ray/Poke input |
| **3D Renderer** | `three` (`npm:super-three`) | `0.185.0` | WebGL2 PBR rendering, IBL room lighting, procedural geometry (`LatheGeometry`, custom rigs), `InstancedMesh` particle pools |
| **Physics Engine** | `@dimforge/rapier3d-simd-compat` | `^0.19.3` | WASM SIMD rigid-body physics at fixed `90Hz` (`1/90s`), CCD bowling ball, compound pins, kinematic obstacles, trimesh ground |
| **Spatial UI** | `@pmndrs/uikit`, `@pmndrs/uikit-horizon`, `@pmndrs/uikit-lucide` | `^1.0.74` | Declarative `.uikitml` spatial panels styled with Meta Horizon dark kit, sharp vector typography, and uniform runtime scaling (`70%`–`150%`) |
| **Audio** | Native Web Audio API (`src/audio.ts`) | Browser native | Procedural oscillator + filtered noise synthesizer with master volume & mute |
| **Language & Build** | TypeScript, Vite, `@iwsdk/vite-plugin-dev`, `@iwsdk/cli` | `5.8.3` / `7.1.4` / `1.1.0` | Strict ESNext bundling, virtual IWSDK project config (`virtual:iwsdk-project`), IWER desktop emulator integration |
| **Testing** | Vitest | `^3.2.4` | Unit & regression test suites for physics, pull hysteresis, state machine, level/workshop validation, menu guards, and WebXR diagnostics |

---

## System Architecture

### ECS World & System Pipeline

Rollox boots in [`src/index.ts`](./src/index.ts) by creating an IWSDK `World` from [`iwsdk.config.json`](./iwsdk.config.json) (`virtual:iwsdk-project`) and registering five cooperative ECS systems in deterministic execution order:

```
┌──────────────────────────────────────────────────────────────────────────┐
│                        Meta IWSDK World (src/index.ts)                   │
│             Config: iwsdk.config.json  |  Scene: main.iwsdk.scene.json   │
└───────────────────────────────────┬──────────────────────────────────────┘
                                    │
    ┌───────────────────────────────┼───────────────────────────────┐
    ▼                               ▼                               ▼
┌────────────────────────┐  ┌────────────────────────┐  ┌────────────────────────┐
│  1. DepthSensingSystem │  │  2. RolloxPhysicsSystem│  │   3. AimingSystem      │
│  (@iwsdk/core)         │  │  (PhysicsSystem.ts)    │  │   (AimingSystem.ts)    │
│                        │  │                        │  │                        │
│ • GPU HardOcclusion    │  │ • 90Hz fixed-step      │  │ • XRHand joint pinch   │
│ • Auto-toggled by      │  │   Rapier3D BowlingWorld│  │ • XR Controller trigger│
│   Low-Lag Mode & XR    │  │ • Dwarf rig animation  │  │ • Desktop mouse drag   │
│   depth feature check  │  │ • Pooled VFX & Audio   │  │ • PullStateMachine     │
└────────────────────────┘  └───────────┬────────────┘  │ • Live trajectory dots │
                                        │               └───────────┬────────────┘
                                        │                           │
                        ┌───────────────┴───────────────┐           │
                        ▼                               ▼           ▼
              ┌────────────────────────┐     ┌───────────────────────────────┐
              │  4. SpatialUISystem    │◄───►│       5. GameFlowSystem       │
              │  (SpatialUISystem.ts)  │     │       (GameFlowSystem.ts)     │
              │                        │     │                               │
              │ • 9 UIKitML panels     │     │ • 12-state RolloxStateMachine │
              │ • Dynamic Ray & Poke   │     │ • Campaign & Workshop levels  │
              │   component attachment │     │ • XRPlane one-time table lock │
              │ • MenuInteractionGuard │     │ • Shot timeout & pin scoring  │
              │ • 2D XR Entry Dock &   │     │ • localStorage persistence    │
              │   runtime diagnostics  │     │ • Performance & recovery APIs │
              └────────────────────────┘     └───────────────────────────────┘
```

### Persistent World-Space Anchoring Hierarchy

A critical design rule in Rollox is that **neither the bowling alley nor the spatial UI panels are ever parented to the player's head/camera**. Everything lives under one persistent world-space root (`RolloxWorldRoot`), guaranteeing zero head-locked drift while allowing independent height adjustments for the table without shifting UI menus out of reach:

```
world.sceneEntity
 ├── GroundPlaneCollisionMesh (invisible Rapier trimesh floor; shadows handled once by ShadowCatcher)
 └── RolloxWorldRoot (persistent world anchor: arenaBasePos + arenaYaw)
      ├── Spatial UIKitML Panels (9 panels at fixed local offsets; decoupled from table heightOffset)
      │    ├── main-menu-panel      ├── hud-panel            ├── modal-panel
      │    ├── level-select-panel   ├── workshop-panel       ├── settings-panel
      │    ├── onboarding-panel     ├── instructions-panel   └── callout-panel
      └── RolloxTableRoot (local Y = settings.heightOffset)
           ├── RolloxArenaRoot (lane segments, side rails, backstops, pin-deck arch)
           ├── RolloxDynamicEntities (bowling pins, Barnaby dwarf rigs, bumpers, gates, barriers)
           ├── BowlingBall (procedural PBR sphere synced to Rapier CCD body during flight)
           └── RolloxAimingGuides (pull-band line, power ring, trajectory preview dots, aim reticle)
```

When the player adjusts **Table Height**, **Distance**, or clicks **Recenter**, `GameFlowSystem.syncAllTransforms()` calls `BowlingWorld.repositionArena(newOffset, newYaw)` — translating all fixed lane colliders, standing pins, obstacles, and ball anchors in place **without tearing down Three.js meshes or rebuilding the Rapier physics world**.

### Physics Simulation (Rapier3D)

Implemented in [`src/physics/BowlingWorld.ts`](./src/physics/BowlingWorld.ts) and driven by [`src/systems/PhysicsSystem.ts`](./src/systems/PhysicsSystem.ts):

- **Fixed-Timestep Accumulator**: Steps at `1 / 90` s (`90Hz`, capped at `MAX_FRAME_DT = 0.05s` and `MAX_SUBSTEPS = 5`) for consistent trajectories across 60Hz desktop displays and 72Hz/90Hz/120Hz Quest refresh rates.
- **Idle Simulation Gating**: Physics stepping automatically pauses during `MAIN_MENU`, `LEVEL_SELECT`, `PAUSED`, and `RESULT` to save CPU and battery.
- **Bowling Ball**: Dynamic sphere (`radius = 0.042m`) with **Continuous Collision Detection (`setCcdEnabled(true)`)**, realistic linear/angular damping, and spin derived from launch speed and lateral pullback.
- **Bowling Pins**: Compound rigid bodies (`height = 0.14m`, `baseRadius = 0.021m`) evaluated for tilt angle and drop height during `SETTLING`; fallen pins are cleanly hidden between shots while remaining standing pins reset upright for the next throw.
- **Kinematic Obstacles**: Velocity/position-driven Rapier kinematic colliders for patrolling dwarfs, rotating rune bumpers, oscillating moving gates, and sliding barriers — firing typed collision callbacks (`onPinImpact`, `onDwarfHit`, `onObstacleHit`, `onRailHit`) directly to `RolloxAudio` and `ParticleBurstPool`.

### Pinch-Pull-Aim-Release State Machine

Implemented in [`src/pullInteraction.ts`](./src/pullInteraction.ts) and wired to live inputs in [`src/systems/AimingSystem.ts`](./src/systems/AimingSystem.ts):

- **Dual-Threshold Pinch Hysteresis**:
  - Acquire threshold: `PINCH_ACQUIRE_GAP_M = 0.032m`
  - Release threshold: `PINCH_RELEASE_GAP_M = 0.050m`
  - Closed-finger override (`0.034m`) prevents premature drops when WebXR `selectend` flickers during hand occlusion.
  - Release confirmation debounce (`HAND_RELEASE_CONFIRM_SEC`) requires sustained finger opening before launching.
- **No Stale-Pose Freezing**: If `XRFrame.getJointPose()` drops tracking mid-pull, `AimingSystem` explicitly marks `tracked = false` instead of falling back to frozen tip coordinates. `PullStateMachine` holds steady through brief tracking blinks (`<= TRACKING_LOSS_HOLD_SEC`), recovers seamlessly if tracking returns, and **safely cancels back to the tee** (never auto-misfiring) if tracking remains lost.
- **Physical Cancel & Anti-Stuck Watchdogs**:
  - Push hand forward past the tee (`z < -0.14m`) or lift high above the table (`y > 0.36m`) to cancel a pull cleanly.
  - Switching input devices mid-pull (hand ↔ controller or left ↔ right) cancels safely rather than latching.
  - A `15s` frozen-input watchdog (`STUCK_HOLD_TIMEOUT_SEC`) guarantees dropped pointer events can never permanently lock the ball to a hand.
- **Power Curves**: Supports `linear`, `smooth` (cubic S-curve default), and `snappy` (`t^0.72`) mappings across `MAX_PULL_DISTANCE = 0.24m` and `MAX_LATERAL_PULL = 0.20m`.

### Spatial UI & Interaction Stability

Implemented in [`src/systems/SpatialUISystem.ts`](./src/systems/SpatialUISystem.ts) and [`src/menuInteraction.ts`](./src/menuInteraction.ts):

- **Dynamic Interactable Mounting**: `RayInteractable` and `PokeInteractable` components are attached **strictly to currently visible panels** and removed immediately when hidden — eliminating wasted per-frame BVH raycasts and preventing invisible panels from capturing clicks.
- **Gameplay Poke Protection**: Gameplay `hud` and `onboarding` panels intentionally exclude `PokeInteractable` (ray-click only) so pinching or pulling near the bowling tee never triggers accidental direct-touch UI events.
- **Bounce & Bleed-Through Protection**: `MenuInteractionGuard` enforces a `220ms` per-button debounce cooldown and a `240ms` cross-screen panel transition lock.
- **Uniform Spatial Scaling**: All 9 spatial panels scale smoothly between `70%` and `150%` (`10%` steps) via `UIKitDocument.setTargetDimensions()` while keeping the 3D bowling arena unscaled.

### WebXR Runtime Diagnostics & Performance Controls

Implemented in [`src/xrDiagnostics.ts`](./src/xrDiagnostics.ts) and [`src/systems/GameFlowSystem.ts`](./src/systems/GameFlowSystem.ts):

- **Feature Detection Without UA Sniffing**: Probes `navigator.xr` and `navigator.xr.isSessionSupported('immersive-ar')` before enabling Mixed Reality entry, surfaces real launch exceptions cleanly in both the 2D dock and 3D Main Menu, prevents duplicate concurrent `requestSession()` calls, and reports granted vs. skipped optional features.
- **Low-Lag Performance Mode**: Persisted toggle accessible from both **Settings** and the **2D Entry Dock** (`Low-Lag: OFF/ON`). When enabled, disables dynamic directional shadows, hides `ShadowCatcher`, turns off XR `DepthOccludable` shader passes (restoring opaque materials cleanly via `restoreOpaqueMaterials()`), and hides ambient floating motes.
- **Non-Blocking Lag Hint**: If sustained active gameplay drops below ~18 FPS for `3.5s` while Low-Lag Mode is off, a non-intrusive callout suggests enabling Low-Lag Mode in Settings.

---

## User Flow & Game Lifecycle

### High-Level Navigation Flow

```
                        ┌──────────────────────┐
                        │  App Boot (LOADING)  │
                        │  Init Rapier3D WASM  │
                        │  Probe navigator.xr  │
                        └──────────┬───────────┘
                                   ▼
                        ┌──────────────────────┐
              ┌────────►│      MAIN MENU       │◄───────────────────────┐
              │         │  • PLAY              │                        │
              │         │  • CUSTOM GAME       │                        │
              │         │  • SETTINGS          │                        │
              │         │  • ENTER / EXIT MR   │                        │
              │         └────┬──────┬──────┬───┘                        │
              │              │      │      │                            │
    ┌─────────┴───────┐      │      │      └──────────────────┐         │
    │                 ▼      ▼      ▼                         ▼         │
    │        ┌────────────────┐  ┌───────────────────┐  ┌────────────┐  │
    │        │  LEVEL SELECT  │  │  ALLEY WORKSHOP   │  │  SETTINGS  │  │
    │        │  Levels 1 – 5  │  │  • 8 Lane Modules │  │  • Audio   │  │
    │        │  (Lock/Stars)  │  │  • 4 Obstacles    │  │  • Curve   │  │
    │        └───────┬────────┘  │  • Pins/Shots/Spd │  │  • Low-Lag │  │
    │                │           │  • Live Validator │  │  • UI Size │  │
    │                │           └─────────┬─────────┘  │  • Table   │  │
    │                │                     │            │  • Practice│  │
    │                ▼                     ▼            └─────┬──────┘  │
    │        ┌────────────────┐  ┌───────────────────┐        │         │
    │        │ CAMPAIGN PLAY  │  │   WORKSHOP TEST   │◄───────┘         │
    │        │ (READY/AIMING) │  │  (Play Custom)    │  (Guided         │
    │        └───────┬────────┘  └─────────┬─────────┘   Onboarding)    │
    │                │                     │                            │
    │                └──────────┬──────────┘                            │
    │                           ▼                                       │
    │                ┌─────────────────────┐                            │
    │                │    PAUSE MODAL      │ (Resume / Restart /        │
    │                │  (P / Esc / Stick)  │  Levels / Settings / Menu) │
    │                └──────────┬──────────┘                            │
    │                           ▼                                       │
    │                ┌───────────────────────────────────────────┐      │
    │                │           POST-GAME RESULT MODAL          │      │
    │                │ • Cleared (>=1★): Next Level / Play Again │──────┘
    │                │                   / Other Levels / Menu   │
    │                │ • Failed (0★):    Try Again / Other Levels│
    │                │                   / Main Menu             │
    │                │ • Custom Game:    Play Again / Edit Setup │
    └────────────────┤                   / Main Menu             │
                     └───────────────────────────────────────────┘
```

### In-Round Shot & Recovery Loop

1. **READY**: Ball rests on the glowing tee ring at `(0, BALL_RADIUS, 0)`. HUD displays current level name, pins knocked (`X / N`), shots remaining, score, and live grab prompt.
2. **AIMING**: Player pinches the ball (or holds controller trigger/grip or drags mouse). Ball smoothly follows the hand within the pullback pocket, displaying the pull-band, power percentage, color-coded meter, and predicted trajectory dots.
   - *Cancel anytime*: Release below minimum pull, push forward down-lane, lift high above the table, or press **B/Y** / **Space** / **Reset Ball**.
3. **BALL_IN_MOTION**: On clean release, the ball switches to dynamic Rapier3D CCD physics and rolls down the lane with rolling audio rumble and spark trails.
   - *Wall-clock & spatial termination*: Transitions automatically to `SETTLING` if the ball stops (`< 0.14 m/s`), falls off the table, passes the backstop (`z < -2.35m`), finishes passing the pin deck, or hits the hard wall-clock timeout (`4.2s`) so severe frame drops can never freeze a shot.
   - *Safe mid-flight reset/pause*: Pressing **Reset Ball**, **Unstick Ball**, or **Pause** while a ball is in flight refunds that interrupted shot so the player is never soft-locked with `0` shots left.
4. **SETTLING**: Waits briefly (`0.45s`–`1.2s`) while knocked pins finish tumbling, updating the live pin counter on the HUD.
5. **Shot Resolution**:
   - Evaluates **Strike** (all pins on shot 1, `+50` bonus), **Spare** (all pins on shot 2, `+25` bonus), **All Cleared**, **Partial**, or **Miss**, triggering callouts, audio chimes, and celebration bursts.
   - Hides fallen pins, resets standing pins upright, and returns the ball to the tee.
   - **If pins remain AND shots remain** → transitions cleanly back to **READY** for the next attempt.
   - **If all pins cleared OR `shotsLeft <= 0`** → transitions to **RESULT**, computes stars (`0`–`3`), saves campaign progress & best scores, and presents the anchored Results Modal.

### 12-State Game Lifecycle Machine

Enforced centrally by [`src/stateMachine.ts`](./src/stateMachine.ts):

`LOADING` · `MAIN_MENU` · `ONBOARDING` · `LEVEL_SELECT` · `READY` · `AIMING` · `BALL_IN_MOTION` · `SETTLING` · `RESULT` · `PAUSED` · `WORKSHOP` · `WORKSHOP_TEST`

---

## Campaign Levels & Alley Workshop

### 5 Handcrafted Campaign Levels

| # | Level Name | Layout | Max Shots | Pins | Obstacles & Challenge |
| :-: | :--- | :--- | :-: | :-: | :--- |
| **1** | **Meadow Straight** | Straight | 3 | Standard 10 | Classic miniature timber alley — learn pinch, pull power, and lateral aim. |
| **2** | **Serpent Zigzag** | Zigzag | 3 | Standard 10 | Angled S-curve with left/right banked rails for bank-shot ricochets. |
| **3** | **Skybridge Ramp** | Elevated | 3 | Standard 10 | Climb an uphill ramp, cross a narrow crest bridge, and drop onto an elevated pin deck. |
| **4** | **Dwarf's Crossing** | Straight | 4 | Standard 10 | Time your throws past **Barnaby the Dwarf**, a patrolling shield guardian. |
| **5** | **Crown Gauntlet** | Gauntlet | 4 | Standard 10 | Uphill ramp into a rotating **Rune Bumper** spinner and faster-patrolling Barnaby. |

### Scoring & Star Progression

- **Base Pin Points**: `+10` points per newly knocked pin.
- **Strike Bonus** (all pins cleared on Shot 1): `+50` bonus points.
- **Spare Bonus** (all pins cleared on Shot 2): `+25` bonus points.
- **All Cleared Bonus** (Shot 3+): `+15` bonus points.
- **Star Rating**:
  - **3 Stars**: Clear all pins with at least 1 shot remaining (Strike or Spare).
  - **2 Stars**: Clear all pins on the final shot, or knock down `>= 70%` of pins.
  - **1 Star**: Knock down `>= 30%` of pins (unlocks the next campaign level).
  - **0 Stars**: Below `30%` pins knocked — displays the amber **LEVEL NOT COMPLETED** modal with **Try Again**, **Other Levels**, and **Main Menu**.

### Custom Game — Alley Workshop Builder

Accessible from **Main Menu → CUSTOM GAME**, the Alley Workshop compiles custom layouts directly into playable `LevelConfig` objects via `compileWorkshopLevel()` in [`src/levels.ts`](./src/levels.ts):

- **8 Snap-Together Track Modules** (up to 6 segments): `Straight`, `Short`, `Left Turn`, `Right Turn`, `Zigzag`, `Ramp Up`, `Ramp Down`, `Elevated Bridge`.
- **Per-Module Editing**: Select any module, nudge X/Z position, rotate yaw, or delete.
- **4 Animated Obstacles** (up to 4 per lane): `Barnaby Dwarf`, `Rune Bumper`, `Moving Gate`, `Sliding Barrier` (with lateral nudge & delete).
- **Custom Rules**:
  - **Pin Formations**: `Standard 10`, `Diamond 9`, `Split 8`, `Crown 6`.
  - **Shot Count**: `2` to `6` shots.
  - **Obstacle Speed**: `Relaxed`, `Normal`, `Fast`.
  - **Side Rails**: Toggle `ON` / `OFF`.
- **Real-Time Validation**: Automatically detects disconnected segments, extreme broken angles, out-of-bounds obstacles, or obstacles overlapping the rotated pin deck before enabling **Start Game / Test Alley**.

---

## Controls, Gestures & Escape Hatches

| Action | Meta Quest Hand Tracking | Meta Quest Touch Controllers | Desktop Mouse & Keyboard |
| :--- | :--- | :--- | :--- |
| **Grab & Pull Ball** | Pinch thumb + index near ball (or ray-hover + pinch) & pull back | Hold **Trigger** or **Grip/Squeeze** on ball & pull back | **Click & Drag** backward on the ball |
| **Aim Shot** | Slide pinched hand left/right | Move controller left/right | Drag mouse left/right |
| **Bowl / Release** | Open pinch cleanly | Release **Trigger / Grip** | Release mouse button |
| **Cancel Pull** | Push hand forward past tee, or lift hand high above table | Press **B** or **Y** button | Release with minimal pull or press **Space** / **Backspace** |
| **Unstick / Reset Ball** | Ray-click **Reset Ball** on HUD | Press **B / Y** button or ray-click **Reset Ball** | **Space**, **Backspace**, or click **Unstick Ball** in 2D Dock |
| **Pause / Resume / Back** | Ray-click **Pause** on HUD | Press **Thumbstick Click** | **P** or **Escape** |
| **Recenter Table** | Ray-click **Recenter** on HUD / Settings | Ray-click **Recenter** | **R** or click **Recenter** in 2D Dock |
| **Adjust UI Scale** | Settings → Menu Size (`-` / `+` / `100%`) | Settings → Menu Size | `[` (smaller) / `]` (larger) |
| **Mute Audio** | HUD / Settings **Sound** button | HUD / Settings **Sound** button | **M** |
| **Low-Lag Mode** | Settings → **Performance Mode (Low-Lag)** | Settings → **Performance Mode (Low-Lag)** | Settings or **Low-Lag** button in 2D Dock |
| **Emergency Menu** | Pause → **Main Menu** | Thumbstick → **Main Menu** | **Menu** button in 2D Dock |

---

## Project Structure

```text
rollox/
├── index.html                        # HTML shell + 2D XR Entry & Recovery Dock
├── iwsdk.config.json                 # Meta IWSDK world, XR features, render & IWER emulator config
├── package.json                      # Dependencies & npm scripts
├── vite.config.ts                    # Vite + @iwsdk/vite-plugin-dev config (HTTP/HTTPS toggle)
├── vitest.config.ts                  # Vitest unit test runner config
├── metadata.json                     # Application metadata
├── LICENSE                           # MIT License
├── README.md                         # Project documentation
├── public/
│   ├── scenes/
│   │   └── main.iwsdk.scene.json     # IWSDK scene graph (lights, ShadowCatcher, 9 UIKitML nodes)
│   └── ui/                           # Declarative Horizon UIKitML spatial UI panels
│       ├── main-menu.uikitml
│       ├── hud-panel.uikitml
│       ├── level-select.uikitml
│       ├── workshop-panel.uikitml
│       ├── settings-panel.uikitml
│       ├── modal-panel.uikitml
│       ├── onboarding-panel.uikitml
│       ├── instructions-panel.uikitml
│       └── callout-panel.uikitml
└── src/
    ├── index.ts                      # IWSDK World bootstrap & ECS system registration
    ├── index.css                     # Fullscreen WebGL canvas & 2D XR dock styles
    ├── assets.ts                     # IWSDK asset manifest
    ├── components.ts                 # Custom ECS components (ArenaRootTag, BowlingBall, SpatialPanelTag, etc.)
    ├── types.ts                      # Core TypeScript types for states, levels, workshop & settings
    ├── stateMachine.ts               # 12-state game & 8-state grab lifecycle state machine
    ├── pullInteraction.ts            # Pinch hysteresis, tracking-loss grace & cancel logic
    ├── menuInteraction.ts            # Click debounce guard, level card states & results formatter
    ├── levels.ts                     # 5 campaign levels, scoring math, power curves & Workshop compiler
    ├── geometry.ts                   # Procedural PBR textures, lane segments, pins, ball & dwarf rigs
    ├── audio.ts                      # Procedural Web Audio synthesizer
    ├── vfx.ts                        # Zero-GC InstancedMesh bursts, ball trails & ambient motes
    ├── xrDiagnostics.ts              # Live navigator.xr probing & resilient immersive-ar launcher
    ├── physics/
    │   └── BowlingWorld.ts           # Rapier3D world, CCD ball, compound pins, zero-rebuild repositioning
    ├── systems/
    │   ├── GameFlowSystem.ts         # Game lifecycle, scoring, XRPlane snap, persistence & recovery
    │   ├── AimingSystem.ts           # XRHand/controller/mouse sampling, haptics & trajectory guides
    │   ├── PhysicsSystem.ts          # 90Hz fixed-step physics driver, dwarf animations, audio/VFX bridge
    │   └── SpatialUISystem.ts        # 9 spatial panels, dynamic Ray/Poke mounting & 2D XR dock
    └── *.test.ts                     # Vitest suites (rollox, physics, pull, xrDiagnostics)
```

---

## Getting Started

### Prerequisites

- **Node.js**: `>=20.19.0 <21` or `>=22.12.0 <23` or `>=24.0.0` (see `engines` in [`package.json`](./package.json))
- **Package Manager**: `npm` (or `bun`)
- *(Optional for physical headset testing)* **Meta Quest 2 / Pro / 3 / 3S** with Meta Quest Browser on the same local Wi-Fi network

### Local Desktop Development

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Start the development server** (HTTP on port `3000`):
   ```bash
   npm run dev
   ```
   Open `http://localhost:3000` in Chrome/Edge. You can play immediately with mouse drag controls or use the integrated IWSDK / IWER desktop Quest 3 emulator (`iwsdk.config.json`).

3. **Run with IWSDK CLI managed dev mode** (optional):
   ```bash
   npm run dev:iwsdk
   ```

### Testing on Meta Quest (HTTPS Mixed Reality)

WebXR (`navigator.xr`) requires a **secure context (HTTPS)** on non-localhost origins.

1. **Start Vite with HTTPS enabled**:
   ```bash
   VITE_HTTPS=true npm run dev
   ```
2. Note your machine's LAN IP address (e.g., `https://192.168.1.42:3000`).
3. Open that URL in **Meta Quest Browser** on your headset (accept the self-signed dev certificate if prompted).
4. Wait for the XR status badge to report **`IMMERSIVE-AR READY`**, then click **Enter Mixed Reality** to launch passthrough with hand tracking and tabletop plane snapping.

### Available Scripts

| Command | Description |
| :--- | :--- |
| `npm run dev` | Starts Vite dev server on `0.0.0.0:3000` (pass `VITE_HTTPS=true` for Quest LAN HTTPS) |
| `npm run dev:iwsdk` | Starts IWSDK CLI dev workflow (`iwsdk dev restart --open --foreground`) |
| `npm run build` | Builds production bundle into `dist/` |
| `npm run preview` | Serves the production `dist/` build locally on port `3000` |
| `npm run lint` | Runs TypeScript static verification (`tsc --noEmit`) |
| `npm run typecheck` | Alias for `tsc --noEmit` |
| `npm test` | Executes all Vitest unit test suites (`vitest run`) |
| `npm run clean` | Removes the `dist/` build output directory |

---

## Testing & Verification

Run the automated test suite and typecheck:

```bash
npm test
npm run lint
npm run build
```

The Vitest suites cover:
- **`src/rollox.test.ts`**: 12-state lifecycle transitions, pause/resume restoration, launch curves, all 5 campaign levels, 4 pin formations, strike/spare/star scoring, Alley Workshop module snapping/caps/validation/compilation, menu click debounce & transition locks, and complete/incomplete/custom results modals.
- **`src/pull.test.ts`**: Deep-pull attachment without auto-release, finger-jitter hysteresis, sustained release confirmation, tracking-loss grace holds & safe cancellation, and spatial UI scale clamping.
- **`src/physics.test.ts`**: Rapier3D physics world initialization, CCD ball launch, pin knockdowns, and arena physics behavior.
- **`src/xrDiagnostics.test.ts`**: `navigator.xr` capability probing, `immersive-ar` feature reporting, duplicate-launch guards, and launch exception handling.

---

## Persistence Schema

Rollox stores player settings, campaign progress, and custom Alley Workshop designs locally in browser `localStorage` (no backend account required):

| Storage Key | Contents |
| :--- | :--- |
| `rollox_iwsdk_settings_v1` | Master volume, mute state, power curve (`linear` / `smooth` / `snappy`), trajectory preview toggle, table height & distance offsets, UI scale (`0.7`–`1.5`), and `lowLagMode`. |
| `rollox_iwsdk_progress_v1` | Highest unlocked campaign level index, completed level indices, best scores per level ID, best stars per level ID, and guided onboarding completion flag. |
| `rollox_iwsdk_workshop_v1` | Custom Alley Workshop lane segments, obstacles, pin formation, max shots, obstacle speed difficulty, and side-rails toggle. |

---

## License

This project is licensed under the **MIT License** — see the [LICENSE](./LICENSE) file for full details.

import {chromium} from 'playwright';

const URL = 'http://localhost:3000/';

function vecDiff(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

async function run() {
  const browser = await chromium.launch({
    executablePath: '/ms-playwright/chromium-1255/chrome-linux64/chrome',
    headless: true,
    args: [
      '--enable-unsafe-swiftshader',
      '--use-gl=angle',
      '--use-angle=swiftshader',
    ],
  });

  const context = await browser.newContext({
    viewport: {width: 1280, height: 800},
  });
  const page = await context.newPage();

  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });
  page.on('pageerror', (err) => {
    pageErrors.push(err.message);
  });

  await page.goto(URL, {waitUntil: 'domcontentloaded'});

  // Wait for GameFlowSystem & bootstrapAsync (MAIN_MENU)
  await page.waitForFunction(() => {
    const world = window.FRAMEWORK_MCP_RUNTIME?.world;
    if (!world?.systems) return false;
    const gfs = world.systems.find((s) => s?.constructor?.name === 'GameFlowSystem');
    return gfs && gfs.sm?.state === 'MAIN_MENU';
  }, {timeout: 25000});

  const diag = await page.evaluate(async () => {
    const world = window.FRAMEWORK_MCP_RUNTIME.world;
    const gfs = world.systems.find((s) => s?.constructor?.name === 'GameFlowSystem');
    const ui = world.systems.find((s) => s?.constructor?.name === 'SpatialUISystem');
    const aim = world.systems.find((s) => s?.constructor?.name === 'AimingSystem');
    const phys = world.systems.find((s) => s?.constructor?.name === 'RolloxPhysicsSystem');
    const THREE = await import('/node_modules/three/build/three.module.js').catch(() => null);

    const getWorldPos = (obj) => {
      if (!obj) return null;
      obj.updateWorldMatrix(true, false);
      const p = obj.matrixWorld.elements;
      return [p[12], p[13], p[14]];
    };

    const panelReport = {};
    for (const [key, panel] of ui.panels.entries()) {
      panelReport[key] = {
        parentName: panel.asset.parent?.name ?? null,
        visible: panel.asset.visible,
        worldPos: getWorldPos(panel.asset),
      };
    }

    const hierarchy = {
      worldRootName: gfs.worldRootGroup.name,
      worldRootParentIsScene: gfs.worldRootGroup.parent === gfs.scene,
      tableRootParentIsWorldRoot: gfs.tableRootGroup.parent === gfs.worldRootGroup,
      arenaGroupParentIsTableRoot: gfs.arenaGroup.parent === gfs.tableRootGroup,
      guidesGroupParentIsTableRoot: aim.guidesGroup.parent === gfs.tableRootGroup,
      rayHitParentIsTableRoot: aim.rayHitMesh.parent === gfs.tableRootGroup,
      ballParentIsTableRoot: gfs.ballEntity.object3D.parent === gfs.tableRootGroup,
      dynamicParentIsTableRoot: Boolean(
        gfs.tableRootGroup.children.find((c) => c.name === 'RolloxDynamicEntities')
      ),
      allPanelsUnderWorldRoot: Object.values(panelReport).every(
        (p) => p.parentName === 'RolloxWorldRoot'
      ),
    };

    const initialWorldRootPos = getWorldPos(gfs.worldRootGroup);
    const initialMenuPos = getWorldPos(ui.panels.get('main-menu').asset);
    const initialModalPos = getWorldPos(ui.panels.get('modal').asset);
    const initialHudPos = getWorldPos(ui.panels.get('hud').asset);

    // 1. Navigate MAIN_MENU -> LEVEL_SELECT -> Level 1
    gfs.onPlayCampaign();
    if (gfs.sm.state !== 'LEVEL_SELECT') throw new Error(`Expected LEVEL_SELECT, got ${gfs.sm.state}`);
    gfs.onSelectLevel(0);
    await new Promise((r) => setTimeout(r, 200));
    if (gfs.sm.state !== 'READY') throw new Error(`Expected READY, got ${gfs.sm.state}`);

    const readyWorldRootPos = getWorldPos(gfs.worldRootGroup);

    // 2. Bowl a strike shot straight down the lane and wait for natural RESULT transition
    // (Use -3.1 m/s so even under slow SwiftShader frame rates, ball hits all 10 pins before 4.2s)
    const origin = aim.getPedestalWorldPosition();
    const vel = origin.clone().set(0, 0, -3.1);
    const spin = origin.clone().set(0, 0, 0);
    gfs.launchShot(origin, vel, spin, 0.92);
    if (gfs.sm.state !== 'BALL_IN_MOTION') {
      throw new Error(`Expected BALL_IN_MOTION, got ${gfs.sm.state}`);
    }

    // Wait for physics + settling -> RESULT
    const waitResult = async () => {
      const t0 = performance.now();
      while (performance.now() - t0 < 60000) {
        if (gfs.sm.state === 'RESULT') return true;
        if (gfs.sm.state === 'READY' || (gfs.sm.state === 'WORKSHOP_TEST' && gfs.workshopTestPhase === 'READY')) {
          return false;
        }
        await new Promise((r) => setTimeout(r, 120));
      }
      return false;
    };

    let reachedResult = await waitResult();
    let safety = 0;
    while (!reachedResult && safety < 5 && gfs.sm.state === 'READY') {
      safety++;
      const altVel = origin.clone().set(safety % 2 === 0 ? 0.04 : -0.04, 0, -3.1);
      gfs.launchShot(origin, altVel, spin, 0.92);
      reachedResult = await waitResult();
    }
    if (!reachedResult || gfs.sm.state !== 'RESULT') {
      throw new Error(`Did not reach RESULT cleanly; state=${gfs.sm.state}`);
    }

    const modalPanel = ui.panels.get('modal').asset;
    const hudPanel = ui.panels.get('hud').asset;
    const getText = (id) => {
      const el = modalPanel.getElementById(id);
      if (!el) return null;
      return el.properties?.signal?.text?.value ?? el.children?.[0]?.properties?.signal?.text?.value ?? el.properties?.text ?? null;
    };
    const getDisplay = (id) => {
      const el = modalPanel.getElementById(id);
      return el?.properties?.signal?.display?.value ?? el?.properties?.display ?? 'flex';
    };

    const shotsBeforeDup = gfs.shotsUsed;
    // Duplicate trigger guard check
    gfs.finalizeShot(false);
    gfs.launchShot(origin, vel, spin, 0.92);
    if (gfs.shotsUsed !== shotsBeforeDup || gfs.sm.state !== 'RESULT') {
      throw new Error('Duplicate shot or finalizeShot mutated RESULT state!');
    }

    const resultWorldRootPos = getWorldPos(gfs.worldRootGroup);
    const resultModalPos = getWorldPos(modalPanel);

    const lvl1ResultUI = {
      modalVisible: modalPanel.visible,
      hudVisible: hudPanel.visible,
      eyebrow: getText('modal-eyebrow'),
      levelName: getText('modal-level-name'),
      title: getText('modal-title'),
      pins: getText('modal-pins-val'),
      score: getText('modal-score-val'),
      best: getText('modal-best-val'),
      nextDisplay: getDisplay('modal-next-btn'),
      playAgainDisplay: getDisplay('modal-play-again-btn'),
      editSetupDisplay: getDisplay('modal-edit-setup-btn'),
      mainMenuDisplay: getDisplay('modal-main-menu-btn'),
      resumeDisplay: getDisplay('modal-resume-btn'),
      shotsUsed: gfs.shotsUsed,
      stars: gfs.lastSummary?.stars,
    };

    // 3. Test PLAY AGAIN on Level 1
    gfs.onModalPlayAgain();
    await new Promise((r) => setTimeout(r, 250));
    const afterPlayAgain = {
      state: gfs.sm.state,
      levelIndex: gfs.currentLevelIndex,
      levelScore: gfs.levelScore,
      shotsLeft: gfs.shotsLeft,
      shotsUsed: gfs.shotsUsed,
      pinsKnocked: gfs.pinsKnocked,
      standingPins: phys.bowlingWorld.pins.filter((p) => !p.fallen).length,
      bestScorePreserved: gfs.progress.bestScores['meadow-straight'] ?? 0,
      modalVisible: modalPanel.visible,
      hudVisible: hudPanel.visible,
      worldRootPos: getWorldPos(gfs.worldRootGroup),
    };

    // 4. Bowl through again -> RESULT -> test NEXT LEVEL (including rapid double-call guard!)
    let s2 = 0;
    while (gfs.sm.state !== 'RESULT' && s2 < 5) {
      s2++;
      if (gfs.sm.state === 'READY') {
        gfs.launchShot(origin, vel, spin, 0.92);
      }
      await waitResult();
    }
    if (gfs.sm.state !== 'RESULT') throw new Error(`Second run did not reach RESULT: ${gfs.sm.state}`);
    // Rapid double call on Next Level
    gfs.onModalNextLevel();
    gfs.onModalNextLevel();
    await new Promise((r) => setTimeout(r, 300));
    const afterNextLevel = {
      state: gfs.sm.state,
      levelIndex: gfs.currentLevelIndex,
      levelId: gfs.currentLevelConfig.id,
      levelScore: gfs.levelScore,
      shotsLeft: gfs.shotsLeft,
      modalVisible: modalPanel.visible,
      hudVisible: hudPanel.visible,
      worldRootPos: getWorldPos(gfs.worldRootGroup),
    };

    // 5. Return to Main Menu -> Workshop -> Custom Game -> RESULT -> Play Again -> Edit Setup
    gfs.onModalMainMenu();
    if (gfs.sm.state !== 'MAIN_MENU') throw new Error(`Expected MAIN_MENU, got ${gfs.sm.state}`);
    gfs.onOpenWorkshop();
    await new Promise((r) => setTimeout(r, 200));
    gfs.onWorkshopTestAlley();
    await new Promise((r) => setTimeout(r, 250));
    if (gfs.sm.state !== 'WORKSHOP_TEST') throw new Error(`Expected WORKSHOP_TEST, got ${gfs.sm.state}`);

    let s3 = 0;
    while (gfs.sm.state !== 'RESULT' && s3 < 6) {
      s3++;
      if (gfs.sm.state === 'WORKSHOP_TEST' && gfs.workshopTestPhase === 'READY') {
        gfs.launchShot(origin, vel, spin, 0.92);
      }
      await waitResult();
    }
    if (gfs.sm.state !== 'RESULT') throw new Error(`Custom game did not reach RESULT: ${gfs.sm.state}`);

    const customResultUI = {
      eyebrow: getText('modal-eyebrow'),
      levelName: getText('modal-level-name'),
      nextDisplay: getDisplay('modal-next-btn'),
      playAgainDisplay: getDisplay('modal-play-again-btn'),
      editSetupDisplay: getDisplay('modal-edit-setup-btn'),
      mainMenuDisplay: getDisplay('modal-main-menu-btn'),
    };

    // Test Custom Game Play Again
    gfs.onModalPlayAgain();
    await new Promise((r) => setTimeout(r, 250));
    const afterCustomPlayAgain = {
      state: gfs.sm.state,
      phase: gfs.workshopTestPhase,
      levelScore: gfs.levelScore,
      shotsLeft: gfs.shotsLeft,
    };

    // Finish Custom Game again and test Edit Setup
    let s4 = 0;
    while (gfs.sm.state !== 'RESULT' && s4 < 6) {
      s4++;
      if (gfs.sm.state === 'WORKSHOP_TEST' && gfs.workshopTestPhase === 'READY') {
        gfs.launchShot(origin, vel, spin, 0.92);
      }
      await waitResult();
    }
    gfs.onModalEditSetup();
    await new Promise((r) => setTimeout(r, 200));
    const afterEditSetup = {
      state: gfs.sm.state,
      worldRootPos: getWorldPos(gfs.worldRootGroup),
      hudPosAfterAllFlows: getWorldPos(hudPanel),
      modalPosAfterAllFlows: getWorldPos(modalPanel),
      menuPosAfterAllFlows: getWorldPos(ui.panels.get('main-menu').asset),
    };

    // Leave in Level 1 RESULT state briefly to verify UI screenshot
    gfs.onModalMainMenu();
    gfs.onPlayCampaign();
    gfs.onSelectLevel(0);
    await new Promise((r) => setTimeout(r, 250));
    let s5 = 0;
    while (gfs.sm.state !== 'RESULT' && s5 < 5) {
      s5++;
      if (gfs.sm.state === 'READY') {
        gfs.launchShot(origin, vel, spin, 0.92);
      }
      await waitResult();
    }

    return {
      hierarchy,
      initialWorldRootPos,
      readyWorldRootPos,
      resultWorldRootPos,
      initialMenuPos,
      initialModalPos,
      resultModalPos,
      initialHudPos,
      lvl1ResultUI,
      afterPlayAgain,
      afterNextLevel,
      customResultUI,
      afterCustomPlayAgain,
      afterEditSetup,
    };
  });

  // Save screenshot of RESULT screen in 2D view
  await page.screenshot({path: '.tmp_verify/results_2d.png'});

  // Now test IWER Enter Mixed Reality session & verify WorldRoot stays locked across head movement & XR exit
  const enterBtnDisabled = await page.locator('#btn-enter-xr').isDisabled();
  let xrCheck = {enterBtnDisabled};
  if (!enterBtnDisabled) {
    await page.locator('#btn-enter-xr').click();
    await page.waitForFunction(() => {
      const world = window.FRAMEWORK_MCP_RUNTIME?.world;
      return world?.session != null;
    }, {timeout: 15000});

    await page.waitForTimeout(400);

    xrCheck = await page.evaluate(async () => {
      const world = window.FRAMEWORK_MCP_RUNTIME.world;
      const gfs = world.systems.find((s) => s?.constructor?.name === 'GameFlowSystem');
      const getWorldPos = (obj) => {
        obj.updateWorldMatrix(true, false);
        const p = obj.matrixWorld.elements;
        return [p[12], p[13], p[14]];
      };
      const posOnXREnter = getWorldPos(gfs.worldRootGroup);
      // Simulate turning head / moving player rig
      world.camera.rotation.y += 0.9;
      world.camera.rotation.x -= 0.4;
      await new Promise((r) => setTimeout(r, 250));
      const posAfterHeadMove = getWorldPos(gfs.worldRootGroup);
      return {
        enterBtnDisabled: false,
        sessionActive: Boolean(world.session),
        visibilityState: world.visibilityState.value,
        posOnXREnter,
        posAfterHeadMove,
        stateInXR: gfs.sm.state,
      };
    });
  }

  console.log('=== HIERARCHY ===', JSON.stringify(diag.hierarchy, null, 2));
  console.log('=== LVL1 RESULT UI ===', JSON.stringify(diag.lvl1ResultUI, null, 2));
  console.log('=== PLAY AGAIN ===', JSON.stringify(diag.afterPlayAgain, null, 2));
  console.log('=== NEXT LEVEL ===', JSON.stringify(diag.afterNextLevel, null, 2));
  console.log('=== CUSTOM RESULT UI ===', JSON.stringify(diag.customResultUI, null, 2));
  console.log('=== CUSTOM PLAY AGAIN ===', JSON.stringify(diag.afterCustomPlayAgain, null, 2));
  console.log('=== CUSTOM EDIT SETUP ===', JSON.stringify(diag.afterEditSetup, null, 2));
  console.log('=== XR CHECK ===', JSON.stringify(xrCheck, null, 2));
  console.log('DRIFT_WORLD_ROOT_READY:', vecDiff(diag.initialWorldRootPos, diag.readyWorldRootPos));
  console.log('DRIFT_WORLD_ROOT_RESULT:', vecDiff(diag.initialWorldRootPos, diag.resultWorldRootPos));
  console.log('DRIFT_WORLD_ROOT_PLAY_AGAIN:', vecDiff(diag.initialWorldRootPos, diag.afterPlayAgain.worldRootPos));
  console.log('DRIFT_WORLD_ROOT_NEXT_LVL:', vecDiff(diag.initialWorldRootPos, diag.afterNextLevel.worldRootPos));
  console.log('DRIFT_WORLD_ROOT_EDIT_SETUP:', vecDiff(diag.initialWorldRootPos, diag.afterEditSetup.worldRootPos));
  console.log('DRIFT_MODAL_POS:', vecDiff(diag.initialModalPos, diag.afterEditSetup.modalPosAfterAllFlows));
  console.log('DRIFT_HUD_POS:', vecDiff(diag.initialHudPos, diag.afterEditSetup.hudPosAfterAllFlows));
  console.log('DRIFT_MENU_POS:', vecDiff(diag.initialMenuPos, diag.afterEditSetup.menuPosAfterAllFlows));
  if (xrCheck.posOnXREnter && xrCheck.posAfterHeadMove) {
    console.log('DRIFT_XR_HEAD_MOVE:', vecDiff(xrCheck.posOnXREnter, xrCheck.posAfterHeadMove));
  }
  console.log('CONSOLE_ERRORS:', consoleErrors.length, consoleErrors);
  console.log('PAGE_ERRORS:', pageErrors.length, pageErrors);

  await browser.close();

  if (consoleErrors.length > 0 || pageErrors.length > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

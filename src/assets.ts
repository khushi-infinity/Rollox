import {AssetType, defineAssets} from '@iwsdk/core';
import uikitmlSources from 'virtual:rollox-uikitml';

const publicAssetUrl = (filePath: string): string =>
  `${import.meta.env.BASE_URL}${filePath.replace(/^\/+/u, '')}`;

const uikitml = (fileName: string, name: string) => {
  const bundledSource = uikitmlSources[fileName];
  const url =
    typeof bundledSource === 'string' && bundledSource.length > 0
      ? `data:text/plain;charset=utf-8,${encodeURIComponent(bundledSource)}`
      : publicAssetUrl(`ui/${fileName}`);
  return {
    url,
    type: AssetType.UIKitML,
    name,
  };
};

export default defineAssets({
  'main-menu-panel': uikitml('main-menu.uikitml', 'Main Menu Panel'),
  'hud-panel': uikitml('hud-panel.uikitml', 'HUD Scoreboard Panel'),
  'level-select-panel': uikitml('level-select.uikitml', 'Level Select Panel'),
  'workshop-panel': uikitml('workshop-panel.uikitml', 'Alley Workshop Panel'),
  'settings-panel': uikitml('settings-panel.uikitml', 'Settings Panel'),
  'instructions-panel': uikitml('instructions-panel.uikitml', 'Instructions Panel'),
  'modal-panel': uikitml('modal-panel.uikitml', 'Pause and Results Panel'),
  'onboarding-panel': uikitml('onboarding-panel.uikitml', 'Onboarding Tutorial Panel'),
  'callout-panel': uikitml('callout-panel.uikitml', 'Callout Banner Panel'),
});

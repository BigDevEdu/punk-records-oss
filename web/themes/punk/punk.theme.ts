// The punk theme. `astryx experimental theme editor` wrote this file once and never changes it again.
// The checked settings live in punk.settings.json and the generated punk.settings.ts;
// change them with `astryx experimental theme editor set punk ...`. Add your own changes below: they win over the settings.
import {defineTheme} from '@astryxdesign/core/theme';
import {punkSettings} from './punk.settings';

export const punkTheme = defineTheme({
  extends: punkSettings,
  name: 'punk',
});

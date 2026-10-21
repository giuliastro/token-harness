/**
 * The guided app's browser controller. Each module is a fragment of one shared scope, so views
 * reuse the same API client, reviewed preview/apply flows and translation function.
 */
import { GUIDE_APP_IT, GUIDE_APP_JS } from './guided-ui-app.js';
import { GUIDE_CORE_IT, GUIDE_CORE_JS } from './guided-ui-core.js';
import { GUIDE_DETAILS_IT, GUIDE_DETAILS_JS } from './guided-ui-details.js';
import { GUIDE_HOME_IT, GUIDE_HOME_JS } from './guided-ui-home.js';
import { GUIDE_METHODS_IT, GUIDE_METHODS_JS } from './guided-ui-methods.js';
import { GUIDE_ONBOARDING_IT, GUIDE_ONBOARDING_JS } from './guided-ui-onboarding.js';
import { GUIDE_OPTIMIZER_INFO } from './guided-optimizer-info.js';

/** Italian text keyed by the English source text; English is the fallback for any missing key. */
export const GUIDE_TRANSLATIONS: Readonly<Record<'it', Readonly<Record<string, string>>>> = {
  it: {
    ...GUIDE_CORE_IT,
    ...GUIDE_HOME_IT,
    ...GUIDE_METHODS_IT,
    ...GUIDE_ONBOARDING_IT,
    ...GUIDE_DETAILS_IT,
    ...GUIDE_APP_IT,
  },
};

export const GUIDE_PRODUCT_JS = `'use strict';
(() => {
  const TRANSLATIONS = ${JSON.stringify(GUIDE_TRANSLATIONS)};
  const TOOL_INFO = ${JSON.stringify(GUIDE_OPTIMIZER_INFO)};
${GUIDE_CORE_JS}
${GUIDE_HOME_JS}
${GUIDE_METHODS_JS}
${GUIDE_ONBOARDING_JS}
${GUIDE_DETAILS_JS}
${GUIDE_APP_JS}
})();
`;

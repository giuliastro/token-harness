/** Embedded local product UI. No remote assets, inline scripts, or framework runtime. */
import { GUIDE_MODAL_GUARD_JS } from './guided-modal-guard-client.js';
import { GUIDE_PRODUCT_JS } from './guided-product-client.js';
import { GUIDE_SHELL_HTML } from './guided-ui-shell.js';
import { GUIDE_UI_CSS } from './guided-ui-styles.js';

export const GUIDE_CSS = GUIDE_UI_CSS;
export const GUIDE_JS = `${GUIDE_MODAL_GUARD_JS}
${GUIDE_PRODUCT_JS}`;
export const GUIDE_HTML = GUIDE_SHELL_HTML;

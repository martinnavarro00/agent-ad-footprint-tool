'use strict';

const { CONSENT_BUTTONS, TIMING } = require('./config');

/**
 * Click the cookie-banner button for the given decision.
 * Consent-management platforms usually render inside an iframe, so the main
 * page and every frame are searched.
 *
 * @param {import('playwright').Page} page
 * @param {'accept'|'reject'|'skip'} decision
 * @returns {Promise<{decision: string, clicked: boolean, label: string|null}>}
 */
async function handleConsent(page, decision) {
  if (decision === 'skip') return { decision, clicked: false, label: null };

  const pattern = CONSENT_BUTTONS[decision];
  if (!pattern) throw new Error(`Unknown consent decision "${decision}" (use accept, reject or skip)`);

  for (const frame of page.frames()) {
    try {
      const button = frame.getByRole('button', { name: pattern }).first();
      if (await button.isVisible({ timeout: TIMING.consentButtonTimeoutMs })) {
        const label = (await button.innerText()).trim();
        await button.click();
        return { decision, clicked: true, label };
      }
    } catch (_) {
      /* frame detached or no such button: try the next frame */
    }
  }
  // Not clicked: either no banner (consent already stored in the profile)
  // or the publisher offers no matching button. Both are recorded as-is.
  return { decision, clicked: false, label: null };
}

module.exports = { handleConsent };

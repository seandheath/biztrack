/**
 * Centralized toast notification state.
 *
 * Pages import showToast() to trigger notifications and pass the reactive
 * state to the <Toast> component via props. This eliminates the duplicated
 * 5-variable boilerplate that was previously in every page.
 *
 * Usage:
 *   import { toast, showToast } from '$lib/toast.js';
 *   showToast('Saved!', 'success');
 *   <Toast message={toast.message} type={toast.type} visible={toast.visible} />
 */

/** Reactive toast state — read by pages, written by showToast(). */
export const toast = $state({
  message: '',
  /** @type {'success'|'error'} */
  type: 'success',
  visible: false,
});

/** @type {ReturnType<typeof setTimeout>|null} */
let _timer = null;

/**
 * Show a toast notification that auto-dismisses after 3 seconds.
 *
 * @param {string} message
 * @param {'success'|'error'} [type='success']
 */
export function showToast(message, type = 'success') {
  toast.message = message;
  toast.type    = type;
  toast.visible = true;
  clearTimeout(_timer);
  _timer = setTimeout(() => { toast.visible = false; }, 3000);
}

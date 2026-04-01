/**
 * Centralized toast notification state.
 *
 * Pages import showToast() to trigger notifications and pass the reactive
 * state to the <Toast> component via props. This eliminates the duplicated
 * 5-variable boilerplate that was previously in every page.
 *
 * Usage:
 *   import { toast, showToast } from '$lib/toast.svelte.js';
 *   showToast('Saved!', 'success');
 *   <Toast message={toast.message} type={toast.type} visible={toast.visible} />
 */

import type { ToastType } from './types.js';

/** Reactive toast state — read by pages, written by showToast(). */
export const toast: { message: string; type: ToastType; visible: boolean } = $state({
  message: '',
  type: 'success' as ToastType,
  visible: false,
});

let _timer: ReturnType<typeof setTimeout> | null = null;

/**
 * Show a toast notification that auto-dismisses after 3 seconds.
 */
export function showToast(message: string, type: ToastType = 'success'): void {
  toast.message = message;
  toast.type    = type;
  toast.visible = true;
  if (_timer) clearTimeout(_timer);
  _timer = setTimeout(() => { toast.visible = false; }, 3000);
}

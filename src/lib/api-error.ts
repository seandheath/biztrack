/**
 * Shared error extraction for Google API responses (Drive + Sheets).
 *
 * Both the Drive and Sheets service layers need to throw descriptive errors
 * from non-ok responses. This utility centralizes the pattern so each layer
 * doesn't duplicate the JSON-body-parsing logic.
 *
 * @param response - The non-ok fetch Response
 * @param context - Short label for the failing operation (e.g. 'listFolders')
 */
export async function throwApiError(response: Response, context: string): Promise<never> {
  let message = `${context} failed (HTTP ${response.status})`;
  try {
    const body = await response.json();
    const err = body?.error;
    if (err?.message) message = `${context}: ${err.message} (${response.status})`;
  } catch {
    // Body not JSON — use status-only message
  }
  throw new Error(message);
}

/**
 * Receipt processing utilities.
 *
 * Images are compressed client-side via Canvas API before upload to minimize
 * Drive storage and upload time. PDFs pass through unchanged.
 *
 * Filename convention: YYYY-MM-DD_VENDOR_N.ext
 *   - VENDOR is the vendor name with spaces replaced by underscores,
 *     non-alphanumeric characters stripped, truncated to 30 chars.
 *   - N is a 1-based counter incremented until the name is unique within
 *     the provided list of existing filenames.
 */

/**
 * Returns true if the file is an image type.
 * @param {File} file
 * @returns {boolean}
 */
export function isImage(file) {
  return file.type.startsWith('image/');
}

/**
 * Compresses an image file to JPEG using the Canvas API.
 * Returns a JPEG Blob at the specified quality (default 70%).
 * Downscales the image if either dimension exceeds maxWidth.
 *
 * @param {File} file          - Source image file (JPEG, PNG, HEIC, etc.)
 * @param {number} quality     - JPEG quality, 0–1 (default 0.7)
 * @param {number} maxWidth    - Max dimension in pixels (default 1920)
 * @returns {Promise<Blob>}    - Compressed JPEG blob
 */
export function compressReceipt(file, quality = 0.7, maxWidth = 1920) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);

      // Calculate target dimensions — maintain aspect ratio
      let { naturalWidth: w, naturalHeight: h } = img;
      if (w > maxWidth || h > maxWidth) {
        if (w >= h) {
          h = Math.round((h * maxWidth) / w);
          w = maxWidth;
        } else {
          w = Math.round((w * maxWidth) / h);
          h = maxWidth;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width  = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);

      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error('Canvas toBlob returned null'));
        },
        'image/jpeg',
        quality
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image for compression'));
    };

    img.src = url;
  });
}

/**
 * Processes a receipt file — compresses images, passes PDFs through.
 *
 * @param {File} file
 * @returns {Promise<{blob: Blob, ext: string}>}
 */
export async function processReceipt(file) {
  if (isImage(file)) {
    const blob = await compressReceipt(file);
    return { blob, ext: 'jpg' };
  }
  // PDF — pass through as-is
  return { blob: file, ext: 'pdf' };
}

/**
 * Generates a unique filename for a receipt.
 * Format: YYYY-MM-DD_VENDOR_N.ext
 *
 * @param {string} vendor             - Vendor name (will be sanitized)
 * @param {string} date               - ISO date string, e.g. "2026-03-27"
 * @param {string} ext                - File extension without dot, e.g. "jpg"
 * @param {string[]} existingNames    - Filenames already in the receipts folder
 * @returns {string}
 */
export function generateFilename(vendor, date, ext, existingNames = []) {
  // Sanitize vendor: replace spaces with underscores, strip non-alphanumeric, truncate
  const safeVendor = vendor
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9_]/g, '')
    .slice(0, 30)
    || 'Receipt';

  const existing = new Set(existingNames);
  let n = 1;
  let filename;
  do {
    filename = `${date}_${safeVendor}_${n}.${ext}`;
    n++;
  } while (existing.has(filename));

  return filename;
}

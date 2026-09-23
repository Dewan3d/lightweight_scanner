/**
 * Utility functions for identifying, classifying, and validating
 * Serial Numbers and PayGo numbers in the warehouse scanning utility.
 */

/**
 * Checks if a scanned code is a PayGo number.
 * PayGo numbers are typically 8 to 9 digits (all numeric, length 7-10).
 * e.g. "689274413", "10256487", "277431516"
 *
 * @param {string} text
 * @returns {boolean}
 */
export function isPaygoBarcode(text) {
  if (!text) return false;
  const clean = text.trim();
  return /^\d{7,11}$/.test(clean);
}

/**
 * Checks if a scanned code is a device Serial Number.
 * Serial numbers are typically 15 to 18 characters long, often starting with
 * a letter and a hyphen (e.g. "P-2002024031500033", "P-2002024072300083")
 * or starting with a letter and numbers (e.g. "P5102548412005482", "P1502548310929446").
 *
 * @param {string} text
 * @returns {boolean}
 */
export function isSerialBarcode(text) {
  if (!text) return false;
  const clean = text.trim();

  // Pattern 1: Starts with letter and hyphen, e.g. P-2002024031500033
  if (/^[a-zA-Z]-[a-zA-Z0-9]{10,}$/i.test(clean)) {
    return true;
  }

  // Pattern 2: Starts with a letter and length >= 12 alphanumeric characters, e.g. P5102548412005482
  if (/^[a-zA-Z][a-zA-Z0-9]{11,}$/i.test(clean)) {
    return true;
  }

  // Pattern 3: General serial format: 12+ characters containing at least one non-digit
  if (clean.length >= 12 && !/^\d+$/.test(clean)) {
    return true;
  }

  return false;
}

/**
 * Classifies a scanned code into its likely device attribute.
 *
 * @param {string} text
 * @returns {'serial' | 'paygo' | 'unknown'}
 */
export function classifyBarcode(text) {
  if (isPaygoBarcode(text)) return 'paygo';
  if (isSerialBarcode(text)) return 'serial';
  return 'unknown';
}

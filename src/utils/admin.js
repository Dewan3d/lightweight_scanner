export const ADMIN_EMAILS = [
  'gabrieldewan365@gmail.com',
  'omoyelevincent02@gmail.com',
  'horlugbammy@gmail.com'
];

/**
 * Checks if the given email address is an administrator.
 * @param {string} email
 * @returns {boolean}
 */
export function checkIsAdmin(email) {
  if (!email) return false;
  return ADMIN_EMAILS.includes(email.toLowerCase().trim());
}

/**
 * Module-level store for instance admin emails.
 * Set once at startup, read by any service that needs to check admin status.
 */
let adminEmails = new Set<string>();

export function setInstanceAdminEmails(emails: string[]) {
  adminEmails = new Set(emails.map((e) => e.toLowerCase()));
}

export function getInstanceAdminEmails(): Set<string> {
  return adminEmails;
}

export function isEmailInstanceAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  if (adminEmails.size === 0) return false;
  return adminEmails.has(email.toLowerCase());
}

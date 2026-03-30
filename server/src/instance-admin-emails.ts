/**
 * Module-level store for instance admin emails and demo emails.
 * Set once at startup, read by any service that needs to check admin/demo status.
 */
let adminEmails = new Set<string>();
let demoEmails = new Set<string>();

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

export function setDemoEmails(emails: string[]) {
  demoEmails = new Set(emails.map((e) => e.toLowerCase()));
}

export function getDemoEmails(): Set<string> {
  return demoEmails;
}

export function isDemoEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  if (demoEmails.size === 0) return false;
  return demoEmails.has(email.toLowerCase());
}

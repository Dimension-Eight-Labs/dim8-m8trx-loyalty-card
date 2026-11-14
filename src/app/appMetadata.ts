/**
 * Product identity and legal text, in one place.
 *
 * The version is not typed here: Vite replaces `__APP_VERSION__` at build
 * (and test) time with the `version` field of package.json (see the `define`
 * block in vite.config.ts), so the About screen and backup files always
 * report the version that was actually built.
 *
 * Copy (description, legal notice) is the approved Iteration 4F wording;
 * change it only with product approval.
 */
export const APP_NAME = 'M8TRX'
export const APP_ATTRIBUTION = 'by DIM8 Labs'
export const APP_VERSION: string = __APP_VERSION__
export const COMPANY_NAME = 'Dimension Eight Labs LLC'
export const BRAND_NAME = 'DIM8 Labs'
export const WEBSITE_URL = 'https://dim8labs.com'
/** Display form of WEBSITE_URL (no scheme). */
export const WEBSITE_LABEL = 'dim8labs.com'
/**
 * The official public source repository (Dimension Eight Labs on GitHub).
 * Every in-app link to source or documentation is derived from this one URL.
 */
export const SOURCE_REPOSITORY_URL = 'https://github.com/Dimension-Eight-Labs/dim8-m8trx-loyalty-card'
export const SOURCE_LINK_LABEL = 'Source Code & Documentation'
/**
 * README section on splitting oversized backups. The fragment is GitHub's
 * anchor for the heading "Advanced: Working With Oversized M8TRX Backups"
 * (lower-cased, punctuation dropped, spaces to hyphens); a host test checks
 * it against README.md, so renaming the heading means updating this.
 */
export const OVERSIZED_BACKUP_DOCS_ANCHOR = 'advanced-working-with-oversized-m8trx-backups'
export const OVERSIZED_BACKUP_DOCS_URL = `${SOURCE_REPOSITORY_URL}#${OVERSIZED_BACKUP_DOCS_ANCHOR}`
/** Short notice at the bottom of the Add Card screen. */
export const COPYRIGHT_NOTICE = `© 2026 ${COMPANY_NAME}`
/** Full legal notice on the About screen. */
export const LEGAL_NOTICE = `© 2026 ${COMPANY_NAME}. All rights reserved.`
export const APP_DESCRIPTION =
  'M8TRX is a simple, offline-first wallet for your loyalty cards. Scan them once. Show them when you need them. No accounts, no tracking, no unnecessary nonsense.'

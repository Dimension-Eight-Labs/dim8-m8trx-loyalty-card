/**
 * Public-release metadata (host test reading repository files): the README
 * heading that the in-app oversized-backup link points to, the official
 * repository URL, the GPL text and the package licence. Guards against a
 * renamed heading silently breaking the warning's link.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { OVERSIZED_BACKUP_DOCS_ANCHOR, OVERSIZED_BACKUP_DOCS_URL, SOURCE_REPOSITORY_URL } from './appMetadata.ts'

const ROOT = join(import.meta.dirname, '../..')
const read = (path: string) => readFileSync(join(ROOT, path), 'utf-8')

/** GitHub's heading anchor: lower-case, drop punctuation except - and _, spaces to hyphens. */
function githubAnchor(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-')
}

describe('public release metadata', () => {
  it('links the oversized-backup warning to an existing README heading on the official repository', () => {
    expect(SOURCE_REPOSITORY_URL).toBe('https://github.com/Dimension-Eight-Labs/dim8-m8trx-loyalty-card')
    expect(OVERSIZED_BACKUP_DOCS_URL).toBe(`${SOURCE_REPOSITORY_URL}#advanced-working-with-oversized-m8trx-backups`)
    const headings = read('README.md')
      .split('\n')
      .filter((line) => /^#{1,6} /.test(line))
      .map((line) => line.replace(/^#+ /, ''))
    expect(headings).toContain('Advanced: Working With Oversized M8TRX Backups')
    expect(headings.map(githubAnchor)).toContain(OVERSIZED_BACKUP_DOCS_ANCHOR)
    // The README's own links to the section use the same anchor.
    expect(read('README.md')).toContain(`(#${OVERSIZED_BACKUP_DOCS_ANCHOR})`)
  })

  it('is licensed GPL-3.0-or-later with the unmodified official GPLv3 text', () => {
    const pkg = JSON.parse(read('package.json')) as { license?: string; version: string }
    expect(pkg.license).toBe('GPL-3.0-or-later')
    expect(pkg.version).toBe('0.5.0')
    const license = read('LICENSE')
    expect(license.startsWith('                    GNU GENERAL PUBLIC LICENSE\n                       Version 3, 29 June 2007\n')).toBe(true)
    // SHA-256 of https://www.gnu.org/licenses/gpl-3.0.txt.
    expect(createHash('sha256').update(license).digest('hex')).toBe('3972dc9744f6499f0f9b2dbf76696f2ae7ad8af9b23dde66d6af86c9dfb36986')
    const readme = read('README.md')
    expect(readme).toContain('Copyright © 2026 Dimension Eight Labs LLC')
    expect(readme).toContain('GPL-3.0-or-later')
  })
})

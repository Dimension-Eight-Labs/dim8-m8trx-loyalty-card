/**
 * Warning before saving a backup that M8TRX cannot restore directly.
 *
 * Shown only when the prepared export exceeds one or more standard restore
 * limits (`issues`, from createBackupExport). The backup is always complete;
 * this dialog only asks the user to acknowledge that restoring it will need
 * the advanced splitting procedure documented in the README.
 *
 * Copy: the title, guidance, link text and actions are the approved wording.
 * The first paragraph names the limit actually exceeded: the approved
 * "more than 60 MiB of image data" sentence when the image budget is the
 * cause, and a sentence in the same form for each other cause, so the
 * warning never claims a reason that does not apply.
 *
 * Cancel has initial focus (the safe default) and, like Escape, discards the
 * prepared file without saving anything. Neither action changes stored cards.
 */
import { useRef } from 'react'
import { OVERSIZED_BACKUP_DOCS_URL } from '../../app/appMetadata.ts'
import { Dialog } from '../../components/Dialog.tsx'
import { BACKUP_LIMITS, type RestoreLimitIssue } from './backupFormat.ts'

export interface OversizedExportDialogProps {
  issues: readonly RestoreLimitIssue[]
  onContinue: () => void
  onCancel: () => void
}

const MIB = 1024 * 1024

/** One sentence per exceeded limit, in the order the issues are reported. */
function oversizedExportReason(issue: RestoreLimitIssue): string {
  switch (issue) {
    case 'totalImageBytes':
      return `Your wallet contains more than ${BACKUP_LIMITS.totalImageBytes / MIB} MiB of image data, exceeding M8TRX’s standard restore limit.`
    case 'imageBytes':
      return `Your wallet contains an image larger than ${BACKUP_LIMITS.imageBytes / MIB} MiB, exceeding M8TRX’s standard restore limit.`
    case 'cards':
      return `Your wallet contains more than ${BACKUP_LIMITS.cards.toLocaleString('en-US')} cards, exceeding M8TRX’s standard restore limit.`
    case 'fileBytes':
      return `This backup file is larger than ${BACKUP_LIMITS.fileBytes / MIB} MiB, exceeding M8TRX’s standard restore limit.`
    case 'fields':
      return 'Your wallet contains card details longer than M8TRX’s standard restore limit allows.'
  }
}

export function OversizedExportDialog({ issues, onContinue, onCancel }: OversizedExportDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null)
  return (
    <Dialog
      role="alertdialog"
      labelledBy="oversized-export-title"
      describedBy="oversized-export-body"
      initialFocusRef={cancelRef}
      onEscape={onCancel}
      className="dialog--scroll"
    >
      <h2 id="oversized-export-title" className="dialog__title">
        Backup Exceeds Restore Limit
      </h2>
      <div id="oversized-export-body" className="dialog__body export-warning" data-testid="oversized-export-body">
        {issues.map((issue) => (
          <p key={issue}>{oversizedExportReason(issue)}</p>
        ))}
        <p>You can still export and save your complete backup, but M8TRX cannot restore a file this large directly.</p>
        <p>Consider removing unused cards or large imported images before creating another backup.</p>
        <p>
          Advanced users can divide the JSON backup into smaller, compatible files. Instructions are available in the{' '}
          <a href={OVERSIZED_BACKUP_DOCS_URL} target="_blank" rel="noopener noreferrer">
            M8TRX GitHub README
          </a>
          .
        </p>
        <p>Your existing cards will not be changed.</p>
      </div>
      <div className="dialog__actions">
        <button ref={cancelRef} type="button" className="button button--secondary" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="button button--primary" onClick={onContinue}>
          Continue Export
        </button>
      </div>
    </Dialog>
  )
}

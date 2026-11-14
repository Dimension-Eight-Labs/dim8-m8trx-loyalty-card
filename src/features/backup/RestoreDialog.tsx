/**
 * Confirmation before restoring a backup.
 *
 * Shows what the (already validated) restore plan will do before anything is
 * written: how many cards the backup holds, how many will be added, and how
 * many are skipped as duplicates or ID conflicts, with their names. The only
 * supported mode is the safe one: existing cards are kept untouched and new
 * cards are appended in their backup order. There is no replace/overwrite
 * option.
 *
 * `onConfirm` resolves to an error message or null; on failure the dialog
 * stays open and announces the error (storage is unchanged, because the
 * import is a single transaction). Cancel has initial focus: the safe default.
 */
import { useRef, useState } from 'react'
import { Dialog } from '../../components/Dialog.tsx'
import type { LoyaltyCard } from '../cards/card.ts'
import type { RestorePlan } from './backupFormat.ts'

export interface RestoreDialogProps {
  plan: RestorePlan
  onConfirm: () => Promise<string | null>
  onCancel: () => void
}

/** Names listed per skipped group before "and N more". */
const NAMES_SHOWN = 5

export function RestoreDialog({ plan, onConfirm, onCancel }: RestoreDialogProps) {
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const adding = plan.toImport.length
  const nothingToAdd = adding === 0

  const handleConfirm = async () => {
    if (importing) return
    setImporting(true)
    setError(null)
    const message = await onConfirm()
    // On success the parent unmounts the dialog.
    if (message) {
      setImporting(false)
      setError(message)
    }
  }

  return (
    <Dialog
      labelledBy="restore-dialog-title"
      describedBy="restore-dialog-summary"
      initialFocusRef={cancelRef}
      onEscape={importing ? undefined : onCancel}
    >
      <h2 id="restore-dialog-title" className="dialog__title">
        {nothingToAdd ? 'Nothing new to restore' : 'Restore from backup?'}
      </h2>
      <div id="restore-dialog-summary" className="dialog__body restore-summary">
        <p>
          This backup has <strong>{count(plan.total, 'card')}</strong>.
        </p>
        <ul className="restore-summary__list" data-testid="restore-summary">
          <li>
            {nothingToAdd ? (
              'No new cards will be added.'
            ) : (
              <>
                <strong>{count(adding, 'new card')}</strong> will be added after your existing cards
                {adding > 1 ? ', in their saved order' : ''}.
              </>
            )}
          </li>
          {plan.duplicates.length > 0 && (
            <li>
              <strong>{count(plan.duplicates.length, 'card')}</strong> already in your wallet{' '}
              {plan.duplicates.length === 1 ? 'is' : 'are'} skipped: {names(plan.duplicates)}.
            </li>
          )}
          {plan.conflicts.length > 0 && (
            <li>
              <strong>{count(plan.conflicts.length, 'card')}</strong> {plan.conflicts.length === 1 ? 'conflicts' : 'conflict'} with a
              different card already saved and {plan.conflicts.length === 1 ? 'is' : 'are'} skipped: {names(plan.conflicts)}.
            </li>
          )}
        </ul>
        <p>Your existing cards won’t be changed or removed.</p>
      </div>
      <div role="alert">{error && <p className="notice notice--error">{error}</p>}</div>
      <div className="dialog__actions">
        <button ref={cancelRef} type="button" className="button button--secondary" onClick={onCancel} disabled={importing}>
          {nothingToAdd ? 'Close' : 'Cancel'}
        </button>
        {!nothingToAdd && (
          <button type="button" className="button button--primary" onClick={handleConfirm} aria-disabled={importing}>
            {importing ? 'Restoring…' : `Add ${count(adding, 'card')}`}
          </button>
        )}
      </div>
    </Dialog>
  )
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`
}

function names(cards: readonly LoyaltyCard[]): string {
  const shown = cards.slice(0, NAMES_SHOWN).map((card) => card.storeName)
  const more = cards.length - shown.length
  return more > 0 ? `${shown.join(', ')} and ${more} more` : shown.join(', ')
}

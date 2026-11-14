/**
 * Modal confirmation before deleting a card.
 *
 * Built on the shared Dialog shell (focus trap, Escape, focus restore) as an
 * ARIA `alertdialog`. Cancel receives focus on open: the safe choice is the
 * default. Escape cancels unless a delete is in progress.
 *
 * `onConfirm` resolves to an error message or null. On failure the dialog
 * stays open and announces the error.
 */
import { useRef, useState } from 'react'
import { Dialog } from '../../components/Dialog.tsx'

export interface DeleteCardDialogProps {
  storeName: string
  onConfirm: () => Promise<string | null>
  onCancel: () => void
}

export function DeleteCardDialog({ storeName, onConfirm, onCancel }: DeleteCardDialogProps) {
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)

  const handleConfirm = async () => {
    if (deleting) return
    setDeleting(true)
    setError(null)
    const message = await onConfirm()
    // On success the parent unmounts the dialog.
    if (message) {
      setDeleting(false)
      setError(message)
    }
  }

  return (
    <Dialog
      role="alertdialog"
      labelledBy="delete-dialog-title"
      describedBy="delete-dialog-description"
      initialFocusRef={cancelRef}
      onEscape={deleting ? undefined : onCancel}
    >
      <h2 id="delete-dialog-title" className="dialog__title">
        Delete this card?
      </h2>
      <p id="delete-dialog-description" className="dialog__body">
        <strong>{storeName}</strong> will be removed from this device. This can’t be undone.
      </p>
      <div role="alert">{error && <p className="notice notice--error">{error}</p>}</div>
      <div className="dialog__actions">
        <button ref={cancelRef} type="button" className="button button--secondary" onClick={onCancel} disabled={deleting}>
          Cancel
        </button>
        <button type="button" className="button button--danger-solid" onClick={handleConfirm} aria-disabled={deleting}>
          {deleting ? 'Deleting…' : 'Delete card'}
        </button>
      </div>
    </Dialog>
  )
}

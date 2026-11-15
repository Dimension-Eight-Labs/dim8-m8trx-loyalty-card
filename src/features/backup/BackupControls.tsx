/**
 * "Export all cards" and "Restore from backup" (Add Card screen, v0.5.0).
 *
 * Export is two taps on purpose: the first reads the wallet and builds the
 * file (asynchronous, so the browser no longer counts it as a user gesture);
 * the second, "Save backup", hands the file to the share sheet or a download
 * inside its own tap, which iOS requires (see saveFile.ts).
 *
 * Oversized exports: when the prepared file exceeds a standard restore limit
 * (backupFormat.ts, `issues`), `confirmOversizedExport` asks the user first
 * (OversizedExportDialog, owned by App). Cancel discards the prepared file
 * and nothing is offered for saving; Continue Export proceeds to the usual
 * "Save backup" step with the complete, unmodified file. Stored cards are
 * only ever read here, so neither choice can change them.
 *
 * Restore: the file picker opens within the tap. The chosen file is read and
 * fully validated (backupFormat.ts) and compared with the stored wallet
 * before anything is written; the resulting plan goes to `onRestorePlanned`,
 * whose owner shows the confirmation (RestoreDialog) and performs the import.
 * The picker has no `accept` filter: iOS greys out files whose extension it
 * doesn't recognise (such as .m8trx), and the content is validated anyway.
 *
 * Visibility (v0.6.0): the backup controls sit near the bottom of a long
 * screen, so the inline "Backup ready" section (and an inline error) can
 * appear below the visible area on a phone, leaving the user unsure whether
 * anything happened. When either appears it is scrolled into view with
 * `block: 'nearest'` (the smallest scroll that shows it, none if it is
 * already visible), smoothly unless the user prefers reduced motion. Its CSS
 * scroll margins keep it clear of the screen edge and the iOS home-indicator
 * safe area. Focus then moves to Save backup without a second scroll. The
 * oversized-export warning is a modal dialog and is always on screen.
 *
 * Everything happens on the device; nothing is sent anywhere.
 */
import { useEffect, useRef, useState } from 'react'
import { APP_NAME, APP_VERSION } from '../../app/appMetadata.ts'
import { ExportIcon, RestoreIcon } from '../../components/icons.tsx'
import type { LoyaltyCard } from '../cards/card.ts'
import {
  BACKUP_MIME_TYPE,
  backupFileName,
  createBackupExport,
  planRestore,
  readBackupFile,
  type RestoreLimitIssue,
  type RestorePlan,
} from './backupFormat.ts'
import { saveFileWithBrowser, type SaveFile } from './saveFile.ts'

export interface BackupControlsProps {
  /** Cards currently shown; export is disabled for an empty wallet. */
  cardCount: number
  /** Reads the stored wallet afresh (export source and restore comparison). */
  loadSnapshot: () => Promise<LoyaltyCard[]>
  onRestorePlanned: (plan: RestorePlan) => void
  /**
   * Asks the user whether to keep an export that exceeds standard restore
   * limits; resolves true for Continue Export, false for Cancel.
   */
  confirmOversizedExport: (issues: readonly RestoreLimitIssue[]) => Promise<boolean>
  saveFile?: SaveFile
  now?: () => Date
}

const TOO_LARGE_TO_CREATE = 'This browser couldn’t create a backup file this large. No backup was created, and your cards were not changed.'

type Busy = 'export' | 'save' | 'restore' | null

export function BackupControls({
  cardCount,
  loadSnapshot,
  onRestorePlanned,
  confirmOversizedExport,
  saveFile = saveFileWithBrowser,
  now = () => new Date(),
}: BackupControlsProps) {
  const [busy, setBusy] = useState<Busy>(null)
  const [ready, setReady] = useState<{ file: File; count: number } | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const saveRef = useRef<HTMLButtonElement>(null)
  const readyRef = useRef<HTMLDivElement>(null)
  const errorRef = useRef<HTMLParagraphElement>(null)

  // Show the newly revealed "Backup ready" section, then put keyboard and
  // screen-reader users on its next step. If the section could not be
  // scrolled (no scrollIntoView), let focus scroll it into view instead.
  useEffect(() => {
    if (!ready) return
    const revealed = revealSection(readyRef.current)
    saveRef.current?.focus({ preventScroll: revealed })
  }, [ready])

  // An inline error is announced (role="alert") and also brought on screen.
  useEffect(() => {
    if (error) revealSection(errorRef.current)
  }, [error])

  const reset = () => {
    setMessage('')
    setError(null)
  }

  const prepareExport = async () => {
    if (busy) return
    reset()
    setReady(null)
    setBusy('export')
    try {
      const cards = await loadSnapshot()
      if (cards.length === 0) throw new Error('There are no cards to export yet.')
      const at = now()
      const { text, issues } = await createBackupExport(cards, { appName: APP_NAME, appVersion: APP_VERSION, now: at })
      if (issues.length > 0 && !(await confirmOversizedExport(issues))) {
        setMessage('Backup not created. Your cards were not changed.')
        return
      }
      setReady({ file: new File([text], backupFileName(at), { type: BACKUP_MIME_TYPE }), count: cards.length })
    } catch (caught) {
      // Engines throw RangeError when a string (the JSON document or a base64
      // image) exceeds their maximum length; say so instead of showing the
      // engine's raw message. A true out-of-memory crash can't be caught.
      setError(caught instanceof RangeError ? TOO_LARGE_TO_CREATE : messageOf(caught, 'Couldn’t create the backup.'))
    } finally {
      setBusy(null)
    }
  }

  const save = async () => {
    if (!ready || busy) return
    reset()
    setBusy('save')
    try {
      const outcome = await saveFile(ready.file)
      if (outcome === 'cancelled') {
        setMessage('Backup not saved. Tap Save backup to try again.')
      } else {
        setMessage(outcome === 'shared' ? `Backup shared: ${ready.file.name}.` : `Backup downloaded: ${ready.file.name}.`)
        setReady(null)
      }
    } catch (caught) {
      setError(messageOf(caught, 'Couldn’t save the backup file.'))
    } finally {
      setBusy(null)
    }
  }

  const restore = async (file: File) => {
    reset()
    setReady(null)
    setBusy('restore')
    try {
      const cards = await readBackupFile(file)
      const plan = await planRestore(cards, await loadSnapshot())
      onRestorePlanned(plan)
    } catch (caught) {
      setError(messageOf(caught, 'Couldn’t read that backup. Nothing was imported.'))
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="utility-group" aria-labelledby="backup-heading">
      <h2 id="backup-heading" className="utility-group__title">
        Backup
      </h2>
      <input
        ref={fileRef}
        type="file"
        className="visually-hidden"
        tabIndex={-1}
        aria-label="Choose backup file"
        data-testid="restore-file-input"
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) void restore(file)
        }}
      />
      <div className="utility-list">
        <button type="button" className="utility-row" onClick={prepareExport} disabled={cardCount === 0} aria-disabled={busy !== null}>
          <ExportIcon />
          <span className="utility-row__title">{busy === 'export' ? 'Preparing backup…' : 'Export all cards'}</span>
          <span className="utility-row__hint">{cardCount === 0 ? 'Add a card first' : 'Save one backup file of your wallet'}</span>
        </button>
        <button
          type="button"
          className="utility-row"
          onClick={() => busy === null && fileRef.current?.click()}
          aria-disabled={busy !== null}
        >
          <RestoreIcon />
          <span className="utility-row__title">{busy === 'restore' ? 'Checking backup…' : 'Restore from backup'}</span>
          <span className="utility-row__hint">Add cards from an M8TRX backup file</span>
        </button>
      </div>

      {ready && (
        <div ref={readyRef} className="backup-ready" data-testid="backup-ready">
          <p className="backup-ready__text">
            Backup ready: <strong>{ready.file.name}</strong> ({ready.count} {ready.count === 1 ? 'card' : 'cards'})
          </p>
          <div className="button-row">
            <button ref={saveRef} type="button" className="button button--primary" onClick={save} aria-disabled={busy !== null}>
              {busy === 'save' ? 'Saving…' : 'Save backup'}
            </button>
            <button type="button" className="button button--ghost" onClick={() => setReady(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <p className="utility-group__message" role="status">
        {message}
      </p>
      <div role="alert">
        {error && (
          <p ref={errorRef} className="notice notice--error backup-notice">
            {error}
          </p>
        )}
      </div>
    </section>
  )
}

/**
 * Scrolls `element` the minimum distance needed to show it (nothing if it is
 * already visible). Returns false when it could not try (no element, or a
 * browser without scrollIntoView), so the caller can fall back.
 */
function revealSection(element: HTMLElement | null): boolean {
  if (!element || typeof element.scrollIntoView !== 'function') return false
  const reduceMotion = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  element.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' })
  return true
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

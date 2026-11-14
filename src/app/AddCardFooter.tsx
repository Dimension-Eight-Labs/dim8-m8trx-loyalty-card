/**
 * Secondary actions at the bottom of the Add Card screen (v0.5.0): Backup
 * (export / restore), About, and the copyright notice as the very last line.
 *
 * Composed by App and handed to AddCardFlow as its `footer`, so the capture
 * flow stays unaware of backup and branding. Rendered below the capture
 * choices and visually quieter than them, so adding a card stays the primary
 * task. The .app-shell bottom padding keeps the notice clear of the iPhone
 * home indicator; the page scrolls on small screens.
 */
import { InfoIcon } from '../components/icons.tsx'
import { BackupControls, type BackupControlsProps } from '../features/backup/BackupControls.tsx'
import { APP_VERSION, COPYRIGHT_NOTICE } from './appMetadata.ts'

export interface AddCardFooterProps extends BackupControlsProps {
  onAbout: () => void
}

export function AddCardFooter({ onAbout, ...backup }: AddCardFooterProps) {
  return (
    <footer className="add-flow__footer" data-testid="add-card-footer">
      <BackupControls {...backup} />
      <div className="utility-list">
        <button type="button" className="utility-row" onClick={onAbout}>
          <InfoIcon />
          <span className="utility-row__title">About</span>
          <span className="utility-row__hint">M8TRX {APP_VERSION}</span>
        </button>
      </div>
      <p className="add-flow__copyright">{COPYRIGHT_NOTICE}</p>
    </footer>
  )
}

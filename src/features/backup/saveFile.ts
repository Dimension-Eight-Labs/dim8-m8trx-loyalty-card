/**
 * Browser adapter that hands a finished backup file to the user.
 *
 * - Where the Web Share API accepts files (iOS/iPadOS Safari, installed PWA,
 *   Android Chrome), the system share sheet opens, from which the user can
 *   choose "Save to Files" (including iCloud Drive), AirDrop, etc.
 * - Otherwise, or if sharing fails for a reason other than the user
 *   cancelling, the file is downloaded through a temporary object URL.
 *
 * Nothing is uploaded: the file only ever goes where the user sends it.
 * Must be called from a user gesture (a tap on "Save backup"), because
 * browsers only allow sharing and downloads in direct response to one; this
 * is why export is a two-step "prepare, then save" action.
 */
export type SaveOutcome = 'shared' | 'downloaded' | 'cancelled'
export type SaveFile = (file: File) => Promise<SaveOutcome>

/** How long a download's object URL is kept; long enough for slow browsers to start it. */
const REVOKE_DELAY_MS = 60_000

export const saveFileWithBrowser: SaveFile = async (file) => {
  if (typeof navigator.share === 'function' && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: file.name })
      return 'shared'
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled'
      // e.g. NotAllowedError: fall back to an ordinary download.
    }
  }
  const url = URL.createObjectURL(file)
  try {
    const link = document.createElement('a')
    link.href = url
    link.download = file.name
    link.rel = 'noopener'
    link.style.display = 'none'
    document.body.append(link)
    link.click()
    link.remove()
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS)
  }
  return 'downloaded'
}

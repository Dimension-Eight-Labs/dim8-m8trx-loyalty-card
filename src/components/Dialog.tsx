/**
 * Minimal accessible modal dialog shell shared by the card menu and the
 * delete confirmation.
 *
 * Implemented with ARIA roles rather than native <dialog>, because jsdom (used
 * by the tests) does not implement `showModal()`. The parent marks the rest of
 * the app `inert` while a dialog is open, which supplies the modality native
 * <dialog> would.
 *
 * Focus behaviour:
 * - `initialFocusRef` (or the first button) receives focus on open.
 * - Tab / Shift+Tab cycle within the dialog.
 * - Escape calls `onEscape` (pass undefined to ignore it, e.g. while busy).
 * - On close, focus returns to the element focused when the dialog opened, if
 *   it still exists. Parents handle the case where it does not.
 * - Clicking the backdrop (outside the panel) also calls `onEscape`.
 */
import { useEffect, useRef, type KeyboardEvent, type ReactNode, type RefObject } from 'react'

export interface DialogProps {
  role?: 'dialog' | 'alertdialog'
  labelledBy: string
  describedBy?: string
  initialFocusRef?: RefObject<HTMLElement | null>
  onEscape?: () => void
  className?: string
  children: ReactNode
}

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'

export function Dialog({
  role = 'dialog',
  labelledBy,
  describedBy,
  initialFocusRef,
  onEscape,
  className,
  children,
}: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null
    const target = initialFocusRef?.current ?? panelRef.current?.querySelector<HTMLElement>(FOCUSABLE)
    target?.focus()
    return () => {
      if (previouslyFocused?.isConnected) previouslyFocused.focus()
    }
    // Run once per open; refs are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onEscape?.()
      return
    }
    if (event.key !== 'Tab' || !panelRef.current) return

    const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE))
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (!first || !last) return
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <div
      className="dialog-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onEscape?.()
      }}
    >
      <div
        ref={panelRef}
        className={className ? `dialog ${className}` : 'dialog'}
        role={role}
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        onKeyDown={handleKeyDown}
      >
        {children}
      </div>
    </div>
  )
}

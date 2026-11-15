/**
 * Small inline SVG icons. All are decorative (aria-hidden); every control
 * that uses one also has a visible text label or an aria-label.
 */
function Icon({ path }: { path: string }) {
  return (
    <svg className="button__icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={path} fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export const PlusIcon = () => <Icon path="M12 5v14M5 12h14" />
export const BackIcon = () => <Icon path="M15 5l-7 7 7 7" />
export const ChevronIcon = () => <Icon path="M9 5l7 7-7 7" />
export const TrashIcon = () => <Icon path="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
export const CloseIcon = () => <Icon path="M6 6l12 12M18 6L6 18" />
export const CameraIcon = () => <Icon path="M4 8h3l2-3h6l2 3h3v11H4zM12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z" />
export const ImageIcon = () => <Icon path="M4 5h16v14H4zM4 16l5-5 4 4 2-2 5 5M15.5 9.5h.01" />
export const KeyboardIcon = () => <Icon path="M3 7h18v10H3zM7 11h.01M11 11h.01M15 11h.01M8 14h8" />
export const CheckIcon = () => <Icon path="M5 12.5l4.5 4.5L19 7.5" />
export const InfoIcon = () => <Icon path="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5.5M12 7.75h.01" />
/** Export: arrow down into a tray. */
export const ExportIcon = () => <Icon path="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14" />
/** Restore: arrow up out of a tray. */
export const RestoreIcon = () => <Icon path="M12 15V4M7.5 8.5L12 4l4.5 4.5M5 19.5h14" />


/*
 * Card-menu action icons (v0.6.1). Original line drawings in the same 24×24
 * grid, 2.25 stroke and round joins as the icons above, so the menu rows read
 * as one set with the Add Card rows. Decorative: each row has a text label.
 */
/** Rename: a pencil writing on a line. */
export const PencilIcon = () => <Icon path="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17zM13.5 8.5l3 3" />
/** Change color: a paint drop. */
export const DropIcon = () => <Icon path="M12 3.5c3.2 3.6 6 7 6 10.5a6 6 0 0 1-12 0c0-3.5 2.8-6.9 6-10.5z" />
/** Change icon: a label tag (the icon marks the card's category). */
export const TagIcon = () => <Icon path="M3.5 4.5v7.1l8.9 8.9 8.1-8.1-8.9-8.9H4.5a1 1 0 0 0-1 1zM8 8.5h.01" />
/** Move to first: arrow up to a bar. */
export const ArrowToTopIcon = () => <Icon path="M5 4h14M12 20V9M6.5 14.5L12 9l5.5 5.5" />
/** Move to last: arrow down to a bar. */
export const ArrowToBottomIcon = () => <Icon path="M5 20h14M12 4v11M6.5 9.5L12 15l5.5-5.5" />

/** Three dots; filled circles read better than strokes at small sizes. */
export const MoreIcon = () => (
  <svg className="button__icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <circle cx="5" cy="12" r="2" fill="currentColor" />
    <circle cx="12" cy="12" r="2" fill="currentColor" />
    <circle cx="19" cy="12" r="2" fill="currentColor" />
  </svg>
)

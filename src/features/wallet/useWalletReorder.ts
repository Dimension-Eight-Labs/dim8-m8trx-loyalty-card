/**
 * Drag-to-reorder for the wallet grid (v0.4.0), built on Pointer Events plus
 * one non-passive `touchmove` guard. No drag-and-drop library: the HTML5
 * drag-and-drop API does not work for touch on iOS, and the behaviour needed
 * here is small.
 *
 * Activation (per pointer type):
 * - Touch: press and hold LONG_PRESS_MS without moving more than
 *   MOVE_TOLERANCE_PX. Moving earlier means the user is scrolling: the press
 *   is abandoned and the browser scrolls as usual. Once activated, the grid's
 *   touchmove guard calls preventDefault() so the page no longer scrolls
 *   under the finger.
 * - Mouse / pen: press the primary button and move at least DRAG_START_PX.
 *   A press released before that is an ordinary click.
 *
 * While dragging:
 * - The tile follows the pointer (CSS `translate` from --drag-x/--drag-y,
 *   written straight to the DOM so pointer moves don't re-render React).
 * - When the pointer is over another tile's grid slot, the dragged card takes
 *   that position in a temporary preview order; the other tiles slide aside
 *   (FLIP, see WalletScreen). Hit-testing uses layout slots (offsetLeft/Top,
 *   which ignore transforms), so mid-animation tiles can't cause flicker.
 * - Near the top or bottom viewport edge the page auto-scrolls, at most
 *   AUTO_SCROLL_MAX_PX per frame, so cards can be carried through long wallets.
 *
 * Ending:
 * - Release commits: `onReorder` is called with the full new order (only if
 *   it changed). The preview stays on screen until it settles; if saving
 *   fails, the previous order returns.
 * - pointercancel, Escape, or the window losing focus cancel and revert.
 * - The click that follows a drag's release is swallowed, so a drag never
 *   opens the card. Long-press never opens the management menu any more;
 *   the tile's "⋯" button is the only way in, and it is excluded from drag
 *   (only the tile's main button carries these handlers).
 *
 * Timing rationale: LONG_PRESS_MS (500 ms) matches common platform long-press
 * durations and is long enough not to trigger on taps; MOVE_TOLERANCE_PX
 * (10 px) tolerates finger jitter while still yielding quickly to scrolling.
 * DRAG_START_PX (6 px) keeps slightly shaky mouse clicks as clicks.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent, type RefObject } from 'react'
import type { LoyaltyCard } from '../cards/card.ts'

export const LONG_PRESS_MS = 500
export const MOVE_TOLERANCE_PX = 10
export const DRAG_START_PX = 6
/** Distance from the viewport edge where auto-scroll starts. */
const AUTO_SCROLL_EDGE_PX = 56
/** Upper bound on auto-scroll speed, per animation frame. */
const AUTO_SCROLL_MAX_PX = 14
/** How long after a drag the following click is still swallowed. */
const CLICK_SUPPRESS_MS = 600

interface Session {
  cardId: string
  pointerId: number
  touch: boolean
  originX: number
  originY: number
  lastX: number
  lastY: number
  active: boolean
  /** Pointer position relative to the dragged tile's slot when the drag began. */
  grabX: number
  grabY: number
  /** Current preview order while active. */
  order: string[]
  timer?: ReturnType<typeof setTimeout>
}

export interface WalletReorderOptions {
  cards: LoyaltyCard[]
  /** The grid whose direct children are tiles carrying `data-card-id`. */
  gridRef: RefObject<HTMLElement | null>
  /** Persists a new order; the promise settles once saving succeeded or failed. */
  onReorder?: (orderedIds: string[]) => Promise<unknown>
}

export interface TileDragHandlers {
  onPointerDown: (event: PointerEvent<HTMLElement>) => void
  onClickCapture: (event: MouseEvent<HTMLElement>) => void
  onContextMenu: (event: MouseEvent<HTMLElement>) => void
  onDragStart: (event: MouseEvent<HTMLElement>) => void
}

export interface WalletReorder {
  /** Cards in display order: the live preview while dragging or saving. */
  orderedCards: LoyaltyCard[]
  /** Card currently being dragged, if any. */
  draggingId: string | null
  /** Pointer handlers for a tile's main (open) button. */
  handlersFor: (cardId: string) => TileDragHandlers
}

export function useWalletReorder({ cards, gridRef, onReorder }: WalletReorderOptions): WalletReorder {
  const [preview, setPreview] = useState<string[] | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const session = useRef<Session | null>(null)
  const suppressClickUntil = useRef(0)
  const scrollFrame = useRef<number | null>(null)
  const cardsRef = useRef(cards)
  const onReorderRef = useRef(onReorder)
  // Window listeners of the current press, so it can remove exactly these.
  const detach = useRef<(() => void) | null>(null)

  useEffect(() => {
    cardsRef.current = cards
    onReorderRef.current = onReorder
  }, [cards, onReorder])

  const orderedCards = useMemo(() => (preview ? applyPreview(cards, preview) : cards), [cards, preview])

  // ---- Geometry -------------------------------------------------------------

  const tileElement = useCallback(
    (cardId: string): HTMLElement | null => {
      const grid = gridRef.current
      if (!grid) return null
      for (const child of Array.from(grid.children)) {
        if (child instanceof HTMLElement && child.dataset.cardId === cardId) return child
      }
      return null
    },
    [gridRef],
  )

  /** Viewport rectangle of a tile's layout slot, ignoring any transform. */
  const slotRect = useCallback(
    (tile: HTMLElement) => {
      const grid = gridRef.current?.getBoundingClientRect()
      const left = (grid?.left ?? 0) + tile.offsetLeft
      const top = (grid?.top ?? 0) + tile.offsetTop
      return { left, top, right: left + tile.offsetWidth, bottom: top + tile.offsetHeight }
    },
    [gridRef],
  )

  /** Moves the dragged tile so it stays under the pointer at the grab point. */
  const positionDragged = useCallback(() => {
    const current = session.current
    if (!current?.active) return
    const tile = tileElement(current.cardId)
    if (!tile) return
    const slot = slotRect(tile)
    tile.style.setProperty('--drag-x', `${current.lastX - current.grabX - slot.left}px`)
    tile.style.setProperty('--drag-y', `${current.lastY - current.grabY - slot.top}px`)
  }, [slotRect, tileElement])

  /** If the pointer is over another tile's slot, move the dragged card there. */
  const hitTest = useCallback(() => {
    const current = session.current
    const grid = gridRef.current
    if (!current?.active || !grid) return
    for (const child of Array.from(grid.children)) {
      if (!(child instanceof HTMLElement)) continue
      const id = child.dataset.cardId
      if (!id || id === current.cardId) continue
      const slot = slotRect(child)
      const inside = current.lastX >= slot.left && current.lastX < slot.right && current.lastY >= slot.top && current.lastY < slot.bottom
      if (!inside) continue
      const from = current.order.indexOf(current.cardId)
      const to = current.order.indexOf(id)
      if (from < 0 || to < 0 || from === to) return
      const next = current.order.slice()
      next.splice(from, 1)
      next.splice(to, 0, current.cardId)
      current.order = next
      setPreview(next)
      return
    }
  }, [gridRef, slotRect])

  // After React re-orders the tiles, the dragged tile's slot has moved:
  // re-anchor it under the pointer before the browser paints.
  useLayoutEffect(() => {
    positionDragged()
  }, [preview, positionDragged])

  // ---- Auto-scroll ----------------------------------------------------------

  const stopAutoScroll = useCallback(() => {
    if (scrollFrame.current !== null) cancelAnimationFrame(scrollFrame.current)
    scrollFrame.current = null
  }, [])

  /** Starts the auto-scroll frame loop if the pointer sits in an edge zone. */
  const maybeAutoScroll = useCallback(() => {
    if (scrollFrame.current !== null || !session.current?.active || autoScrollDelta(session.current.lastY) === 0) return
    const step = () => {
      scrollFrame.current = null
      const current = session.current
      if (!current?.active) return
      const delta = autoScrollDelta(current.lastY)
      if (delta === 0) return
      const before = window.scrollY
      window.scrollBy(0, delta)
      if (window.scrollY === before) return // Already at the end.
      // The page moved under a still pointer: re-anchor and re-hit-test.
      positionDragged()
      hitTest()
      scrollFrame.current = requestAnimationFrame(step)
    }
    scrollFrame.current = requestAnimationFrame(step)
  }, [hitTest, positionDragged])

  // ---- Lifecycle ------------------------------------------------------------

  /** Clears the dragged tile's inline offset, gliding it into its slot. */
  const settleTile = useCallback(
    (cardId: string) => {
      const tile = tileElement(cardId)
      if (!tile) return
      const x = tile.style.getPropertyValue('--drag-x')
      const y = tile.style.getPropertyValue('--drag-y')
      tile.style.removeProperty('--drag-x')
      tile.style.removeProperty('--drag-y')
      if (x && y && !prefersReducedMotion() && typeof tile.animate === 'function') {
        tile.animate([{ translate: `${x} ${y}` }, { translate: '0px 0px' }], { duration: 160, easing: 'ease-out' })
      }
    },
    [tileElement],
  )

  /** Ends the current press. `commit` saves the preview order (drop). */
  const finish = useCallback(
    (commit: boolean) => {
      const current = session.current
      if (!current) return
      session.current = null
      if (current.timer !== undefined) clearTimeout(current.timer)
      detach.current?.()
      detach.current = null
      stopAutoScroll()
      if (!current.active) return

      suppressClickUntil.current = Date.now() + CLICK_SUPPRESS_MS
      settleTile(current.cardId)
      setDraggingId(null)

      const original = cardsRef.current.map((card) => card.id)
      const changed = current.order.some((id, index) => id !== original[index])
      const save = onReorderRef.current
      if (!commit || !changed || !save) {
        setPreview(null)
        return
      }
      // Keep showing the dropped order until the save settles; on success the
      // controller's list already matches it, on failure this reverts.
      setPreview(current.order)
      save(current.order).finally(() => setPreview(null))
    },
    [settleTile, stopAutoScroll],
  )

  const activate = useCallback(() => {
    const current = session.current
    if (!current || current.active) return
    const tile = tileElement(current.cardId)
    if (!tile) {
      finish(false)
      return
    }
    current.timer = undefined
    const slot = slotRect(tile)
    current.grabX = current.originX - slot.left
    current.grabY = current.originY - slot.top
    current.order = cardsRef.current.map((card) => card.id)
    current.active = true
    // Light haptic confirmation where supported (Android); a no-op elsewhere.
    if (current.touch) navigator.vibrate?.(10)
    setPreview(current.order)
    setDraggingId(current.cardId)
    positionDragged()
  }, [finish, positionDragged, slotRect, tileElement])

  const onMove = useCallback(
    (event: globalThis.PointerEvent) => {
      const current = session.current
      if (!current || event.pointerId !== current.pointerId) return
      current.lastX = event.clientX ?? 0
      current.lastY = event.clientY ?? 0
      if (!current.active) {
        const distance = Math.hypot(current.lastX - current.originX, current.lastY - current.originY)
        if (current.touch) {
          // Moving before the hold completes is a scroll, not a drag.
          if (distance > MOVE_TOLERANCE_PX) finish(false)
        } else if (distance >= DRAG_START_PX) {
          activate()
        }
        return
      }
      event.preventDefault()
      positionDragged()
      hitTest()
      maybeAutoScroll()
    },
    [activate, finish, hitTest, maybeAutoScroll, positionDragged],
  )

  const begin = useCallback(
    (cardId: string, event: PointerEvent<HTMLElement>) => {
      if (!event.isPrimary || session.current) return
      const touch = event.pointerType === 'touch'
      if (!touch && event.button !== 0) return
      const x = event.clientX ?? 0
      const y = event.clientY ?? 0
      const current: Session = {
        cardId,
        pointerId: event.pointerId,
        touch,
        originX: x,
        originY: y,
        lastX: x,
        lastY: y,
        active: false,
        grabX: 0,
        grabY: 0,
        order: [],
      }
      if (touch) current.timer = setTimeout(activate, LONG_PRESS_MS)
      session.current = current

      const up = (e: globalThis.PointerEvent) => {
        if (e.pointerId === current.pointerId) finish(true)
      }
      const cancel = (e: globalThis.PointerEvent) => {
        if (e.pointerId === current.pointerId) finish(false)
      }
      const key = (e: KeyboardEvent) => {
        if (e.key === 'Escape' && session.current?.active) {
          e.preventDefault()
          finish(false)
        }
      }
      const blur = () => finish(false)
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', up)
      window.addEventListener('pointercancel', cancel)
      window.addEventListener('keydown', key)
      window.addEventListener('blur', blur)
      detach.current = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', up)
        window.removeEventListener('pointercancel', cancel)
        window.removeEventListener('keydown', key)
        window.removeEventListener('blur', blur)
      }
    },
    [activate, finish, onMove],
  )

  // Once a touch drag is active, stop the page from scrolling under it.
  // Must be a non-passive native listener: React's touch handlers are passive.
  useEffect(() => {
    const grid = gridRef.current
    if (!grid) return
    const guard = (event: TouchEvent) => {
      if (session.current?.active) event.preventDefault()
    }
    grid.addEventListener('touchmove', guard, { passive: false })
    return () => grid.removeEventListener('touchmove', guard)
  }, [gridRef])

  // Unmount mid-press: drop timers and listeners without saving.
  useEffect(
    () => () => {
      const current = session.current
      session.current = null
      if (current?.timer !== undefined) clearTimeout(current.timer)
      detach.current?.()
      stopAutoScroll()
    },
    [stopAutoScroll],
  )

  const handlersFor = useCallback(
    (cardId: string): TileDragHandlers => ({
      onPointerDown: (event) => begin(cardId, event),
      onClickCapture: (event) => {
        if (Date.now() < suppressClickUntil.current) {
          suppressClickUntil.current = 0
          event.preventDefault()
          event.stopPropagation()
        }
      },
      // A touch long-press must not raise a native context menu (Android) or
      // callout; desktop right-click keeps the browser's own menu.
      onContextMenu: (event) => {
        if (session.current?.touch) event.preventDefault()
      },
      // Stop native image/link dragging from hijacking a mouse drag.
      onDragStart: (event) => event.preventDefault(),
    }),
    [begin],
  )

  return { orderedCards, draggingId, handlersFor }
}

/** Cards in preview order; cards added or removed mid-drag are tolerated. */
function applyPreview(cards: LoyaltyCard[], preview: string[]): LoyaltyCard[] {
  const byId = new Map(cards.map((card) => [card.id, card]))
  const ordered: LoyaltyCard[] = []
  for (const id of preview) {
    const card = byId.get(id)
    if (card) {
      ordered.push(card)
      byId.delete(id)
    }
  }
  return ordered.concat([...byId.values()])
}

/** Auto-scroll step for a pointer at viewport y: negative up, positive down, 0 outside the edge zones. */
function autoScrollDelta(y: number): number {
  const root = document.scrollingElement ?? document.documentElement
  const height = window.innerHeight
  const canUp = window.scrollY > 0
  const canDown = window.scrollY + height < root.scrollHeight
  // Speed grows linearly with depth into the edge zone, capped at the edge.
  const step = (depth: number) => Math.ceil((AUTO_SCROLL_MAX_PX * Math.min(depth, AUTO_SCROLL_EDGE_PX)) / AUTO_SCROLL_EDGE_PX)
  if (y < AUTO_SCROLL_EDGE_PX && canUp) return -step(AUTO_SCROLL_EDGE_PX - y)
  if (y > height - AUTO_SCROLL_EDGE_PX && canDown) return step(y - (height - AUTO_SCROLL_EDGE_PX))
  return 0
}

export function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

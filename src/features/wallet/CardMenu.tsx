/**
 * Card management menu opened by a tile's "⋯" button (its only entry point;
 * long-press now rearranges tiles instead).
 *
 * Four small steps inside one dialog: the menu (Rename / Change color /
 * Change icon / move actions / Delete), a rename form, a color picker and a
 * category icon picker. Delete hands back to the parent, which shows the
 * separate DeleteCardDialog confirmation.
 *
 * Menu step layout (v0.6.1): a compact identity header in the card's own
 * palette color, showing its category icon (if any) and full name with the
 * same text/icon color rule as the wallet tile, so it is obvious which card is
 * being edited. The header holds a 48px top-right Close (×) button, which
 * replaced the old Cancel row; Escape and a tap on the backdrop still close
 * the menu. Each action row has a small decorative line icon before its
 * label. Rename keeps initial focus. The rename / color / icon steps keep
 * their own Cancel buttons, which return to the menu.
 *
 * Short viewports (v0.6.1 correction): the full menu is ~514px tall, more
 * than a landscape iPhone shows. The menu-step dialog is therefore capped to
 * the usable viewport in CSS, the header stays fixed, and only the action
 * rows (`.card-menu__actions`) scroll, so the Close × is always reachable.
 *
 * Move actions are the keyboard- and screen-reader-accessible alternative to
 * dragging. "Move up" and "Move down" (internally the `earlier` / `later`
 * targets) mean one place back or forward in reading order (left to right,
 * then top to bottom), whatever the column count. Actions that cannot apply
 * (e.g. "Move up" on the first card) are
 * disabled, and the whole group is hidden when there is only one card.
 * `onMove` resolves to an error message or null; on failure the menu stays
 * open with the message and the saved order is unchanged.
 *
 * There is intentionally no way to edit barcode data: to fix a wrong barcode
 * the user deletes the card and adds it again.
 *
 * `onRename` / `onRecolor` / `onChangeIcon` resolve to an error message or null; on failure the
 * step stays open with the message and the user's input.
 */
import { useId, useRef, useState, type FormEvent, type ReactNode, type Ref } from 'react'
import { Dialog } from '../../components/Dialog.tsx'
import {
  ArrowDownIcon,
  ArrowToBottomIcon,
  ArrowToTopIcon,
  ArrowUpIcon,
  CloseIcon,
  DropIcon,
  PencilIcon,
  TagIcon,
  TrashIcon,
} from '../../components/icons.tsx'
import { CARD_LIMITS, validateStoreName, type LoyaltyCard } from '../cards/card.ts'
import { CardCategoryIcon } from '../cards/CardCategoryIcon.tsx'
import type { CardIconId } from '../cards/cardIcons.ts'
import { ColorPicker } from '../cards/ColorPicker.tsx'
import { IconPicker } from '../cards/IconPicker.tsx'
import { tileColor } from '../cards/tileColors.ts'
import type { MoveTarget } from './walletOrder.ts'

export interface CardMenuProps {
  card: LoyaltyCard
  /** Zero-based position of the card in the wallet. */
  position: number
  /** Number of cards in the wallet. */
  count: number
  onClose: () => void
  onRename: (storeName: string) => Promise<string | null>
  onRecolor: (color: string) => Promise<string | null>
  /** `null` means None (remove the icon). */
  onChangeIcon: (icon: CardIconId | null) => Promise<string | null>
  onMove: (target: MoveTarget) => Promise<string | null>
  onDelete: () => void
}

type Step = 'menu' | 'rename' | 'color' | 'icon'

export function CardMenu({ card, position, count, onClose, onRename, onRecolor, onChangeIcon, onMove, onDelete }: CardMenuProps) {
  const [step, setStep] = useState<Step>('menu')
  const [moveError, setMoveError] = useState<string | null>(null)
  const [moving, setMoving] = useState(false)
  const titleId = useId()
  // Rename stays the first focused control, as before the header gained its
  // Close button (which comes first in DOM and tab order).
  const firstActionRef = useRef<HTMLButtonElement>(null)
  const colors = tileColor(card.color)
  const atStart = position <= 0
  const atEnd = position >= count - 1

  const move = async (target: MoveTarget) => {
    if (moving) return
    setMoving(true)
    setMoveError(null)
    const message = await onMove(target)
    // On success the parent closes the menu; only failures land here.
    if (message) {
      setMoving(false)
      setMoveError(message)
    }
  }

  return (
    <Dialog
      key={step}
      labelledBy={titleId}
      onEscape={step === 'menu' ? onClose : () => setStep('menu')}
      initialFocusRef={step === 'menu' ? firstActionRef : undefined}
      // Only the menu step is height-capped with an internal scroll region;
      // the rename / color / icon steps keep their normal layout.
      className={step === 'menu' ? 'dialog--menu dialog--menu-actions' : 'dialog--menu'}
    >
      {step === 'menu' && (
        <>
          {/* Identity header: the card's own color, icon and name, styled like its tile. */}
          <div className="card-header" data-testid="card-menu-header" style={{ background: colors.background, color: colors.text }}>
            {card.icon && (
              <span className="card-header__icon">
                <CardCategoryIcon icon={card.icon} />
              </span>
            )}
            <h2 id={titleId} className="card-header__title">
              {card.storeName}
            </h2>
            <button type="button" className="card-header__close" aria-label="Close" onClick={onClose}>
              <CloseIcon />
            </button>
          </div>
          {/*
           * Scroll region: on short (e.g. landscape) viewports the dialog is
           * capped to the visible height and only this part scrolls, so the
           * header and its Close × above stay on screen. See app.css.
           */}
          <div className="card-menu__actions" data-testid="card-menu-actions">
            <div className="menu-list">
              <MenuItem ref={firstActionRef} icon={<PencilIcon />} label="Rename" onClick={() => setStep('rename')} />
              <MenuItem icon={<DropIcon />} label="Change color" onClick={() => setStep('color')} />
              <MenuItem icon={<TagIcon />} label="Change icon" onClick={() => setStep('icon')} />
              {count > 1 && (
                <div className="menu-list__group" role="group" aria-label={`Position ${position + 1} of ${count}`}>
                  <MenuItem icon={<ArrowUpIcon />} label="Move up" disabled={atStart || moving} onClick={() => move('earlier')} />
                  <MenuItem icon={<ArrowDownIcon />} label="Move down" disabled={atEnd || moving} onClick={() => move('later')} />
                  <MenuItem icon={<ArrowToTopIcon />} label="Move to first" disabled={atStart || moving} onClick={() => move('first')} />
                  <MenuItem icon={<ArrowToBottomIcon />} label="Move to last" disabled={atEnd || moving} onClick={() => move('last')} />
                </div>
              )}
              <MenuItem icon={<TrashIcon />} label="Delete" danger onClick={onDelete} />
            </div>
            <div role="alert">{moveError && <p className="notice notice--error">{moveError}</p>}</div>
          </div>
        </>
      )}
      {step === 'rename' && <RenameStep titleId={titleId} card={card} onCancel={() => setStep('menu')} onSave={onRename} />}
      {step === 'color' && <ColorStep titleId={titleId} card={card} onCancel={() => setStep('menu')} onSave={onRecolor} />}
      {step === 'icon' && <IconStep titleId={titleId} card={card} onCancel={() => setStep('menu')} onSave={onChangeIcon} />}
    </Dialog>
  )
}

interface MenuItemProps {
  ref?: Ref<HTMLButtonElement>
  icon: ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
  danger?: boolean
}

/** One action row: decorative line icon, then the visible label (its accessible name). */
function MenuItem({ ref, icon, label, onClick, disabled, danger = false }: MenuItemProps) {
  return (
    <button
      ref={ref}
      type="button"
      className={danger ? 'menu-list__item menu-list__item--danger' : 'menu-list__item'}
      disabled={disabled}
      onClick={onClick}
    >
      {icon}
      <span className="menu-list__label">{label}</span>
    </button>
  )
}

interface StepProps<T> {
  titleId: string
  card: LoyaltyCard
  onCancel: () => void
  onSave: (value: T) => Promise<string | null>
}

function RenameStep({ titleId, card, onCancel, onSave }: StepProps<string>) {
  const [name, setName] = useState(card.storeName)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const inputId = useId()

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (saving) return
    const problem = validateStoreName(name)
    if (problem) {
      setError(problem)
      inputRef.current?.focus()
      return
    }
    setSaving(true)
    const message = await onSave(name)
    if (message) {
      setSaving(false)
      setError(message)
    }
  }

  return (
    <form className="form" onSubmit={submit} noValidate>
      <h2 id={titleId} className="dialog__title">
        Rename card
      </h2>
      <div className="field">
        <label className="field__label" htmlFor={inputId}>
          Store name
        </label>
        <input
          ref={inputRef}
          id={inputId}
          className="field__control"
          value={name}
          maxLength={CARD_LIMITS.storeName}
          autoComplete="off"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${inputId}-error` : undefined}
          onChange={(event) => setName(event.target.value)}
        />
        {error && (
          <p id={`${inputId}-error`} className="field__error" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="dialog__actions">
        <button type="button" className="button button--secondary" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="button button--primary" aria-disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  )
}

function ColorStep({ titleId, card, onCancel, onSave }: StepProps<string>) {
  const [color, setColor] = useState(card.color)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    const message = await onSave(color)
    if (message) {
      setSaving(false)
      setError(message)
    }
  }

  return (
    <form className="form" onSubmit={submit}>
      <h2 id={titleId} className="dialog__title">
        Change color
      </h2>
      <ColorPicker name="menu-color" value={color} onChange={setColor} />
      <div role="alert">{error && <p className="notice notice--error">{error}</p>}</div>
      <div className="dialog__actions">
        <button type="button" className="button button--secondary" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="button button--primary" aria-disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  )
}

function IconStep({ titleId, card, onCancel, onSave }: StepProps<CardIconId | null>) {
  const [icon, setIcon] = useState<CardIconId | null>(card.icon ?? null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    const message = await onSave(icon)
    if (message) {
      setSaving(false)
      setError(message)
    }
  }

  return (
    <form className="form" onSubmit={submit}>
      <h2 id={titleId} className="dialog__title">
        Change icon
      </h2>
      <IconPicker name="menu-icon" value={icon} color={card.color} onChange={setIcon} />
      <div role="alert">{error && <p className="notice notice--error">{error}</p>}</div>
      <div className="dialog__actions">
        <button type="button" className="button button--secondary" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="button button--primary" aria-disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  )
}

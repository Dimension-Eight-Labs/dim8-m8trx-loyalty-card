/**
 * Card management menu opened by a tile's "⋯" button (its only entry point;
 * long-press now rearranges tiles instead).
 *
 * Three small steps inside one dialog: the menu (Rename / Change colour /
 * move actions / Delete), a rename form, and a colour picker. Delete hands
 * back to the parent, which shows the separate DeleteCardDialog confirmation.
 *
 * Move actions are the keyboard- and screen-reader-accessible alternative to
 * dragging. "Earlier" and "later" mean one place back or forward in reading
 * order (left to right, then top to bottom), whatever the column count.
 * Actions that cannot apply (e.g. "Move earlier" on the first card) are
 * disabled, and the whole group is hidden when there is only one card.
 * `onMove` resolves to an error message or null; on failure the menu stays
 * open with the message and the saved order is unchanged.
 *
 * There is intentionally no way to edit barcode data: to fix a wrong barcode
 * the user deletes the card and adds it again.
 *
 * `onRename` / `onRecolor` resolve to an error message or null; on failure the
 * step stays open with the message and the user's input.
 */
import { useId, useRef, useState, type FormEvent } from 'react'
import { Dialog } from '../../components/Dialog.tsx'
import { CARD_LIMITS, validateStoreName, type LoyaltyCard } from '../cards/card.ts'
import { ColorPicker } from '../cards/ColorPicker.tsx'
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
  onMove: (target: MoveTarget) => Promise<string | null>
  onDelete: () => void
}

type Step = 'menu' | 'rename' | 'color'

export function CardMenu({ card, position, count, onClose, onRename, onRecolor, onMove, onDelete }: CardMenuProps) {
  const [step, setStep] = useState<Step>('menu')
  const [moveError, setMoveError] = useState<string | null>(null)
  const [moving, setMoving] = useState(false)
  const titleId = useId()
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
    <Dialog key={step} labelledBy={titleId} onEscape={step === 'menu' ? onClose : () => setStep('menu')} className="dialog--menu">
      {step === 'menu' && (
        <>
          <h2 id={titleId} className="dialog__title">
            {card.storeName}
          </h2>
          <div className="menu-list">
            <button type="button" className="menu-list__item" onClick={() => setStep('rename')}>
              Rename
            </button>
            <button type="button" className="menu-list__item" onClick={() => setStep('color')}>
              Change colour
            </button>
            {count > 1 && (
              <div className="menu-list__group" role="group" aria-label={`Position ${position + 1} of ${count}`}>
                <button type="button" className="menu-list__item" disabled={atStart || moving} onClick={() => move('earlier')}>
                  Move earlier
                </button>
                <button type="button" className="menu-list__item" disabled={atEnd || moving} onClick={() => move('later')}>
                  Move later
                </button>
                <button type="button" className="menu-list__item" disabled={atStart || moving} onClick={() => move('first')}>
                  Move to first
                </button>
                <button type="button" className="menu-list__item" disabled={atEnd || moving} onClick={() => move('last')}>
                  Move to last
                </button>
              </div>
            )}
            <button type="button" className="menu-list__item menu-list__item--danger" onClick={onDelete}>
              Delete
            </button>
            <button type="button" className="menu-list__item menu-list__item--cancel" onClick={onClose}>
              Cancel
            </button>
          </div>
          <div role="alert">{moveError && <p className="notice notice--error">{moveError}</p>}</div>
        </>
      )}
      {step === 'rename' && <RenameStep titleId={titleId} card={card} onCancel={() => setStep('menu')} onSave={onRename} />}
      {step === 'color' && <ColorStep titleId={titleId} card={card} onCancel={() => setStep('menu')} onSave={onRecolor} />}
    </Dialog>
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
        Change colour
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

/**
 * Component tests for the card-editing menu's v0.6.1 presentation: the
 * colored identity header, the Close × that replaced the Cancel row, action
 * icons, labels, order and disabled states, and the unchanged closing and
 * focus behavior. Rendered with an in-memory card; the full flows (rename,
 * recolor, delete confirmation, persistence) are covered in App.test.tsx.
 *
 * Host tests in jsdom: structure, attributes and focus, not pixels.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { LoyaltyCard } from '../cards/card.ts'
import { CardMenu } from './CardMenu.tsx'

function makeCard(overrides: Partial<LoyaltyCard> = {}): LoyaltyCard {
  const at = '2026-01-01T00:00:00.000Z'
  return {
    id: 'a',
    schemaVersion: 2,
    storeName: 'Corner Coffee',
    color: 'teal',
    barcode: { kind: 'generated', format: 'code128', value: '1' },
    createdAt: at,
    updatedAt: at,
    ...overrides,
  }
}

/** Opens the menu from a real trigger so focus restoration can be observed. */
function Harness({ card, position = 1, count = 3, onDelete = () => {} }: { card: LoyaltyCard; position?: number; count?: number; onDelete?: () => void }) {
  const [open, setOpen] = useState(false)
  const done = async () => null
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Options
      </button>
      {open && (
        <CardMenu
          card={card}
          position={position}
          count={count}
          onClose={() => setOpen(false)}
          onRename={done}
          onRecolor={done}
          onChangeIcon={done}
          onMove={done}
          onDelete={onDelete}
        />
      )}
    </>
  )
}

async function openMenu(props: Parameters<typeof Harness>[0]) {
  const user = userEvent.setup()
  render(<Harness {...props} />)
  const trigger = screen.getByRole('button', { name: 'Options' })
  await user.click(trigger)
  return { user, trigger, dialog: screen.getByRole('dialog') }
}

// Exact v0.6.1 order. One-step Move up / Move down were removed (drag-and-drop covers them).
const ACTIONS = ['Rename', 'Change color', 'Change icon', 'Move to first', 'Move to last', 'Delete']

describe('CardMenu header', () => {
  it('shows the card’s color, icon and full name, labelling the dialog', async () => {
    const { dialog } = await openMenu({ card: makeCard({ icon: 'coffee' }) })
    expect(dialog).toHaveAccessibleName('Corner Coffee')
    const header = within(dialog).getByTestId('card-menu-header')
    expect(header).toHaveStyle({ background: '#727F89', color: '#E8ECEB' }) // teal = Brushed Steel
    expect(within(header).getByRole('heading', { level: 2, name: 'Corner Coffee' })).toBeInTheDocument()
    const icon = header.querySelector('svg[data-icon="coffee"]')
    expect(icon).toHaveAttribute('aria-hidden', 'true')
    // Icon before title, title before Close: the tile's reading order.
    const [iconSlot, title, close] = Array.from(header.children)
    expect(iconSlot).toContainElement(icon as HTMLElement)
    expect(title).toHaveTextContent('Corner Coffee')
    expect(close).toBe(within(header).getByRole('button', { name: 'Close' }))
  })

  it.each([
    ['Ivory: Charcoal', 'white', '#E5E0D1', '#1A1A1A'],
    ['Antique Gold: Soft Silver', 'yellow', '#9B7B20', '#E8ECEB'],
    ['Deep Violet: Soft Silver', 'purple', '#51436C', '#E8ECEB'],
  ])('draws the icon in the text color on %s', async (_name, color, background, text) => {
    const { dialog } = await openMenu({ card: makeCard({ color, icon: 'fuel' }) })
    const header = within(dialog).getByTestId('card-menu-header')
    expect(header).toHaveStyle({ background, color: text })
    const strokes = header.querySelector('svg[data-icon="fuel"] g')
    expect(strokes).toHaveAttribute('stroke', 'currentColor')
    expect(header.querySelector('[data-part="halo"]')).toBeNull()
  })

  it('omits the icon slot when no icon is chosen and keeps a long name complete', async () => {
    const long = 'The Extremely Long Neighborhood Hardware and Garden Supply Emporium Rewards'
    const { dialog } = await openMenu({ card: makeCard({ storeName: long }) })
    const header = within(dialog).getByTestId('card-menu-header')
    expect(header.querySelector('svg[data-icon]')).toBeNull()
    expect(within(header).getByRole('heading', { level: 2 })).toHaveTextContent(long)
    expect(dialog).toHaveAccessibleName(long)
  })
})

describe('CardMenu actions', () => {
  it('lists every action in order, each with a decorative icon, and no Cancel row', async () => {
    const { dialog } = await openMenu({ card: makeCard() })
    const rows = Array.from(dialog.querySelectorAll<HTMLButtonElement>('.menu-list__item'))
    expect(rows.map((row) => row.textContent)).toEqual(ACTIONS)
    for (const row of rows) {
      const icon = row.querySelector('svg')
      expect(icon, row.textContent ?? '').toHaveAttribute('aria-hidden', 'true')
      // Icon first, then the label (the row's accessible name).
      expect(row.firstElementChild).toBe(icon)
      expect(row).toHaveAccessibleName(row.textContent ?? '')
    }
    expect(within(dialog).queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Delete' })).toHaveClass('menu-list__item--danger')
  })

  it('offers no one-step Move up / Move down actions', async () => {
    const { dialog } = await openMenu({ card: makeCard() })
    expect(within(dialog).queryByRole('button', { name: /Move up|Move down/ })).not.toBeInTheDocument()
    expect(dialog).not.toHaveTextContent(/Move up|Move down/)
  })

  it('disables moves that cannot apply at the start and end of the wallet', async () => {
    const first = await openMenu({ card: makeCard(), position: 0, count: 3 })
    const group = within(first.dialog).getByRole('group', { name: 'Position 1 of 3' })
    expect(within(group).getAllByRole('button').map((b) => b.textContent)).toEqual(['Move to first', 'Move to last'])
    expect(within(group).getByRole('button', { name: 'Move to first' })).toBeDisabled()
    expect(within(group).getByRole('button', { name: 'Move to last' })).toBeEnabled()
  })

  it('enables both moves in the middle of the wallet', async () => {
    const { dialog } = await openMenu({ card: makeCard(), position: 1, count: 3 })
    expect(within(dialog).getByRole('button', { name: 'Move to first' })).toBeEnabled()
    expect(within(dialog).getByRole('button', { name: 'Move to last' })).toBeEnabled()
  })

  it('disables Move to last on the last card', async () => {
    const { dialog } = await openMenu({ card: makeCard(), position: 2, count: 3 })
    expect(within(dialog).getByRole('button', { name: 'Move to last' })).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: 'Move to first' })).toBeEnabled()
  })

  it('keeps both moves visible but disabled for a single card', async () => {
    const single = await openMenu({ card: makeCard(), position: 0, count: 1 })
    expect(within(single.dialog).getByRole('group', { name: 'Position 1 of 1' })).toBeInTheDocument()
    expect(Array.from(single.dialog.querySelectorAll('.menu-list__item'), (row) => row.textContent)).toEqual(ACTIONS)
    expect(within(single.dialog).getByRole('button', { name: 'Move to first' })).toBeDisabled()
    expect(within(single.dialog).getByRole('button', { name: 'Move to last' })).toBeDisabled()
  })

  it.each([
    ['Move to first', 'first'],
    ['Move to last', 'last'],
  ])('%s calls onMove with the %s target; a failure keeps the menu open with the message', async (label, target) => {
    const onMove = vi.fn(async () => 'Couldn’t save the new card order.')
    const user = userEvent.setup()
    render(
      <CardMenu
        card={makeCard()}
        position={1}
        count={3}
        onClose={() => {}}
        onRename={async () => null}
        onRecolor={async () => null}
        onChangeIcon={async () => null}
        onMove={onMove}
        onDelete={() => {}}
      />,
    )
    await user.click(screen.getByRole('button', { name: label }))
    expect(onMove).toHaveBeenCalledWith(target)
    expect(await screen.findByText('Couldn’t save the new card order.')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    // Re-enabled after the failure so the user can retry.
    expect(screen.getByRole('button', { name: label })).toBeEnabled()
  })

  it('hands Delete to the parent (which shows the confirmation)', async () => {
    const onDelete = vi.fn()
    const { user, dialog } = await openMenu({ card: makeCard(), onDelete })
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))
    expect(onDelete).toHaveBeenCalledTimes(1)
  })
})

/*
 * Short-viewport structure (v0.6.1 correction). The CSS caps the menu-step
 * panel to the viewport and scrolls only `.card-menu__actions`; that only
 * keeps the Close × reachable if the header sits outside the scroll region.
 * jsdom does no layout, so this checks the DOM contract; the CSS side is in
 * cardLayout.node.test.ts and real rendering is a browser / iPhone check.
 */
describe('CardMenu short-viewport structure', () => {
  it('keeps the header and Close outside the action scroll region', async () => {
    const { dialog } = await openMenu({ card: makeCard() })
    expect(dialog).toHaveClass('dialog--menu-actions')
    const header = within(dialog).getByTestId('card-menu-header')
    const actions = within(dialog).getByTestId('card-menu-actions')
    expect(actions).toHaveClass('card-menu__actions')
    // Header and scroll region are siblings, header first, both direct children of the panel.
    expect(Array.from(dialog.children)).toEqual([header, actions])
    expect(actions).not.toContainElement(within(dialog).getByRole('button', { name: 'Close' }))
    expect(header).toContainElement(within(dialog).getByRole('button', { name: 'Close' }))
  })

  it('puts every action row, in order, and the move-error alert inside the scroll region', async () => {
    const { dialog } = await openMenu({ card: makeCard() })
    const actions = within(dialog).getByTestId('card-menu-actions')
    const rows = Array.from(actions.querySelectorAll('.menu-list__item'), (row) => row.textContent)
    expect(rows).toEqual(ACTIONS)
    expect(dialog.querySelectorAll('.menu-list__item')).toHaveLength(ACTIONS.length)
    expect(within(actions).getByRole('alert')).toBeInTheDocument()
  })

  it('drops the height cap in the rename, color and icon steps', async () => {
    for (const action of ['Rename', 'Change color', 'Change icon']) {
      const { user, dialog } = await openMenu({ card: makeCard() })
      await user.click(within(dialog).getByRole('button', { name: action }))
      const step = screen.getByRole('dialog')
      expect(step).toHaveClass('dialog--menu')
      expect(step).not.toHaveClass('dialog--menu-actions')
      expect(within(step).queryByTestId('card-menu-actions')).not.toBeInTheDocument()
      // Returning to the menu restores the capped layout.
      await user.click(within(step).getByRole('button', { name: 'Cancel' }))
      expect(screen.getByRole('dialog')).toHaveClass('dialog--menu-actions')
      cleanup()
    }
  })
})

describe('CardMenu closing and focus', () => {
  it('focuses Rename on open, not the Close button', async () => {
    const { dialog } = await openMenu({ card: makeCard() })
    expect(within(dialog).getByRole('button', { name: 'Rename' })).toHaveFocus()
  })

  it('closes with the × and returns focus to the trigger', async () => {
    const { user, trigger, dialog } = await openMenu({ card: makeCard() })
    await user.click(within(dialog).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('closes with Escape and with a tap on the backdrop', async () => {
    const { user, trigger } = await openMenu({ card: makeCard() })
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()

    await user.click(trigger)
    const backdrop = screen.getByRole('dialog').parentElement!
    expect(backdrop).toHaveClass('dialog-backdrop')
    fireEvent.pointerDown(backdrop)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('keeps Tab cycling inside the menu, through the × and the actions', async () => {
    const { user, dialog } = await openMenu({ card: makeCard(), position: 0, count: 1 })
    expect(within(dialog).getByRole('button', { name: 'Rename' })).toHaveFocus()
    await user.tab({ shift: true })
    expect(within(dialog).getByRole('button', { name: 'Close' })).toHaveFocus()
    await user.tab({ shift: true })
    expect(within(dialog).getByRole('button', { name: 'Delete' })).toHaveFocus()
  })

  it('keeps Cancel in the rename step, returning to the menu', async () => {
    const { user, dialog } = await openMenu({ card: makeCard() })
    await user.click(within(dialog).getByRole('button', { name: 'Rename' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByTestId('card-menu-header')).toBeInTheDocument()
  })
})

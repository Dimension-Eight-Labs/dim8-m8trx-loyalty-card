import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { DeleteCardDialog } from './DeleteCardDialog.tsx'

/** Opens the dialog from a real trigger so focus restoration can be observed. */
function Harness({ onConfirm }: { onConfirm: () => Promise<string | null> }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      {open && (
        <DeleteCardDialog
          storeName="Corner Coffee"
          onCancel={() => setOpen(false)}
          onConfirm={async () => {
            const error = await onConfirm()
            if (!error) setOpen(false)
            return error
          }}
        />
      )}
    </>
  )
}

async function openDialog(onConfirm = vi.fn(async () => null as string | null)) {
  const user = userEvent.setup()
  render(<Harness onConfirm={onConfirm} />)
  await user.click(screen.getByRole('button', { name: 'Open' }))
  return { user, onConfirm }
}

describe('DeleteCardDialog', () => {
  it('is a labelled modal alertdialog with Cancel focused first', async () => {
    await openDialog()
    const dialog = screen.getByRole('alertdialog', { name: 'Delete this card?' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAccessibleDescription(/Corner Coffee will be removed/)
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
  })

  it('closes on Escape and returns focus to the trigger', async () => {
    const { user, onConfirm } = await openDialog()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open' })).toHaveFocus()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('keeps Tab focus inside the dialog', async () => {
    const { user } = await openDialog()
    const cancel = screen.getByRole('button', { name: 'Cancel' })
    const confirm = screen.getByRole('button', { name: 'Delete card' })

    await user.tab()
    expect(confirm).toHaveFocus()
    await user.tab()
    expect(cancel).toHaveFocus()
    await user.tab({ shift: true })
    expect(confirm).toHaveFocus()
  })

  it('confirms from the keyboard', async () => {
    const { user, onConfirm } = await openDialog()
    await user.tab()
    await user.keyboard('{Enter}')
    expect(onConfirm).toHaveBeenCalledOnce()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('stays open and announces a failure', async () => {
    const { user } = await openDialog(vi.fn(async () => 'Couldn’t delete the card.'))
    await user.click(screen.getByRole('button', { name: 'Delete card' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t delete the card.')
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
  })
})

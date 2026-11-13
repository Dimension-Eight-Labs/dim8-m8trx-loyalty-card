import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { CardEmptyState } from './CardEmptyState.tsx'

describe('CardEmptyState', () => {
  it('renders the heading, explanation, and an accessible Add Card button', () => {
    render(<CardEmptyState onAddCard={() => {}} />)

    expect(screen.getByRole('heading', { level: 1, name: 'No cards yet' })).toBeInTheDocument()
    expect(screen.getByText(/loyalty and membership cards/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add Card' })).toBeEnabled()
  })

  it('labels its region with the heading', () => {
    render(<CardEmptyState onAddCard={() => {}} />)

    expect(screen.getByRole('region', { name: 'No cards yet' })).toBeInTheDocument()
  })

  it('invokes onAddCard when Add Card is clicked', async () => {
    const user = userEvent.setup()
    const onAddCard = vi.fn()
    render(<CardEmptyState onAddCard={onAddCard} />)

    await user.click(screen.getByRole('button', { name: 'Add Card' }))

    expect(onAddCard).toHaveBeenCalledOnce()
  })

  it('invokes onAddCard when Add Card is activated from the keyboard', async () => {
    const user = userEvent.setup()
    const onAddCard = vi.fn()
    render(<CardEmptyState onAddCard={onAddCard} />)

    await user.tab()
    expect(screen.getByRole('button', { name: 'Add Card' })).toHaveFocus()
    await user.keyboard('{Enter}')

    expect(onAddCard).toHaveBeenCalledOnce()
  })
})

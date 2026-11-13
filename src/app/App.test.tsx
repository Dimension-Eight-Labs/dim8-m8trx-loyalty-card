import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { ADD_CARD_UNAVAILABLE_MESSAGE, App } from './App.tsx'

describe('App', () => {
  it('renders the header and main landmarks with the empty state', () => {
    render(<App />)

    expect(screen.getByRole('banner')).toHaveTextContent('Loyalty Card')
    expect(screen.getByRole('main')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'No cards yet' })).toBeInTheDocument()
  })

  it('announces that card entry is not yet available instead of failing silently', async () => {
    const user = userEvent.setup()
    render(<App />)

    expect(screen.getByRole('status')).toBeEmptyDOMElement()
    await user.click(screen.getByRole('button', { name: 'Add Card' }))

    expect(screen.getByRole('status')).toHaveTextContent(ADD_CARD_UNAVAILABLE_MESSAGE)
  })
})

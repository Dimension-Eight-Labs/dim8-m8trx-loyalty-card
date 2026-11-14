/**
 * Application composition root.
 *
 * Owns which screen is showing (wallet / add / checkout) and which management
 * dialog is open, and wires feature components to the card controller
 * (useCards). Storage is injected as a CardRepository and capture as optional
 * CaptureServices, so App knows nothing about IndexedDB, cameras, or decoders.
 *
 * Screens are plain view state rather than URL routes: this is a single-screen
 * PWA with no deep links, and the service worker serves index.html for every
 * navigation anyway.
 *
 * Code splitting: the add-card flow (ZXing decoder, cropper, camera code) is
 * loaded on demand. Checkout draws barcodes with bwip-js, which stays in the
 * main bundle so tapping a tile shows the card immediately, even offline.
 *
 * Accessibility: after an in-app screen change, the new screen's heading takes
 * focus (see ViewHeading); closing checkout returns focus to the tile that
 * opened it. While a dialog is open the rest of the app is `inert`.
 *
 * Ordering: `cards` from useCards is the user's saved wallet order, and it
 * also defines checkout's left/right sequence. Reordering comes from a tile
 * drag (WalletScreen) or the menu's move actions; both save the complete new
 * order through `reorderCards` and announce the card's new position in the
 * polite status region. A failed save leaves the previous order in place.
 *
 * Branding and portability (v0.5.0): every screen shows the shared M8TRX
 * header (AppHeader). The Add Card screen's footer (AddCardFooter) offers
 * backup export/restore and About. A validated restore plan is confirmed in
 * RestoreDialog, owned here like the other dialogs so the rest of the app is
 * inert meanwhile; the import itself is one atomic repository transaction.
 */
import { lazy, Suspense, useRef, useState } from 'react'
import { AppHeader } from '../components/AppHeader.tsx'
import { PlusIcon } from '../components/icons.tsx'
import { AboutView } from '../features/about/AboutView.tsx'
import type { CaptureServices } from '../features/add/captureServices.ts'
import type { RestorePlan } from '../features/backup/backupFormat.ts'
import { RestoreDialog } from '../features/backup/RestoreDialog.tsx'
import type { SaveFile } from '../features/backup/saveFile.ts'
import { CardEmptyState } from '../features/cards/CardEmptyState.tsx'
import type { CardRepository } from '../features/cards/CardRepository.ts'
import { DeleteCardDialog } from '../features/cards/DeleteCardDialog.tsx'
import { colorForIndex } from '../features/cards/tileColors.ts'
import { useCards } from '../features/cards/useCards.ts'
import { CheckoutScreen } from '../features/checkout/CheckoutScreen.tsx'
import { CardMenu } from '../features/wallet/CardMenu.tsx'
import { movedOrder } from '../features/wallet/walletOrder.ts'
import { WalletScreen } from '../features/wallet/WalletScreen.tsx'
import { AddCardFooter } from './AddCardFooter.tsx'

const AddCardFlow = lazy(() => import('../features/add/AddCardFlow.tsx').then((module) => ({ default: module.AddCardFlow })))

export type View =
  | { name: 'wallet'; focusCardId?: string }
  | { name: 'add' }
  | { name: 'about' }
  | { name: 'checkout'; cardId: string }

type DialogState =
  | { name: 'menu'; cardId: string }
  | { name: 'delete'; cardId: string }
  | { name: 'restore'; plan: RestorePlan }
  | null

export interface AppProps {
  repository: CardRepository
  /** Camera/image/decoder adapters; defaults to the browser implementations. Injectable for tests. */
  capture?: CaptureServices
  /** Hands a finished backup file to the user; defaults to share sheet / download. Injectable for tests. */
  saveFile?: SaveFile
}

export const LOADING_MESSAGE = 'Loading your cards…'

export function App({ repository, capture, saveFile }: AppProps) {
  const { status, cards, loadError, reload, createCard, updateCard, deleteCard, reorderCards, importCards, loadSnapshot } =
    useCards(repository)
  const [view, setView] = useState<View>({ name: 'wallet' })
  const [dialog, setDialog] = useState<DialogState>(null)
  // False until the first in-app navigation, so initial load does not move focus.
  const [hasNavigated, setHasNavigated] = useState(false)
  const [statusMessage, setStatusMessage] = useState('')
  const addButtonRef = useRef<HTMLButtonElement>(null)
  // Asks a wallet tile to take focus again (after a keyboard move).
  const [tileFocus, setTileFocus] = useState<{ cardId: string; seq: number } | undefined>(undefined)

  /** Saves a new order and announces where `cardId` ended up. Resolves to an error message or null. */
  const saveOrder = async (orderedIds: string[], cardId: string): Promise<string | null> => {
    const result = await reorderCards(orderedIds)
    if (!result.ok) {
      setStatusMessage(result.message)
      return result.message
    }
    const card = cards.find((item) => item.id === cardId)
    const position = orderedIds.indexOf(cardId) + 1
    setStatusMessage(card ? `${card.storeName} moved to position ${position} of ${orderedIds.length}.` : '')
    return null
  }

  /** The dragged card is the one whose index changed the most; good enough for the announcement. */
  const saveDraggedOrder = (orderedIds: string[]) => {
    const current = cards.map((card) => card.id)
    const moved =
      orderedIds.reduce<{ id: string; distance: number } | null>((best, id, index) => {
        const distance = Math.abs(index - current.indexOf(id))
        return !best || distance > best.distance ? { id, distance } : best
      }, null)?.id ?? orderedIds[0] ?? ''
    return saveOrder(orderedIds, moved)
  }

  const navigate = (next: View, message = '') => {
    setHasNavigated(true)
    setStatusMessage(message)
    setView(next)
  }

  const dialogCard = dialog && dialog.name !== 'restore' ? cards.find((card) => card.id === dialog.cardId) : undefined

  // Checkout replaces the whole app shell: nothing else on screen.
  if (status === 'ready' && view.name === 'checkout' && cards.some((card) => card.id === view.cardId)) {
    return (
      <CheckoutScreen
        cards={cards}
        cardId={view.cardId}
        onChangeCard={(cardId) => setView({ name: 'checkout', cardId })}
        onClose={() => navigate({ name: 'wallet', focusCardId: view.cardId })}
      />
    )
  }

  const renderContent = () => {
    if (status === 'loading') {
      return (
        <p className="app-loading" role="status">
          {LOADING_MESSAGE}
        </p>
      )
    }

    if (status === 'error') {
      return (
        <section className="load-error" aria-labelledby="load-error-heading">
          <h1 id="load-error-heading" className="view-heading">
            Your cards couldn’t be loaded
          </h1>
          <p role="alert" className="notice notice--error">
            {loadError}
          </p>
          <button type="button" className="button button--primary" onClick={reload}>
            Try again
          </button>
        </section>
      )
    }

    if (view.name === 'add') {
      return (
        <Suspense
          fallback={
            <p className="app-loading" role="status">
              Loading…
            </p>
          }
        >
          <AddCardFlow
            services={capture}
            defaultColor={colorForIndex(cards.length)}
            onCancel={() => navigate({ name: 'wallet' })}
            onSave={async (input) => {
              const result = await createCard(input)
              if (!result.ok) return result.message
              navigate({ name: 'wallet', focusCardId: result.value.id }, 'Card saved.')
              return null
            }}
            footer={
              <AddCardFooter
                cardCount={cards.length}
                loadSnapshot={loadSnapshot}
                onRestorePlanned={(plan) => setDialog({ name: 'restore', plan })}
                saveFile={saveFile}
                onAbout={() => navigate({ name: 'about' })}
              />
            }
          />
        </Suspense>
      )
    }

    if (view.name === 'about') {
      return <AboutView focusOnMount={hasNavigated} onBack={() => navigate({ name: 'add' })} />
    }

    if (cards.length === 0) {
      return <CardEmptyState focusOnMount={hasNavigated} onAddCard={() => navigate({ name: 'add' })} />
    }

    return (
      <WalletScreen
        cards={cards}
        focusOnMount={hasNavigated && view.name === 'wallet' && !view.focusCardId}
        focusCardId={view.name === 'wallet' ? view.focusCardId : undefined}
        onOpenCard={(cardId) => navigate({ name: 'checkout', cardId })}
        onOpenMenu={(cardId) => setDialog({ name: 'menu', cardId })}
        onReorder={saveDraggedOrder}
        focusRequest={tileFocus}
      />
    )
  }

  const showAdd = status === 'ready' && view.name === 'wallet' && cards.length > 0
  const centred = status !== 'ready' || (view.name === 'wallet' && cards.length === 0)
  const restorePlan = dialog?.name === 'restore' ? dialog.plan : null
  const showDialog = restorePlan !== null || (dialog !== null && dialogCard !== undefined)

  return (
    <>
      <div className="app-shell" inert={showDialog}>
        <AppHeader
          action={
            showAdd && (
              <button
                ref={addButtonRef}
                type="button"
                className="icon-button"
                aria-label="Add card"
                onClick={() => navigate({ name: 'add' })}
              >
                <PlusIcon />
              </button>
            )
          }
        />
        <main className={centred ? 'app-main app-main--centred' : 'app-main'}>
          {renderContent()}
          {/* Polite live region so screen readers hear confirmations without losing focus. */}
          <p className="app-status" role="status" aria-live="polite">
            {statusMessage}
          </p>
        </main>
      </div>

      {restorePlan && (
        <RestoreDialog
          plan={restorePlan}
          onCancel={() => setDialog(null)}
          onConfirm={async () => {
            const result = await importCards(restorePlan.toImport, restorePlan.expectedOrder)
            if (!result.ok) return result.message
            setDialog(null)
            const restored = result.value
            navigate({ name: 'wallet' }, `Restored ${restored} ${restored === 1 ? 'card' : 'cards'} from your backup.`)
            return null
          }}
        />
      )}

      {showDialog && dialogCard && dialog?.name === 'menu' && (
        <CardMenu
          card={dialogCard}
          position={cards.indexOf(dialogCard)}
          count={cards.length}
          onClose={() => setDialog(null)}
          onMove={async (target) => {
            const orderedIds = movedOrder(cards.map((card) => card.id), dialogCard.id, target)
            const message = await saveOrder(orderedIds, dialogCard.id)
            if (message) return message
            setDialog(null)
            // Focus the moved card itself (not the ⋯ button the menu would
            // restore), so keyboard users keep their place.
            setTileFocus((previous) => ({ cardId: dialogCard.id, seq: (previous?.seq ?? 0) + 1 }))
            return null
          }}
          onDelete={() => setDialog({ name: 'delete', cardId: dialogCard.id })}
          onRename={async (storeName) => {
            const result = await updateCard(dialogCard.id, { storeName })
            if (!result.ok) return result.message
            setDialog(null)
            setStatusMessage('Card renamed.')
            return null
          }}
          onRecolor={async (color) => {
            const result = await updateCard(dialogCard.id, { color })
            if (!result.ok) return result.message
            setDialog(null)
            setStatusMessage('Colour changed.')
            return null
          }}
        />
      )}

      {showDialog && dialogCard && dialog?.name === 'delete' && (
        <DeleteCardDialog
          storeName={dialogCard.storeName}
          onCancel={() => setDialog(null)}
          onConfirm={async () => {
            const result = await deleteCard(dialogCard.id)
            if (!result.ok) return result.message
            setDialog(null)
            setStatusMessage('Card deleted.')
            setHasNavigated(true)
            // The tile that opened the menu is gone; move focus somewhere stable.
            requestAnimationFrame(() => addButtonRef.current?.focus())
            return null
          }}
        />
      )}
    </>
  )
}

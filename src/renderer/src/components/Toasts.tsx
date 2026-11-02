import type { ReactNode } from 'react'
import { CloseIcon } from './Icons'

export interface ToastItem {
  id: string
  message: string
  tone?: 'error' | 'info'
}

export function Toasts({
  items,
  onDismiss
}: {
  items: ToastItem[]
  onDismiss: (id: string) => void
}): ReactNode {
  if (items.length === 0) return null
  return (
    <div className="toasts" aria-live="polite">
      {items.map((item) => (
        <div key={item.id} className={`toast${item.tone === 'error' ? ' toast-error' : ''}`}>
          <span>{item.message}</span>
          <button
            type="button"
            className="toast-close"
            onClick={() => onDismiss(item.id)}
            aria-label="Dismiss"
          >
            <CloseIcon />
          </button>
        </div>
      ))}
    </div>
  )
}

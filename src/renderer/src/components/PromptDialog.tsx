import { useState, type FormEvent, type ReactNode } from 'react'
import type { Locale } from '../../../shared/types'
import { translate } from '../i18n'
import { Modal } from './Modal'

export function PromptDialog({
  title,
  label,
  initial = '',
  locale,
  onClose,
  onSubmit
}: {
  title: string
  label: string
  initial?: string
  locale: Locale
  onClose: () => void
  onSubmit: (value: string) => Promise<string | null>
}): ReactNode {
  const [value, setValue] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    const next = value.trim()
    if (!next) {
      setError(translate(locale, 'requiredField'))
      return
    }
    setBusy(true)
    setError(null)
    const message = await onSubmit(next)
    setBusy(false)
    if (message) {
      setError(message)
      return
    }
    onClose()
  }

  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="button ghost" type="button" onClick={onClose} disabled={busy}>
            {translate(locale, 'cancel')}
          </button>
          <button
            className="button primary"
            type="submit"
            form="prompt-form"
            disabled={busy || !value.trim()}
          >
            {busy ? translate(locale, 'loading') : translate(locale, 'submit')}
          </button>
        </>
      }
    >
      <form id="prompt-form" className="form" onSubmit={(event) => void submit(event)}>
        <label className="field">
          <span>{label}</span>
          <input
            value={value}
            onChange={(event) => setValue(event.target.value)}
            autoFocus
            maxLength={255}
            spellCheck={false}
          />
        </label>
        {error ? <div className="form-error">{error}</div> : null}
      </form>
    </Modal>
  )
}

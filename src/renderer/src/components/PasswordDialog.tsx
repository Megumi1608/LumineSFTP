import { useState, type FormEvent, type ReactNode } from 'react'
import type { Locale, Profile } from '../../../shared/types'
import { translate } from '../i18n'
import { LockIcon } from './Icons'
import { Modal } from './Modal'

export function PasswordDialog({
  profile,
  locale,
  busy,
  onClose,
  onSubmit
}: {
  profile: Profile
  locale: Locale
  busy: boolean
  onClose: () => void
  onSubmit: (password: string) => void
}): ReactNode {
  const [password, setPassword] = useState('')

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    if (!password) return
    onSubmit(password)
  }

  return (
    <Modal
      title={translate(locale, 'passwordFor', { name: profile.name })}
      subtitle={`${profile.username}@${profile.host}:${profile.port}`}
      onClose={onClose}
      footer={
        <>
          <button className="button ghost" type="button" onClick={onClose} disabled={busy}>
            {translate(locale, 'cancel')}
          </button>
          <button
            className="button primary"
            type="submit"
            form="password-form"
            disabled={busy || !password}
          >
            {busy ? translate(locale, 'loading') : translate(locale, 'connectAction')}
          </button>
        </>
      }
    >
      <form id="password-form" className="form" onSubmit={submit}>
        <label className="field">
          <span>{translate(locale, 'passwordLabel')}</span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoFocus
            autoComplete="current-password"
            disabled={busy}
          />
        </label>
        <p className="hint">
          <LockIcon /> {translate(locale, 'passwordHint')}
        </p>
      </form>
    </Modal>
  )
}

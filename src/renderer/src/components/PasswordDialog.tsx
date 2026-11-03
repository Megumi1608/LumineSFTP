import { useState, type FormEvent, type ReactNode } from 'react'
import type { ConnectSecret, Locale, Profile } from '../../../shared/types'
import { translate } from '../i18n'
import { LockIcon } from './Icons'
import { Modal } from './Modal'

export function PasswordDialog({
  profile,
  locale,
  busy,
  canSave,
  error,
  onClose,
  onSubmit
}: {
  profile: Profile
  locale: Locale
  busy: boolean
  canSave: boolean
  error?: string | null
  onClose: () => void
  onSubmit: (secret: ConnectSecret) => void
}): ReactNode {
  const [value, setValue] = useState('')
  const [save, setSave] = useState(false)
  const isKey = profile.authMethod === 'key'

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    if (!value) return
    onSubmit(
      isKey
        ? { passphrase: value, saveSecret: save && canSave }
        : { password: value, saveSecret: save && canSave }
    )
  }

  return (
    <Modal
      title={
        isKey
          ? translate(locale, 'passphraseFor', { name: profile.name })
          : translate(locale, 'passwordFor', { name: profile.name })
      }
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
            disabled={busy || !value}
          >
            {busy ? translate(locale, 'loading') : translate(locale, 'connectAction')}
          </button>
        </>
      }
    >
      <form id="password-form" className="form" onSubmit={submit}>
        <label className="field">
          <span>{isKey ? translate(locale, 'passphraseLabel') : translate(locale, 'passwordLabel')}</span>
          <input
            type="password"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            autoFocus
            autoComplete="off"
            disabled={busy}
          />
        </label>
        {isKey ? <p className="hint">{translate(locale, 'passphraseHint')}</p> : null}

        {canSave ? (
          <label className="field checkbox-field">
            <input
              type="checkbox"
              checked={save}
              onChange={(event) => setSave(event.target.checked)}
              disabled={busy}
            />
            <span>{translate(locale, 'saveSecret')}</span>
          </label>
        ) : (
          <p className="hint">{translate(locale, 'saveSecretUnavailable')}</p>
        )}
        {canSave ? <p className="hint">{translate(locale, 'saveSecretHint')}</p> : null}

        {profile.hasSavedPassword ? (
          <p className="hint">
            <LockIcon /> {translate(locale, 'savedSecret')}
          </p>
        ) : null}
        {error ? <div className="form-error">{error}</div> : null}
      </form>
    </Modal>
  )
}

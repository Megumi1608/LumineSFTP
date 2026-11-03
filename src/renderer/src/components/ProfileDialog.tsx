import { useState, type FormEvent, type ReactNode } from 'react'
import { qrErrorMessages, validateQrObject } from '../../../shared/qr'
import type { AuthMethod, Locale, Profile } from '../../../shared/types'
import { errorText, translate } from '../i18n'
import { Modal } from './Modal'

export function ProfileDialog({
  mode,
  profile,
  locale,
  onClose,
  onSaved,
  onOpenQr
}: {
  mode: 'add' | 'edit'
  profile?: Profile
  locale: Locale
  onClose: () => void
  onSaved: (profile: Profile) => void
  onOpenQr?: () => void
}): ReactNode {
  const [name, setName] = useState(profile?.name ?? '')
  const [host, setHost] = useState(profile?.host ?? '')
  const [port, setPort] = useState(String(profile?.port ?? 22))
  const [username, setUsername] = useState(profile?.username ?? '')
  const [authMethod, setAuthMethod] = useState<AuthMethod>(profile?.authMethod ?? 'password')
  const [keyPath, setKeyPath] = useState(profile?.keyPath ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const pickKey = async (): Promise<void> => {
    setError(null)
    const result = await window.lumine.profiles.pickKey()
    if (result.ok) {
      if (result.data) setKeyPath(result.data)
      return
    }
    if (result.code !== 'DIALOG_CANCELLED') {
      setError(errorText(locale, result.code, result.detail))
    }
  }

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    setError(null)

    if (authMethod === 'key' && !keyPath.trim()) {
      setError(translate(locale, 'requiredField'))
      return
    }

    const parsed = validateQrObject({
      host: host.trim(),
      port: port.trim(),
      username: username.trim(),
      name: name.trim() || undefined
    })
    if (!parsed.ok) {
      setError(qrErrorMessages[parsed.error][locale])
      return
    }

    setBusy(true)
    const result = await window.lumine.profiles.save({
      name: parsed.value.name ?? parsed.value.host,
      host: parsed.value.host,
      port: parsed.value.port,
      username: parsed.value.username,
      authMethod,
      keyPath: authMethod === 'key' ? keyPath.trim() : null,
      ...(profile ? { id: profile.id } : {})
    })
    setBusy(false)

    if (!result.ok) {
      setError(errorText(locale, result.code, result.detail))
      return
    }
    onSaved(result.data)
  }

  return (
    <Modal
      title={mode === 'add' ? translate(locale, 'addProfile') : translate(locale, 'editProfile')}
      subtitle={translate(locale, 'securityNote')}
      onClose={onClose}
      footer={
        <>
          <button className="button ghost" type="button" onClick={onClose}>
            {translate(locale, 'cancel')}
          </button>
          <button className="button primary" type="submit" form="profile-form" disabled={busy}>
            {busy ? translate(locale, 'loading') : translate(locale, 'save')}
          </button>
        </>
      }
    >
      <form id="profile-form" className="form" onSubmit={submit}>
        {mode === 'add' && onOpenQr ? (
          <button className="button subtle full" type="button" onClick={onOpenQr}>
            {translate(locale, 'importQr')}
          </button>
        ) : null}

        <label className="field">
          <span>{translate(locale, 'nameOptional')}</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={translate(locale, 'profileNamePlaceholder')}
            maxLength={80}
            autoFocus
          />
        </label>

        <div className="field-row">
          <label className="field grow">
            <span>{translate(locale, 'hostLabel')}</span>
            <input
              value={host}
              onChange={(event) => setHost(event.target.value)}
              placeholder={translate(locale, 'hostPlaceholder')}
              maxLength={253}
              required
              spellCheck={false}
            />
          </label>
          <label className="field port">
            <span>{translate(locale, 'portLabel')}</span>
            <input
              value={port}
              onChange={(event) => setPort(event.target.value)}
              placeholder={translate(locale, 'portPlaceholder')}
              inputMode="numeric"
              maxLength={5}
              required
            />
          </label>
        </div>

        <label className="field">
          <span>{translate(locale, 'usernameLabel')}</span>
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder={translate(locale, 'usernamePlaceholder')}
            maxLength={128}
            required
            spellCheck={false}
            autoComplete="off"
          />
        </label>

        <label className="field">
          <span>{translate(locale, 'authMethod')}</span>
          <select
            value={authMethod}
            onChange={(event) => setAuthMethod(event.target.value as AuthMethod)}
          >
            <option value="password">{translate(locale, 'authPassword')}</option>
            <option value="key">{translate(locale, 'authKey')}</option>
          </select>
        </label>

        {authMethod === 'key' ? (
          <div className="field">
            <span>{translate(locale, 'keyPathLabel')}</span>
            <div className="field-row">
              <input
                className="grow"
                value={keyPath}
                onChange={(event) => setKeyPath(event.target.value)}
                placeholder={translate(locale, 'keyPathLabel')}
                spellCheck={false}
              />
              <button className="button tiny" type="button" onClick={() => void pickKey()}>
                {translate(locale, 'chooseKey')}
              </button>
            </div>
            <p className="hint">{translate(locale, 'keyHint')}</p>
          </div>
        ) : null}

        {error ? <div className="form-error">{error}</div> : null}
      </form>
    </Modal>
  )
}

import { useEffect, useState, type ReactNode } from 'react'
import type { KnownHost, Locale, UpdateStatus } from '../../../shared/types'
import { errorText, translate } from '../i18n'
import { Modal } from './Modal'

function updateMessage(locale: Locale, update: UpdateStatus): string {
  switch (update.state) {
    case 'checking':
      return translate(locale, 'updateChecking')
    case 'available':
      return translate(locale, 'updateAvailable', { version: update.version ?? '' })
    case 'not-available':
      return translate(locale, 'updateUpToDate')
    case 'downloading':
      return translate(locale, 'updateDownloading', { percent: update.percent ?? 0 })
    case 'downloaded':
      return translate(locale, 'updateReady')
    case 'error':
      return translate(locale, 'updateError')
    case 'unsupported':
      return update.message === 'dev'
        ? translate(locale, 'updateDev')
        : translate(locale, 'updateUnsupported')
    default:
      return translate(locale, 'updateIdle')
  }
}

export function SettingsDialog({
  locale,
  version,
  onLocaleChange,
  onClose
}: {
  locale: Locale
  version: string
  onLocaleChange: (locale: Locale) => void
  onClose: () => void
}): ReactNode {
  const [knownHosts, setKnownHosts] = useState<KnownHost[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [confirmKey, setConfirmKey] = useState<string | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [update, setUpdate] = useState<UpdateStatus>({
    state: 'idle',
    canAutoUpdate: false
  })
  const [updateBusy, setUpdateBusy] = useState(false)

  const load = async (): Promise<void> => {
    setLoading(true)
    const result = await window.lumine.knownHosts.list()
    setLoading(false)
    if (result.ok) {
      setKnownHosts(result.data)
      setError(null)
    } else {
      setError(errorText(locale, result.code, result.detail))
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    let alive = true
    void window.lumine.updates.get().then((result) => {
      if (alive && result.ok) setUpdate(result.data)
    })
    const off = window.lumine.onUpdate((next) => {
      if (alive) setUpdate(next)
    })
    return () => {
      alive = false
      off()
    }
  }, [])

  const checkUpdates = async (): Promise<void> => {
    setUpdateBusy(true)
    setError(null)
    const result = await window.lumine.updates.check()
    setUpdateBusy(false)
    if (result.ok) setUpdate(result.data)
    else setError(errorText(locale, result.code, result.detail))
  }

  const downloadUpdates = async (): Promise<void> => {
    setUpdateBusy(true)
    setError(null)
    const result = await window.lumine.updates.download()
    setUpdateBusy(false)
    if (result.ok) setUpdate(result.data)
    else setError(errorText(locale, result.code, result.detail))
  }

  const installUpdates = async (): Promise<void> => {
    setError(null)
    const result = await window.lumine.updates.install()
    if (!result.ok) setError(errorText(locale, result.code, result.detail))
  }

  const openReleasePage = async (): Promise<void> => {
    setError(null)
    const result = await window.lumine.updates.openRelease()
    if (!result.ok) setError(errorText(locale, result.code, result.detail))
  }

  const changeLocale = async (next: Locale): Promise<void> => {
    setError(null)
    const result = await window.lumine.settings.setLocale(next)
    if (result.ok) {
      onLocaleChange(next)
    } else {
      setError(errorText(locale, result.code, result.detail))
    }
  }

  const forget = async (key: string): Promise<void> => {
    if (confirmKey !== key) {
      setConfirmKey(key)
      return
    }
    setBusyKey(key)
    const result = await window.lumine.knownHosts.forget(key)
    setBusyKey(null)
    setConfirmKey(null)
    if (!result.ok) {
      setError(errorText(locale, result.code, result.detail))
      return
    }
    setKnownHosts((current) => current.filter((entry) => entry.key !== key))
  }

  return (
    <Modal
      title={translate(locale, 'settingsTitle')}
      onClose={onClose}
      wide
      footer={
        <button className="button primary" type="button" onClick={onClose}>
          {translate(locale, 'close')}
        </button>
      }
    >
      <div className="section">
        <label className="field">
          <span>{translate(locale, 'language')}</span>
          <select
            value={locale}
            onChange={(event) => void changeLocale(event.target.value as Locale)}
          >
            <option value="vi">{translate(locale, 'languageVi')}</option>
            <option value="en">{translate(locale, 'languageEn')}</option>
          </select>
        </label>
      </div>

      <div className="section">
        <div className="section-head">
          <h3>{translate(locale, 'updates')}</h3>
          <button
            className="button tiny"
            type="button"
            onClick={() => void checkUpdates()}
            disabled={updateBusy || update.state === 'checking' || update.state === 'downloading'}
          >
            {update.state === 'checking'
              ? translate(locale, 'updateChecking')
              : translate(locale, 'checkForUpdates')}
          </button>
        </div>
        <div className="update-row">
          <div className="update-copy">
            <strong>
              {translate(locale, 'updateCurrent')}: {version || '—'}
            </strong>
            <p className="hint">{updateMessage(locale, update)}</p>
            {update.state === 'downloading' ? (
              <div className="progress update-progress">
                <div
                  className="progress-fill"
                  style={{ width: `${update.percent ?? 0}%` }}
                />
              </div>
            ) : null}
            {update.state === 'error' && update.message ? (
              <p className="hint update-detail">{update.message.slice(0, 160)}</p>
            ) : null}
          </div>
          <div className="update-actions">
            {update.state === 'available' && update.canAutoUpdate ? (
              <button
                className="button primary tiny"
                type="button"
                onClick={() => void downloadUpdates()}
                disabled={updateBusy}
              >
                {translate(locale, 'updateDownload')}
              </button>
            ) : null}
            {update.state === 'downloaded' ? (
              <button
                className="button primary tiny"
                type="button"
                onClick={() => void installUpdates()}
              >
                {translate(locale, 'updateInstall')}
              </button>
            ) : null}
            {update.state === 'available' && !update.canAutoUpdate ? (
              <button
                className="button tiny"
                type="button"
                onClick={() => void openReleasePage()}
              >
                {translate(locale, 'openRelease')}
              </button>
            ) : null}
            {update.state === 'error' || update.state === 'unsupported' ? (
              <button
                className="button tiny"
                type="button"
                onClick={() => void openReleasePage()}
              >
                {translate(locale, 'openRelease')}
              </button>
            ) : null}
          </div>
        </div>
        {update.state === 'available' && !update.canAutoUpdate ? (
          <p className="hint">{translate(locale, 'updateMacManual')}</p>
        ) : null}
      </div>

      <div className="section">
        <div className="section-head">
          <h3>{translate(locale, 'knownHosts')}</h3>
          <button className="button tiny" type="button" onClick={() => void load()} disabled={loading}>
            {translate(locale, 'refresh')}
          </button>
        </div>
        <p className="hint">{translate(locale, 'knownHostsHint')}</p>
        {loading ? <p className="hint">{translate(locale, 'loading')}</p> : null}
        {!loading && knownHosts.length === 0 ? (
          <p className="hint">{translate(locale, 'knownHostsEmpty')}</p>
        ) : null}
        <div className="known-hosts">
          {knownHosts.map((entry) => (
            <div className="known-host" key={entry.key}>
              <div className="known-host-main">
                <strong>{entry.key}</strong>
                <span className="muted">{entry.keyType}</span>
                <code>{entry.fingerprint}</code>
              </div>
              <button
                className={`button tiny${confirmKey === entry.key ? ' danger' : ''}`}
                type="button"
                disabled={busyKey === entry.key}
                onClick={() => void forget(entry.key)}
              >
                {confirmKey === entry.key
                  ? translate(locale, 'confirmForget')
                  : translate(locale, 'forget')}
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="section">
        <div className="field-row">
          <span className="muted">{translate(locale, 'versionLabel')}</span>
          <span>{version || '—'}</span>
        </div>
        <p className="hint">{translate(locale, 'aboutText')}</p>
        <p className="hint">{translate(locale, 'securityNote')}</p>
      </div>

      {error ? <div className="form-error">{error}</div> : null}
    </Modal>
  )
}

import { useState, type ReactNode } from 'react'
import type { ConnectionStatus, KnownHost, Locale, Profile } from '../../../shared/types'
import { formatDate } from '../format'
import { errorText, translate } from '../i18n'
import { LockIcon } from './Icons'

export function ProfileDetail({
  profile,
  status,
  locale,
  knownHost,
  onConnect,
  onEdit,
  onRemove,
  onForgetSecret
}: {
  profile: Profile
  status: ConnectionStatus
  locale: Locale
  knownHost: KnownHost | null
  onConnect: () => void
  onEdit: () => void
  onRemove: () => void
  onForgetSecret: () => void
}): ReactNode {
  const [confirming, setConfirming] = useState(false)
  const [forgetting, setForgetting] = useState(false)

  return (
    <div className="detail">
      <div className="section-head detail-head">
        <h2>{translate(locale, 'connectionDetails')}</h2>
        <div className="detail-actions">
          <button className="button ghost tiny" type="button" onClick={onEdit}>
            {translate(locale, 'edit')}
          </button>
          <button
            className={`button ghost tiny${confirming ? ' danger' : ''}`}
            type="button"
            title={
              confirming
                ? translate(locale, 'confirmRemoveProfile')
                : translate(locale, 'removeProfile')
            }
            onClick={() => {
              if (!confirming) {
                setConfirming(true)
                return
              }
              setConfirming(false)
              onRemove()
            }}
            onBlur={() => setConfirming(false)}
          >
            {confirming
              ? translate(locale, 'confirmRemoveAction')
              : translate(locale, 'removeProfile')}
          </button>
        </div>
      </div>

      <dl className="meta-strip">
        <div>
          <dt>{translate(locale, 'hostLabel')}</dt>
          <dd className="mono">{profile.host}</dd>
        </div>
        <div>
          <dt>{translate(locale, 'portLabel')}</dt>
          <dd className="num">{profile.port}</dd>
        </div>
        <div>
          <dt>{translate(locale, 'usernameLabel')}</dt>
          <dd className="mono">{profile.username}</dd>
        </div>
        <div>
          <dt>{translate(locale, 'lastUsed')}</dt>
          <dd className="num">
            {profile.lastUsedAt
              ? formatDate(profile.lastUsedAt / 1000, locale)
              : translate(locale, 'neverConnected')}
          </dd>
        </div>
      </dl>

      <div className="trust-row">
        <span className="trust-icon">
          <LockIcon size={16} />
        </span>
        <div className="trust-copy">
          <span className="meta-label">{translate(locale, 'authMethod')}</span>
          <code>
            {profile.authMethod === 'key'
              ? profile.keyPath || translate(locale, 'authKey')
              : translate(locale, 'authPassword')}
          </code>
          {profile.hasSavedPassword ? (
            <span className="trust-meta">{translate(locale, 'savedSecret')}</span>
          ) : null}
        </div>
        {profile.hasSavedPassword ? (
          <button
            className={`button tiny${forgetting ? ' danger' : ''}`}
            type="button"
            onClick={() => {
              if (!forgetting) {
                setForgetting(true)
                return
              }
              setForgetting(false)
              onForgetSecret()
            }}
            onBlur={() => setForgetting(false)}
          >
            {forgetting
              ? translate(locale, 'confirmForgetSecret')
              : translate(locale, 'forgetSecret')}
          </button>
        ) : null}
      </div>

      <div className="trust-row">
        <span className="trust-icon">
          <LockIcon size={16} />
        </span>
        <div className="trust-copy">
          <span className="meta-label">Host key</span>
          {knownHost ? (
            <>
              <code>{knownHost.fingerprint}</code>
              <span className="trust-meta">{knownHost.keyType}</span>
            </>
          ) : (
            <p>{translate(locale, 'hostKeyPending')}</p>
          )}
        </div>
        <span className={`chip${knownHost ? ' chip-ink' : ' chip-dashed'}`}>
          {knownHost ? translate(locale, 'trusted') : translate(locale, 'unverified')}
        </span>
      </div>

      {status.state === 'error' && status.code ? (
        <div className="inline-notice">
          <div>
            <strong>{translate(locale, 'connectionErrorTitle')}</strong>
            <p>{errorText(locale, status.code, status.detail)}</p>
          </div>
          <button className="button tiny" type="button" onClick={onConnect}>
            {translate(locale, 'retry')}
          </button>
        </div>
      ) : null}

      <p className="hint detail-hint">{translate(locale, 'passwordOnlySession')}</p>
    </div>
  )
}

import type { ReactNode } from 'react'
import type { ConnectionStatus, Locale, Profile } from '../../../shared/types'
import { translate } from '../i18n'
import { PlusIcon, QrIcon, ServerIcon, SettingsIcon } from './Icons'

export function Sidebar({
  profiles,
  activeProfileId,
  status,
  locale,
  onSelect,
  onAdd,
  onQr,
  onSettings
}: {
  profiles: Profile[]
  activeProfileId: string | null
  status: ConnectionStatus
  locale: Locale
  onSelect: (profile: Profile) => void
  onAdd: () => void
  onQr: () => void
  onSettings: () => void
}): ReactNode {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">
          <ServerIcon />
        </div>
        <div>
          <strong>{translate(locale, 'appName')}</strong>
          <span>{translate(locale, 'tagline')}</span>
        </div>
      </div>

      <div className="sidebar-actions">
        <button className="button full" type="button" onClick={onAdd}>
          <PlusIcon /> {translate(locale, 'addProfile')}
        </button>
        <button className="button full" type="button" onClick={onQr}>
          <QrIcon /> {translate(locale, 'importQr')}
        </button>
      </div>

      <div className="list-label">{translate(locale, 'profiles')}</div>

      <div className="profile-list">
        {profiles.length === 0 ? (
          <p className="sidebar-empty">{translate(locale, 'noProfiles')}</p>
        ) : null}

        {profiles.map((profile) => {
          const active = profile.id === activeProfileId
          const connected = active && status.state === 'connected'
          return (
            <button
              key={profile.id}
              className={`profile-item${active ? ' active' : ''}`}
              type="button"
              aria-current={active ? 'true' : undefined}
              onClick={() => onSelect(profile)}
            >
              <span className={`status-dot${connected ? ' online' : ''}`} />
              <span className="profile-copy">
                <strong>{profile.name}</strong>
                <span>
                  {profile.username}@{profile.host}:{profile.port}
                </span>
              </span>
            </button>
          )
        })}
      </div>

      <div className="sidebar-foot">
        <span className={`status-text state-${status.state}`}>
          {status.state === 'connected'
            ? translate(locale, 'statusConnected')
            : status.state === 'connecting' || status.state === 'verifying_host'
              ? translate(locale, 'statusConnecting')
              : status.state === 'authenticating'
                ? translate(locale, 'statusAuthenticating')
                : status.state === 'error'
                  ? translate(locale, 'statusError')
                  : translate(locale, 'statusDisconnected')}
        </span>
        <button
          className="icon-button"
          type="button"
          onClick={onSettings}
          title={translate(locale, 'settings')}
        >
          <SettingsIcon />
        </button>
      </div>
    </aside>
  )
}

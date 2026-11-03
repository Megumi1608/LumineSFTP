import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type {
  Bookmark,
  ConnectSecret,
  ConnectionStatus,
  ErrorCode,
  HostKeyMismatchPrompt,
  HostKeyPrompt,
  InteractiveRequest,
  KnownHost,
  KnownHostsHealth,
  Locale,
  Profile,
  RemoteEntry,
  RemoteListing,
  TransferInfo,
  UpdateStatus
} from '../../shared/types'
import { FileBrowser } from './components/FileBrowser'
import { BookmarksDialog } from './components/BookmarksDialog'
import { HostKeyDialog } from './components/HostKeyDialog'
import { HostKeyMismatchDialog } from './components/HostKeyMismatchDialog'
import { InteractiveDialog } from './components/InteractiveDialog'
import { Onboarding } from './components/Onboarding'
import { PasswordDialog } from './components/PasswordDialog'
import { ProfileDetail } from './components/ProfileDetail'
import { ProfileDialog } from './components/ProfileDialog'
import { PropertiesDialog } from './components/PropertiesDialog'
import { PromptDialog } from './components/PromptDialog'
import { QrDialog } from './components/QrDialog'
import { SettingsDialog } from './components/SettingsDialog'
import { Sidebar } from './components/Sidebar'
import { Toasts, type ToastItem } from './components/Toasts'
import { Transfers } from './components/Transfers'
import { remoteJoin } from './format'
import { errorText, translate } from './i18n'

type PromptState =
  | { kind: 'mkdir' }
  | { kind: 'rename'; entry: RemoteEntry }

const IGNORED_ERRORS: ErrorCode[] = [
  'DIALOG_CANCELLED',
  'TRANSFER_CANCELLED',
  'AUTH_CANCELLED',
  'HOST_KEY_REJECTED',
  'HOST_KEY_MISMATCH'
]

function statusLabel(locale: Locale, state: ConnectionStatus['state']): string {
  switch (state) {
    case 'connected':
      return translate(locale, 'statusConnected')
    case 'connecting':
      return translate(locale, 'statusConnecting')
    case 'verifying_host':
      return translate(locale, 'statusVerifying')
    case 'authenticating':
      return translate(locale, 'statusAuthenticating')
    case 'error':
      return translate(locale, 'statusError')
    default:
      return translate(locale, 'statusDisconnected')
  }
}

export default function App(): ReactNode {
  const [locale, setLocale] = useState<Locale>('vi')
  const [version, setVersion] = useState('')
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [knownHosts, setKnownHosts] = useState<KnownHost[]>([])
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([])
  const [bookmarksOpen, setBookmarksOpen] = useState(false)
  const [properties, setProperties] = useState<{
    entry: RemoteEntry
    path: string
  } | null>(null)
  const [propertiesBusy, setPropertiesBusy] = useState(false)
  const [propertiesError, setPropertiesError] = useState<string | null>(null)
  const [historyState, setHistoryState] = useState({
    canBack: false,
    canForward: false
  })
  const [knownHostsHealth, setKnownHostsHealth] = useState<KnownHostsHealth>('ok')
  const [secretStorageAvailable, setSecretStorageAvailable] = useState(false)
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null)
  const [status, setStatus] = useState<ConnectionStatus>({ state: 'disconnected' })
  const [listing, setListing] = useState<RemoteListing | null>(null)
  const [listingError, setListingError] = useState<{
    code: ErrorCode
    detail?: string
  } | null>(null)
  const [transfers, setTransfers] = useState<Record<string, TransferInfo>>({})
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({
    state: 'idle',
    canAutoUpdate: false
  })

  const [hostKey, setHostKey] = useState<HostKeyPrompt | null>(null)
  const [hostKeyMismatch, setHostKeyMismatch] = useState<HostKeyMismatchPrompt | null>(null)
  const [interactive, setInteractive] = useState<InteractiveRequest | null>(null)
  const [passwordProfile, setPasswordProfile] = useState<Profile | null>(null)
  const [authError, setAuthError] = useState<string | null>(null)
  const [profileDialog, setProfileDialog] = useState<
    { mode: 'add' } | { mode: 'edit'; profile: Profile } | null
  >(null)
  const [qrOpen, setQrOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [prompt, setPrompt] = useState<PromptState | null>(null)

  const [busy, setBusy] = useState(false)
  const [connecting, setConnecting] = useState(false)

  const toastCounter = useRef(0)
  const requestCounter = useRef(0)
  const lastError = useRef<{ code: ErrorCode; at: number } | null>(null)
  const listingRef = useRef<RemoteListing | null>(null)
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const historyRef = useRef<string[]>([])
  const historyIndexRef = useRef(-1)

  useEffect(() => {
    listingRef.current = listing
  }, [listing])

  useEffect(
    () => () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current)
    },
    []
  )

  const notify = useCallback((message: string, tone: 'info' | 'error' = 'info'): void => {
    toastCounter.current += 1
    const id = `t${toastCounter.current}`
    setToasts((current) => [...current, { id, message, tone }])
    setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id))
    }, 6000)
  }, [])

  const reportError = useCallback(
    (code: ErrorCode, detail?: string, dedupe = false): void => {
      if (IGNORED_ERRORS.includes(code)) return
      const now = Date.now()
      if (
        dedupe &&
        lastError.current &&
        lastError.current.code === code &&
        now - lastError.current.at < 2500
      ) {
        return
      }
      lastError.current = { code, at: now }
      notify(errorText(locale, code, detail), 'error')
    },
    [locale, notify]
  )

  const refreshKnownHosts = useCallback(async (): Promise<void> => {
    const result = await window.lumine.knownHosts.list()
    if (result.ok) setKnownHosts(result.data)
  }, [])

  const pushHistory = useCallback((target: string): void => {
    const next = historyRef.current.slice(0, historyIndexRef.current + 1)
    if (next[next.length - 1] === target) return
    next.push(target)
    historyRef.current = next
    historyIndexRef.current = next.length - 1
    setHistoryState({ canBack: next.length > 1, canForward: false })
  }, [])

  const resetHistory = useCallback((): void => {
    historyRef.current = []
    historyIndexRef.current = -1
    setHistoryState({ canBack: false, canForward: false })
  }, [])

  const openPath = useCallback(
    async (path: string, recordHistory = true): Promise<void> => {
      const token = ++requestCounter.current
      setBusy(true)
      const result = await window.lumine.sftp.list(path)
      if (token !== requestCounter.current) return
      setBusy(false)
      if (result.ok) {
        setListing(result.data)
        setListingError(null)
        if (recordHistory) pushHistory(result.data.path)
        document.title = `${result.data.path} · Lumine SFTP`
      } else {
        setListingError({ code: result.code, ...(result.detail ? { detail: result.detail } : {}) })
        reportError(result.code, result.detail)
      }
    },
    [pushHistory, reportError]
  )

  const goBack = useCallback((): void => {
    const index = historyIndexRef.current - 1
    const target = historyRef.current[index]
    if (index < 0 || !target) return
    historyIndexRef.current = index
    setHistoryState({ canBack: index > 0, canForward: true })
    void openPath(target, false)
  }, [openPath])

  const goForward = useCallback((): void => {
    const index = historyIndexRef.current + 1
    const target = historyRef.current[index]
    if (!target) return
    historyIndexRef.current = index
    setHistoryState({
      canBack: index > 0,
      canForward: index < historyRef.current.length - 1
    })
    void openPath(target, false)
  }, [openPath])

  useEffect(() => {
    let alive = true
    if (!activeProfileId) {
      setBookmarks([])
      return
    }
    void window.lumine.bookmarks.list(activeProfileId).then((result) => {
      if (alive && result.ok) setBookmarks(result.data)
    })
    return () => {
      alive = false
    }
  }, [activeProfileId])

  const addBookmark = useCallback(async (): Promise<void> => {
    if (!activeProfileId || !listing) return
    const result = await window.lumine.bookmarks.add(activeProfileId, listing.path)
    if (!result.ok) {
      reportError(result.code, result.detail)
      return
    }
    setBookmarks((current) =>
      [...current.filter((item) => item.id !== result.data.id), result.data].sort((a, b) =>
        a.name.localeCompare(b.name)
      )
    )
    notify(translate(locale, 'bookmarkAdded'))
  }, [activeProfileId, listing, locale, notify, reportError])

  const removeBookmark = useCallback(
    async (id: string): Promise<void> => {
      const result = await window.lumine.bookmarks.remove(id)
      if (!result.ok) {
        reportError(result.code, result.detail)
        return
      }
      setBookmarks((current) => current.filter((item) => item.id !== id))
      notify(translate(locale, 'bookmarkRemoved'))
    },
    [locale, notify, reportError]
  )

  const copyPath = useCallback(
    async (target: string): Promise<void> => {
      try {
        await navigator.clipboard.writeText(target)
        notify(translate(locale, 'copiedPath'))
      } catch {
        reportError('INTERNAL')
      }
    },
    [locale, notify, reportError]
  )

  const openProperties = useCallback(
    (entry: RemoteEntry): void => {
      setPropertiesError(null)
      setProperties({
        entry,
        path: remoteJoin(listingRef.current?.path ?? '/', entry.name)
      })
    },
    []
  )

  const submitChmod = useCallback(
    async (mode: number): Promise<void> => {
      if (!properties) return
      setPropertiesBusy(true)
      setPropertiesError(null)
      const result = await window.lumine.sftp.chmod(properties.path, mode)
      setPropertiesBusy(false)
      if (!result.ok) {
        setPropertiesError(errorText(locale, result.code, result.detail))
        return
      }
      setProperties(null)
      if (listingRef.current) await openPath(listingRef.current.path)
      notify(translate(locale, 'chmodDone'))
    },
    [locale, notify, openPath, properties]
  )

  useEffect(() => {
    let alive = true
    void (async () => {
      const [settings, list, hosts, update] = await Promise.all([
        window.lumine.settings.get(),
        window.lumine.profiles.list(),
        window.lumine.knownHosts.list(),
        window.lumine.updates.get()
      ])
      if (!alive) return
      if (settings.ok) {
        setLocale(settings.data.locale)
        setVersion(settings.data.version)
        setKnownHostsHealth(settings.data.knownHostsHealth)
        setSecretStorageAvailable(settings.data.secretStorageAvailable)
        document.documentElement.lang = settings.data.locale
      } else {
        reportError(settings.code, settings.detail)
      }
      if (list.ok) {
        setProfiles(list.data)
        setActiveProfileId((current) => current ?? list.data[0]?.id ?? null)
      } else {
        reportError(list.code, list.detail)
      }
      if (hosts.ok) setKnownHosts(hosts.data)
      if (update.ok) setUpdateStatus(update.data)
    })()
    return () => {
      alive = false
    }
  }, [reportError])

  useEffect(() => {
    const offStatus = window.lumine.onStatus((next) => {
      setStatus(next)
      if (next.state === 'connected') {
        void openPath('')
      }
      if (next.state === 'disconnected' || next.state === 'error') {
        requestCounter.current += 1
        setBusy(false)
        setListing(null)
        setListingError(null)
        resetHistory()
        document.title = 'Lumine SFTP'
      }
      if (next.state === 'error' && next.code) {
        lastError.current = { code: next.code, at: Date.now() }
        reportError(next.code, next.detail)
      }
    })

    const offHostKey = window.lumine.onHostKey((promptValue) => {
      setPasswordProfile(null)
      setHostKey(promptValue)
    })

    const offHostKeyMismatch = window.lumine.onHostKeyMismatch((promptValue) => {
      setPasswordProfile(null)
      setHostKeyMismatch(promptValue)
    })

    const offInteractive = window.lumine.onInteractive((request) => {
      setPasswordProfile(null)
      setInteractive(request)
    })

    const offTransfer = window.lumine.onTransfer((transfer) => {
      setTransfers((current) => ({ ...current, [transfer.id]: transfer }))
      if (transfer.state === 'done' && transfer.direction === 'upload' && listingRef.current) {
        const target = listingRef.current.path
        if (refreshTimer.current) clearTimeout(refreshTimer.current)
        refreshTimer.current = setTimeout(() => {
          void openPath(target)
        }, 500)
      }
    })

    const offUpdate = window.lumine.onUpdate((next) => {
      setUpdateStatus(next)
    })

    return () => {
      offStatus()
      offHostKey()
      offHostKeyMismatch()
      offInteractive()
      offTransfer()
      offUpdate()
    }
  }, [openPath, reportError, resetHistory])

  const upsertProfile = useCallback((profile: Profile): void => {
    setProfiles((current) => {
      const exists = current.some((item) => item.id === profile.id)
      const next = exists
        ? current.map((item) => (item.id === profile.id ? profile : item))
        : [profile, ...current]
      return next.slice().sort(
        (left, right) =>
          (right.lastUsedAt ?? 0) - (left.lastUsedAt ?? 0) || left.name.localeCompare(right.name)
      )
    })
  }, [])

  const disconnect = useCallback(async (): Promise<void> => {
    const result = await window.lumine.disconnect()
    if (!result.ok) reportError(result.code, result.detail)
    setStatus({ state: 'disconnected' })
    setListing(null)
    setListingError(null)
    setConnecting(false)
    requestCounter.current += 1
    setBusy(false)
    resetHistory()
  }, [reportError, resetHistory])

  const handleConnect = useCallback(
    async (profile: Profile, secret: ConnectSecret): Promise<void> => {
      setConnecting(true)
      setActiveProfileId(profile.id)
      setAuthError(null)
      resetHistory()
      const result = await window.lumine.connect(profile.id, secret)
      setConnecting(false)
      if (!result.ok) {
        if (result.code === 'SECRET_REQUIRED' || result.code === 'AUTH_FAILED') {
          setPasswordProfile(profile)
          setAuthError(errorText(locale, result.code, result.detail))
        } else {
          setPasswordProfile(null)
          reportError(result.code, result.detail, true)
        }
        return
      }
      setPasswordProfile(null)
      upsertProfile(result.data)
      void refreshKnownHosts()
      await openPath('')
    },
    [locale, openPath, refreshKnownHosts, reportError, resetHistory, upsertProfile]
  )

  const startConnect = useCallback(
    (profile: Profile): void => {
      setAuthError(null)
      if (profile.authMethod === 'password' && !profile.hasSavedPassword) {
        setPasswordProfile(profile)
        return
      }
      void handleConnect(profile, {})
    },
    [handleConnect]
  )

  const forgetSecret = useCallback(
    async (profile: Profile): Promise<void> => {
      const result = await window.lumine.secrets.forget(profile.id)
      if (!result.ok) {
        reportError(result.code, result.detail)
        return
      }
      upsertProfile(result.data)
      notify(translate(locale, 'secretForgotten'))
    },
    [locale, notify, reportError, upsertProfile]
  )

  const selectProfile = useCallback(
    async (profile: Profile): Promise<void> => {
      if (profile.id === activeProfileId) return
      if (
        status.state === 'connecting' ||
        status.state === 'verifying_host' ||
        status.state === 'authenticating'
      ) {
        return
      }
      if (status.state === 'connected') {
        await disconnect()
      } else if (status.state !== 'disconnected') {
        setStatus({ state: 'disconnected' })
      }
      setActiveProfileId(profile.id)
      setListing(null)
      setListingError(null)
      resetHistory()
    },
    [activeProfileId, disconnect, resetHistory, status.state]
  )

  const removeProfile = useCallback(
    async (profile: Profile): Promise<void> => {
      const result = await window.lumine.profiles.remove(profile.id)
      if (!result.ok) {
        reportError(result.code, result.detail)
        return
      }
      const remaining = profiles.filter((item) => item.id !== profile.id)
      setProfiles(remaining)
      if (activeProfileId === profile.id) {
        await disconnect()
        setActiveProfileId(remaining[0]?.id ?? null)
        setListing(null)
        setListingError(null)
      }
      notify(translate(locale, 'profileRemoved'))
    },
    [activeProfileId, disconnect, locale, notify, profiles, reportError]
  )

  const upload = useCallback(
    async (folder = false): Promise<void> => {
      if (!listing) return
      const result = folder
        ? await window.lumine.sftp.uploadFolder(listing.path)
        : await window.lumine.sftp.upload(listing.path)
      if (result.ok) notify(translate(locale, 'uploadStarted'))
      else reportError(result.code, result.detail)
    },
    [listing, locale, notify, reportError]
  )

  const download = useCallback(
    async (paths: string[]): Promise<void> => {
      const result = await window.lumine.sftp.download(paths)
      if (result.ok) notify(translate(locale, 'downloadStarted'))
      else reportError(result.code, result.detail)
    },
    [locale, notify, reportError]
  )

  const removeEntries = useCallback(
    async (paths: string[]): Promise<void> => {
      const result = await window.lumine.sftp.remove(paths)
      if (!result.ok) {
        reportError(result.code, result.detail)
        return
      }
      if (listing) await openPath(listing.path)
    },
    [listing, openPath, reportError]
  )

  const submitPrompt = useCallback(
    async (value: string): Promise<string | null> => {
      if (!listing || !prompt) return null
      if (prompt.kind === 'rename' && prompt.entry.name === value) return null

      const result =
        prompt.kind === 'mkdir'
          ? await window.lumine.sftp.mkdir(listing.path, value)
          : await window.lumine.sftp.rename(listing.path, prompt.entry.name, value)

      if (!result.ok) return errorText(locale, result.code, result.detail)
      await openPath(listing.path)
      return null
    },
    [listing, locale, openPath, prompt]
  )

  const respondHostKey = useCallback(
    async (accept: boolean): Promise<void> => {
      if (!hostKey) return
      const requestId = hostKey.requestId
      setHostKey(null)
      const result = await window.lumine.respondHostKey(requestId, accept)
      if (!result.ok) reportError(result.code, result.detail)
      if (accept) void refreshKnownHosts()
    },
    [hostKey, refreshKnownHosts, reportError]
  )

  const answerInteractive = useCallback(
    async (answers: string[]): Promise<void> => {
      if (!interactive) return
      const requestId = interactive.requestId
      setInteractive(null)
      const result = await window.lumine.answerInteractive(requestId, false, answers)
      if (!result.ok) reportError(result.code, result.detail)
    },
    [interactive, reportError]
  )

  const cancelInteractive = useCallback(async (): Promise<void> => {
    if (!interactive) return
    const requestId = interactive.requestId
    setInteractive(null)
    const result = await window.lumine.answerInteractive(requestId, true, [])
    if (!result.ok) reportError(result.code, result.detail)
  }, [interactive, reportError])

  const activeProfile = profiles.find((item) => item.id === activeProfileId) ?? null
  const knownHost = activeProfile
    ? (knownHosts.find(
        (entry) => entry.host === activeProfile.host && entry.port === activeProfile.port
      ) ?? null)
    : null
  const transferList = Object.values(transfers)
  const connected = status.state === 'connected'
  const connectingState =
    status.state === 'connecting' ||
    status.state === 'verifying_host' ||
    status.state === 'authenticating'

  return (
    <div className="app">
      <Sidebar
        profiles={profiles}
        activeProfileId={activeProfileId}
        status={status}
        locale={locale}
        onSelect={(profile) => void selectProfile(profile)}
        onAdd={() => setProfileDialog({ mode: 'add' })}
        onQr={() => setQrOpen(true)}
        onSettings={() => setSettingsOpen(true)}
      />

      <main className="main">
        <header className="main-head">
          <div className="head-title">
            <h1>{activeProfile ? activeProfile.name : translate(locale, 'profiles')}</h1>
            {activeProfile ? (
              <p>{`${activeProfile.username}@${activeProfile.host}:${activeProfile.port}`}</p>
            ) : null}
          </div>

          <div className="head-actions">
            {updateStatus.state === 'available' && updateStatus.version ? (
              <button
                className="pill update-pill"
                type="button"
                onClick={() => setSettingsOpen(true)}
              >
                {translate(locale, 'updateAvailableShort', {
                  version: updateStatus.version
                })}
              </button>
            ) : null}
            {updateStatus.state === 'downloaded' ? (
              <button
                className="pill update-pill"
                type="button"
                onClick={() => setSettingsOpen(true)}
              >
                {translate(locale, 'updateInstall')}
              </button>
            ) : null}

            {activeProfile ? (
              <span className={`pill state-${status.state}`}>
                <span className="status-dot" />
                {statusLabel(locale, status.state)}
              </span>
            ) : null}

            {activeProfile ? (
              connected || connectingState ? (
                <button
                  className="button head-button"
                  type="button"
                  onClick={() => void disconnect()}
                >
                  {connected
                    ? translate(locale, 'disconnect')
                    : translate(locale, 'cancelConnection')}
                </button>
              ) : (
                <button
                  className="button head-button primary"
                  type="button"
                  disabled={connecting}
                  onClick={() => startConnect(activeProfile)}
                >
                  {translate(locale, 'connect')}
                </button>
              )
            ) : null}
          </div>
        </header>

        <section className="sheet">
          {connectingState || (busy && listing) ? <div className="sheet-progress" /> : null}

          <div className={`sheet-body${!activeProfile ? ' is-onboarding' : ''}`}>
            {connected ? (
              listingError && !listing ? (
                <div className="load-error">
                  <strong>{translate(locale, 'connectionErrorTitle')}</strong>
                  <p>{errorText(locale, listingError.code, listingError.detail)}</p>
                  <button
                    className="button"
                    type="button"
                    onClick={() => void openPath('')}
                  >
                    {translate(locale, 'retry')}
                  </button>
                </div>
              ) : (
                <FileBrowser
                  listing={listing}
                  locale={locale}
                  bookmarks={bookmarks}
                  canBack={historyState.canBack}
                  canForward={historyState.canForward}
                  onBack={goBack}
                  onForward={goForward}
                  onOpen={(path) => void openPath(path)}
                  onRefresh={() => listing && void openPath(listing.path)}
                  onUpload={() => void upload(false)}
                  onUploadFolder={() => void upload(true)}
                  onDownload={(paths) => void download(paths)}
                  onRename={(entry) => setPrompt({ kind: 'rename', entry })}
                  onDelete={(paths) => void removeEntries(paths)}
                  onNewFolder={() => setPrompt({ kind: 'mkdir' })}
                  onAddBookmark={() => void addBookmark()}
                  onOpenBookmarks={() => setBookmarksOpen(true)}
                  onProperties={(entry) => openProperties(entry)}
                  onCopyPath={(target) => void copyPath(target)}
                />
              )
            ) : activeProfile ? (
              <ProfileDetail
                profile={activeProfile}
                status={status}
                locale={locale}
                knownHost={knownHost}
                onConnect={() => startConnect(activeProfile)}
                onEdit={() => setProfileDialog({ mode: 'edit', profile: activeProfile })}
                onRemove={() => void removeProfile(activeProfile)}
                onForgetSecret={() => void forgetSecret(activeProfile)}
              />
            ) : (
              <Onboarding
                locale={locale}
                onQr={() => setQrOpen(true)}
                onAdd={() => setProfileDialog({ mode: 'add' })}
              />
            )}
          </div>

          <Transfers
            transfers={transferList}
            locale={locale}
            onCancel={(id) => void window.lumine.sftp.cancel(id)}
            onRetry={(id) => void window.lumine.sftp.retry(id)}
            onReveal={(id) => void window.lumine.sftp.reveal(id)}
            onClear={() =>
              setTransfers((current) => {
                const next: Record<string, TransferInfo> = {}
                for (const [id, transfer] of Object.entries(current)) {
                  if (transfer.state === 'running' || transfer.state === 'queued') {
                    next[id] = transfer
                  }
                }
                return next
              })
            }
          />
        </section>
      </main>

      {profileDialog ? (
        <ProfileDialog
          mode={profileDialog.mode}
          profile={profileDialog.mode === 'edit' ? profileDialog.profile : undefined}
          locale={locale}
          onClose={() => setProfileDialog(null)}
          onSaved={(profile) => {
            upsertProfile(profile)
            setActiveProfileId(profile.id)
            setListing(null)
            setProfileDialog(null)
            notify(translate(locale, 'profileSaved'))
          }}
          onOpenQr={
            profileDialog.mode === 'add'
              ? () => {
                  setProfileDialog(null)
                  setQrOpen(true)
                }
              : undefined
          }
        />
      ) : null}

      {qrOpen ? (
        <QrDialog
          locale={locale}
          onClose={() => setQrOpen(false)}
          onSaved={(profile, connectNow) => {
            upsertProfile(profile)
            setQrOpen(false)
            notify(translate(locale, 'profileSaved'))
            setActiveProfileId(profile.id)
            setListing(null)
            if (connectNow) startConnect(profile)
          }}
        />
      ) : null}

      {passwordProfile ? (
        <PasswordDialog
          profile={passwordProfile}
          locale={locale}
          busy={connecting}
          canSave={secretStorageAvailable}
          error={authError}
          onClose={() => {
            setPasswordProfile(null)
            setAuthError(null)
          }}
          onSubmit={(secret) => void handleConnect(passwordProfile, secret)}
        />
      ) : null}

      {hostKey ? (
        <HostKeyDialog
          prompt={hostKey}
          locale={locale}
          onRespond={(accept) => void respondHostKey(accept)}
        />
      ) : null}

      {hostKeyMismatch ? (
        <HostKeyMismatchDialog
          prompt={hostKeyMismatch}
          locale={locale}
          onClose={() => setHostKeyMismatch(null)}
          onOpenSettings={() => {
            setHostKeyMismatch(null)
            setSettingsOpen(true)
          }}
        />
      ) : null}

      {interactive ? (
        <InteractiveDialog
          request={interactive}
          locale={locale}
          onClose={() => void cancelInteractive()}
          onSubmit={(answers) => void answerInteractive(answers)}
        />
      ) : null}

      {settingsOpen ? (
        <SettingsDialog
          locale={locale}
          version={version}
          knownHostsHealth={knownHostsHealth}
          onLocaleChange={(next) => {
            setLocale(next)
            document.documentElement.lang = next
          }}
          onClose={() => {
            setSettingsOpen(false)
            void refreshKnownHosts()
          }}
        />
      ) : null}

      {bookmarksOpen ? (
        <BookmarksDialog
          bookmarks={bookmarks}
          locale={locale}
          onOpen={(target) => void openPath(target)}
          onRemove={(id) => void removeBookmark(id)}
          onClose={() => setBookmarksOpen(false)}
        />
      ) : null}

      {properties ? (
        <PropertiesDialog
          entry={properties.entry}
          path={properties.path}
          locale={locale}
          busy={propertiesBusy}
          error={propertiesError}
          onClose={() => setProperties(null)}
          onSubmit={(mode) => void submitChmod(mode)}
        />
      ) : null}

      {prompt ? (
        <PromptDialog
          title={
            prompt.kind === 'mkdir'
              ? translate(locale, 'newFolderTitle')
              : translate(locale, 'renameTitle')
          }
          label={
            prompt.kind === 'mkdir' ? translate(locale, 'folderName') : translate(locale, 'newName')
          }
          initial={prompt.kind === 'rename' ? prompt.entry.name : ''}
          locale={locale}
          onClose={() => setPrompt(null)}
          onSubmit={submitPrompt}
        />
      ) : null}

      <Toasts
        items={toasts}
        onDismiss={(id) =>
          setToasts((current) => current.filter((item) => item.id !== id))
        }
      />
    </div>
  )
}

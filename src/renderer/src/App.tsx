import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent,
  type ReactNode
} from 'react'
import type {
  ConnectionState,
  ConnectionStatus,
  ErrorCode,
  HostKeyPrompt,
  InteractiveRequest,
  KnownHost,
  Locale,
  Location,
  Profile,
  RemoteEntry,
  RemoteListing,
  TransferInfo,
  UpdateStatus
} from '../../shared/types'
import { errorText, translate } from './i18n'
import { ContextMenu, type ContextMenuItem } from './components/ContextMenu'
import { FileBrowser } from './components/FileBrowser'
import { HostKeyDialog } from './components/HostKeyDialog'
import {
  DownloadIcon,
  FileIcon,
  FolderIcon,
  FolderPlusIcon,
  PencilIcon,
  RefreshIcon,
  TrashIcon,
  UploadIcon
} from './components/Icons'
import { InteractiveDialog } from './components/InteractiveDialog'
import { Onboarding } from './components/Onboarding'
import { PasswordDialog } from './components/PasswordDialog'
import { ProfileDetail } from './components/ProfileDetail'
import { ProfileDialog } from './components/ProfileDialog'
import { PromptDialog } from './components/PromptDialog'
import { QrDialog } from './components/QrDialog'
import { SettingsDialog } from './components/SettingsDialog'
import { Sidebar } from './components/Sidebar'
import { Toasts, type ToastItem } from './components/Toasts'
import { Transfers } from './components/Transfers'

type PaneId = 'a' | 'b'
type PaneKind = 'remote' | 'local'

type PromptState =
  | { pane: PaneId; kind: 'mkdir' }
  | { pane: PaneId; kind: 'rename'; entry: RemoteEntry }

interface PaneState {
  kind: PaneKind
  profileId: string | null
  sessionId: string | null
  listing: RemoteListing | null
  error: { code: ErrorCode; detail?: string } | null
  busy: boolean
}

interface DragPayload {
  pane: PaneId
  kind: PaneKind
  path: string
}

const IGNORED_ERRORS: ErrorCode[] = [
  'DIALOG_CANCELLED',
  'TRANSFER_CANCELLED',
  'AUTH_CANCELLED',
  'HOST_KEY_REJECTED'
]

const CONNECTING_STATES: ConnectionState[] = [
  'connecting',
  'verifying_host',
  'authenticating'
]

function emptyPane(kind: PaneKind): PaneState {
  return {
    kind,
    profileId: null,
    sessionId: null,
    listing: null,
    error: null,
    busy: false
  }
}

function statusLabel(locale: Locale, state: ConnectionState): string {
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

function joinPath(kind: PaneKind, directory: string, name: string): string {
  if (kind === 'remote') return `${directory === '/' ? '' : directory}/${name}`
  const separator = directory.includes('\\') ? '\\' : '/'
  return `${directory.replace(/[\\/]+$/, '')}${separator}${name}`
}

export default function App(): ReactNode {
  const [locale, setLocale] = useState<Locale>('vi')
  const [version, setVersion] = useState('')
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [knownHosts, setKnownHosts] = useState<KnownHost[]>([])
  const [split, setSplit] = useState(false)
  const [panes, setPanes] = useState<Record<PaneId, PaneState>>({
    a: emptyPane('remote'),
    b: emptyPane('local')
  })
  const [statuses, setStatuses] = useState<Record<string, ConnectionStatus>>({})
  const [transfers, setTransfers] = useState<Record<string, TransferInfo>>({})
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({
    state: 'idle',
    canAutoUpdate: false
  })
  const [dragOver, setDragOver] = useState<PaneId | null>(null)

  const [hostKey, setHostKey] = useState<HostKeyPrompt | null>(null)
  const [interactive, setInteractive] = useState<InteractiveRequest | null>(null)
  const [passwordTarget, setPasswordTarget] = useState<{
    pane: PaneId
    profile: Profile
  } | null>(null)
  const [profileDialog, setProfileDialog] = useState<
    { mode: 'add' } | { mode: 'edit'; profile: Profile } | null
  >(null)
  const [qrOpen, setQrOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [prompt, setPrompt] = useState<PromptState | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(
    null
  )
  const [connectingPane, setConnectingPane] = useState<PaneId | null>(null)

  const panesRef = useRef(panes)
  panesRef.current = panes
  const dragRef = useRef<DragPayload | null>(null)
  const contextItemsRef = useRef<ContextMenuItem[]>([])
  const toastCounter = useRef(0)
  const lastError = useRef<{ code: ErrorCode; at: number } | null>(null)
  const seenTransferErrors = useRef(new Set<string>())

  const notify = useCallback(
    (message: string, tone: 'info' | 'error' = 'info'): void => {
      toastCounter.current += 1
      const id = `t${toastCounter.current}`
      setToasts((current) => [...current, { id, message, tone }])
      setTimeout(() => {
        setToasts((current) => current.filter((item) => item.id !== id))
      }, 6000)
    },
    []
  )

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

  const patchPane = useCallback((id: PaneId, patch: Partial<PaneState>): void => {
    setPanes((current) => ({ ...current, [id]: { ...current[id], ...patch } }))
  }, [])

  const refreshKnownHosts = useCallback(async (): Promise<void> => {
    const result = await window.lumine.knownHosts.list()
    if (result.ok) setKnownHosts(result.data)
  }, [])

  const openRemote = useCallback(
    async (id: PaneId, path: string, explicitSessionId?: string): Promise<void> => {
      // Lúc vừa kết nối xong, state pane chưa render lại nên `panesRef` vẫn cũ;
      // truyền thẳng id phiên mới để lần liệt kê đầu tiên không bị bỏ qua.
      const sessionId = explicitSessionId ?? panesRef.current[id].sessionId
      if (!sessionId) return
      patchPane(id, { busy: true })
      const result = await window.lumine.sftp.list(sessionId, path)
      patchPane(id, { busy: false })
      if (result.ok) {
        patchPane(id, { listing: result.data, error: null })
        document.title = `${result.data.path} · Lumine SFTP`
      } else {
        patchPane(id, {
          error: { code: result.code, ...(result.detail ? { detail: result.detail } : {}) }
        })
        reportError(result.code, result.detail)
      }
    },
    [patchPane, reportError]
  )

  const openLocal = useCallback(
    async (id: PaneId, path: string): Promise<void> => {
      patchPane(id, { busy: true })
      const result = await window.lumine.local.list(path)
      patchPane(id, { busy: false })
      if (result.ok) {
        patchPane(id, { listing: result.data, error: null })
        document.title = `${result.data.path} · Lumine SFTP`
      } else {
        patchPane(id, {
          error: { code: result.code, ...(result.detail ? { detail: result.detail } : {}) }
        })
        reportError(result.code, result.detail)
      }
    },
    [patchPane, reportError]
  )

  const refreshPane = useCallback(
    (id: PaneId): void => {
      const pane = panesRef.current[id]
      if (!pane.listing) return
      void (pane.kind === 'local'
        ? openLocal(id, pane.listing.path)
        : openRemote(id, pane.listing.path))
    },
    [openLocal, openRemote]
  )

  const disconnectPane = useCallback(
    async (id: PaneId): Promise<void> => {
      const sessionId = panesRef.current[id].sessionId
      setConnectingPane((current) => (current === id ? null : current))
      if (sessionId) {
        await window.lumine.disconnect(sessionId)
        setStatuses((current) => {
          const next = { ...current }
          delete next[sessionId]
          return next
        })
      }
      patchPane(id, { sessionId: null, listing: null, error: null })
    },
    [patchPane]
  )

  const upsertProfile = useCallback((profile: Profile): void => {
    setProfiles((current) => {
      const exists = current.some((item) => item.id === profile.id)
      const next = exists
        ? current.map((item) => (item.id === profile.id ? profile : item))
        : [profile, ...current]
      return next.slice().sort(
        (left, right) =>
          (right.lastUsedAt ?? 0) - (left.lastUsedAt ?? 0) ||
          left.name.localeCompare(right.name)
      )
    })
  }, [])

  const connectPane = useCallback(
    async (id: PaneId, profile: Profile, password: string): Promise<void> => {
      const sessionId = crypto.randomUUID()
      patchPane(id, {
        kind: 'remote',
        profileId: profile.id,
        sessionId,
        listing: null,
        error: null
      })
      setConnectingPane(id)
      const result = await window.lumine.connect(profile.id, password, sessionId)
      setConnectingPane(null)
      setPasswordTarget(null)
      if (!result.ok) {
        patchPane(id, { sessionId: null })
        reportError(result.code, result.detail, true)
        return
      }
      upsertProfile(result.data.profile)
      void refreshKnownHosts()
      await openRemote(id, '', result.data.sessionId)
    },
    [openRemote, patchPane, refreshKnownHosts, reportError, upsertProfile]
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
        document.documentElement.lang = settings.data.locale
      } else {
        reportError(settings.code, settings.detail)
      }
      if (list.ok) {
        setProfiles(list.data)
        setPanes((current) => ({
          ...current,
          a: {
            ...current.a,
            profileId: current.a.profileId ?? list.data[0]?.id ?? null
          }
        }))
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
      if (!next.sessionId) return
      setStatuses((current) => ({ ...current, [next.sessionId!]: next }))
      if (next.state === 'error') {
        reportError(next.code ?? 'NETWORK_ERROR', next.detail, true)
        setConnectingPane(null)
      }
      if (next.state === 'disconnected') setConnectingPane(null)
    })

    const offHostKey = window.lumine.onHostKey((promptValue) => {
      setPasswordTarget(null)
      setHostKey(promptValue)
    })

    const offInteractive = window.lumine.onInteractive((request) => {
      setPasswordTarget(null)
      setInteractive(request)
    })

    const offTransfer = window.lumine.onTransfer((transfer) => {
      setTransfers((current) => ({ ...current, [transfer.id]: transfer }))
      if (transfer.state === 'error' && !seenTransferErrors.current.has(transfer.id)) {
        seenTransferErrors.current.add(transfer.id)
        notify(
          `${transfer.name}: ${errorText(locale, transfer.code ?? 'TRANSFER_FAILED')}`,
          'error'
        )
      }
    })

    const offUpdate = window.lumine.onUpdate((next) => {
      setUpdateStatus(next)
    })

    const onDragEnd = (): void => {
      dragRef.current = null
      setDragOver(null)
    }
    window.addEventListener('dragend', onDragEnd)

    return () => {
      offStatus()
      offHostKey()
      offInteractive()
      offTransfer()
      offUpdate()
      window.removeEventListener('dragend', onDragEnd)
    }
  }, [locale, notify, reportError])

  const activeProfile =
    profiles.find((item) => item.id === panes.a.profileId) ?? null
  const knownHost = activeProfile
    ? (knownHosts.find(
        (entry) => entry.host === activeProfile.host && entry.port === activeProfile.port
      ) ?? null)
    : null
  const transferList = Object.values(transfers)

  const paneStatus = (id: PaneId): ConnectionStatus | null => {
    const sessionId = panes[id].sessionId
    return sessionId ? (statuses[sessionId] ?? null) : null
  }
  const isConnected = (id: PaneId): boolean => paneStatus(id)?.state === 'connected'
  const isConnecting = (id: PaneId): boolean => {
    const state = paneStatus(id)?.state
    return state !== undefined && CONNECTING_STATES.includes(state)
  }

  const activateEntry = (id: PaneId, entry: RemoteEntry, path: string): void => {
    const pane = panesRef.current[id]
    if (entry.kind === 'directory') {
      void (pane.kind === 'local' ? openLocal(id, path) : openRemote(id, path))
      return
    }
    if (pane.kind === 'local') {
      void window.lumine.local.open(path).then((result) => {
        if (!result.ok) reportError(result.code, result.detail)
      })
      return
    }
    if (!pane.sessionId) return
    notify(translate(locale, 'openingFile'))
    void window.lumine.sftp.open(pane.sessionId, path).then((result) => {
      if (!result.ok) reportError(result.code, result.detail)
    })
  }

  const uploadDialog = async (id: PaneId): Promise<void> => {
    const pane = panesRef.current[id]
    if (!pane.sessionId || !pane.listing) return
    const result = await window.lumine.sftp.upload(pane.sessionId, pane.listing.path)
    if (result.ok) notify(translate(locale, 'uploadStarted'))
    else reportError(result.code, result.detail)
  }

  const downloadDialog = async (id: PaneId, path: string): Promise<void> => {
    const sessionId = panesRef.current[id].sessionId
    if (!sessionId) return
    const result = await window.lumine.sftp.download(sessionId, path)
    if (result.ok) notify(translate(locale, 'downloadStarted'))
    else reportError(result.code, result.detail)
  }

  /** Khung SFTP đang kết nối có thể nhận tệp kéo từ khung local. */
  const otherRemotePane = (id: PaneId): PaneId | null => {
    if (!split) return null
    const candidate: PaneId = id === 'a' ? 'b' : 'a'
    const pane = panesRef.current[candidate]
    return pane.kind === 'remote' && pane.sessionId && pane.listing
      ? candidate
      : null
  }

  const copyToPane = async (payload: DragPayload, target: PaneId): Promise<void> => {
    if (payload.pane === target) return
    const pane = panesRef.current[target]
    if (!pane.listing) return
    if (pane.kind === 'remote' && !pane.sessionId) {
      reportError('NOT_CONNECTED')
      return
    }
    if (payload.kind === 'remote' && !panesRef.current[payload.pane].sessionId) {
      reportError('NOT_CONNECTED')
      return
    }
    const to: Location =
      pane.kind === 'remote'
        ? { kind: 'remote', sessionId: pane.sessionId!, path: pane.listing.path }
        : { kind: 'local', path: pane.listing.path }
    const from: Location =
      payload.kind === 'remote'
        ? {
            kind: 'remote',
            sessionId: panesRef.current[payload.pane].sessionId!,
            path: payload.path
          }
        : { kind: 'local', path: payload.path }
    const result = await window.lumine.transfer.copy(from, to)
    if (result.ok) notify(translate(locale, 'copyStarted'))
    else reportError(result.code, result.detail)
  }

  const uploadFromLocal = async (id: PaneId, path: string): Promise<void> => {
    const target = otherRemotePane(id)
    if (!target) {
      notify(translate(locale, 'uploadTargetMissing'), 'error')
      return
    }
    await copyToPane({ pane: id, kind: 'local', path }, target)
  }

  const transferRow = (id: PaneId, entry: RemoteEntry, path: string): void => {
    if (panesRef.current[id].kind === 'local') {
      void uploadFromLocal(id, path)
      return
    }
    void downloadDialog(id, path)
  }

  const deleteEntry = async (id: PaneId, path: string): Promise<void> => {
    const pane = panesRef.current[id]
    const result =
      pane.kind === 'local'
        ? await window.lumine.local.remove(path)
        : pane.sessionId
          ? await window.lumine.sftp.remove(pane.sessionId, path)
          : ({ ok: false, code: 'NOT_CONNECTED', detail: undefined } as const)
    if (!result.ok) {
      reportError(result.code, result.detail)
      return
    }
    refreshPane(id)
  }

  const submitPrompt = async (value: string): Promise<string | null> => {
    if (!prompt) return null
    const pane = panesRef.current[prompt.pane]
    if (!pane.listing) return null
    if (prompt.kind === 'rename' && prompt.entry.name === value) return null

    let result
    if (pane.kind === 'local') {
      result =
        prompt.kind === 'mkdir'
          ? await window.lumine.local.mkdir(pane.listing.path, value)
          : await window.lumine.local.rename(
              pane.listing.path,
              prompt.entry.name,
              value
            )
    } else if (pane.sessionId) {
      result =
        prompt.kind === 'mkdir'
          ? await window.lumine.sftp.mkdir(pane.sessionId, pane.listing.path, value)
          : await window.lumine.sftp.rename(
              pane.sessionId,
              pane.listing.path,
              prompt.entry.name,
              value
            )
    } else {
      return translate(locale, 'err.NOT_CONNECTED')
    }

    if (!result.ok) return errorText(locale, result.code, result.detail)
    refreshPane(prompt.pane)
    return null
  }

  const respondHostKey = async (accept: boolean): Promise<void> => {
    if (!hostKey) return
    const request = hostKey
    setHostKey(null)
    const result = await window.lumine.respondHostKey(
      request.sessionId,
      request.requestId,
      accept
    )
    if (!result.ok) reportError(result.code, result.detail)
    if (accept) void refreshKnownHosts()
  }

  const answerInteractive = async (answers: string[]): Promise<void> => {
    if (!interactive) return
    const request = interactive
    setInteractive(null)
    const result = await window.lumine.answerInteractive(
      request.sessionId,
      request.requestId,
      false,
      answers
    )
    if (!result.ok) reportError(result.code, result.detail)
  }

  const cancelInteractive = async (): Promise<void> => {
    if (!interactive) return
    const request = interactive
    setInteractive(null)
    const result = await window.lumine.answerInteractive(
      request.sessionId,
      request.requestId,
      true,
      []
    )
    if (!result.ok) reportError(result.code, result.detail)
  }

  const selectSource = async (id: PaneId, value: string): Promise<void> => {
    setContextMenu(null)
    await disconnectPane(id)
    if (value === 'local') {
      patchPane(id, { kind: 'local', profileId: null, listing: null, error: null })
      await openLocal(id, '')
      return
    }
    patchPane(id, {
      kind: 'remote',
      profileId: value,
      listing: null,
      error: null
    })
  }

  const toggleSplit = async (): Promise<void> => {
    const next = !split
    setSplit(next)
    if (next) {
      patchPane('b', {
        kind: 'local',
        profileId: null,
        sessionId: null,
        listing: null,
        error: null
      })
      await openLocal('b', '')
      return
    }
    if (panesRef.current.b.sessionId) await disconnectPane('b')
  }

  const selectSidebarProfile = (profile: Profile): void => {
    if (panes.a.profileId === profile.id && panes.a.kind === 'remote') return
    void disconnectPane('a').then(() => {
      patchPane('a', {
        kind: 'remote',
        profileId: profile.id,
        listing: null,
        error: null
      })
    })
  }

  const removeProfile = async (profile: Profile): Promise<void> => {
    const result = await window.lumine.profiles.remove(profile.id)
    if (!result.ok) {
      reportError(result.code, result.detail)
      return
    }
    await Promise.all(
      (['a', 'b'] as PaneId[]).map(async (id) => {
        if (panesRef.current[id].profileId !== profile.id) return
        if (panesRef.current[id].sessionId) await disconnectPane(id)
        patchPane(id, { profileId: null, kind: 'remote', listing: null, error: null })
      })
    )
    setProfiles((current) => current.filter((item) => item.id !== profile.id))
    notify(translate(locale, 'profileRemoved'))
  }

  const openContextMenu = (
    pane: PaneId,
    entry: RemoteEntry | null,
    event: MouseEvent
  ): void => {
    event.preventDefault()
    const paneState = panesRef.current[pane]
    const items: ContextMenuItem[] = []

    if (entry && paneState.listing) {
      const entryPath = joinPath(paneState.kind, paneState.listing.path, entry.name)
      items.push({
        key: 'open',
        label: translate(locale, 'open'),
        icon: entry.kind === 'directory' ? <FolderIcon /> : <FileIcon />,
        onSelect: () => activateEntry(pane, entry, entryPath)
      })
      if (paneState.kind === 'remote') {
        items.push({
          key: 'download',
          label: translate(locale, 'download'),
          icon: <DownloadIcon />,
          onSelect: () => void downloadDialog(pane, entryPath)
        })
      } else {
        items.push({
          key: 'upload',
          label: translate(locale, 'upload'),
          icon: <UploadIcon />,
          onSelect: () => void uploadFromLocal(pane, entryPath)
        })
      }
      items.push({
        key: 'rename',
        label: translate(locale, 'rename'),
        icon: <PencilIcon />,
        onSelect: () => setPrompt({ pane, kind: 'rename', entry })
      })
      items.push({
        key: 'delete',
        label: translate(locale, 'delete'),
        icon: <TrashIcon />,
        danger: true,
        onSelect: () => void deleteEntry(pane, entryPath)
      })
    } else {
      items.push({
        key: 'mkdir',
        label: translate(locale, 'newFolder'),
        icon: <FolderPlusIcon />,
        onSelect: () => setPrompt({ pane, kind: 'mkdir' })
      })
      if (paneState.kind === 'remote') {
        items.push({
          key: 'upload',
          label: translate(locale, 'upload'),
          icon: <UploadIcon />,
          onSelect: () => void uploadDialog(pane)
        })
      }
      items.push({
        key: 'refresh',
        label: translate(locale, 'refresh'),
        icon: <RefreshIcon />,
        onSelect: () => refreshPane(pane)
      })
    }

    contextItemsRef.current = items
    setContextMenu({ x: event.clientX, y: event.clientY })
  }

  const startDrag = (
    pane: PaneId,
    entry: RemoteEntry,
    path: string,
    event: DragEvent
  ): void => {
    const payload: DragPayload = { pane, kind: panesRef.current[pane].kind, path }
    dragRef.current = payload
    event.dataTransfer.effectAllowed = 'copy'
    event.dataTransfer.setData('text/plain', entry.name)
    event.dataTransfer.setData('application/x-lumine', JSON.stringify(payload))
  }

  const handleDrop = (target: PaneId, event: DragEvent): void => {
    event.preventDefault()
    setDragOver(null)
    const payload = dragRef.current
    dragRef.current = null
    if (payload) void copyToPane(payload, target)
  }

  const renderBrowser = (id: PaneId): ReactNode => {
    const pane = panes[id]
    return (
      <FileBrowser
        listing={pane.listing}
        locale={locale}
        sourceKind={pane.kind}
        busy={pane.busy}
        onOpenDir={(path) =>
          void (pane.kind === 'local' ? openLocal(id, path) : openRemote(id, path))
        }
        onActivate={(entry, path) => activateEntry(id, entry, path)}
        onRefresh={() => refreshPane(id)}
        onUpload={pane.kind === 'remote' ? () => void uploadDialog(id) : undefined}
        onNewFolder={() => setPrompt({ pane: id, kind: 'mkdir' })}
        onRowTransfer={(entry, path) => transferRow(id, entry, path)}
        onRename={(entry) => setPrompt({ pane: id, kind: 'rename', entry })}
        onDelete={(path) => void deleteEntry(id, path)}
        onContextMenu={(entry, event) => openContextMenu(id, entry, event)}
        onDragStartEntry={(entry, path, event) => startDrag(id, entry, path, event)}
      />
    )
  }

  const renderLoadError = (pane: PaneState, onRetry: () => void): ReactNode => (
    <div className="load-error">
      <strong>{translate(locale, 'connectionErrorTitle')}</strong>
      <p>{errorText(locale, pane.error!.code, pane.error!.detail)}</p>
      <button className="button" type="button" onClick={onRetry}>
        {translate(locale, 'retry')}
      </button>
    </div>
  )

  const renderPaneBody = (id: PaneId): ReactNode => {
    const pane = panes[id]
    if (pane.kind === 'local') {
      return pane.error && !pane.listing ? (
        renderLoadError(pane, () => void openLocal(id, ''))
      ) : (
        renderBrowser(id)
      )
    }
    if (isConnected(id)) {
      return pane.error && !pane.listing ? (
        renderLoadError(pane, () => void openRemote(id, ''))
      ) : (
        renderBrowser(id)
      )
    }
    const profile = profiles.find((item) => item.id === pane.profileId) ?? null
    return (
      <div className="pane-empty">
        <strong>{profile ? profile.name : translate(locale, 'profiles')}</strong>
        {profile ? (
          <p className="pane-host">
            {profile.username}@{profile.host}:{profile.port}
          </p>
        ) : null}
        <p>{translate(locale, 'notConnectedHint')}</p>
        {profile ? (
          <button
            className="button primary"
            type="button"
            disabled={isConnecting(id)}
            onClick={() => setPasswordTarget({ pane: id, profile })}
          >
            {translate(locale, 'connect')}
          </button>
        ) : null}
        {pane.error ? (
          <p className="pane-error">
            {errorText(locale, pane.error.code, pane.error.detail)}
          </p>
        ) : null}
      </div>
    )
  }

  const renderPane = (id: PaneId): ReactNode => {
    const pane = panes[id]
    const state = paneStatus(id)?.state ?? 'disconnected'
    return (
      <div
        className={`pane${dragOver === id ? ' drop-target' : ''}`}
        onDragOver={(event) => {
          if (!dragRef.current || dragRef.current.pane === id) return
          event.preventDefault()
          event.dataTransfer.dropEffect = 'copy'
          setDragOver(id)
        }}
        onDragLeave={(event) => {
          if (event.currentTarget.contains(event.relatedTarget as Node)) return
          setDragOver((current) => (current === id ? null : current))
        }}
        onDrop={(event) => handleDrop(id, event)}
      >
        <div className="pane-head">
          <select
            className="pane-source"
            aria-label={translate(locale, 'source')}
            value={pane.kind === 'local' ? 'local' : (pane.profileId ?? '')}
            onChange={(event) => void selectSource(id, event.target.value)}
          >
            <option value="local">{translate(locale, 'localComputer')}</option>
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name}
              </option>
            ))}
          </select>

          {pane.kind === 'remote' ? (
            <>
              <span className={`pill state-${state}`}>
                <span className="status-dot" />
                {statusLabel(locale, state)}
              </span>
              {isConnected(id) || isConnecting(id) ? (
                <button
                  className="button tiny"
                  type="button"
                  onClick={() => void disconnectPane(id)}
                >
                  {isConnected(id)
                    ? translate(locale, 'disconnect')
                    : translate(locale, 'cancelConnection')}
                </button>
              ) : (
                <button
                  className="button tiny primary"
                  type="button"
                  disabled={!pane.profileId || connectingPane === id}
                  onClick={() => {
                    const profile = profiles.find((item) => item.id === pane.profileId)
                    if (profile) setPasswordTarget({ pane: id, profile })
                  }}
                >
                  {translate(locale, 'connect')}
                </button>
              )}
            </>
          ) : (
            <span className="pane-local-label">{translate(locale, 'localComputer')}</span>
          )}
        </div>
        <div className="pane-body">{renderPaneBody(id)}</div>
        {dragOver === id ? (
          <div className="drop-hint">{translate(locale, 'dropHere')}</div>
        ) : null}
      </div>
    )
  }

  const busy = panes.a.busy || (split && panes.b.busy)

  return (
    <div className="app">
      <Sidebar
        profiles={profiles}
        activeProfileId={panes.a.profileId}
        status={paneStatus('a') ?? { state: 'disconnected' }}
        locale={locale}
        onSelect={selectSidebarProfile}
        onAdd={() => setProfileDialog({ mode: 'add' })}
        onQr={() => setQrOpen(true)}
        onSettings={() => setSettingsOpen(true)}
      />

      <main className="main">
        <header className="main-head">
          <div className="main-head-inner">
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

              {!split && panes.a.kind === 'remote' && activeProfile ? (
                <span className={`pill state-${paneStatus('a')?.state ?? 'disconnected'}`}>
                  <span className="status-dot" />
                  {statusLabel(locale, paneStatus('a')?.state ?? 'disconnected')}
                </span>
              ) : null}

              {!split && panes.a.kind === 'remote' && activeProfile ? (
                isConnected('a') || isConnecting('a') ? (
                  <button
                    className="button head-button"
                    type="button"
                    onClick={() => void disconnectPane('a')}
                  >
                    {isConnected('a')
                      ? translate(locale, 'disconnect')
                      : translate(locale, 'cancelConnection')}
                  </button>
                ) : (
                  <button
                    className="button head-button primary"
                    type="button"
                    disabled={connectingPane === 'a'}
                    onClick={() => setPasswordTarget({ pane: 'a', profile: activeProfile })}
                  >
                    {translate(locale, 'connect')}
                  </button>
                )
              ) : null}

              <button
                className={`button head-button${split ? ' primary' : ''}`}
                type="button"
                onClick={() => void toggleSplit()}
                title={translate(locale, split ? 'mergeView' : 'splitView')}
              >
                {translate(locale, split ? 'mergeView' : 'splitView')}
              </button>
            </div>
          </div>
        </header>

        <section className="sheet">
          {connectingPane || busy ? <div className="sheet-progress" /> : null}

          {split ? (
            <div className="panes">
              {renderPane('a')}
              {renderPane('b')}
            </div>
          ) : (
            <div
              className={`sheet-body${
                !activeProfile && panes.a.kind !== 'local' ? ' is-onboarding' : ''
              }`}
            >
              {panes.a.kind === 'local' ? (
                renderBrowser('a')
              ) : isConnected('a') ? (
                panes.a.error && !panes.a.listing ? (
                  renderLoadError(panes.a, () => void openRemote('a', ''))
                ) : (
                  renderBrowser('a')
                )
              ) : activeProfile ? (
                <ProfileDetail
                  profile={activeProfile}
                  status={paneStatus('a') ?? { state: 'disconnected' }}
                  locale={locale}
                  knownHost={knownHost}
                  onConnect={() => setPasswordTarget({ pane: 'a', profile: activeProfile })}
                  onEdit={() => setProfileDialog({ mode: 'edit', profile: activeProfile })}
                  onRemove={() => void removeProfile(activeProfile)}
                />
              ) : (
                <Onboarding
                  locale={locale}
                  onQr={() => setQrOpen(true)}
                  onAdd={() => setProfileDialog({ mode: 'add' })}
                />
              )}
            </div>
          )}

          <Transfers
            transfers={transferList}
            locale={locale}
            onCancel={(id) => {
              void window.lumine.transfer.cancel(id).then((result) => {
                if (!result.ok) reportError(result.code, result.detail)
              })
            }}
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
            if (profileDialog.mode === 'add') {
              patchPane('a', {
                kind: 'remote',
                profileId: profile.id,
                listing: null,
                error: null
              })
            }
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
            patchPane('a', {
              kind: 'remote',
              profileId: profile.id,
              listing: null,
              error: null
            })
            if (connectNow) setPasswordTarget({ pane: 'a', profile })
          }}
        />
      ) : null}

      {passwordTarget ? (
        <PasswordDialog
          profile={passwordTarget.profile}
          locale={locale}
          busy={connectingPane === passwordTarget.pane}
          onClose={() => setPasswordTarget(null)}
          onSubmit={(password) =>
            void connectPane(passwordTarget.pane, passwordTarget.profile, password)
          }
        />
      ) : null}

      {hostKey ? (
        <HostKeyDialog
          prompt={hostKey}
          locale={locale}
          onRespond={(accept) => void respondHostKey(accept)}
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

      {contextMenu ? (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextItemsRef.current}
          onClose={() => setContextMenu(null)}
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
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { app, dialog, ipcMain, shell, type BrowserWindow } from 'electron'
import {
  assertAnswers,
  assertId,
  assertKnownHostKey,
  assertLocale,
  assertPassword,
  assertProfileSave,
  assertRemoteName,
  assertRemotePath,
  assertRequestId,
  ContractError
} from '../shared/contract'
import { IPC, type Err, type Location, type Result } from '../shared/types'
import { AppError, toErr } from './errors'
import { CopyService } from './copy'
import {
  listLocal,
  localHome,
  mkdirLocal,
  normalizeLocalPath,
  removeLocal,
  renameLocal
} from './local-fs'
import { nativeStrings } from './native-strings'
import { SftpSession, type SessionEvents } from './ssh'
import type { Store } from './store'
import {
  checkForUpdates,
  downloadUpdate,
  getUpdateStatus,
  initUpdater,
  installUpdate,
  openReleasePage
} from './updater'

function assertLocalPath(value: unknown): string {
  return normalizeLocalPath(assertRemotePath(value))
}

function assertLocation(value: unknown): Location {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ContractError('location')
  }
  const record = value as Record<string, unknown>
  if (record.kind === 'remote') {
    return {
      kind: 'remote',
      sessionId: assertId(record.sessionId),
      path: assertRemotePath(record.path)
    }
  }
  if (record.kind === 'local') {
    return { kind: 'local', path: assertRemotePath(record.path) }
  }
  throw new ContractError('location')
}

export function registerIpc(window: BrowserWindow, store: Store): void {
  const sessions = new Map<string, SftpSession>()

  const send = (channel: string, payload: unknown): void => {
    if (window.isDestroyed()) return
    window.webContents.send(channel, payload)
  }

  const copyService = new CopyService({
    getSession: (sessionId) => sessions.get(sessionId) ?? null,
    emit: (transfer) => send(IPC.eventTransfer, transfer)
  })

  const sessionEvents = (sessionId: string): SessionEvents => ({
    status: (status) => send(IPC.eventStatus, { ...status, sessionId }),
    hostKey: (prompt) => send(IPC.eventHostKey, { ...prompt, sessionId }),
    interactive: (request) =>
      send(IPC.eventInteractive, { ...request, sessionId }),
    transfer: (transfer) => send(IPC.eventTransfer, { ...transfer, sessionId })
  })

  const requireSession = (rawId: unknown): SftpSession => {
    const sessionId = assertId(rawId)
    const session = sessions.get(sessionId)
    if (!session) throw new AppError('NOT_CONNECTED')
    return session
  }

  const native = () => nativeStrings[store.getLocale()]

  initUpdater((update) => send(IPC.eventUpdate, update))

  function handle<T>(
    channel: string,
    action: (...args: unknown[]) => Promise<T> | T
  ): void {
    ipcMain.handle(channel, async (event, ...args: unknown[]): Promise<Result<T> | Err> => {
      if (event.sender !== window.webContents) {
        return { ok: false, code: 'INTERNAL' }
      }
      try {
        return { ok: true, data: await action(...args) }
      } catch (error) {
        return toErr(error)
      }
    })
  }

  handle(IPC.profilesList, () => store.listProfiles())

  handle(IPC.profilesSave, (raw) => {
    const input = assertProfileSave(raw)
    return store.saveProfile(
      {
        name: input.name,
        host: input.host,
        port: input.port,
        username: input.username
      },
      input.id
    )
  })

  handle(IPC.profilesRemove, (raw) => {
    store.removeProfile(assertId(raw))
    return null
  })

  handle(IPC.settingsGet, () => ({
    locale: store.getLocale(),
    version: app.getVersion()
  }))

  handle(IPC.settingsSetLocale, (raw) => {
    const locale = assertLocale(raw)
    store.setLocale(locale)
    return { locale, version: app.getVersion() }
  })

  handle(IPC.knownHostsList, () => store.listKnownHosts())

  handle(IPC.knownHostsForget, (raw) => {
    store.forgetKnownHost(assertKnownHostKey(raw))
    return null
  })

  handle(IPC.connect, async (rawId, rawPassword, rawSession) => {
    const id = assertId(rawId)
    const password = assertPassword(rawPassword)
    // Khung tự sinh id phiên để mọi sự kiện (host key, interactive, trạng thái)
    // có thể được định tuyến về đúng khung ngay từ bước kết nối.
    const sessionId = assertId(rawSession)
    if (sessions.has(sessionId)) throw new ContractError('session')
    const profile = store.getProfile(id)
    const next = new SftpSession(profile, {
      knownHosts: store,
      events: sessionEvents(sessionId)
    })
    sessions.set(sessionId, next)
    try {
      await next.connect(password)
    } catch (error) {
      next.dispose()
      sessions.delete(sessionId)
      throw error
    }
    store.touchProfile(id)
    return { profile: store.getProfile(id), sessionId }
  })

  handle(IPC.disconnect, (rawId) => {
    const sessionId = assertId(rawId)
    const session = sessions.get(sessionId)
    if (session) {
      session.dispose()
      sessions.delete(sessionId)
    }
    send(IPC.eventStatus, { state: 'disconnected', sessionId })
    return null
  })

  handle(IPC.hostKeyRespond, (rawSession, rawRequestId, rawAccept) => {
    if (typeof rawAccept !== 'boolean') throw new ContractError('accept')
    requireSession(rawSession).respondHostKey(
      assertRequestId(rawRequestId),
      rawAccept
    )
    return null
  })

  handle(IPC.interactiveAnswer, (rawSession, rawRequestId, rawCancelled, rawAnswers) => {
    if (typeof rawCancelled !== 'boolean') throw new ContractError('cancelled')
    const answers = rawCancelled ? [] : assertAnswers(rawAnswers)
    requireSession(rawSession).answerInteractive(
      assertRequestId(rawRequestId),
      rawCancelled,
      answers
    )
    return null
  })

  handle(IPC.sftpList, (rawSession, rawPath) => {
    const path = rawPath === '' || rawPath === undefined ? '' : assertRemotePath(rawPath)
    return requireSession(rawSession).list(path)
  })

  handle(IPC.sftpMkdir, async (rawSession, rawDirectory, rawName) => {
    const directory = assertRemotePath(rawDirectory)
    let name: string
    try {
      name = assertRemoteName(rawName)
    } catch {
      throw new AppError('INVALID_NAME')
    }
    await requireSession(rawSession).mkdir(directory, name)
    return null
  })

  handle(IPC.sftpRename, async (rawSession, rawDirectory, rawFrom, rawTo) => {
    const directory = assertRemotePath(rawDirectory)
    let from: string
    let to: string
    try {
      from = assertRemoteName(rawFrom)
      to = assertRemoteName(rawTo)
    } catch {
      throw new AppError('INVALID_NAME')
    }
    await requireSession(rawSession).rename(directory, from, to)
    return null
  })

  const confirmDelete = async (target: string): Promise<void> => {
    const text = native()
    const decision = await dialog.showMessageBox(window, {
      type: 'warning',
      buttons: [text.cancel, text.deleteAction],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      message: text.deleteTitle,
      detail: `${target}\n\n${text.deleteMessage}`
    })
    if (decision.response !== 1) throw new AppError('DIALOG_CANCELLED')
  }

  handle(IPC.sftpRemove, async (rawSession, rawPath) => {
    const path = assertRemotePath(rawPath)
    const active = requireSession(rawSession)
    await confirmDelete(path)
    await active.remove(path)
    return null
  })

  handle(IPC.sftpUpload, async (rawSession, rawDirectory) => {
    const directory = assertRemotePath(rawDirectory)
    const active = requireSession(rawSession)
    const text = native()
    const picked = await dialog.showOpenDialog(window, {
      title: text.chooseFiles,
      properties: ['openFile', 'multiSelections']
    })
    if (picked.canceled || picked.filePaths.length === 0) {
      throw new AppError('DIALOG_CANCELLED')
    }

    try {
      return { queued: await active.upload(picked.filePaths, directory, false) }
    } catch (error) {
      if (!(error instanceof AppError) || error.code !== 'ALREADY_EXISTS') throw error
      const decision = await dialog.showMessageBox(window, {
        type: 'question',
        buttons: [text.cancel, text.overwriteAction],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
        message: text.overwriteTitle,
        detail: `${text.overwriteMessage(error.detail ?? '')}\n\n${text.overwriteDetail}`
      })
      if (decision.response !== 1) throw new AppError('DIALOG_CANCELLED')
      return { queued: await active.upload(picked.filePaths, directory, true) }
    }
  })

  handle(IPC.sftpDownload, async (rawSession, rawPath) => {
    const remotePath = assertRemotePath(rawPath)
    const text = native()
    const active = requireSession(rawSession)
    const stats = await active.stat(remotePath)
    const picked = await dialog.showOpenDialog(window, {
      title: text.chooseFolder,
      properties: ['openDirectory', 'createDirectory']
    })
    if (picked.canceled || !picked.filePaths[0]) {
      throw new AppError('DIALOG_CANCELLED')
    }
    const localDirectory = picked.filePaths[0]

    if (stats.kind === 'directory') {
      const sessionId = assertId(rawSession)
      copyService.start(
        { kind: 'remote', sessionId, path: remotePath },
        { kind: 'local', path: localDirectory }
      )
      return { queued: 1 }
    }

    try {
      return { queued: await active.download(remotePath, localDirectory, false) }
    } catch (error) {
      if (!(error instanceof AppError) || error.code !== 'ALREADY_EXISTS') throw error
      const decision = await dialog.showMessageBox(window, {
        type: 'question',
        buttons: [text.cancel, text.overwriteAction],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
        message: text.overwriteTitle,
        detail: `${text.overwriteMessage(error.detail ?? '')}\n\n${text.overwriteDetail}`
      })
      if (decision.response !== 1) throw new AppError('DIALOG_CANCELLED')
      return { queued: await active.download(remotePath, localDirectory, true) }
    }
  })

  handle(IPC.sftpOpen, async (rawSession, rawPath) => {
    const sessionId = assertId(rawSession)
    const session = requireSession(rawSession)
    const remotePath = assertRemotePath(rawPath)
    const stats = await session.stat(remotePath)
    if (stats.kind !== 'file' && stats.kind !== 'link') {
      throw new AppError('INVALID_PATH', remotePath)
    }

    const directory = path.join(app.getPath('temp'), 'lumine-open', randomUUID())
    fs.mkdirSync(directory, { recursive: true })
    const jobId = copyService.start(
      { kind: 'remote', sessionId, path: remotePath },
      { kind: 'local', path: directory },
      (destination) => {
        void shell.openPath(destination)
      }
    )
    return { jobId }
  })

  handle(IPC.localHome, () => ({ path: localHome() }))

  handle(IPC.localList, (rawPath) => {
    const target =
      rawPath === '' || rawPath === undefined ? localHome() : assertLocalPath(rawPath)
    return listLocal(target)
  })

  handle(IPC.localMkdir, async (rawDirectory, rawName) => {
    const directory = assertLocalPath(rawDirectory)
    let name: string
    try {
      name = assertRemoteName(rawName)
    } catch {
      throw new AppError('INVALID_NAME')
    }
    await mkdirLocal(directory, name)
    return null
  })

  handle(IPC.localRename, async (rawDirectory, rawFrom, rawTo) => {
    const directory = assertLocalPath(rawDirectory)
    let from: string
    let to: string
    try {
      from = assertRemoteName(rawFrom)
      to = assertRemoteName(rawTo)
    } catch {
      throw new AppError('INVALID_NAME')
    }
    await renameLocal(directory, from, to)
    return null
  })

  handle(IPC.localRemove, async (rawPath) => {
    const target = assertLocalPath(rawPath)
    await confirmDelete(target)
    await removeLocal(target)
    return null
  })

  handle(IPC.localOpen, async (rawPath) => {
    const target = assertLocalPath(rawPath)
    await fs.promises.access(target)
    const error = await shell.openPath(target)
    if (error) throw new AppError('INTERNAL', error)
    return null
  })

  handle(IPC.transferCopy, (rawFrom, rawTo) => {
    const from = assertLocation(rawFrom)
    const to = assertLocation(rawTo)
    if (from.kind === 'remote') requireSession(from.sessionId)
    if (to.kind === 'remote') requireSession(to.sessionId)
    const jobId = copyService.start(from, to)
    return { jobId }
  })

  handle(IPC.transferCancel, (rawId) => {
    const id = assertRequestId(rawId)
    if (copyService.cancel(id)) return null
    for (const session of sessions.values()) {
      try {
        session.cancelTransfer(id)
        return null
      } catch {
        // Không phải lượt truyền của phiên này; thử phiên kế tiếp.
      }
    }
    throw new AppError('INVALID_INPUT', id)
  })

  handle(IPC.updatesGet, () => getUpdateStatus())
  handle(IPC.updatesCheck, () => checkForUpdates())
  handle(IPC.updatesDownload, () => downloadUpdate())
  handle(IPC.updatesInstall, () => {
    installUpdate()
    return null
  })
  handle(IPC.updatesOpenRelease, async () => {
    await openReleasePage()
    return null
  })
}
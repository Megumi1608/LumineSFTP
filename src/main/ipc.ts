import { app, dialog, ipcMain, type BrowserWindow } from 'electron'
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
import { IPC, type Err, type Result } from '../shared/types'
import { AppError, toErr } from './errors'
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

export function registerIpc(window: BrowserWindow, store: Store): void {
  let session: SftpSession | null = null

  const send = (channel: string, payload: unknown): void => {
    if (window.isDestroyed()) return
    window.webContents.send(channel, payload)
  }

  const events: SessionEvents = {
    status: (status) => send(IPC.eventStatus, status),
    hostKey: (prompt) => send(IPC.eventHostKey, prompt),
    interactive: (request) => send(IPC.eventInteractive, request),
    transfer: (transfer) => send(IPC.eventTransfer, transfer)
  }

  const requireSession = (): SftpSession => {
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

  handle(IPC.connect, async (rawId, rawPassword) => {
    const id = assertId(rawId)
    const password = assertPassword(rawPassword)
    const profile = store.getProfile(id)

    session?.dispose()
    session = null

    const next = new SftpSession(profile, { knownHosts: store, events })
    session = next
    try {
      await next.connect(password)
    } catch (error) {
      next.dispose()
      if (session === next) session = null
      throw error
    }
    store.touchProfile(id)
    return store.getProfile(id)
  })

  handle(IPC.disconnect, () => {
    session?.dispose()
    session = null
    send(IPC.eventStatus, { state: 'disconnected' })
    return null
  })

  handle(IPC.hostKeyRespond, (rawRequestId, rawAccept) => {
    if (typeof rawAccept !== 'boolean') throw new ContractError('accept')
    requireSession().respondHostKey(assertRequestId(rawRequestId), rawAccept)
    return null
  })

  handle(IPC.interactiveAnswer, (rawRequestId, rawCancelled, rawAnswers) => {
    if (typeof rawCancelled !== 'boolean') throw new ContractError('cancelled')
    const answers = rawCancelled ? [] : assertAnswers(rawAnswers)
    requireSession().answerInteractive(
      assertRequestId(rawRequestId),
      rawCancelled,
      answers
    )
    return null
  })

  handle(IPC.sftpList, (rawPath) => {
    const path = rawPath === '' || rawPath === undefined ? '' : assertRemotePath(rawPath)
    return requireSession().list(path)
  })

  handle(IPC.sftpMkdir, async (rawDirectory, rawName) => {
    const directory = assertRemotePath(rawDirectory)
    let name: string
    try {
      name = assertRemoteName(rawName)
    } catch {
      throw new AppError('INVALID_NAME')
    }
    await requireSession().mkdir(directory, name)
    return null
  })

  handle(IPC.sftpRename, async (rawDirectory, rawFrom, rawTo) => {
    const directory = assertRemotePath(rawDirectory)
    let from: string
    let to: string
    try {
      from = assertRemoteName(rawFrom)
      to = assertRemoteName(rawTo)
    } catch {
      throw new AppError('INVALID_NAME')
    }
    await requireSession().rename(directory, from, to)
    return null
  })

  handle(IPC.sftpRemove, async (rawPath) => {
    const path = assertRemotePath(rawPath)
    const text = native()
    const decision = await dialog.showMessageBox(window, {
      type: 'warning',
      buttons: [text.cancel, text.deleteAction],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      message: text.deleteTitle,
      detail: `${path}\n\n${text.deleteMessage}`
    })
    if (decision.response !== 1) throw new AppError('DIALOG_CANCELLED')
    await requireSession().remove(path)
    return null
  })

  handle(IPC.sftpUpload, async (rawDirectory) => {
    const directory = assertRemotePath(rawDirectory)
    const text = native()
    const picked = await dialog.showOpenDialog(window, {
      title: text.chooseFiles,
      properties: ['openFile', 'multiSelections']
    })
    if (picked.canceled || picked.filePaths.length === 0) {
      throw new AppError('DIALOG_CANCELLED')
    }

    const active = requireSession()
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

  handle(IPC.sftpDownload, async (rawPath) => {
    const remotePath = assertRemotePath(rawPath)
    const text = native()
    const picked = await dialog.showOpenDialog(window, {
      title: text.chooseFolder,
      properties: ['openDirectory', 'createDirectory']
    })
    if (picked.canceled || !picked.filePaths[0]) {
      throw new AppError('DIALOG_CANCELLED')
    }
    const localDirectory = picked.filePaths[0]
    const active = requireSession()

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

  handle(IPC.sftpCancel, (rawId) => {
    requireSession().cancelTransfer(assertRequestId(rawId))
    return null
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

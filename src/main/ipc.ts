import { app, dialog, ipcMain, shell, type BrowserWindow } from 'electron'
import fs from 'node:fs'
import { utils } from 'ssh2'
import {
  assertAnswers,
  assertConnectSecret,
  assertId,
  assertKnownHostKey,
  assertLocale,
  assertMode,
  assertProfileSave,
  assertRemoteName,
  assertRemotePath,
  assertRemotePaths,
  assertRequestId,
  ContractError
} from '../shared/contract'
import { IPC, type ConflictMode, type Err, type Profile, type Result } from '../shared/types'
import { AppError, toErr } from './errors'
import { nativeStrings } from './native-strings'
import { SftpSession, type ConnectAuth, type SessionEvents } from './ssh'
import type { Store } from './store'
import type { Vault } from './vault'
import {
  checkForUpdates,
  downloadUpdate,
  getUpdateStatus,
  initUpdater,
  installUpdate,
  openReleasePage
} from './updater'

export function registerIpc(window: BrowserWindow, store: Store, vault: Vault): void {
  let session: SftpSession | null = null

  const send = (channel: string, payload: unknown): void => {
    if (window.isDestroyed()) return
    window.webContents.send(channel, payload)
  }

  const events: SessionEvents = {
    status: (status) => send(IPC.eventStatus, status),
    hostKey: (prompt) => send(IPC.eventHostKey, prompt),
    hostKeyMismatch: (prompt) => send(IPC.eventHostKeyMismatch, prompt),
    interactive: (request) => send(IPC.eventInteractive, request),
    transfer: (transfer) => send(IPC.eventTransfer, transfer)
  }

  const requireSession = (): SftpSession => {
    if (!session) throw new AppError('NOT_CONNECTED')
    return session
  }

  const native = () => nativeStrings[store.getLocale()]

  const decorate = async (profile: Profile): Promise<Profile> => ({
    ...profile,
    hasSavedPassword: await vault.has(profile.id)
  })

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

  handle(IPC.profilesList, async () =>
    Promise.all(store.listProfiles().map((profile) => decorate(profile)))
  )

  handle(IPC.profilesSave, async (raw) => {
    const input = assertProfileSave(raw)
    const existing = input.id
      ? store.listProfiles().find((profile) => profile.id === input.id)
      : null
    const saved = store.saveProfile(
      {
        name: input.name,
        host: input.host,
        port: input.port,
        username: input.username,
        authMethod: input.authMethod,
        keyPath: input.keyPath
      },
      input.id
    )
    if (
      existing &&
      (existing.authMethod !== saved.authMethod || existing.keyPath !== saved.keyPath)
    ) {
      await vault.delete(saved.id)
    }
    return decorate(saved)
  })

  handle(IPC.profilesRemove, async (raw) => {
    const id = assertId(raw)
    store.removeProfile(id)
    await vault.delete(id)
    return null
  })

  handle(IPC.profilesPickKey, async () => {
    const text = native()
    const picked = await dialog.showOpenDialog(window, {
      title: text.chooseKey,
      properties: ['openFile'],
      filters: [
        { name: text.keyFiles, extensions: ['pem', 'key', 'ppk', 'openssh', ''] }
      ]
    })
    if (picked.canceled || !picked.filePaths[0]) throw new AppError('DIALOG_CANCELLED')
    const file = picked.filePaths[0]
    const stats = fs.statSync(file)
    if (!stats.isFile() || stats.size > 1024 * 1024) {
      throw new AppError('INVALID_PATH', file)
    }
    return file
  })

  handle(IPC.secretsForget, async (raw) => {
    const id = assertId(raw)
    await vault.delete(id)
    return decorate(store.getProfile(id))
  })

  handle(IPC.settingsGet, async () => ({
    locale: store.getLocale(),
    version: app.getVersion(),
    knownHostsHealth: store.getKnownHostsHealth(),
    secretStorageAvailable: await vault.isAvailable()
  }))

  handle(IPC.settingsSetLocale, async (raw) => {
    const locale = assertLocale(raw)
    store.setLocale(locale)
    return {
      locale,
      version: app.getVersion(),
      knownHostsHealth: store.getKnownHostsHealth(),
      secretStorageAvailable: await vault.isAvailable()
    }
  })

  handle(IPC.knownHostsList, () => store.listKnownHosts())

  handle(IPC.knownHostsForget, (raw) => {
    store.forgetKnownHost(assertKnownHostKey(raw))
    return null
  })

  handle(IPC.bookmarksList, (raw) => store.listBookmarks(assertId(raw)))

  handle(IPC.bookmarksAdd, (rawProfileId, rawPath) =>
    store.addBookmark(assertId(rawProfileId), assertRemotePath(rawPath))
  )

  handle(IPC.bookmarksRemove, (raw) => {
    store.removeBookmark(assertId(raw))
    return null
  })

  handle(IPC.connect, async (rawId, rawSecret) => {
    const id = assertId(rawId)
    const secret = assertConnectSecret(rawSecret)
    const profile = store.getProfile(id)

    let auth: ConnectAuth
    if (profile.authMethod === 'key') {
      if (!profile.keyPath) throw new AppError('INVALID_INPUT', 'keyPath')
      let keyData: Buffer
      try {
        keyData = fs.readFileSync(profile.keyPath)
      } catch {
        throw new AppError('NO_SUCH_FILE', profile.keyPath)
      }
      if (keyData.length > 1024 * 1024) throw new AppError('INVALID_INPUT', 'key size')

      const passphrase =
        secret.passphrase ?? (await vault.get(id, 'passphrase')) ?? undefined
      const parsed = utils.parseKey(keyData, passphrase)
      if (parsed instanceof Error) {
        if (!passphrase && /passphrase|encrypted|decrypt/i.test(parsed.message)) {
          throw new AppError('SECRET_REQUIRED', 'passphrase')
        }
        throw new AppError('AUTH_FAILED', parsed.message)
      }
      auth = { privateKey: keyData, ...(passphrase ? { passphrase } : {}) }
    } else {
      const password = secret.password ?? (await vault.get(id, 'password')) ?? undefined
      if (!password) throw new AppError('SECRET_REQUIRED', 'password')
      auth = { password }
    }

    session?.dispose()
    session = null

    const next = new SftpSession(profile, { knownHosts: store, events })
    session = next
    try {
      await next.connect(auth)
    } catch (error) {
      next.dispose()
      if (session === next) session = null
      throw error
    }
    store.touchProfile(id)

    const provided =
      profile.authMethod === 'key' ? secret.passphrase : secret.password
    if (provided && (secret.saveSecret || (await vault.has(id)))) {
      if (await vault.isAvailable()) {
        try {
          await vault.set(
            id,
            profile.authMethod === 'key' ? 'passphrase' : 'password',
            provided
          )
        } catch {
          // The connection succeeded; a vault write failure must not fail it.
        }
      }
    }

    return decorate(store.getProfile(id))
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

  const resolveConflict = async (names: string[]): Promise<ConflictMode | null> => {
    const text = native()
    const decision = await dialog.showMessageBox(window, {
      type: 'question',
      buttons: [text.cancel, text.skipAction, text.overwriteAction, text.renameAction],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      message: text.conflictTitle(names.length),
      detail: `${text.conflictMessage}\n\n${names.slice(0, 20).join('\n')}`
    })
    if (decision.response === 0) return null
    if (decision.response === 1) return 'skip'
    if (decision.response === 2) return 'overwrite'
    return 'rename'
  }

  const withConflict = async <T>(
    action: (mode: ConflictMode) => Promise<T>
  ): Promise<T> => {
    try {
      return await action('error')
    } catch (error) {
      if (!(error instanceof AppError) || error.code !== 'ALREADY_EXISTS') throw error
      const names = (error.detail ?? '').split('\n').filter(Boolean)
      const mode = await resolveConflict(names)
      if (!mode) throw new AppError('DIALOG_CANCELLED')
      return action(mode)
    }
  }

  handle(IPC.sftpRemove, async (rawPaths) => {
    const paths = assertRemotePaths(rawPaths)
    const text = native()
    const active = requireSession()
    let items = 0
    let truncated = false
    let hasDirectory = false
    for (const path of paths) {
      try {
        const info = await active.describeDelete(path)
        if (info.directory) {
          hasDirectory = true
          items += info.items
          truncated = truncated || info.truncated
        }
      } catch {
        // Preview is best-effort; deletion still reports its own errors.
      }
    }
    const detailParts = [paths.slice(0, 20).join('\n')]
    if (hasDirectory) detailParts.push(text.deleteFolderDetail(items, truncated))
    detailParts.push(text.deleteMessage)
    const decision = await dialog.showMessageBox(window, {
      type: 'warning',
      buttons: [text.cancel, text.deleteAction],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      message: text.deleteTitle,
      detail: detailParts.join('\n\n')
    })
    if (decision.response !== 1) throw new AppError('DIALOG_CANCELLED')
    for (const path of paths) await active.remove(path)
    return { queued: paths.length }
  })

  const pickAndUpload = async (
    directory: string,
    picker: 'files' | 'folder'
  ): Promise<{ queued: number }> => {
    const text = native()
    const picked = await dialog.showOpenDialog(window, {
      title: picker === 'files' ? text.chooseFiles : text.chooseUploadFolder,
      properties: picker === 'files' ? ['openFile', 'multiSelections'] : ['openDirectory']
    })
    if (picked.canceled || picked.filePaths.length === 0) {
      throw new AppError('DIALOG_CANCELLED')
    }
    const active = requireSession()
    return {
      queued: await withConflict((mode) =>
        active.upload(picked.filePaths, directory, mode)
      )
    }
  }

  handle(IPC.sftpUpload, (rawDirectory) =>
    pickAndUpload(assertRemotePath(rawDirectory), 'files')
  )

  handle(IPC.sftpUploadFolder, (rawDirectory) =>
    pickAndUpload(assertRemotePath(rawDirectory), 'folder')
  )

  handle(IPC.sftpDownload, async (rawPaths) => {
    const paths = assertRemotePaths(rawPaths)
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
    return {
      queued: await withConflict((mode) =>
        active.download(paths, localDirectory, mode)
      )
    }
  })

  handle(IPC.sftpCancel, (rawId) => {
    requireSession().cancelTransfer(assertRequestId(rawId))
    return null
  })

  handle(IPC.sftpRetry, (rawId) => {
    requireSession().retryTransfer(assertRequestId(rawId))
    return null
  })

  handle(IPC.sftpReveal, (rawId) => {
    const path = requireSession().getDownloadPath(assertRequestId(rawId))
    if (!path) throw new AppError('INVALID_INPUT', 'download')
    shell.showItemInFolder(path)
    return null
  })

  handle(IPC.sftpChmod, async (rawPath, rawMode) => {
    await requireSession().chmod(assertRemotePath(rawPath), assertMode(rawMode))
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

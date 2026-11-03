import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC,
  type ConnectSecret,
  type ConnectionStatus,
  type HostKeyMismatchPrompt,
  type HostKeyPrompt,
  type InteractiveRequest,
  type Location,
  type LumineApi,
  type ProfileInput,
  type TransferInfo,
  type UpdateStatus
} from '../shared/types'

function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, payload: T): void => {
    callback(payload)
  }
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

const api: LumineApi = {
  profiles: {
    list: () => ipcRenderer.invoke(IPC.profilesList),
    save: (input: ProfileInput & { id?: string }) =>
      ipcRenderer.invoke(IPC.profilesSave, input),
    remove: (id: string) => ipcRenderer.invoke(IPC.profilesRemove, id),
    pickKey: () => ipcRenderer.invoke(IPC.profilesPickKey)
  },
  secrets: {
    forget: (profileId: string) => ipcRenderer.invoke(IPC.secretsForget, profileId)
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    setLocale: (locale) => ipcRenderer.invoke(IPC.settingsSetLocale, locale)
  },
  knownHosts: {
    list: () => ipcRenderer.invoke(IPC.knownHostsList),
    forget: (key: string) => ipcRenderer.invoke(IPC.knownHostsForget, key)
  },
  bookmarks: {
    list: (profileId: string) => ipcRenderer.invoke(IPC.bookmarksList, profileId),
    add: (profileId: string, path: string) =>
      ipcRenderer.invoke(IPC.bookmarksAdd, profileId, path),
    remove: (id: string) => ipcRenderer.invoke(IPC.bookmarksRemove, id)
  },
  connect: (profileId: string, secret: ConnectSecret, sessionId: string) =>
    ipcRenderer.invoke(IPC.connect, profileId, secret, sessionId),
  disconnect: (sessionId: string) => ipcRenderer.invoke(IPC.disconnect, sessionId),
  respondHostKey: (sessionId: string, requestId: string, accept: boolean) =>
    ipcRenderer.invoke(IPC.hostKeyRespond, sessionId, requestId, accept),
  answerInteractive: (
    sessionId: string,
    requestId: string,
    cancelled: boolean,
    answers: string[]
  ) =>
    ipcRenderer.invoke(
      IPC.interactiveAnswer,
      sessionId,
      requestId,
      cancelled,
      answers
    ),
  sftp: {
    list: (sessionId: string, path: string) =>
      ipcRenderer.invoke(IPC.sftpList, sessionId, path),
    mkdir: (sessionId: string, dir: string, name: string) =>
      ipcRenderer.invoke(IPC.sftpMkdir, sessionId, dir, name),
    rename: (sessionId: string, dir: string, from: string, to: string) =>
      ipcRenderer.invoke(IPC.sftpRename, sessionId, dir, from, to),
    remove: (sessionId: string, paths: string[]) =>
      ipcRenderer.invoke(IPC.sftpRemove, sessionId, paths),
    upload: (sessionId: string, dir: string) =>
      ipcRenderer.invoke(IPC.sftpUpload, sessionId, dir),
    uploadFolder: (sessionId: string, dir: string) =>
      ipcRenderer.invoke(IPC.sftpUploadFolder, sessionId, dir),
    download: (sessionId: string, paths: string[]) =>
      ipcRenderer.invoke(IPC.sftpDownload, sessionId, paths),
    open: (sessionId: string, path: string) =>
      ipcRenderer.invoke(IPC.sftpOpen, sessionId, path),
    retry: (id: string) => ipcRenderer.invoke(IPC.sftpRetry, id),
    reveal: (id: string) => ipcRenderer.invoke(IPC.sftpReveal, id),
    chmod: (sessionId: string, path: string, mode: number) =>
      ipcRenderer.invoke(IPC.sftpChmod, sessionId, path, mode)
  },
  local: {
    home: () => ipcRenderer.invoke(IPC.localHome),
    list: (path: string) => ipcRenderer.invoke(IPC.localList, path),
    mkdir: (dir: string, name: string) =>
      ipcRenderer.invoke(IPC.localMkdir, dir, name),
    rename: (dir: string, from: string, to: string) =>
      ipcRenderer.invoke(IPC.localRename, dir, from, to),
    remove: (path: string) => ipcRenderer.invoke(IPC.localRemove, path),
    open: (path: string) => ipcRenderer.invoke(IPC.localOpen, path)
  },
  transfer: {
    copy: (from: Location, to: Location) =>
      ipcRenderer.invoke(IPC.transferCopy, from, to),
    cancel: (id: string) => ipcRenderer.invoke(IPC.transferCancel, id)
  },
  updates: {
    get: () => ipcRenderer.invoke(IPC.updatesGet),
    check: () => ipcRenderer.invoke(IPC.updatesCheck),
    download: () => ipcRenderer.invoke(IPC.updatesDownload),
    install: () => ipcRenderer.invoke(IPC.updatesInstall),
    openRelease: () => ipcRenderer.invoke(IPC.updatesOpenRelease)
  },
  onStatus: (callback: (status: ConnectionStatus) => void) =>
    subscribe(IPC.eventStatus, callback),
  onHostKey: (callback: (prompt: HostKeyPrompt) => void) =>
    subscribe(IPC.eventHostKey, callback),
  onHostKeyMismatch: (callback: (prompt: HostKeyMismatchPrompt) => void) =>
    subscribe(IPC.eventHostKeyMismatch, callback),
  onInteractive: (callback: (request: InteractiveRequest) => void) =>
    subscribe(IPC.eventInteractive, callback),
  onTransfer: (callback: (transfer: TransferInfo) => void) =>
    subscribe(IPC.eventTransfer, callback),
  onUpdate: (callback: (status: UpdateStatus) => void) =>
    subscribe(IPC.eventUpdate, callback)
}

contextBridge.exposeInMainWorld('lumine', api)

export type { LumineApi }

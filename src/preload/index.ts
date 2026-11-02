import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC,
  type ConnectionStatus,
  type HostKeyPrompt,
  type InteractiveRequest,
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
    remove: (id: string) => ipcRenderer.invoke(IPC.profilesRemove, id)
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    setLocale: (locale) => ipcRenderer.invoke(IPC.settingsSetLocale, locale)
  },
  knownHosts: {
    list: () => ipcRenderer.invoke(IPC.knownHostsList),
    forget: (key: string) => ipcRenderer.invoke(IPC.knownHostsForget, key)
  },
  connect: (profileId: string, password: string) =>
    ipcRenderer.invoke(IPC.connect, profileId, password),
  disconnect: () => ipcRenderer.invoke(IPC.disconnect),
  respondHostKey: (requestId: string, accept: boolean) =>
    ipcRenderer.invoke(IPC.hostKeyRespond, requestId, accept),
  answerInteractive: (requestId: string, cancelled: boolean, answers: string[]) =>
    ipcRenderer.invoke(IPC.interactiveAnswer, requestId, cancelled, answers),
  sftp: {
    list: (path: string) => ipcRenderer.invoke(IPC.sftpList, path),
    mkdir: (dir: string, name: string) => ipcRenderer.invoke(IPC.sftpMkdir, dir, name),
    rename: (dir: string, from: string, to: string) =>
      ipcRenderer.invoke(IPC.sftpRename, dir, from, to),
    remove: (path: string) => ipcRenderer.invoke(IPC.sftpRemove, path),
    upload: (dir: string) => ipcRenderer.invoke(IPC.sftpUpload, dir),
    download: (path: string) => ipcRenderer.invoke(IPC.sftpDownload, path),
    cancel: (id: string) => ipcRenderer.invoke(IPC.sftpCancel, id)
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
  onInteractive: (callback: (request: InteractiveRequest) => void) =>
    subscribe(IPC.eventInteractive, callback),
  onTransfer: (callback: (transfer: TransferInfo) => void) =>
    subscribe(IPC.eventTransfer, callback),
  onUpdate: (callback: (status: UpdateStatus) => void) =>
    subscribe(IPC.eventUpdate, callback)
}

contextBridge.exposeInMainWorld('lumine', api)

export type { LumineApi }

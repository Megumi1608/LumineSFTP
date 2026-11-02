import { app, shell } from 'electron'
import { autoUpdater, type UpdateInfo } from 'electron-updater'
import type { UpdateStatus } from '../shared/types'
import { AppError, cleanDetail } from './errors'

export const RELEASE_URL = 'https://github.com/Megumi1608/LumineSFTP/releases/latest'

let emit: (status: UpdateStatus) => void = () => {}
let status: UpdateStatus = {
  state: 'idle',
  canAutoUpdate: process.platform === 'win32'
}
let initialized = false

function setStatus(next: UpdateStatus): void {
  status = next
  emit(next)
}

function messageOf(error: unknown): string {
  return cleanDetail(error instanceof Error ? error.message : error) ?? 'update failed'
}

function canAutoUpdate(): boolean {
  return app.isPackaged && process.platform === 'win32'
}

export function getUpdateStatus(): UpdateStatus {
  return status
}

export async function checkForUpdates(): Promise<UpdateStatus> {
  if (!app.isPackaged) {
    setStatus({
      state: 'unsupported',
      message: 'dev',
      canAutoUpdate: false
    })
    return status
  }

  setStatus({ state: 'checking', canAutoUpdate: canAutoUpdate() })
  try {
    await autoUpdater.checkForUpdates()
  } catch (error) {
    setStatus({
      state: 'error',
      message: messageOf(error),
      canAutoUpdate: canAutoUpdate()
    })
  }
  return status
}

export async function downloadUpdate(): Promise<UpdateStatus> {
  if (!canAutoUpdate()) {
    setStatus({
      state: 'unsupported',
      canAutoUpdate: false
    })
    return status
  }

  setStatus({
    state: 'downloading',
    percent: 0,
    ...(status.version ? { version: status.version } : {}),
    canAutoUpdate: true
  })
  try {
    await autoUpdater.downloadUpdate()
  } catch (error) {
    setStatus({
      state: 'error',
      message: messageOf(error),
      canAutoUpdate: true
    })
  }
  return status
}

export function installUpdate(): void {
  if (status.state !== 'downloaded') {
    throw new AppError('UPDATE_FAILED', 'no downloaded update')
  }
  autoUpdater.quitAndInstall(false, true)
}

export async function openReleasePage(): Promise<void> {
  await shell.openExternal(RELEASE_URL)
}

export function initUpdater(listener: (status: UpdateStatus) => void): void {
  emit = listener
  if (initialized) return
  initialized = true

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowPrerelease = false

  autoUpdater.on('checking-for-update', () => {
    setStatus({ state: 'checking', canAutoUpdate: canAutoUpdate() })
  })

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    setStatus({
      state: 'available',
      version: info.version,
      canAutoUpdate: canAutoUpdate()
    })
  })

  autoUpdater.on('update-not-available', () => {
    setStatus({ state: 'not-available', canAutoUpdate: canAutoUpdate() })
  })

  autoUpdater.on('download-progress', (progress) => {
    setStatus({
      state: 'downloading',
      percent: Math.max(0, Math.min(100, Math.round(progress.percent))),
      ...(status.version ? { version: status.version } : {}),
      canAutoUpdate: canAutoUpdate()
    })
  })

  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    setStatus({
      state: 'downloaded',
      version: info.version,
      percent: 100,
      canAutoUpdate: canAutoUpdate()
    })
  })

  autoUpdater.on('error', (error) => {
    setStatus({
      state: 'error',
      message: messageOf(error),
      canAutoUpdate: canAutoUpdate()
    })
  })

  emit(status)

  if (app.isPackaged) {
    setTimeout(() => {
      void checkForUpdates()
    }, 12_000).unref()
  }
}

import {
  app,
  BrowserWindow,
  Menu,
  screen,
  session,
  type MenuItemConstructorOptions,
  type Rectangle
} from 'electron'
import { join } from 'node:path'
import { PROD_CSP } from '../shared/csp'
import type { WindowState } from '../shared/types'
import { registerIpc } from './ipc'
import { Store } from './store'
import { Vault } from './vault'

app.setName('Lumine SFTP')
app.enableSandbox()

const isDev = !app.isPackaged
const ownsLock = app.requestSingleInstanceLock()

let mainWindow: BrowserWindow | null = null
let store: Store | null = null

app.on('web-contents-created', (_event, contents) => {
  contents.on('will-navigate', (event, url) => {
    if (url !== contents.getURL()) event.preventDefault()
  })
  contents.on('will-redirect', (event, url) => {
    if (url !== contents.getURL()) event.preventDefault()
  })
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  contents.on('will-attach-webview', (event) => event.preventDefault())
})

function installSessionSecurity(): void {
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false)
  })
  session.defaultSession.setPermissionCheckHandler(() => false)
  session.defaultSession.setSpellCheckerEnabled(false)
  if (!isDev) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [`${PROD_CSP}; frame-ancestors 'none'`]
        }
      })
    })
  }
}

function buildMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
    { role: 'editMenu' },
    { role: 'windowMenu' },
    ...(isDev
      ? [
          {
            label: 'Developer',
            submenu: [
              { role: 'reload' as const },
              { role: 'toggleDevTools' as const }
            ]
          }
        ]
      : [])
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function savedBounds(state: WindowState | null): Partial<Rectangle> {
  if (!state) return {}
  const width = Math.round(state.width)
  const height = Math.round(state.height)
  if (state.x === undefined || state.y === undefined) return { width, height }
  const x = Math.round(state.x)
  const y = Math.round(state.y)
  const visible = screen.getAllDisplays().some((display) => {
    const area = display.workArea
    return (
      x < area.x + area.width &&
      x + width > area.x &&
      y < area.y + area.height &&
      y + height > area.y
    )
  })
  return visible ? { x, y, width, height } : { width, height }
}

function createWindow(state: WindowState | null): BrowserWindow {
  const window = new BrowserWindow({
    width: 1180,
    height: 760,
    ...savedBounds(state),
    minWidth: 940,
    minHeight: 600,
    show: false,
    title: 'Lumine SFTP',
    backgroundColor: '#0b0b0b',
    autoHideMenuBar: true,
    ...(isDev ? { icon: join(__dirname, '../../build/icon.png') } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webviewTag: false,
      spellcheck: false,
      devTools: isDev,
      safeDialogs: true
    }
  })

  if (state?.maximized) window.maximize()
  window.once('ready-to-show', () => window.show())
  window.on('close', () => {
    if (!store || window.isDestroyed()) return
    const bounds = window.getNormalBounds()
    store.setWindowState({
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
      maximized: window.isMaximized()
    })
  })
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null
  })
  window.webContents.on('render-process-gone', (_event, details) => {
    if (isDev) console.error('[renderer] gone:', details.reason)
  })

  return window
}

if (!ownsLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })

  app.whenReady().then(() => {
    store = new Store(app.getPath('userData'))
    installSessionSecurity()
    buildMenu()

    mainWindow = createWindow(store.getWindowState())
    registerIpc(mainWindow, store, new Vault(app.getPath('userData')))

    const devUrl = process.env.ELECTRON_RENDERER_URL
    if (isDev && devUrl) {
      void mainWindow.loadURL(devUrl)
    } else {
      void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
    }
  })

  app.on('window-all-closed', () => {
    app.quit()
  })
}

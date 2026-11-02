import { app, BrowserWindow, Menu, session, type MenuItemConstructorOptions } from 'electron'
import { join } from 'node:path'
import { registerIpc } from './ipc'
import { Store } from './store'

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

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 940,
    minHeight: 600,
    show: false,
    title: 'Lumine SFTP',
    backgroundColor: '#0b0b0b',
    autoHideMenuBar: true,
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

  window.once('ready-to-show', () => window.show())
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

    mainWindow = createWindow()
    registerIpc(mainWindow, store)

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

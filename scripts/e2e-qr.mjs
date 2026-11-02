import { _electron as electron } from 'playwright-core'
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import QRCode from 'qrcode'

const require = createRequire(import.meta.url)
const electronPath = require('electron')

mkdirSync('artifacts', { recursive: true })

const payload = {
  host: '127.0.0.1',
  port: 2222,
  username: 'test',
  name: 'Local SFTP'
}
await QRCode.toFile('artifacts/qr-valid.png', JSON.stringify(payload), { width: 420, margin: 2 })

const app = await electron.launch({
  executablePath: electronPath,
  args: ['.'],
  cwd: process.cwd(),
  env: { ...process.env, NODE_ENV: 'production' }
})

const page = await app.firstWindow()
const messages = []
page.on('console', (message) => messages.push(`[console:${message.type()}] ${message.text()}`))
page.on('pageerror', (error) => messages.push(`[pageerror] ${error.message}`))

await page.waitForSelector('.app', { timeout: 20000 })
await page.getByRole('button', { name: 'Nhập từ QR' }).first().click()
await page.waitForSelector('.drop-zone')
await page.locator('input[type=file]').setInputFiles('artifacts/qr-valid.png')
await page.waitForSelector('.qr-preview', { timeout: 10000 })

const preview = (await page.locator('.qr-preview').innerText()).replace(/\n/g, ' | ')
console.log('preview:', preview)
if (!preview.includes('127.0.0.1') || !preview.includes('2222') || !preview.includes('test')) {
  throw new Error('QR preview did not contain the expected values')
}

await page.screenshot({ path: 'artifacts/smoke-qr-preview.png', fullPage: true })
await page.getByRole('button', { name: 'Lưu kết nối', exact: true }).click()
await page.waitForSelector('.profile-item', { timeout: 10000 })
const sidebar = (await page.locator('.profile-list').innerText()).replace(/\n/g, ' | ')
console.log('sidebar:', sidebar)
if (!sidebar.includes('Local SFTP')) throw new Error('profile was not saved')

await page.screenshot({ path: 'artifacts/smoke-qr-saved.png', fullPage: true })
console.log('messages:', messages.length ? messages.filter((m) => !m.includes('frame-ancestors')).join('\n') : '(none)')

await app.close()

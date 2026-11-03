import { _electron as electron } from 'playwright-core'
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'

const require = createRequire(import.meta.url)
const electronPath = require('electron')

mkdirSync('artifacts', { recursive: true })

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

const profileName = `E2E ${Date.now()}`

// Create a profile manually.
await page.getByRole('button', { name: 'Thêm kết nối' }).first().click()
await page.waitForSelector('.modal')
const inputs = page.locator('.modal input')
await inputs.nth(0).fill(profileName)
await inputs.nth(1).fill('127.0.0.1')
await inputs.nth(2).fill('2222')
await inputs.nth(3).fill('test')
await page.getByRole('button', { name: 'Lưu', exact: true }).click()
await page.waitForSelector(`.profile-item:has-text("${profileName}")`)

// Wrong password should produce a clear error and no session.
await page.getByRole('button', { name: 'Kết nối', exact: true }).click()
await page.waitForSelector('.modal input[type=password]')
await page.locator('.modal input[type=password]').fill('definitely-wrong')
await page.getByRole('button', { name: 'Đăng nhập' }).click()

// The very first connection asks for host key confirmation before authentication.
await page.waitForTimeout(1500)
const hostKeyDialog = page.locator('.modal', { hasText: 'Xác minh host key' })
if (await hostKeyDialog.count()) {
  console.log('host key prompt shown')
  await page.screenshot({ path: 'artifacts/smoke-hostkey.png', fullPage: true })
  await page.getByRole('button', { name: 'Tin cậy & kết nối' }).click()
}

await page.waitForSelector('.toast-error', { timeout: 20000 })
const wrongMessage = await page.locator('.toast-error').first().innerText()
console.log('wrong password message:', wrongMessage.replace(/\n/g, ' '))
if (!wrongMessage.includes('Sai mật khẩu')) throw new Error('wrong password was not reported')

// Correct password (the dialog stays open after a failed attempt).
await page.locator('.modal input[type=password]').fill('testpass')
await page.getByRole('button', { name: 'Đăng nhập' }).click()

await page.waitForSelector('.file-head', { timeout: 20000 })
const body = (await page.locator('.browser').innerText()).replace(/\n/g, ' | ')
console.log('browser:', body.slice(0, 400))
if (!body.includes('upload')) throw new Error('writable upload folder not listed')
await page.screenshot({ path: 'artifacts/smoke-connected.png', fullPage: true })

// Enter the upload folder.
await page.locator('.file-row', { hasText: 'upload' }).dblclick()
await page.waitForFunction(
  () => document.querySelector('.breadcrumbs')?.textContent?.includes('upload') ?? false,
  null,
  { timeout: 10000 }
)

// Create a folder.
const folderName = `e2e-${Date.now()}`
await page.getByRole('button', { name: 'Thư mục mới' }).click()
await page.waitForSelector('.modal input')
await page.locator('.modal input').fill(folderName)
await page.getByRole('button', { name: 'Đồng ý' }).click()
await page.waitForSelector(`.file-row:has-text("${folderName}")`, { timeout: 10000 })

// Rename it.
const row = page.locator(`.file-row:has-text("${folderName}")`)
await row.locator('button[title="Đổi tên"]').click()
await page.waitForSelector('.modal input')
await page.locator('.modal input').fill(`${folderName}-renamed`)
await page.getByRole('button', { name: 'Đồng ý' }).click()
await page.waitForSelector(`.file-row:has-text("${folderName}-renamed")`, { timeout: 10000 })
console.log('folder create + rename ok')

// Disconnect and clean up the test profile.
await page.getByRole('button', { name: 'Ngắt kết nối' }).click()
await page.waitForSelector('.detail', { timeout: 10000 })

await page.getByRole('button', { name: 'Xoá kết nối', exact: true }).click()
await page.getByRole('button', { name: 'Xác nhận xoá', exact: true }).click()
await page.waitForTimeout(500)

// Forget the pinned host key so the next run sees the prompt again.
await page.locator('.sidebar-foot .icon-button').click()
await page.waitForSelector('.modal')
const knownHost = page.locator('.known-host', { hasText: '127.0.0.1:2222' })
if (await knownHost.count()) {
  await knownHost.getByRole('button', { name: 'Quên' }).click()
  await knownHost.getByRole('button', { name: 'Xác nhận?' }).click()
  await page.waitForTimeout(400)
}
await page.getByRole('button', { name: 'Đóng' }).click()

console.log('messages:', messages.filter((item) => !item.includes('frame-ancestors')).join('\n') || '(none)')
await app.close()

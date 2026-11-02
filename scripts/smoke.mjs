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
await page.waitForTimeout(700)

console.log('title:', await page.title())
console.log('lang:', await page.locator('html').getAttribute('lang'))
console.log('body:', (await page.locator('body').innerText()).replace(/\n/g, ' | ').slice(0, 800))
console.log('csp:', await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content'))
console.log('messages:', messages.length ? messages.join('\n') : '(none)')

await page.screenshot({ path: 'artifacts/smoke-welcome.png', fullPage: true })
await app.close()

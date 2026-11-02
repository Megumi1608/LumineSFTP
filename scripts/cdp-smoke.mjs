import { spawn } from 'node:child_process'
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'

const executablePath = 'release/win-unpacked/Lumine SFTP.exe'
mkdirSync('artifacts', { recursive: true })

const child = spawn(executablePath, ['--remote-debugging-port=9222'], {
  stdio: 'ignore',
  windowsHide: false
})

async function waitForDebugger() {
  for (let index = 0; index < 40; index += 1) {
    try {
      const response = await fetch('http://127.0.0.1:9222/json/version')
      if (response.ok) return
    } catch {
      // not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('CDP endpoint did not start')
}

let browser
try {
  await waitForDebugger()
  browser = await chromium.connectOverCDP('http://127.0.0.1:9222')
  const page = browser.contexts().flatMap((context) => context.pages())[0]
  if (!page) throw new Error('no renderer page')
  await page.waitForSelector('.app', { timeout: 15000 })
  console.log('title:', await page.title())
  console.log('body:', (await page.locator('.app').innerText()).replace(/\n/g, ' | ').slice(0, 400))

  await page.locator('.sidebar-foot .icon-button').click()
  await page.waitForSelector('.modal')
  const modalText = await page.locator('.modal').innerText()
  console.log('settings has updates:', modalText.includes('Cập nhật'))
  console.log('update section:', modalText.split('\n').slice(0, 22).join(' | '))
  await page.screenshot({ path: 'artifacts/packaged-settings.png', fullPage: true })

  await page.getByRole('button', { name: 'Kiểm tra cập nhật' }).click()
  await page.waitForTimeout(5000)
  const after = await page.locator('.modal').innerText()
  console.log('after check:', after.split('\n').slice(0, 24).join(' | '))
} finally {
  if (browser) await browser.close()
  child.kill()
  await new Promise((resolve) => setTimeout(resolve, 500))
}

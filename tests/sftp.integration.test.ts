import { createHash, randomBytes } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { KnownHost, Profile, TransferInfo } from '../src/shared/types'
import { AppError } from '../src/main/errors'
import { SftpSession, type SessionEvents } from '../src/main/ssh'

const enabled = process.env.SFTP_IT === '1'
const host = process.env.SFTP_HOST ?? '127.0.0.1'
const port = Number(process.env.SFTP_PORT ?? 2222)
const username = process.env.SFTP_USER ?? 'test'
const password = process.env.SFTP_PASSWORD ?? 'testpass'

interface Waiter {
  name: string
  direction: 'upload' | 'download'
  resolve: (transfer: TransferInfo) => void
  reject: (error: Error) => void
}

function makeHarness(profile: Profile) {
  const hosts = new Map<string, KnownHost>()
  const waiters: Waiter[] = []
  let session: SftpSession

  const knownHosts = {
    getKnownHost: (hostname: string, portNumber: number): KnownHost | null =>
      hosts.get(`${hostname}:${portNumber}`) ?? null,
    addKnownHost: (entry: {
      host: string
      port: number
      keyType: string
      fingerprint: string
    }): KnownHost => {
      const value: KnownHost = {
        key: `${entry.host}:${entry.port}`,
        host: entry.host,
        port: entry.port,
        keyType: entry.keyType,
        fingerprint: entry.fingerprint,
        firstSeen: Date.now()
      }
      hosts.set(value.key, value)
      return value
    }
  }

  const events: SessionEvents = {
    status: () => {},
    hostKey: (prompt) => {
      session.respondHostKey(prompt.requestId, true)
    },
    interactive: () => {},
    transfer: (transfer) => {
      const index = waiters.findIndex(
        (waiter) =>
          waiter.name === transfer.name &&
          waiter.direction === transfer.direction &&
          (transfer.state === 'done' ||
            transfer.state === 'error' ||
            transfer.state === 'cancelled')
      )
      if (index < 0) return
      const [waiter] = waiters.splice(index, 1)
      if (!waiter) return
      if (transfer.state === 'done') waiter.resolve(transfer)
      else waiter.reject(new Error(`transfer ${transfer.state}`))
    }
  }

  session = new SftpSession(profile, { knownHosts, events })

  return {
    session,
    hosts,
    waitForTransfer(name: string, direction: 'upload' | 'download'): Promise<TransferInfo> {
      return new Promise((resolve, reject) => {
        waiters.push({ name, direction, resolve, reject })
      })
    }
  }
}

const profile: Profile = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'integration',
  host,
  port,
  username,
  createdAt: Date.now(),
  lastUsedAt: null
}

describe.skipIf(!enabled)('SftpSession integration', () => {
  let harness: ReturnType<typeof makeHarness>
  let home = '/'
  let workBase = '/'
  let workDir = ''
  let localFile = ''
  let downloadDir = ''

  beforeAll(async () => {
    downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumine-sftp-'))
    localFile = path.join(downloadDir, 'payload.bin')
    fs.writeFileSync(localFile, randomBytes(512 * 1024))

    harness = makeHarness(profile)
    await harness.session.connect(password)
    home = (await harness.session.list('.')).path
    workBase = process.env.SFTP_BASE ?? home
    const folderName = `lumine-test-${Date.now()}`
    await harness.session.mkdir(workBase, folderName)
    workDir = workBase === '/' ? `/${folderName}` : `${workBase}/${folderName}`
  }, 30_000)

  afterAll(async () => {
    if (harness) {
      try {
        await harness.session.remove(workDir)
      } catch {
        // best effort
      }
      harness.session.dispose()
    }
    if (downloadDir) fs.rmSync(downloadDir, { recursive: true, force: true })
  })

  it('lists the home directory', async () => {
    const listing = await harness.session.list('.')
    expect(listing.path).toBe(home)
    expect(Array.isArray(listing.entries)).toBe(true)
  }, 20_000)

  it('uploads, downloads, renames and deletes a file', async () => {
    const uploaded = harness.waitForTransfer('payload.bin', 'upload')
    await harness.session.upload([localFile], workDir, false)
    await uploaded

    let listing = await harness.session.list(workDir)
    expect(listing.entries.some((entry) => entry.name === 'payload.bin')).toBe(true)

    const downloaded = harness.waitForTransfer('payload.bin', 'download')
    await harness.session.download(`${workDir}/payload.bin`, downloadDir, true)
    await downloaded

    const localHash = createHash('sha256').update(fs.readFileSync(localFile)).digest('hex')
    const remoteHash = createHash('sha256')
      .update(fs.readFileSync(path.join(downloadDir, 'payload.bin')))
      .digest('hex')
    expect(remoteHash).toBe(localHash)

    await harness.session.rename(workDir, 'payload.bin', 'renamed.bin')
    listing = await harness.session.list(workDir)
    expect(listing.entries.some((entry) => entry.name === 'renamed.bin')).toBe(true)

    await harness.session.remove(`${workDir}/renamed.bin`)
    listing = await harness.session.list(workDir)
    expect(listing.entries.some((entry) => entry.name === 'renamed.bin')).toBe(false)
  }, 40_000)

  it('blocks a changed host key instead of prompting', async () => {
    const strict = makeHarness(profile)
    strict.hosts.set(`${host}:${port}`, {
      key: `${host}:${port}`,
      host,
      port,
      keyType: 'ssh-ed25519',
      fingerprint: 'SHA256:definitely-not-the-real-key',
      firstSeen: Date.now()
    })
    await expect(strict.session.connect(password)).rejects.toMatchObject({
      code: 'HOST_KEY_MISMATCH'
    })
    strict.session.dispose()
  }, 20_000)

  it('rejects a wrong password', async () => {
    const wrong = makeHarness(profile)
    await expect(wrong.session.connect('wrong-password')).rejects.toMatchObject({
      code: 'AUTH_FAILED'
    })
    wrong.session.dispose()
  }, 20_000)

  it('does not allow deleting the remote root', async () => {
    await expect(harness.session.remove('/')).rejects.toBeInstanceOf(AppError)
  })
})

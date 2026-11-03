import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { Transform, type Readable, type Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { posix } from 'node:path'
import { Client, type Algorithms, type FileEntryWithStats, type SFTPWrapper } from 'ssh2'
import type {
  ConflictMode,
  ConnectionState,
  ConnectionStatus,
  ErrorCode,
  HostKeyMismatchPrompt,
  HostKeyPrompt,
  InteractiveRequest,
  KnownHost,
  Profile,
  RemoteEntry,
  RemoteListing,
  TransferDirection,
  TransferInfo,
  TransferState
} from '../shared/types'
import { AppError, mapError } from './errors'
import { safeLocalPath } from './local-path'

export interface KnownHostLookup {
  getKnownHost(host: string, port: number): KnownHost | null
  addKnownHost(entry: {
    host: string
    port: number
    keyType: string
    fingerprint: string
  }): KnownHost
}

export type SessionHostKeyPrompt = Omit<HostKeyPrompt, 'sessionId'>
export type SessionInteractiveRequest = Omit<InteractiveRequest, 'sessionId'>
export type SessionHostKeyMismatch = Omit<HostKeyMismatchPrompt, 'sessionId'>

export interface SessionEvents {
  status(status: ConnectionStatus): void
  hostKey(prompt: SessionHostKeyPrompt): void
  hostKeyMismatch(prompt: SessionHostKeyMismatch): void
  interactive(request: SessionInteractiveRequest): void
  transfer(info: TransferInfo): void
}

export interface SessionOptions {
  knownHosts: KnownHostLookup
  events: SessionEvents
}

interface PendingHostKey {
  requestId: string
  callback: (accept: boolean) => void
  keyType: string
  fingerprint: string
  timer: NodeJS.Timeout
}

interface PendingInteractive {
  requestId: string
  finish: (answers: string[]) => void
  timer: NodeJS.Timeout
}

interface StatsLike {
  isDirectory(): boolean
  isFile(): boolean
  isSymbolicLink(): boolean
  size: number
  mtime: number
}

interface TransferRecord extends TransferInfo {
  controller: AbortController
  localPath: string
  remotePath: string
  overwrite: boolean
  lastEmit: number
  lastBytes: number
  tempPath?: string
  remoteSize?: number
  remoteMtime?: number
  localSize?: number
  localMtime?: number
  resume: boolean
}

interface TransferPlan {
  name: string
  localPath: string
  remotePath: string
  total: number
  remoteSize?: number
  remoteMtime?: number
  localSize?: number
  localMtime?: number
}

const MAX_LIST_ENTRIES = 10_000
const MAX_QUEUE = 2000
const MAX_TRANSFERS_KEPT = 100
const TRANSFER_CONCURRENCY = 2
const DELETE_PREVIEW_LIMIT = 500
const MAX_TREE_ITEMS = 5000
const MAX_TREE_DEPTH = 32

// Legacy SHA-1 algorithms (ssh-rsa, hmac-sha1, group1/14-sha1, CBC) are
// deliberately excluded so a downgrade cannot be negotiated with this app.
export const SECURE_ALGORITHMS: Algorithms = {
  kex: [
    'curve25519-sha256',
    'curve25519-sha256@libssh.org',
    'ecdh-sha2-nistp256',
    'ecdh-sha2-nistp384',
    'ecdh-sha2-nistp521',
    'diffie-hellman-group16-sha512',
    'diffie-hellman-group18-sha512',
    'diffie-hellman-group14-sha256'
  ],
  cipher: [
    'aes256-gcm@openssh.com',
    'aes128-gcm@openssh.com',
    'aes256-ctr',
    'aes192-ctr',
    'aes128-ctr'
  ],
  serverHostKey: [
    'ssh-ed25519',
    'ecdsa-sha2-nistp256',
    'ecdsa-sha2-nistp384',
    'ecdsa-sha2-nistp521',
    'rsa-sha2-512',
    'rsa-sha2-256'
  ],
  hmac: [
    'hmac-sha2-256-etm@openssh.com',
    'hmac-sha2-512-etm@openssh.com',
    'hmac-sha2-256',
    'hmac-sha2-512'
  ],
  compress: ['none', 'zlib@openssh.com']
}

function valueCall<T>(
  invoke: (callback: (error: Error | null | undefined, value: T) => void) => void
): Promise<T> {
  return new Promise((resolve, reject) => {
    invoke((error, value) => (error ? reject(error) : resolve(value)))
  })
}

function doneCall(invoke: (callback: (error?: Error | null) => void) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    invoke((error) => (error ? reject(error) : resolve()))
  })
}

function sftpStatus(error: unknown): number | undefined {
  const code = (error as { code?: unknown } | null)?.code
  return typeof code === 'number' ? code : undefined
}

function keyTypeOf(key: Buffer): string {
  if (key.length < 4) return 'unknown'
  const length = key.readUInt32BE(0)
  if (length <= 0 || length > 64 || 4 + length > key.length) return 'unknown'
  const text = key.subarray(4, 4 + length).toString('ascii')
  return /^[a-z0-9@.-]+$/i.test(text) ? text : 'unknown'
}

function fingerprintOf(key: Buffer): string {
  return `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`
}

function validRemoteName(name: string): boolean {
  return Boolean(name) && name.length <= 255 && name !== '.' && name !== '..' && !/[/\\\u0000-\u001f\u007f]/.test(name)
}

function isNoSuchFile(error: unknown): boolean {
  return sftpStatus(error) === 2 || (error as { code?: unknown } | null)?.code === 'ENOENT'
}

function isAlreadyExists(error: unknown): boolean {
  return sftpStatus(error) === 11 || (error as { code?: unknown } | null)?.code === 'EEXIST'
}

function isUnsupportedOperation(error: unknown): boolean {
  if (sftpStatus(error) === 8) return true
  const message = (error as { message?: unknown } | null)?.message
  return typeof message === 'string' && /not supported|unsupported/i.test(message)
}

export interface ConnectAuth {
  password?: string
  privateKey?: Buffer | string
  passphrase?: string
}

export class SftpSession {
  private readonly client = new Client()
  private sftp?: SFTPWrapper
  private state: ConnectionState = 'disconnected'
  private failureCode?: ErrorCode
  private pendingHostKey?: PendingHostKey
  private pendingInteractive?: PendingInteractive
  private interactiveRounds = 0
  private transfers = new Map<string, TransferRecord>()
  private queue: TransferRecord[] = []
  private running = 0
  private disposed = false

  constructor(
    private readonly profile: Profile,
    private readonly options: SessionOptions
  ) {}

  connect(auth: ConnectAuth | string): Promise<void> {
    if (this.disposed) return Promise.reject(new AppError('INTERNAL', 'session disposed'))

    const credentials: ConnectAuth = typeof auth === 'string' ? { password: auth } : auth
    if (!credentials.password && !credentials.privateKey) {
      return Promise.reject(new AppError('SECRET_REQUIRED'))
    }

    this.emitStatus('connecting')

    return new Promise<void>((resolve, reject) => {
      let settled = false

      const fail = (code: ErrorCode, detail?: string): void => {
        if (settled) {
          this.emitStatus('error', code, detail)
          return
        }
        settled = true
        this.emitStatus('error', code, detail)
        reject(new AppError(code, detail))
      }

      this.client.on('error', (error: unknown) => {
        const mapped = this.failureCode
          ? { code: this.failureCode }
          : mapError(error)
        fail(mapped.code, mapped.detail)
      })

      this.client.on('close', () => {
        this.clearPending()
        if (!settled) {
          fail(this.failureCode ?? 'NETWORK_ERROR')
          return
        }
        if (this.state === 'connected' || this.state === 'authenticating') {
          this.state = 'disconnected'
          this.options.events.status({
            state: 'disconnected',
            profileId: this.profile.id,
            profileName: this.profile.name,
            host: this.profile.host,
            port: this.profile.port
          })
        }
      })

      this.client.on('keyboard-interactive', (_name, _instructions, _lang, prompts, finish) => {
        if (this.disposed) {
          finish([])
          return
        }
        this.interactiveRounds += 1
        if (this.interactiveRounds > 8 || prompts.length > 16) {
          this.failureCode = 'AUTH_FAILED'
          finish([])
          return
        }
        if (prompts.length === 0) {
          finish([])
          return
        }

        const requestId = randomUUID()
        this.pendingInteractive = {
          requestId,
          finish,
          timer: setTimeout(() => {
            const pending = this.pendingInteractive
            if (!pending || pending.requestId !== requestId) return
            this.pendingInteractive = undefined
            this.failureCode = 'AUTH_FAILED'
            pending.finish([])
            this.client.end()
          }, 90_000)
        }
        this.emitStatus('authenticating')
        this.options.events.interactive({
          requestId,
          name: _name,
          instructions: _instructions,
          prompts: prompts.map((prompt) => ({
            prompt: prompt.prompt,
            echo: Boolean(prompt.echo)
          }))
        })
      })

      this.client.on('ready', () => {
        if (settled) return
        this.emitStatus('authenticating')
        this.client.sftp((error, sftp) => {
          if (error) {
            fail('SFTP_UNAVAILABLE')
            this.client.end()
            return
          }
          this.attachSftp(sftp)
          if (!settled) {
            settled = true
            this.emitStatus('connected')
            resolve()
          }
        })
      })

      this.client.connect({
        host: this.profile.host,
        port: this.profile.port,
        username: this.profile.username,
        password: credentials.password,
        privateKey: credentials.privateKey,
        passphrase: credentials.passphrase,
        readyTimeout: 30_000,
        keepaliveInterval: 15_000,
        keepaliveCountMax: 3,
        tryKeyboard: true,
        authHandler: credentials.privateKey
          ? ['publickey', 'keyboard-interactive']
          : ['password', 'keyboard-interactive'],
        algorithms: SECURE_ALGORITHMS,
        hostVerifier: (key: Buffer, callback: (accept: boolean) => void) => {
          this.verifyHostKey(key, callback)
        }
      })
    })
  }

  private attachSftp(sftp: SFTPWrapper): void {
    this.sftp = sftp
    sftp.on('error', () => {
      // Errors are surfaced by individual operations; keep the session alive.
    })
    sftp.on('close', () => {
      if (this.sftp === sftp) this.sftp = undefined
    })
  }

  private verifyHostKey(key: Buffer, callback: (accept: boolean) => void): void {
    const fingerprint = fingerprintOf(key)
    const keyType = keyTypeOf(key)
    const known = this.options.knownHosts.getKnownHost(this.profile.host, this.profile.port)

    if (known) {
      if (known.fingerprint !== fingerprint) {
        this.failureCode = 'HOST_KEY_MISMATCH'
        this.emitStatus(
          'error',
          'HOST_KEY_MISMATCH',
          `expected ${known.fingerprint}; received ${fingerprint}`
        )
        this.options.events.hostKeyMismatch({
          host: this.profile.host,
          port: this.profile.port,
          keyType,
          expectedKeyType: known.keyType,
          expectedFingerprint: known.fingerprint,
          receivedFingerprint: fingerprint
        })
        callback(false)
        return
      }
      callback(true)
      return
    }

    const requestId = randomUUID()
    const timer = setTimeout(() => {
      const pending = this.pendingHostKey
      if (!pending || pending.requestId !== requestId) return
      this.pendingHostKey = undefined
      this.failureCode = 'HOST_KEY_TIMEOUT'
      pending.callback(false)
      this.emitStatus('error', 'HOST_KEY_TIMEOUT')
      this.client.end()
    }, 60_000)

    this.pendingHostKey = { requestId, callback, keyType, fingerprint, timer }
    this.emitStatus('verifying_host')
    this.options.events.hostKey({
      requestId,
      host: this.profile.host,
      port: this.profile.port,
      keyType,
      fingerprint
    })
  }

  respondHostKey(requestId: string, accept: boolean): void {
    const pending = this.pendingHostKey
    if (!pending || pending.requestId !== requestId) {
      throw new AppError('INVALID_INPUT', 'host key request')
    }
    clearTimeout(pending.timer)
    this.pendingHostKey = undefined

    if (!accept) {
      this.failureCode = 'HOST_KEY_REJECTED'
      pending.callback(false)
      this.emitStatus('error', 'HOST_KEY_REJECTED')
      this.client.end()
      return
    }

    this.options.knownHosts.addKnownHost({
      host: this.profile.host,
      port: this.profile.port,
      keyType: pending.keyType,
      fingerprint: pending.fingerprint
    })
    this.emitStatus('connecting')
    pending.callback(true)
  }

  answerInteractive(requestId: string, cancelled: boolean, answers: string[]): void {
    const pending = this.pendingInteractive
    if (!pending || pending.requestId !== requestId) {
      throw new AppError('INVALID_INPUT', 'interactive request')
    }
    clearTimeout(pending.timer)
    this.pendingInteractive = undefined

    if (cancelled) {
      this.failureCode = 'AUTH_CANCELLED'
      pending.finish([])
      this.emitStatus('error', 'AUTH_CANCELLED')
      this.client.end()
      return
    }
    pending.finish(answers)
  }

  async list(target: string): Promise<RemoteListing> {
    const sftp = this.requireSftp()
    const requested = target && target.trim() ? target : '.'
    const resolved = await valueCall<string>((callback) => sftp.realpath(requested, callback))
    const entries = await valueCall<FileEntryWithStats[]>((callback) =>
      sftp.readdir(resolved, callback)
    )
    if (entries.length > MAX_LIST_ENTRIES) {
      throw new AppError('LIST_TOO_LARGE', String(entries.length))
    }

    const mapped: RemoteEntry[] = entries
      .filter(
        (entry) =>
          entry.filename !== '.' &&
          entry.filename !== '..' &&
          entry.filename.length <= 1024 &&
          !entry.filename.includes('\u0000') &&
          !entry.filename.includes('/')
      )
      .map((entry) => ({
        name: entry.filename,
        kind: entry.attrs.isDirectory()
          ? 'directory'
          : entry.attrs.isFile()
            ? 'file'
            : entry.attrs.isSymbolicLink()
              ? 'link'
              : 'other',
        size: entry.attrs.size,
        modified: entry.attrs.mtime,
        mode: entry.attrs.mode ?? 0,
        uid: entry.attrs.uid ?? 0,
        gid: entry.attrs.gid ?? 0
      }))

    mapped.sort((left, right) => {
      const leftDir = left.kind === 'directory' ? 0 : 1
      const rightDir = right.kind === 'directory' ? 0 : 1
      return leftDir - rightDir || left.name.localeCompare(right.name)
    })

    const parent = posix.dirname(resolved)
    return { path: resolved, entries: mapped, parent: parent === resolved ? null : parent }
  }

  /** Kiểu + kích thước cho bộ copy; không đi qua realpath vì đích đã tuyệt đối. */
  async stat(target: string): Promise<{ kind: RemoteEntry['kind']; size: number }> {
    const stats = await this.lstat(this.requirePath(target))
    return {
      kind: stats.isDirectory()
        ? 'directory'
        : stats.isFile()
          ? 'file'
          : stats.isSymbolicLink()
            ? 'link'
            : 'other',
      size: stats.size
    }
  }

  createReadStream(target: string): Readable {
    return this.requireSftp().createReadStream(this.requirePath(target))
  }

  createWriteStream(target: string): {
    stream: Writable
    closed: Promise<void>
  } {
    const stream = this.requireSftp().createWriteStream(this.requirePath(target))
    return { stream, closed: this.waitForClose(stream) }
  }

  /** `mkdir -p` phía server, dùng khi copy cả cây thư mục sang đích. */
  async ensureDir(target: string): Promise<void> {
    const resolved = this.requirePath(target)
    const segments = resolved.split('/').filter(Boolean)
    let current = ''
    for (const segment of segments) {
      current += `/${segment}`
      try {
        await doneCall((callback) => this.requireSftp().mkdir(current, callback))
      } catch (error) {
        const stats = await this.lstat(current).catch(() => null)
        if (!stats || !stats.isDirectory()) throw error
      }
    }
  }

  async exists(target: string): Promise<boolean> {
    try {
      await this.lstat(this.requirePath(target))
      return true
    } catch {
      return false
    }
  }

  async renameAbsolute(from: string, to: string): Promise<void> {
    const sftp = this.requireSftp()
    await doneCall((callback) =>
      sftp.rename(this.requirePath(from), this.requirePath(to), callback)
    )
  }

  async removeQuietly(target: string): Promise<void> {
    const sftp = this.sftp
    if (!sftp) return
    await this.unlinkIfExists(sftp, target)
  }

  async mkdir(directory: string, name: string): Promise<void> {
    const sftp = this.requireSftp()
    if (!validRemoteName(name)) throw new AppError('INVALID_NAME', name)
    const target = posix.join(this.requirePath(directory), name)
    await doneCall((callback) => sftp.mkdir(target, callback))
  }

  async rename(directory: string, from: string, to: string): Promise<void> {
    const sftp = this.requireSftp()
    if (!validRemoteName(from) || !validRemoteName(to)) {
      throw new AppError('INVALID_NAME', !validRemoteName(from) ? from : to)
    }
    const base = this.requirePath(directory)
    await doneCall((callback) =>
      sftp.rename(posix.join(base, from), posix.join(base, to), callback)
    )
  }

  async remove(target: string): Promise<void> {
    const sftp = this.requireSftp()
    const remote = this.requirePath(target)
    if (posix.normalize(remote) === '/') throw new AppError('INVALID_PATH', remote)
    const counter = { value: 0 }
    await this.removeRecursive(sftp, remote, 0, counter)
  }

  async describeDelete(
    target: string
  ): Promise<{ directory: boolean; items: number; truncated: boolean }> {
    const sftp = this.requireSftp()
    const remote = this.requirePath(target)
    const stats = await this.lstat(remote)
    if (!stats.isDirectory()) return { directory: false, items: 0, truncated: false }
    const counter = { value: 0, truncated: false }
    await this.countTree(sftp, remote, 0, counter)
    return { directory: true, items: counter.value, truncated: counter.truncated }
  }

  private async countTree(
    sftp: SFTPWrapper,
    target: string,
    depth: number,
    counter: { value: number; truncated: boolean }
  ): Promise<void> {
    if (counter.value >= DELETE_PREVIEW_LIMIT || depth > 32) {
      counter.truncated = true
      return
    }
    let entries: FileEntryWithStats[]
    try {
      entries = await valueCall<FileEntryWithStats[]>((callback) =>
        sftp.readdir(target, callback)
      )
    } catch {
      counter.truncated = true
      return
    }
    for (const entry of entries) {
      if (entry.filename === '.' || entry.filename === '..') continue
      if (counter.value >= DELETE_PREVIEW_LIMIT) {
        counter.truncated = true
        return
      }
      counter.value += 1
      if (entry.attrs.isDirectory()) {
        await this.countTree(sftp, posix.join(target, entry.filename), depth + 1, counter)
      }
    }
  }

  private async removeRecursive(
    sftp: SFTPWrapper,
    target: string,
    depth: number,
    counter: { value: number }
  ): Promise<void> {
    if (depth > 32 || counter.value > MAX_LIST_ENTRIES) {
      throw new AppError('LIST_TOO_LARGE', target)
    }
    const stats = await this.lstat(target)
    if (stats.isDirectory()) {
      const entries = await valueCall<FileEntryWithStats[]>((callback) =>
        sftp.readdir(target, callback)
      )
      for (const entry of entries) {
        if (entry.filename === '.' || entry.filename === '..') continue
        counter.value += 1
        await this.removeRecursive(
          sftp,
          posix.join(target, entry.filename),
          depth + 1,
          counter
        )
      }
      await doneCall((callback) => sftp.rmdir(target, callback))
      return
    }
    await doneCall((callback) => sftp.unlink(target, callback))
  }

  async upload(paths: string[], directory: string, mode: ConflictMode): Promise<number> {
    const sftp = this.requireSftp()
    const remoteDir = this.requirePath(directory)
    if (paths.length === 0) throw new AppError('DIALOG_CANCELLED')
    if (this.queue.length + this.running >= MAX_QUEUE) {
      throw new AppError('TRANSFER_FAILED', 'queue full')
    }

    const files: TransferPlan[] = []
    const counter = { value: 0 }
    for (const localPath of paths) {
      await this.collectUpload(sftp, localPath, remoteDir, files, 0, counter)
    }
    if (files.length === 0) return 0

    const conflicts: string[] = []
    const planned: Array<TransferPlan & { overwrite: boolean }> = []
    for (const file of files) {
      const exists = await this.remoteExists(file.remotePath)
      if (!exists) {
        planned.push({ ...file, overwrite: false })
        continue
      }
      if (mode === 'error') {
        conflicts.push(file.name)
        continue
      }
      if (mode === 'skip') continue
      if (mode === 'overwrite') {
        planned.push({ ...file, overwrite: true })
        continue
      }
      const renamed = await this.uniqueRemoteName(file.remotePath)
      planned.push({
        ...file,
        name: posix.basename(renamed),
        remotePath: renamed,
        overwrite: false
      })
    }

    if (conflicts.length > 0) {
      throw new AppError('ALREADY_EXISTS', conflicts.slice(0, 20).join('\n'))
    }
    for (const item of planned) {
      this.enqueue({
        direction: 'upload',
        name: item.name,
        localPath: item.localPath,
        remotePath: item.remotePath,
        total: item.total,
        overwrite: item.overwrite,
        ...(item.localSize !== undefined ? { localSize: item.localSize } : {}),
        ...(item.localMtime !== undefined ? { localMtime: item.localMtime } : {})
      })
    }
    return planned.length
  }

  private async collectUpload(
    sftp: SFTPWrapper,
    localPath: string,
    remoteDir: string,
    out: TransferPlan[],
    depth: number,
    counter: { value: number }
  ): Promise<void> {
    counter.value += 1
    if (counter.value > MAX_TREE_ITEMS || depth > MAX_TREE_DEPTH) {
      throw new AppError('LIST_TOO_LARGE', localPath)
    }
    const stats = fs.lstatSync(localPath)
    if (stats.isSymbolicLink()) return
    const name = path.basename(localPath)
    if (!validRemoteName(name)) throw new AppError('INVALID_NAME', name)
    const remotePath = posix.join(remoteDir, name)

    if (stats.isDirectory()) {
      try {
        await doneCall((callback) => sftp.mkdir(remotePath, callback))
      } catch (error) {
        if (!isAlreadyExists(error)) throw error
      }
      for (const child of fs.readdirSync(localPath)) {
        await this.collectUpload(sftp, path.join(localPath, child), remotePath, out, depth + 1, counter)
      }
      return
    }
    if (!stats.isFile()) return
    if (out.length >= MAX_QUEUE) throw new AppError('TRANSFER_FAILED', 'queue full')
    out.push({
      name,
      localPath,
      remotePath,
      total: stats.size,
      localSize: stats.size,
      localMtime: stats.mtimeMs
    })
  }

  async download(
    paths: string[],
    localDirectory: string,
    mode: ConflictMode
  ): Promise<number> {
    this.requireSftp()
    if (paths.length === 0) throw new AppError('DIALOG_CANCELLED')
    if (!fs.statSync(localDirectory).isDirectory()) {
      throw new AppError('INVALID_PATH', localDirectory)
    }

    const files: TransferPlan[] = []
    const counter = { value: 0 }
    for (const remotePath of paths) {
      await this.collectDownload(
        this.requirePath(remotePath),
        localDirectory,
        [],
        files,
        0,
        counter
      )
    }
    if (files.length === 0) return 0

    const conflicts: string[] = []
    const planned: Array<TransferPlan & { overwrite: boolean }> = []
    for (const file of files) {
      if (!fs.existsSync(file.localPath)) {
        planned.push({ ...file, overwrite: false })
        continue
      }
      if (mode === 'error') {
        conflicts.push(file.name)
        continue
      }
      if (mode === 'skip') continue
      if (mode === 'overwrite') {
        planned.push({ ...file, overwrite: true })
        continue
      }
      const renamed = this.uniqueLocalName(file.localPath)
      planned.push({
        ...file,
        name: path.basename(renamed),
        localPath: renamed,
        overwrite: false
      })
    }

    if (conflicts.length > 0) {
      throw new AppError('ALREADY_EXISTS', conflicts.slice(0, 20).join('\n'))
    }
    for (const item of planned) {
      this.enqueue({
        direction: 'download',
        name: item.name,
        localPath: item.localPath,
        remotePath: item.remotePath,
        total: item.total,
        overwrite: item.overwrite,
        ...(item.remoteSize !== undefined ? { remoteSize: item.remoteSize } : {}),
        ...(item.remoteMtime !== undefined ? { remoteMtime: item.remoteMtime } : {})
      })
    }
    return planned.length
  }

  private async collectDownload(
    remotePath: string,
    root: string,
    segments: string[],
    out: TransferPlan[],
    depth: number,
    counter: { value: number }
  ): Promise<void> {
    counter.value += 1
    if (counter.value > MAX_TREE_ITEMS || depth > MAX_TREE_DEPTH) {
      throw new AppError('LIST_TOO_LARGE', remotePath)
    }
    const stats = await this.lstat(remotePath)
    if (stats.isSymbolicLink()) return
    const name = posix.basename(remotePath)
    if (!validRemoteName(name)) throw new AppError('INVALID_NAME', name)

    if (stats.isDirectory()) {
      let directory: string
      try {
        directory = safeLocalPath(root, [...segments, name])
      } catch {
        throw new AppError('INVALID_PATH', name)
      }
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
      const entries = await valueCall<FileEntryWithStats[]>((callback) =>
        this.requireSftp().readdir(remotePath, callback)
      )
      for (const entry of entries) {
        if (entry.filename === '.' || entry.filename === '..') continue
        if (entry.attrs.isSymbolicLink()) continue
        await this.collectDownload(
          posix.join(remotePath, entry.filename),
          root,
          [...segments, name],
          out,
          depth + 1,
          counter
        )
      }
      return
    }
    if (!stats.isFile()) return
    if (out.length >= MAX_QUEUE) throw new AppError('TRANSFER_FAILED', 'queue full')
    let localPath: string
    try {
      localPath = safeLocalPath(root, [...segments, name])
    } catch {
      throw new AppError('INVALID_PATH', name)
    }
    out.push({
      name,
      localPath,
      remotePath,
      total: Math.max(0, stats.size),
      remoteSize: stats.size,
      remoteMtime: stats.mtime
    })
  }

  private async uniqueRemoteName(remotePath: string): Promise<string> {
    const directory = posix.dirname(remotePath)
    const base = posix.basename(remotePath)
    const extension = posix.extname(base)
    const stem = extension ? base.slice(0, -extension.length) : base
    for (let index = 1; index <= 99; index += 1) {
      const candidate = posix.join(directory, `${stem} (${index})${extension}`)
      if (!(await this.remoteExists(candidate))) return candidate
    }
    throw new AppError('ALREADY_EXISTS', base)
  }

  private uniqueLocalName(localPath: string): string {
    const directory = path.dirname(localPath)
    const base = path.basename(localPath)
    const extension = path.extname(base)
    const stem = extension ? base.slice(0, -extension.length) : base
    for (let index = 1; index <= 99; index += 1) {
      const candidate = path.join(directory, `${stem} (${index})${extension}`)
      if (!fs.existsSync(candidate)) return candidate
    }
    throw new AppError('ALREADY_EXISTS', base)
  }

  cancelTransfer(id: string): void {
    const record = this.transfers.get(id)
    if (!record) throw new AppError('INVALID_INPUT', id)
    if (record.state === 'queued') {
      this.queue = this.queue.filter((item) => item.id !== id)
      record.state = 'cancelled'
      record.canRetry = false
      this.emitTransfer(record)
      return
    }
    if (record.state === 'running') record.controller.abort()
  }

  retryTransfer(id: string): void {
    const record = this.transfers.get(id)
    if (!record || record.state !== 'error') throw new AppError('INVALID_INPUT', id)
    if (this.queue.length + this.running >= MAX_QUEUE) {
      throw new AppError('TRANSFER_FAILED', 'queue full')
    }
    record.state = 'queued'
    record.code = undefined
    record.canRetry = false
    record.speed = undefined
    record.eta = undefined
    record.resume = true
    record.controller = new AbortController()
    this.queue.push(record)
    this.emitTransfer(record)
    this.pump()
  }

  getDownloadPath(id: string): string | null {
    const record = this.transfers.get(id)
    if (!record || record.direction !== 'download' || record.state !== 'done') return null
    return record.localPath
  }

  async chmod(target: string, mode: number): Promise<void> {
    const sftp = this.requireSftp()
    await doneCall((callback) => sftp.chmod(this.requirePath(target), mode, callback))
  }

  private enqueue(input: {
    direction: TransferDirection
    name: string
    localPath: string
    remotePath: string
    total: number
    overwrite: boolean
    remoteSize?: number
    remoteMtime?: number
    localSize?: number
    localMtime?: number
  }): string {
    const id = randomUUID()
    const record: TransferRecord = {
      id,
      direction: input.direction,
      name: input.name,
      transferred: 0,
      total: input.total,
      state: 'queued',
      controller: new AbortController(),
      localPath: input.localPath,
      remotePath: input.remotePath,
      overwrite: input.overwrite,
      lastEmit: Date.now(),
      lastBytes: 0,
      resume: false,
      ...(input.remoteSize !== undefined ? { remoteSize: input.remoteSize } : {}),
      ...(input.remoteMtime !== undefined ? { remoteMtime: input.remoteMtime } : {}),
      ...(input.localSize !== undefined ? { localSize: input.localSize } : {}),
      ...(input.localMtime !== undefined ? { localMtime: input.localMtime } : {})
    }
    this.transfers.set(id, record)
    this.queue.push(record)
    this.pruneTransfers()
    this.emitTransfer(record)
    this.pump()
    return id
  }

  private pruneTransfers(): void {
    if (this.transfers.size <= MAX_TRANSFERS_KEPT) return
    for (const [id, record] of this.transfers) {
      if (record.state === 'done' || record.state === 'error' || record.state === 'cancelled') {
        this.transfers.delete(id)
      }
      if (this.transfers.size <= MAX_TRANSFERS_KEPT) break
    }
  }

  private pump(): void {
    if (this.disposed) return
    while (this.running < TRANSFER_CONCURRENCY && this.queue.length > 0) {
      const record = this.queue.shift()
      if (!record) break
      if (record.controller.signal.aborted) {
        record.state = 'cancelled'
        this.emitTransfer(record)
        continue
      }
      this.running += 1
      void this.runTransfer(record).finally(() => {
        this.running -= 1
        this.pump()
      })
    }
  }

  private async runTransfer(record: TransferRecord): Promise<void> {
    record.state = 'running'
    record.code = undefined
    record.speed = undefined
    record.eta = undefined
    this.emitTransfer(record)

    try {
      if (record.direction === 'download') {
        const sftp = this.requireSftp()
        const temp = `${record.localPath}.lumine.part`
        record.tempPath = temp
        const current = await this.lstat(record.remotePath)
        record.total = Math.max(0, current.size)

        let offset = 0
        if (
          record.resume &&
          record.remoteSize !== undefined &&
          record.remoteMtime !== undefined &&
          current.size === record.remoteSize &&
          current.mtime === record.remoteMtime &&
          fs.existsSync(temp)
        ) {
          const partial = fs.statSync(temp)
          if (partial.size <= current.size) offset = partial.size
        }

        if (offset === 0) {
          fs.rmSync(temp, { force: true })
          record.transferred = 0
        } else {
          record.transferred = offset
        }
        record.lastEmit = Date.now()
        record.lastBytes = record.transferred

        if (offset === record.total && offset > 0) {
          this.replaceLocalFile(temp, record.localPath)
        } else {
          const source = sftp.createReadStream(
            record.remotePath,
            offset > 0 ? { start: offset } : undefined
          )
          const destination = fs.createWriteStream(
            temp,
            offset > 0 ? { flags: 'a' } : { flags: 'wx', mode: 0o600 }
          )
          await pipeline(source, this.progress(record), destination, {
            signal: record.controller.signal
          })
          this.replaceLocalFile(temp, record.localPath)
        }
      } else {
        const sftp = this.requireSftp()
        const directory = posix.dirname(record.remotePath)
        const temp = posix.join(
          directory,
          `.${posix.basename(record.remotePath)}.lumine.part`
        )
        record.tempPath = temp
        const local = fs.statSync(record.localPath)
        record.total = local.size

        let offset = 0
        if (
          record.resume &&
          record.localSize !== undefined &&
          record.localMtime !== undefined &&
          local.size === record.localSize &&
          local.mtimeMs === record.localMtime
        ) {
          try {
            const partial = await valueCall<{ size: number }>((callback) =>
              sftp.stat(temp, callback)
            )
            if (partial.size <= local.size) offset = partial.size
          } catch (error) {
            if (!isNoSuchFile(error)) throw error
          }
        }

        if (!record.resume) await this.unlinkIfExists(sftp, temp)
        record.transferred = offset
        record.lastEmit = Date.now()
        record.lastBytes = offset

        const source = fs.createReadStream(
          record.localPath,
          offset > 0 ? { start: offset } : undefined
        )
        const destination = sftp.createWriteStream(
          temp,
          offset > 0 ? { flags: 'r+', start: offset } : { mode: 0o600 }
        )
        const closed = this.waitForClose(destination)
        await pipeline(source, this.progress(record), destination, {
          signal: record.controller.signal
        })
        await closed
        if (record.overwrite) {
          await this.replaceRemoteFile(sftp, temp, record.remotePath)
        } else {
          await doneCall((callback) => sftp.rename(temp, record.remotePath, callback))
        }
      }

      record.state = 'done'
      record.transferred = record.total
      record.speed = undefined
      record.eta = 0
      record.canRetry = false
      record.tempPath = undefined
      this.emitTransfer(record)
    } catch (error) {
      const aborted = record.controller.signal.aborted
      await this.cleanupTemp(record, aborted)
      if (aborted) {
        record.state = 'cancelled'
        record.canRetry = false
      } else {
        record.state = 'error'
        record.code = mapError(error).code
        record.canRetry = true
      }
      record.speed = undefined
      record.eta = undefined
      this.emitTransfer(record)
    }
  }

  private progress(record: TransferRecord): Transform {
    return new Transform({
      transform: (chunk: Buffer, _encoding, callback) => {
        record.transferred += chunk.length
        const now = Date.now()
        const elapsed = now - record.lastEmit
        if (elapsed >= 100) {
          const delta = record.transferred - record.lastBytes
          const instant = delta / (elapsed / 1000)
          record.speed = record.speed ? record.speed * 0.6 + instant * 0.4 : instant
          record.eta =
            record.speed > 0
              ? Math.max(0, Math.round((record.total - record.transferred) / record.speed))
              : undefined
          record.lastEmit = now
          record.lastBytes = record.transferred
          this.emitTransfer(record)
        }
        callback(null, chunk)
      }
    })
  }

  private waitForClose(stream: NodeJS.WritableStream): Promise<void> {
    return new Promise((resolve) => {
      let finished = false
      const done = (): void => {
        if (finished) return
        finished = true
        resolve()
      }
      stream.once('close', done)
      stream.once('error', done)
      const timer = setTimeout(done, 15_000)
      timer.unref()
    })
  }

  private replaceLocalFile(temp: string, target: string): void {
    try {
      fs.renameSync(temp, target)
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code
      if (code !== 'EEXIST' && code !== 'EPERM' && code !== 'EACCES') throw error
      fs.rmSync(target, { force: true })
      fs.renameSync(temp, target)
    }
  }

  private async replaceRemoteFile(
    sftp: SFTPWrapper,
    temp: string,
    target: string
  ): Promise<void> {
    try {
      await doneCall((callback) => sftp.ext_openssh_rename(temp, target, callback))
      return
    } catch (error) {
      if (!isUnsupportedOperation(error)) throw error
    }

    try {
      await doneCall((callback) => sftp.rename(temp, target, callback))
      return
    } catch (error) {
      if (!isAlreadyExists(error)) throw error
    }

    await this.unlinkIfExists(sftp, target)
    await doneCall((callback) => sftp.rename(temp, target, callback))
  }

  private async cleanupTemp(record: TransferRecord, remove: boolean): Promise<void> {
    const temp = record.tempPath
    if (!remove || !temp) return
    record.tempPath = undefined
    if (record.direction === 'download') {
      try {
        fs.rmSync(temp, { force: true })
      } catch {
        // best effort
      }
      return
    }
    const sftp = this.sftp
    if (!sftp) return
    await this.unlinkIfExists(sftp, temp)
  }

  private async unlinkIfExists(sftp: SFTPWrapper, target: string): Promise<void> {
    try {
      await doneCall((callback) => sftp.unlink(target, callback))
    } catch (error) {
      if (!isNoSuchFile(error)) throw error
    }
  }

  private async remoteExists(target: string): Promise<boolean> {
    try {
      await this.lstat(target)
      return true
    } catch (error) {
      if (isNoSuchFile(error)) return false
      throw error
    }
  }

  private async lstat(target: string): Promise<StatsLike> {
    const sftp = this.requireSftp()
    return valueCall<StatsLike>((callback) => sftp.lstat(target, callback))
  }

  private emitTransfer(record: TransferRecord): void {
    this.options.events.transfer({
      id: record.id,
      direction: record.direction,
      name: record.name,
      transferred: record.transferred,
      total: record.total,
      state: record.state,
      ...(record.code ? { code: record.code } : {}),
      ...(record.speed !== undefined ? { speed: record.speed } : {}),
      ...(record.eta !== undefined ? { eta: record.eta } : {}),
      ...(record.state === 'error' ? { canRetry: true } : {})
    })
  }

  private emitStatus(state: ConnectionState, code?: ErrorCode, detail?: string): void {
    this.state = state
    this.options.events.status({
      state,
      profileId: this.profile.id,
      profileName: this.profile.name,
      host: this.profile.host,
      port: this.profile.port,
      ...(code ? { code } : {}),
      ...(detail ? { detail } : {})
    })
  }

  private requireSftp(): SFTPWrapper {
    if (!this.sftp) throw new AppError('NOT_CONNECTED')
    return this.sftp
  }

  private requirePath(value: string): string {
    if (typeof value !== 'string' || !value || value.length > 4096 || /[\u0000\r\n]/.test(value)) {
      throw new AppError('INVALID_PATH')
    }
    const normalized = posix.normalize(value)
    if (!normalized.startsWith('/')) throw new AppError('INVALID_PATH', 'absolute path required')
    return normalized
  }

  private clearPending(): void {
    if (this.pendingHostKey) {
      clearTimeout(this.pendingHostKey.timer)
      this.pendingHostKey = undefined
    }
    if (this.pendingInteractive) {
      clearTimeout(this.pendingInteractive.timer)
      this.pendingInteractive = undefined
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.clearPending()

    for (const record of this.queue) {
      record.state = 'cancelled'
      this.emitTransfer(record)
    }
    this.queue = []
    for (const record of this.transfers.values()) {
      if (record.state === 'running') record.controller.abort()
    }

    try {
      this.sftp?.end()
    } catch {
      // best effort
    }
    this.sftp = undefined
    try {
      this.client.end()
    } catch {
      // best effort
    }
    this.state = 'disconnected'
  }
}

export { fingerprintOf, keyTypeOf }

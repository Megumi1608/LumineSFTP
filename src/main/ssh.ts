import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { posix } from 'node:path'
import { Client, type FileEntryWithStats, type SFTPWrapper } from 'ssh2'
import type {
  ConnectionState,
  ConnectionStatus,
  ErrorCode,
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
import { safeLocalTarget } from './local-path'

export interface KnownHostLookup {
  getKnownHost(host: string, port: number): KnownHost | null
  addKnownHost(entry: {
    host: string
    port: number
    keyType: string
    fingerprint: string
  }): KnownHost
}

export interface SessionEvents {
  status(status: ConnectionStatus): void
  hostKey(prompt: HostKeyPrompt): void
  interactive(request: InteractiveRequest): void
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
  tempPath?: string
}

const MAX_LIST_ENTRIES = 10_000
const MAX_QUEUE = 50
const MAX_TRANSFERS_KEPT = 100
const TRANSFER_CONCURRENCY = 2

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

  connect(password: string): Promise<void> {
    if (this.disposed) return Promise.reject(new AppError('INTERNAL', 'session disposed'))

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
        password,
        readyTimeout: 30_000,
        keepaliveInterval: 15_000,
        keepaliveCountMax: 3,
        tryKeyboard: true,
        authHandler: ['password', 'keyboard-interactive'],
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
        modified: entry.attrs.mtime
      }))

    mapped.sort((left, right) => {
      const leftDir = left.kind === 'directory' ? 0 : 1
      const rightDir = right.kind === 'directory' ? 0 : 1
      return leftDir - rightDir || left.name.localeCompare(right.name)
    })

    return { path: resolved, entries: mapped }
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

  async upload(files: string[], directory: string, overwrite: boolean): Promise<number> {
    const sftp = this.requireSftp()
    const remoteDir = this.requirePath(directory)
    if (files.length === 0) throw new AppError('DIALOG_CANCELLED')
    if (this.queue.length + this.running >= MAX_QUEUE) {
      throw new AppError('TRANSFER_FAILED', 'queue full')
    }

    const prepared: Array<{ localPath: string; remotePath: string; size: number; name: string }> = []
    for (const file of files) {
      const stats = fs.statSync(file)
      if (!stats.isFile()) throw new AppError('INVALID_INPUT', path.basename(file))
      const name = path.basename(file)
      if (!validRemoteName(name)) throw new AppError('INVALID_NAME', name)
      const remotePath = posix.join(remoteDir, name)
      if (!overwrite && (await this.remoteExists(remotePath))) {
        throw new AppError('ALREADY_EXISTS', name)
      }
      prepared.push({ localPath: file, remotePath, size: stats.size, name })
    }

    for (const item of prepared) {
      this.enqueue({
        direction: 'upload',
        name: item.name,
        localPath: item.localPath,
        remotePath: item.remotePath,
        total: item.size,
        overwrite
      })
    }
    return prepared.length
  }

  async download(
    remotePath: string,
    localDirectory: string,
    overwrite: boolean
  ): Promise<number> {
    this.requireSftp()
    const remote = this.requirePath(remotePath)
    const stats = await this.lstat(remote)
    if (stats.isDirectory()) throw new AppError('INVALID_PATH', remote)
    if (!fs.statSync(localDirectory).isDirectory()) {
      throw new AppError('INVALID_PATH', localDirectory)
    }

    const name = posix.basename(remote)
    if (!validRemoteName(name)) throw new AppError('INVALID_NAME', name)

    let localPath: string
    try {
      localPath = safeLocalTarget(localDirectory, name)
    } catch {
      throw new AppError('INVALID_PATH', name)
    }

    if (!overwrite && fs.existsSync(localPath)) {
      throw new AppError('ALREADY_EXISTS', name)
    }

    this.enqueue({
      direction: 'download',
      name,
      localPath,
      remotePath: remote,
      total: Math.max(0, stats.size),
      overwrite
    })
    return 1
  }

  cancelTransfer(id: string): void {
    const record = this.transfers.get(id)
    if (!record) throw new AppError('INVALID_INPUT', id)
    if (record.state === 'queued') {
      this.queue = this.queue.filter((item) => item.id !== id)
      record.state = 'cancelled'
      this.emitTransfer(record)
      return
    }
    if (record.state === 'running') record.controller.abort()
  }

  private enqueue(input: {
    direction: TransferDirection
    name: string
    localPath: string
    remotePath: string
    total: number
    overwrite: boolean
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
      lastEmit: 0
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
    const suffix = randomUUID().replace(/-/g, '').slice(0, 10)
    record.state = 'running'
    this.emitTransfer(record)

    try {
      if (record.direction === 'download') {
        const temp = `${record.localPath}.lumine-${suffix}.part`
        record.tempPath = temp
        const source = this.requireSftp().createReadStream(record.remotePath)
        const destination = fs.createWriteStream(temp, { flags: 'wx', mode: 0o600 })
        await pipeline(source, this.progress(record), destination, {
          signal: record.controller.signal
        })
        if (record.overwrite) fs.rmSync(record.localPath, { force: true })
        fs.renameSync(temp, record.localPath)
      } else {
        const sftp = this.requireSftp()
        const directory = posix.dirname(record.remotePath)
        const temp = posix.join(
          directory,
          `.${posix.basename(record.remotePath)}.lumine-${suffix}.part`
        )
        record.tempPath = temp
        const source = fs.createReadStream(record.localPath)
        const destination = sftp.createWriteStream(temp)
        const closed = this.waitForClose(destination)
        await pipeline(source, this.progress(record), destination, {
          signal: record.controller.signal
        })
        await closed
        if (record.overwrite) await this.unlinkIfExists(sftp, record.remotePath)
        await doneCall((callback) => sftp.rename(temp, record.remotePath, callback))
      }

      record.state = 'done'
      record.transferred = record.total
      record.tempPath = undefined
      this.emitTransfer(record)
    } catch (error) {
      await this.cleanupTemp(record)
      if (record.controller.signal.aborted) {
        record.state = 'cancelled'
      } else {
        record.state = 'error'
        record.code = mapError(error).code
      }
      this.emitTransfer(record)
    }
  }

  private progress(record: TransferRecord): Transform {
    return new Transform({
      transform: (chunk: Buffer, _encoding, callback) => {
        record.transferred += chunk.length
        const now = Date.now()
        if (now - record.lastEmit >= 100) {
          record.lastEmit = now
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

  private async cleanupTemp(record: TransferRecord): Promise<void> {
    const temp = record.tempPath
    record.tempPath = undefined
    if (!temp) return
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
      ...(record.code ? { code: record.code } : {})
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

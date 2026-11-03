import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { posix } from 'node:path'
import { Transform, type Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { Location, TransferDirection, TransferInfo } from '../shared/types'
import { AppError, mapError } from './errors'
import {
  ensureLocalDir,
  normalizeLocalPath,
  statLocal,
  walkLocal
} from './local-fs'
import { sanitizeLocalName } from './local-path'
import type { SftpSession } from './ssh'

const MAX_COPY_FILES = 10_000
const MAX_COPY_DEPTH = 32

export interface CopyServiceOptions {
  getSession(sessionId: string): SftpSession | null
  emit(transfer: TransferInfo): void
}

interface CopyJob {
  id: string
  controller: AbortController
  info: TransferInfo
  lastEmit: number
  after?: (destination: string) => void
}

interface RemoteTree {
  files: Array<{ path: string; relative: string; size: number }>
  directories: string[]
  total: number
}

function basenameOf(location: Location): string {
  return location.kind === 'remote'
    ? posix.basename(location.path)
    : path.basename(normalizeLocalPath(location.path))
}

function validRemoteName(name: string): boolean {
  return (
    Boolean(name) &&
    name.length <= 255 &&
    name !== '.' &&
    name !== '..' &&
    !/[/\\\u0000-\u001f\u007f]/.test(name)
  )
}

function directionOf(from: Location, to: Location): TransferDirection {
  if (from.kind === 'local' && to.kind === 'remote') return 'upload'
  if (from.kind === 'remote' && to.kind === 'local') return 'download'
  return 'copy'
}

/**
 * Copy file/thư mục giữa hai đầu SFTP hoặc đĩa local.
 *
 * Luôn đọc-rồi-ghi: SFTP không có lệnh copy phía server, còn remote→remote là
 * hai kết nối riêng nên chỉ có thể nối stream của bên đọc vào stream bên ghi.
 * Ghi vào file tạm `.part` rồi mới rename, để huỷ giữa đường không để lại file
 * đích nửa vời trùng tên với dữ liệu thật.
 */
export class CopyService {
  private readonly jobs = new Map<string, CopyJob>()

  constructor(private readonly options: CopyServiceOptions) {}

  start(
    from: Location,
    to: Location,
    after?: (destination: string) => void
  ): string {
    const id = randomUUID()
    const job: CopyJob = {
      id,
      controller: new AbortController(),
      info: {
        id,
        direction: directionOf(from, to),
        name: basenameOf(from),
        transferred: 0,
        total: 0,
        state: 'queued'
      },
      lastEmit: 0,
      ...(after ? { after } : {})
    }
    this.jobs.set(id, job)
    this.emit(job)
    void this.run(job, from, to)
    return id
  }

  cancel(id: string): boolean {
    const job = this.jobs.get(id)
    if (!job) return false
    if (job.info.state === 'queued' || job.info.state === 'running') {
      job.controller.abort()
    }
    return true
  }

  cancelAll(): void {
    for (const job of this.jobs.values()) job.controller.abort()
  }

  private emit(job: CopyJob): void {
    this.options.emit({ ...job.info })
  }

  private report(job: CopyJob, force = false): void {
    const now = Date.now()
    if (!force && now - job.lastEmit < 100) return
    job.lastEmit = now
    this.emit(job)
  }

  private requireSession(sessionId: string): SftpSession {
    const session = this.options.getSession(sessionId)
    if (!session) throw new AppError('NOT_CONNECTED')
    return session
  }

  private async run(
    job: CopyJob,
    from: Location,
    to: Location
  ): Promise<void> {
    const signal = job.controller.signal
    try {
      job.info.state = 'running'
      this.emit(job)

      const name = basenameOf(from)
      const destination = await this.resolveDestination(to, name)
      const isDirectory = await this.sourceIsDirectory(from)

      if (isDirectory) {
        job.info.total = 0
        this.emit(job)
        await this.makeDirectory(to, destination, signal)
        const total = await this.copyTree(job, from, to, destination, signal)
        job.info.total = total
      } else {
        job.info.total = await this.sourceSize(from)
        this.emit(job)
        await this.copyFile(job, from, to, destination, signal)
      }

      this.throwIfAborted(signal)
      job.info.state = 'done'
      job.info.transferred = job.info.total
      this.emit(job)

      if (job.after && to.kind === 'local') {
        job.after(destination)
      }
    } catch (error) {
      job.info.state = signal.aborted ? 'cancelled' : 'error'
      if (!signal.aborted) job.info.code = mapError(error).code
      this.emit(job)
    }
  }

  private async sourceIsDirectory(from: Location): Promise<boolean> {
    if (from.kind === 'remote') {
      return (await this.requireSession(from.sessionId).stat(from.path)).kind === 'directory'
    }
    return (await statLocal(from.path)).kind === 'directory'
  }

  private async sourceSize(from: Location): Promise<number> {
    if (from.kind === 'remote') {
      return Math.max(0, (await this.requireSession(from.sessionId).stat(from.path)).size)
    }
    return Math.max(0, (await statLocal(from.path)).size)
  }

  private async resolveDestination(to: Location, name: string): Promise<string> {
    if (to.kind === 'remote') {
      if (!validRemoteName(name)) throw new AppError('INVALID_NAME', name)
      const session = this.requireSession(to.sessionId)
      const directory = await session.stat(to.path)
      if (directory.kind !== 'directory') throw new AppError('INVALID_PATH', to.path)
      const destination = posix.join(to.path, name)
      if (await session.exists(destination)) {
        throw new AppError('ALREADY_EXISTS', name)
      }
      return destination
    }

    const directory = await statLocal(to.path)
    if (directory.kind !== 'directory') throw new AppError('INVALID_PATH', to.path)
    const destination = path.join(normalizeLocalPath(to.path), sanitizeLocalName(name))
    const existing = await fs.promises.lstat(destination).catch(() => null)
    if (existing) throw new AppError('ALREADY_EXISTS', name)
    return destination
  }

  private async makeDirectory(
    to: Location,
    target: string,
    signal: AbortSignal
  ): Promise<void> {
    this.throwIfAborted(signal)
    if (to.kind === 'remote') {
      await this.requireSession(to.sessionId).ensureDir(target)
      return
    }
    await ensureLocalDir(target)
  }

  private async copyTree(
    job: CopyJob,
    from: Location,
    to: Location,
    destination: string,
    signal: AbortSignal
  ): Promise<number> {
    const tree =
      from.kind === 'remote'
        ? await this.walkRemote(
            this.requireSession(from.sessionId),
            from.path,
            signal
          )
        : await walkLocal(from.path)

    if (tree.files.length > MAX_COPY_FILES) {
      throw new AppError('LIST_TOO_LARGE', String(tree.files.length))
    }
    job.info.total = tree.total
    this.emit(job)

    for (const relative of tree.directories) {
      await this.makeDirectory(to, this.join(to, destination, relative), signal)
    }
    for (const file of tree.files) {
      this.throwIfAborted(signal)
      const source: Location =
        from.kind === 'remote'
          ? { kind: 'remote', sessionId: from.sessionId, path: file.path }
          : { kind: 'local', path: file.path }
      await this.copyFile(
        job,
        source,
        to,
        this.join(to, destination, file.relative),
        signal
      )
    }
    return tree.total
  }

  private join(to: Location, root: string, relative: string): string {
    const parts = relative.split('/').filter(Boolean)
    if (to.kind === 'remote') return posix.join(root, ...parts)
    return path.join(root, ...parts.map((part) => sanitizeLocalName(part)))
  }

  private async copyFile(
    job: CopyJob,
    from: Location,
    to: Location,
    destination: string,
    signal: AbortSignal
  ): Promise<void> {
    this.throwIfAborted(signal)
    const suffix = randomUUID().replace(/-/g, '').slice(0, 10)

    if (to.kind === 'local') {
      await ensureLocalDir(path.dirname(destination))
      const temp = `${destination}.lumine-${suffix}.part`
      const source = this.readStream(from)
      const target = fs.createWriteStream(temp, { flags: 'wx', mode: 0o600 })
      try {
        await pipeline(source, this.progress(job), target, { signal })
        fs.renameSync(temp, destination)
      } catch (error) {
        fs.rmSync(temp, { force: true })
        throw error
      }
      return
    }

    const session = this.requireSession(to.sessionId)
    await session.ensureDir(posix.dirname(destination))
    const temp = posix.join(
      posix.dirname(destination),
      `.${posix.basename(destination)}.lumine-${suffix}.part`
    )
    const target = session.createWriteStream(temp)
    try {
      await pipeline(this.readStream(from), this.progress(job), target.stream, {
        signal
      })
      await target.closed
      if (await session.exists(destination)) {
        await session.removeQuietly(destination)
      }
      await session.renameAbsolute(temp, destination)
    } catch (error) {
      await session.removeQuietly(temp)
      throw error
    }
  }

  private readStream(from: Location): Readable {
    if (from.kind === 'remote') {
      return this.requireSession(from.sessionId).createReadStream(from.path)
    }
    return fs.createReadStream(normalizeLocalPath(from.path))
  }

  private async walkRemote(
    session: SftpSession,
    root: string,
    signal: AbortSignal,
    depth = 0
  ): Promise<RemoteTree> {
    if (depth > MAX_COPY_DEPTH) throw new AppError('LIST_TOO_LARGE', root)
    this.throwIfAborted(signal)
    const listing = await session.list(root)
    const tree: RemoteTree = { files: [], directories: [], total: 0 }

    for (const entry of listing.entries) {
      if (entry.kind === 'directory') {
        tree.directories.push(entry.name)
        const child = await this.walkRemote(
          session,
          posix.join(listing.path, entry.name),
          signal,
          depth + 1
        )
        tree.total += child.total
        for (const dir of child.directories) {
          tree.directories.push(`${entry.name}/${dir}`)
        }
        for (const file of child.files) {
          tree.files.push({
            path: file.path,
            relative: `${entry.name}/${file.relative}`,
            size: file.size
          })
        }
        continue
      }
      if (entry.kind !== 'file' && entry.kind !== 'link') continue
      tree.files.push({
        path: posix.join(listing.path, entry.name),
        relative: entry.name,
        size: entry.size
      })
      tree.total += entry.size
    }

    return tree
  }

  private throwIfAborted(signal: AbortSignal): void {
    if (signal.aborted) throw new AppError('TRANSFER_CANCELLED')
  }

  private progress(job: CopyJob): Transform {
    return new Transform({
      transform: (chunk: Buffer, _encoding, callback) => {
        job.info.transferred += chunk.length
        this.report(job)
        callback(null, chunk)
      }
    })
  }
}
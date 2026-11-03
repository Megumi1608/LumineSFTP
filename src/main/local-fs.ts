import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { RemoteEntry, RemoteEntryKind, RemoteListing } from '../shared/types'
import { AppError } from './errors'

/** Khung "Máy tính này" duyệt đĩa thật, nên chặn ở cùng giới hạn với SFTP. */
const MAX_LOCAL_ENTRIES = 10_000
const MAX_LOCAL_DEPTH = 32

export function normalizeLocalPath(value: string): string {
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > 4096 ||
    /[\u0000\r\n]/.test(value)
  ) {
    throw new AppError('INVALID_PATH')
  }
  const resolved = path.resolve(value)
  if (!path.isAbsolute(resolved)) throw new AppError('INVALID_PATH')
  return resolved
}

export function localHome(): string {
  return os.homedir()
}

export function localParent(target: string): string | null {
  const resolved = normalizeLocalPath(target)
  const parent = path.dirname(resolved)
  return parent === resolved ? null : parent
}

function kindOf(stats: fs.Stats): RemoteEntryKind {
  if (stats.isDirectory()) return 'directory'
  if (stats.isFile()) return 'file'
  if (stats.isSymbolicLink()) return 'link'
  return 'other'
}

export async function listLocal(target: string): Promise<RemoteListing> {
  const resolved = normalizeLocalPath(target)
  const dirents = await fs.promises.readdir(resolved, { withFileTypes: true })
  if (dirents.length > MAX_LOCAL_ENTRIES) {
    throw new AppError('LIST_TOO_LARGE', String(dirents.length))
  }

  const entries: RemoteEntry[] = []
  for (const dirent of dirents) {
    let stats: fs.Stats
    try {
      stats = await fs.promises.lstat(path.join(resolved, dirent.name))
    } catch {
      continue
    }
    entries.push({
      name: dirent.name,
      kind: kindOf(stats),
      size: stats.size,
      modified: Math.floor(stats.mtimeMs / 1000),
      mode: stats.mode,
      uid: stats.uid ?? 0,
      gid: stats.gid ?? 0
    })
  }

  entries.sort((left, right) => {
    const leftDir = left.kind === 'directory' ? 0 : 1
    const rightDir = right.kind === 'directory' ? 0 : 1
    return leftDir - rightDir || left.name.localeCompare(right.name)
  })

  return { path: resolved, entries, parent: localParent(resolved) }
}

export async function statLocal(target: string): Promise<{
  kind: RemoteEntryKind
  size: number
  mtime: number
}> {
  const resolved = normalizeLocalPath(target)
  const stats = await fs.promises.lstat(resolved)
  return { kind: kindOf(stats), size: stats.size, mtime: stats.mtimeMs }
}

export async function ensureLocalDir(target: string): Promise<void> {
  await fs.promises.mkdir(normalizeLocalPath(target), { recursive: true })
}

export async function mkdirLocal(directory: string, name: string): Promise<void> {
  const base = normalizeLocalPath(directory)
  const target = path.resolve(base, name)
  if (path.dirname(target) !== base) throw new AppError('INVALID_NAME', name)
  await fs.promises.mkdir(target)
}

export async function renameLocal(
  directory: string,
  from: string,
  to: string
): Promise<void> {
  const base = normalizeLocalPath(directory)
  const source = path.resolve(base, from)
  const target = path.resolve(base, to)
  if (path.dirname(source) !== base || path.dirname(target) !== base) {
    throw new AppError('INVALID_NAME')
  }
  await fs.promises.rename(source, target)
}

export async function removeLocal(target: string): Promise<void> {
  const resolved = normalizeLocalPath(target)
  if (resolved === path.parse(resolved).root) throw new AppError('INVALID_PATH', resolved)
  await fs.promises.rm(resolved, { recursive: true, force: false })
}

/**
 * Liệt kê đệ quy để tính tổng dung lượng trước khi copy thư mục — thanh tiến
 * trình cần mẫu số thật, không phải "số file đã xong" nhảy lung tung.
 */
export async function walkLocal(
  target: string
): Promise<{
  files: Array<{ path: string; size: number; relative: string }>
  directories: string[]
  total: number
}> {
  const root = normalizeLocalPath(target)
  const files: Array<{ path: string; size: number; relative: string }> = []
  const directories: string[] = []
  let total = 0

  async function visit(current: string, relative: string, depth: number): Promise<void> {
    if (depth > MAX_LOCAL_DEPTH) throw new AppError('LIST_TOO_LARGE', current)
    const entries = await fs.promises.readdir(current, { withFileTypes: true })
    if (entries.length > MAX_LOCAL_ENTRIES) {
      throw new AppError('LIST_TOO_LARGE', current)
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name)
      const childRelative = relative ? `${relative}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        directories.push(childRelative)
        await visit(full, childRelative, depth + 1)
        continue
      }
      if (!entry.isFile()) continue
      const stats = await fs.promises.stat(full)
      files.push({ path: full, size: stats.size, relative: childRelative })
      total += stats.size
    }
  }

  await visit(root, '', 0)
  return { files, directories, total }
}
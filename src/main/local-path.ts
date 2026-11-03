import path from 'node:path'
import { removeInvisibleControls } from '../shared/filename'

const RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i
const ILLEGAL_LOCAL_CHARS = /[\u0000-\u001f\u007f<>:"|?*]/g

/**
 * Turn a server-controlled filename into a safe local filename.
 * Removes directory components, Windows-reserved names, control characters,
 * trailing dots/spaces and caps the length.
 */
export function sanitizeLocalName(input: string): string {
  const raw = typeof input === 'string' ? input : ''
  const base = raw.split(/[\\/]/).pop() ?? ''
  let name = removeInvisibleControls(base).replace(ILLEGAL_LOCAL_CHARS, '_')
  name = name.replace(/[. ]+$/g, '')
  if (!name || name === '.' || name === '..') name = 'download'

  const stem = name.split('.')[0] ?? ''
  if (RESERVED_NAME.test(stem)) name = `_${name}`

  const chars = Array.from(name)
  if (chars.length > 200) {
    const dot = name.lastIndexOf('.')
    const extension = dot > 0 && chars.length - dot <= 20 ? name.slice(dot) : ''
    const extensionLength = Array.from(extension).length
    name = chars.slice(0, Math.max(1, 200 - extensionLength)).join('') + extension
  }

  return name
}

/** True only when `candidate` is a child of `directory` (never the directory itself). */
export function isInsideDirectory(directory: string, candidate: string): boolean {
  const from = path.resolve(directory)
  const to = path.resolve(candidate)
  const relative = path.relative(from, to)
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative)
}

export function safeLocalTarget(directory: string, remoteName: string): string {
  const target = path.resolve(directory, sanitizeLocalName(remoteName))
  if (!isInsideDirectory(directory, target)) {
    throw new Error('unsafe local path')
  }
  return target
}

/** Build a contained local path from server-controlled relative segments. */
export function safeLocalPath(directory: string, segments: string[]): string {
  let current = path.resolve(directory)
  for (const segment of segments) {
    current = path.resolve(current, sanitizeLocalName(segment))
  }
  if (!isInsideDirectory(directory, current)) {
    throw new Error('unsafe local path')
  }
  return current
}

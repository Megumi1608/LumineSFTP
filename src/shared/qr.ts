import type { QrPayload } from './types'

export const QR_MAX_LENGTH = 2048

export type QrError =
  | 'EMPTY'
  | 'TOO_LARGE'
  | 'NOT_JSON'
  | 'NOT_OBJECT'
  | 'UNKNOWN_FIELD'
  | 'SECRET_REJECTED'
  | 'INVALID_HOST'
  | 'INVALID_PORT'
  | 'INVALID_USERNAME'
  | 'INVALID_NAME'

export type QrParseResult =
  | { ok: true; value: QrPayload }
  | { ok: false; error: QrError }

const ALLOWED_FIELDS = new Set(['host', 'port', 'username', 'name'])
const SECRET_FIELDS = new Set([
  'password',
  'passwd',
  'passphrase',
  'privatekey',
  'private_key',
  'secret',
  'token',
  'key'
])

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/

/** Normalize and validate a hostname, IPv4 or bracketed/unbracketed IPv6 literal. */
export function normalizeHost(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  let host = raw.trim()
  if (!host || host.length > 253) return null
  if (CONTROL_CHARS.test(host) || /\s/.test(host)) return null
  if (/[/\\@?#%]/.test(host)) return null

  const bracketed = host.startsWith('[') && host.endsWith(']')
  if (!bracketed && host.includes(':')) return null
  if (bracketed && !/^\[[0-9a-fA-F:.]+\]$/.test(host)) return null

  if (!bracketed) host = host.replace(/\.$/, '')

  let parsed: URL
  try {
    parsed = new URL(`http://${host}/`)
  } catch {
    return null
  }
  if (parsed.username || parsed.password || parsed.port) return null
  if (parsed.pathname !== '/' || parsed.search || parsed.hash) return null

  let hostname = parsed.hostname
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    hostname = hostname.slice(1, -1)
  }
  if (!hostname || hostname.length > 253) return null

  if (hostname.includes(':')) {
    // URL already validated the IPv6 literal.
    if (!/^[0-9a-f:.]+$/.test(hostname)) return null
    return hostname.toLowerCase()
  }

  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) {
    if (hostname.split('.').some((part) => Number(part) > 255)) return null
    return hostname
  }

  const labels = hostname.split('.')
  if (
    labels.some(
      (label) =>
        !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label) || label.length > 63
    )
  ) {
    return null
  }
  return hostname.toLowerCase()
}

export function normalizePort(raw: unknown): number | null {
  if (typeof raw === 'number') {
    return Number.isInteger(raw) && raw >= 1 && raw <= 65535 ? raw : null
  }
  if (typeof raw === 'string') {
    const value = raw.trim()
    if (!/^\d{1,5}$/.test(value)) return null
    const port = Number(value)
    return port >= 1 && port <= 65535 ? port : null
  }
  return null
}

export function normalizeUsername(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const username = raw.trim()
  if (!username || username.length > 128) return null
  if (CONTROL_CHARS.test(username)) return null
  return username
}

export function normalizeLabel(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null
  if (typeof raw !== 'string') return null
  const name = raw.trim()
  if (!name || name.length > 80) return null
  if (CONTROL_CHARS.test(name)) return null
  return name
}

/** Validate an already-parsed JSON object as a QR payload. */
export function validateQrObject(value: unknown): QrParseResult {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: 'NOT_OBJECT' }
  }
  const record = value as Record<string, unknown>
  const keys = Object.keys(record)

  for (const key of keys) {
    if (SECRET_FIELDS.has(key.toLowerCase())) {
      return { ok: false, error: 'SECRET_REJECTED' }
    }
  }
  for (const key of keys) {
    if (!ALLOWED_FIELDS.has(key)) {
      return { ok: false, error: 'UNKNOWN_FIELD' }
    }
  }

  const host = normalizeHost(record.host)
  if (!host) return { ok: false, error: 'INVALID_HOST' }

  const port = normalizePort(record.port)
  if (!port) return { ok: false, error: 'INVALID_PORT' }

  const username = normalizeUsername(record.username)
  if (!username) return { ok: false, error: 'INVALID_USERNAME' }

  let name: string | undefined
  if (record.name !== undefined) {
    const label = normalizeLabel(record.name)
    if (!label) return { ok: false, error: 'INVALID_NAME' }
    name = label
  }

  return { ok: true, value: { host, port, username, ...(name ? { name } : {}) } }
}

/** Parse the raw string decoded from a QR image. Tolerates surrounding whitespace and a trailing semicolon. */
export function parseQrText(text: string): QrParseResult {
  if (typeof text !== 'string') return { ok: false, error: 'EMPTY' }
  let payload = text.trim()
  if (!payload) return { ok: false, error: 'EMPTY' }
  if (payload.length > QR_MAX_LENGTH) return { ok: false, error: 'TOO_LARGE' }
  payload = payload.replace(/;+\s*$/, '')

  let parsed: unknown
  try {
    parsed = JSON.parse(payload)
  } catch {
    return { ok: false, error: 'NOT_JSON' }
  }
  return validateQrObject(parsed)
}

export const qrErrorMessages: Record<QrError, { vi: string; en: string }> = {
  EMPTY: { vi: 'Ảnh không chứa dữ liệu QR.', en: 'The image contains no QR data.' },
  TOO_LARGE: { vi: 'Dữ liệu QR quá lớn (tối đa 2 KB).', en: 'QR data is too large (2 KB max).' },
  NOT_JSON: { vi: 'Nội dung QR không phải JSON hợp lệ.', en: 'QR content is not valid JSON.' },
  NOT_OBJECT: { vi: 'QR phải chứa một object JSON.', en: 'The QR must contain a JSON object.' },
  UNKNOWN_FIELD: {
    vi: 'QR chứa trường không được hỗ trợ.',
    en: 'The QR contains an unsupported field.'
  },
  SECRET_REJECTED: {
    vi: 'QR chứa mật khẩu hoặc khoá bí mật. Đã từ chối vì lý do bảo mật.',
    en: 'The QR contains a password or secret key. Rejected for security reasons.'
  },
  INVALID_HOST: { vi: 'Địa chỉ host không hợp lệ.', en: 'The host address is invalid.' },
  INVALID_PORT: {
    vi: 'Port phải là số nguyên từ 1 đến 65535.',
    en: 'The port must be an integer between 1 and 65535.'
  },
  INVALID_USERNAME: { vi: 'Username không hợp lệ.', en: 'The username is invalid.' },
  INVALID_NAME: { vi: 'Tên kết nối không hợp lệ.', en: 'The connection name is invalid.' }
}

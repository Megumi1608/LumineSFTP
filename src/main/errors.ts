import type { Err, ErrorCode } from '../shared/types'

export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly detail?: string
  ) {
    super(code)
    this.name = 'AppError'
  }
}

export function cleanDetail(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  const text = String(value)
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!text) return undefined
  return text.length > 300 ? `${text.slice(0, 297)}...` : text
}

interface NetworkError {
  code?: string | number
  level?: string
  message?: string
}

export function mapError(error: unknown): { code: ErrorCode; detail?: string } {
  if (error instanceof AppError) {
    return { code: error.code, detail: cleanDetail(error.detail) }
  }

  const problem = (error ?? {}) as NetworkError
  const rawCode = problem.code
  const rawMessage = typeof problem.message === 'string' ? problem.message : ''

  if (
    /no matching (host key|key exchange|cipher|mac|compression)/i.test(rawMessage) ||
    /(unsupported|incompatible) (algorithm|host key|key exchange|cipher|mac)/i.test(rawMessage)
  ) {
    return { code: 'ALGORITHM_UNSUPPORTED', detail: cleanDetail(rawMessage) }
  }

  if (problem.level === 'client-authentication') {
    return { code: 'AUTH_FAILED' }
  }
  if (problem.level === 'client-timeout') {
    return { code: 'CONNECTION_TIMEOUT' }
  }

  if (typeof rawCode === 'number') {
    // SSH_FX_* status codes from the SFTP subsystem.
    if (rawCode === 2) return { code: 'NO_SUCH_FILE' }
    if (rawCode === 3) return { code: 'PERMISSION_DENIED' }
    if (rawCode === 8) return { code: 'TRANSFER_FAILED' }
    if (rawCode === 11) return { code: 'ALREADY_EXISTS' }
    return { code: 'INTERNAL', detail: cleanDetail(problem.message) }
  }

  switch (rawCode) {
    case 'ECONNREFUSED':
      return { code: 'CONNECTION_REFUSED' }
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return { code: 'HOST_NOT_FOUND' }
    case 'ETIMEDOUT':
      return { code: 'CONNECTION_TIMEOUT' }
    case 'ENETUNREACH':
    case 'EHOSTUNREACH':
    case 'ECONNRESET':
    case 'EPIPE':
      return { code: 'NETWORK_ERROR' }
    case 'ENOENT':
      return { code: 'NO_SUCH_FILE' }
    case 'EACCES':
    case 'EPERM':
      return { code: 'PERMISSION_DENIED' }
    case 'EEXIST':
      return { code: 'ALREADY_EXISTS' }
    case 'ENOSPC':
      return { code: 'TRANSFER_FAILED' }
    default:
      return { code: 'INTERNAL', detail: cleanDetail(problem.message) }
  }
}

export function toErr(error: unknown): Err {
  const mapped = mapError(error)
  return {
    ok: false,
    code: mapped.code,
    ...(mapped.detail ? { detail: mapped.detail } : {})
  }
}

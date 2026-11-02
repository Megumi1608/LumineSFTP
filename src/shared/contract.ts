import { validateQrObject, type QrError } from './qr'
import type { ErrorCode, Locale, ProfileInput } from './types'

export class ContractError extends Error {
  readonly code: ErrorCode = 'INVALID_INPUT'

  constructor(readonly detail?: string) {
    super('invalid input')
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ContractError('object expected')
  }
  return value as Record<string, unknown>
}

function text(value: unknown, max: number, field: string): string {
  if (typeof value !== 'string') throw new ContractError(field)
  if (!value || value.length > max) throw new ContractError(field)
  return value
}

function qrErrorToContract(error: QrError): never {
  throw new ContractError(error)
}

export function assertId(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new ContractError('id')
  }
  return value
}

export function assertRequestId(value: unknown): string {
  return assertId(value)
}

export function assertLocale(value: unknown): Locale {
  if (value !== 'vi' && value !== 'en') throw new ContractError('locale')
  return value
}

export function assertProfileSave(value: unknown): ProfileInput & { id?: string } {
  const record = asRecord(value)
  const allowed = new Set(['id', 'host', 'port', 'username', 'name'])
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) throw new ContractError(`field:${key}`)
  }

  const parsed = validateQrObject({
    host: record.host,
    port: record.port,
    username: record.username,
    name: record.name
  })
  if (!parsed.ok) qrErrorToContract(parsed.error)

  const id = record.id === undefined ? undefined : assertId(record.id)
  return {
    ...(id ? { id } : {}),
    name: parsed.value.name ?? parsed.value.host,
    host: parsed.value.host,
    port: parsed.value.port,
    username: parsed.value.username
  }
}

export function assertPassword(value: unknown): string {
  const password = text(value, 1024, 'password')
  if (password.includes('\u0000')) throw new ContractError('password')
  return password
}

export function assertRemotePath(value: unknown): string {
  const path = text(value, 4096, 'path')
  if (/[\u0000\r\n]/.test(path)) throw new ContractError('path')
  return path
}

export function assertRemoteName(value: unknown): string {
  if (typeof value !== 'string') throw new ContractError('name')
  if (!value || value.length > 255) throw new ContractError('name')
  if (value === '.' || value === '..') throw new ContractError('name')
  if (/[/\\\u0000-\u001f\u007f]/.test(value)) throw new ContractError('name')
  return value
}

export function assertAnswers(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 16) throw new ContractError('answers')
  return value.map((answer) => {
    if (typeof answer !== 'string' || answer.length > 1024) {
      throw new ContractError('answers')
    }
    return answer
  })
}

export function assertKnownHostKey(value: unknown): string {
  const key = text(value, 320, 'known-host')
  if (/[\u0000\r\n]/.test(key)) throw new ContractError('known-host')
  return key
}

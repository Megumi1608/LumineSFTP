import { describe, expect, it } from 'vitest'
import { normalizeHost, normalizePort, parseQrText, validateQrObject } from '../src/shared/qr'

const sample = '{"host":"files.example.com","port":2022,"username":"demo-user"}'

describe('parseQrText', () => {
  it('parses the sample payload', () => {
    const result = parseQrText(sample)
    expect(result).toEqual({
      ok: true,
      value: {
        host: 'files.example.com',
        port: 2022,
        username: 'demo-user'
      }
    })
  })

  it('tolerates whitespace and a trailing semicolon', () => {
    const result = parseQrText(`  ${sample};  `)
    expect(result.ok).toBe(true)
  })

  it('accepts a numeric string port and an optional name', () => {
    const result = parseQrText(
      JSON.stringify({ host: 'example.com', port: '22', username: 'me', name: 'Work' })
    )
    expect(result).toEqual({
      ok: true,
      value: { host: 'example.com', port: 22, username: 'me', name: 'Work' }
    })
  })

  it('rejects passwords and other secrets in the QR payload', () => {
    for (const field of ['password', 'passphrase', 'privateKey', 'token']) {
      const result = parseQrText(
        JSON.stringify({ host: 'example.com', port: 22, username: 'me', [field]: 'secret' })
      )
      expect(result).toEqual({ ok: false, error: 'SECRET_REJECTED' })
    }
  })

  it('rejects unknown fields', () => {
    const result = parseQrText(
      JSON.stringify({ host: 'example.com', port: 22, username: 'me', nickname: 'x' })
    )
    expect(result).toEqual({ ok: false, error: 'UNKNOWN_FIELD' })
  })

  it('rejects non-JSON and non-object payloads', () => {
    expect(parseQrText('hello')).toEqual({ ok: false, error: 'NOT_JSON' })
    expect(parseQrText('[]')).toEqual({ ok: false, error: 'NOT_OBJECT' })
    expect(parseQrText('null')).toEqual({ ok: false, error: 'NOT_OBJECT' })
    expect(parseQrText('   ')).toEqual({ ok: false, error: 'EMPTY' })
  })

  it('rejects oversized payloads', () => {
    const result = parseQrText(`{"host":"${'a'.repeat(3000)}"}`)
    expect(result).toEqual({ ok: false, error: 'TOO_LARGE' })
  })

  it('rejects invalid hosts', () => {
    const invalid = [
      'https://example.com',
      'example.com/path',
      'user@example.com',
      'example.com:22',
      'exa mple.com',
      'exa_mple.com',
      '-example.com',
      'example..com',
      'a'.repeat(254)
    ]
    for (const host of invalid) {
      expect(normalizeHost(host)).toBeNull()
    }
  })

  it('normalizes hostnames and IPv6 literals', () => {
    expect(normalizeHost('EXAMPLE.com.')).toBe('example.com')
    expect(normalizeHost('münich.de')).toBe('xn--mnich-kva.de')
    expect(normalizeHost('[2001:db8::1]')).toBe('2001:db8::1')
    expect(normalizeHost('2001:db8::1')).toBeNull()
    expect(normalizeHost('127.0.0.1')).toBe('127.0.0.1')
    expect(normalizeHost('999.0.0.1')).toBeNull()
  })

  it('validates ports strictly', () => {
    expect(normalizePort(22)).toBe(22)
    expect(normalizePort('2022')).toBe(2022)
    expect(normalizePort(0)).toBeNull()
    expect(normalizePort(65536)).toBeNull()
    expect(normalizePort('22 ')).toBe(22)
    expect(normalizePort('2x')).toBeNull()
    expect(normalizePort(22.5)).toBeNull()
  })

  it('rejects control characters in usernames', () => {
    expect(
      validateQrObject({ host: 'example.com', port: 22, username: 'bad\nname' })
    ).toEqual({ ok: false, error: 'INVALID_USERNAME' })
  })
})

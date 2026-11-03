import { describe, expect, it } from 'vitest'
import {
  assertAnswers,
  assertConnectSecret,
  assertKnownHostKey,
  assertLocale,
  assertPassword,
  assertProfileSave,
  assertRemoteName,
  assertRemotePath,
  assertRequestId,
  ContractError
} from '../src/shared/contract'

function expectInvalid(run: () => unknown): void {
  try {
    run()
  } catch (error) {
    expect(error).toBeInstanceOf(ContractError)
    return
  }
  throw new Error('expected ContractError')
}

describe('IPC contract', () => {
  it('accepts a valid profile', () => {
    expect(
      assertProfileSave({
        host: 'Example.com',
        port: 2022,
        username: 'me',
        name: 'Work'
      })
    ).toEqual({
      host: 'example.com',
      port: 2022,
      username: 'me',
      name: 'Work',
      authMethod: 'password',
      keyPath: null
    })
  })

  it('accepts key auth profiles', () => {
    const result = assertProfileSave({
      host: 'example.com',
      port: 22,
      username: 'me',
      authMethod: 'key',
      keyPath: 'C:\\Users\\me\\.ssh\\id_ed25519'
    })
    expect(result.authMethod).toBe('key')
    expect(result.keyPath).toContain('id_ed25519')
  })

  it('rejects key auth without a key path and connect secrets with unknown fields', () => {
    expectInvalid(() =>
      assertProfileSave({
        host: 'example.com',
        port: 22,
        username: 'me',
        authMethod: 'key'
      })
    )
    expectInvalid(() => assertConnectSecret({ password: 'x', extra: true }))
    expect(assertConnectSecret({ passphrase: 'x', saveSecret: true })).toEqual({
      passphrase: 'x',
      saveSecret: true
    })
  })

  it('accepts an id when saving an existing profile', () => {
    const id = '11111111-1111-4111-8111-111111111111'
    const result = assertProfileSave({
      id,
      host: 'example.com',
      port: 22,
      username: 'me',
      name: 'Work'
    })
    expect(result.id).toBe(id)
  })

  it('rejects secrets and extra fields', () => {
    expectInvalid(() =>
      assertProfileSave({ host: 'example.com', port: 22, username: 'me', password: 'x' })
    )
    expectInvalid(() =>
      assertProfileSave({ host: 'example.com', port: 22, username: 'me', extra: true })
    )
  })

  it('rejects malformed ids and locales', () => {
    expectInvalid(() => assertRequestId('not-an-id'))
    expectInvalid(() => assertLocale('fr'))
  })

  it('validates passwords', () => {
    expect(assertPassword('p@ss word')).toBe('p@ss word')
    expectInvalid(() => assertPassword(''))
    expectInvalid(() => assertPassword('bad\u0000password'))
  })

  it('validates remote paths and names', () => {
    expect(assertRemotePath('/home/user/file.txt')).toBe('/home/user/file.txt')
    expectInvalid(() => assertRemotePath('/home/\nfile'))
    expect(assertRemoteName('report 2026.txt')).toBe('report 2026.txt')
    expectInvalid(() => assertRemoteName('../escape'))
    expectInvalid(() => assertRemoteName('a/b'))
    expectInvalid(() => assertRemoteName('.'))
    expectInvalid(() => assertRemoteName(''))
  })

  it('validates interactive answers', () => {
    expect(assertAnswers(['one', 'two'])).toEqual(['one', 'two'])
    expectInvalid(() => assertAnswers('nope'))
    expectInvalid(() => assertAnswers(['ok', 42]))
  })

  it('validates known-host keys', () => {
    expect(assertKnownHostKey('example.com:22')).toBe('example.com:22')
    expect(assertKnownHostKey('[2001:db8::1]:22')).toBe('[2001:db8::1]:22')
    expectInvalid(() => assertKnownHostKey('bad\nkey'))
  })
})

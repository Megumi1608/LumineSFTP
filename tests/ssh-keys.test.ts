import { describe, expect, it } from 'vitest'
import { SECURE_ALGORITHMS, fingerprintOf, keyTypeOf } from '../src/main/ssh'

// Synthetic ed25519-shaped key used only to verify fingerprint formatting.
const ed25519Key = Buffer.from(
  'AAAAC3NzaC1lZDI1NTE5AAAAIEJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJC',
  'base64'
)

describe('host key helpers', () => {
  it('computes an OpenSSH-style SHA-256 fingerprint', () => {
    expect(fingerprintOf(ed25519Key)).toBe(
      'SHA256:LgZpRzWEAbVvBimxTv69/UB88PD8jyOSDqfozr+iNX0'
    )
  })

  it('reads the key algorithm from the SSH blob', () => {
    expect(keyTypeOf(ed25519Key)).toBe('ssh-ed25519')
    expect(keyTypeOf(Buffer.from([0, 0, 0, 20, 115, 115, 104]))).toBe('unknown')
  })
})

describe('secure transport policy', () => {
  const list = (value: unknown): string[] => value as string[]

  it('rejects SHA-1 host keys', () => {
    const hostKeys = list(SECURE_ALGORITHMS.serverHostKey)
    expect(hostKeys).not.toContain('ssh-rsa')
    expect(hostKeys).not.toContain('ssh-dss')
    expect(hostKeys).toContain('rsa-sha2-256')
    expect(hostKeys).toContain('ssh-ed25519')
  })

  it('rejects SHA-1 MACs and weak ciphers', () => {
    const hmacs = list(SECURE_ALGORITHMS.hmac)
    expect(hmacs.every((name) => !/sha1|md5/i.test(name))).toBe(true)
    const ciphers = list(SECURE_ALGORITHMS.cipher)
    expect(ciphers.every((name) => !/cbc|arcfour|3des|blowfish|cast/i.test(name))).toBe(true)
  })

  it('rejects SHA-1 and group1 key exchange', () => {
    const kex = list(SECURE_ALGORITHMS.kex)
    expect(kex.every((name) => !/sha1|group1-sha1/i.test(name))).toBe(true)
    expect(kex).toContain('curve25519-sha256')
  })
})

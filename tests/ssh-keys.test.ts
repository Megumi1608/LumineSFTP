import { describe, expect, it } from 'vitest'
import { fingerprintOf, keyTypeOf } from '../src/main/ssh'

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

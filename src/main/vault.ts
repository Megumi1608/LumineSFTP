import { safeStorage } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

export type SecretKind = 'password' | 'passphrase'

interface SecretEntry {
  password?: string
  passphrase?: string
}

interface SecretsFile {
  version: 1
  entries: Record<string, SecretEntry>
}

const VERSION = 1

function emptyFile(): SecretsFile {
  return { version: VERSION, entries: {} }
}

function writeAtomic(file: string, value: SecretsFile): void {
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx'
  })
  try {
    fs.renameSync(temp, file)
  } catch (error) {
    try {
      fs.rmSync(temp, { force: true })
    } catch {
      // best effort
    }
    throw error
  }
  try {
    fs.chmodSync(file, 0o600)
  } catch {
    // Windows: ACLs inherit from the user profile.
  }
}

export class Vault {
  private readonly file: string

  constructor(baseDir: string) {
    this.file = path.join(baseDir, 'secrets.json')
  }

  async isAvailable(): Promise<boolean> {
    try {
      return await safeStorage.isAsyncEncryptionAvailable()
    } catch {
      return false
    }
  }

  private read(): SecretsFile {
    if (!fs.existsSync(this.file)) return emptyFile()
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Partial<SecretsFile>
      if (!parsed || typeof parsed !== 'object' || typeof parsed.entries !== 'object') {
        return emptyFile()
      }
      const entries: Record<string, SecretEntry> = {}
      for (const [id, entry] of Object.entries(parsed.entries ?? {})) {
        if (!entry || typeof entry !== 'object') continue
        const clean: SecretEntry = {}
        if (typeof entry.password === 'string') clean.password = entry.password
        if (typeof entry.passphrase === 'string') clean.passphrase = entry.passphrase
        if (clean.password || clean.passphrase) entries[id] = clean
      }
      return { version: VERSION, entries }
    } catch {
      return emptyFile()
    }
  }

  private write(value: SecretsFile): void {
    writeAtomic(this.file, value)
  }

  async get(profileId: string, kind: SecretKind): Promise<string | null> {
    if (!(await this.isAvailable())) return null
    const encoded = this.read().entries[profileId]?.[kind]
    if (!encoded) return null
    try {
      const decrypted = await safeStorage.decryptStringAsync(Buffer.from(encoded, 'base64'))
      return decrypted.result
    } catch {
      await this.deleteKind(profileId, kind)
      return null
    }
  }

  async has(profileId: string): Promise<boolean> {
    if (!(await this.isAvailable())) return false
    const entry = this.read().entries[profileId]
    return Boolean(entry?.password || entry?.passphrase)
  }

  async set(profileId: string, kind: SecretKind, value: string): Promise<void> {
    if (!(await this.isAvailable())) {
      throw new Error('secret storage unavailable')
    }
    const encrypted = await safeStorage.encryptStringAsync(value)
    const data = this.read()
    data.entries[profileId] = {
      ...data.entries[profileId],
      [kind]: encrypted.toString('base64')
    }
    this.write(data)
  }

  async delete(profileId: string): Promise<void> {
    const data = this.read()
    if (!data.entries[profileId]) return
    delete data.entries[profileId]
    this.write(data)
  }

  private async deleteKind(profileId: string, kind: SecretKind): Promise<void> {
    const data = this.read()
    const entry = data.entries[profileId]
    if (!entry || !entry[kind]) return
    delete entry[kind]
    if (!entry.password && !entry.passphrase) delete data.entries[profileId]
    this.write(data)
  }
}

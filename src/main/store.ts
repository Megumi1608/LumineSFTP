import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { normalizeHost, normalizePort, normalizeLabel, normalizeUsername } from '../shared/qr'
import type { KnownHost, Locale, Profile, ProfileInput } from '../shared/types'
import { AppError } from './errors'

const MAX_PROFILES = 200
const MAX_KNOWN_HOSTS = 500

function chmodQuiet(file: string, mode: number): void {
  try {
    fs.chmodSync(file, mode)
  } catch {
    // Windows: chmod is a no-op; the file lives inside the user profile.
  }
}

function writeJsonAtomic(file: string, value: unknown): void {
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`
  const body = `${JSON.stringify(value, null, 2)}\n`
  fs.writeFileSync(temp, body, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
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
  chmodQuiet(file, 0o600)
}

function backupCorrupt(file: string): void {
  try {
    fs.renameSync(file, `${file}.corrupt-${Date.now()}`)
  } catch {
    // if backup fails, leave the file alone
  }
}

function readJson(file: string, isValid: (value: unknown) => boolean): unknown | null {
  if (!fs.existsSync(file)) return null
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (!isValid(parsed)) throw new Error('invalid shape')
    return parsed
  } catch {
    backupCorrupt(file)
    return null
  }
}

function isStoredHost(host: string): boolean {
  return host.includes(':') ? normalizeHost(`[${host}]`) === host : normalizeHost(host) === host
}

function isProfile(value: unknown): value is Profile {
  if (value === null || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    typeof record.id === 'string' &&
    typeof record.name === 'string' &&
    typeof record.host === 'string' &&
    isStoredHost(record.host) &&
    normalizePort(record.port) === record.port &&
    normalizeUsername(record.username) === record.username &&
    typeof record.createdAt === 'number' &&
    (record.lastUsedAt === null || typeof record.lastUsedAt === 'number')
  )
}

function isKnownHost(value: unknown): value is KnownHost {
  if (value === null || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    typeof record.key === 'string' &&
    typeof record.host === 'string' &&
    typeof record.port === 'number' &&
    typeof record.keyType === 'string' &&
    typeof record.fingerprint === 'string' &&
    typeof record.firstSeen === 'number'
  )
}

function isSettingsFile(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false
  const locale = (value as Record<string, unknown>).locale
  return locale === 'vi' || locale === 'en'
}

export function knownHostKey(host: string, port: number): string {
  return `${host.includes(':') ? `[${host}]` : host}:${port}`
}

export class Store {
  private readonly profilesFile: string
  private readonly knownHostsFile: string
  private readonly settingsFile: string

  constructor(private readonly baseDir: string) {
    fs.mkdirSync(baseDir, { recursive: true, mode: 0o700 })
    this.profilesFile = path.join(baseDir, 'profiles.json')
    this.knownHostsFile = path.join(baseDir, 'known_hosts.json')
    this.settingsFile = path.join(baseDir, 'settings.json')
  }

  private readProfiles(): Profile[] {
    const value = readJson(
      this.profilesFile,
      (parsed) => Array.isArray(parsed) && parsed.every(isProfile)
    )
    if (!Array.isArray(value)) return []
    return (value as Profile[]).slice(0, MAX_PROFILES)
  }

  private writeProfiles(profiles: Profile[]): void {
    writeJsonAtomic(this.profilesFile, profiles)
  }

  listProfiles(): Profile[] {
    return this.readProfiles()
      .slice()
      .sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0) || a.name.localeCompare(b.name))
  }

  getProfile(id: string): Profile {
    const profile = this.readProfiles().find((item) => item.id === id)
    if (!profile) throw new AppError('PROFILE_NOT_FOUND')
    return profile
  }

  saveProfile(input: ProfileInput, id?: string): Profile {
    const profiles = this.readProfiles()
    const now = Date.now()
    const name = normalizeLabel(input.name) ?? input.host

    if (id) {
      const index = profiles.findIndex((item) => item.id === id)
      if (index < 0) throw new AppError('PROFILE_NOT_FOUND')
      const existing = profiles[index] as Profile
      const updated: Profile = {
        ...existing,
        name,
        host: input.host,
        port: input.port,
        username: input.username
      }
      profiles[index] = updated
      this.writeProfiles(profiles)
      return updated
    }

    const profile: Profile = {
      id: randomUUID(),
      name,
      host: input.host,
      port: input.port,
      username: input.username,
      createdAt: now,
      lastUsedAt: null
    }
    this.writeProfiles([profile, ...profiles].slice(0, MAX_PROFILES))
    return profile
  }

  removeProfile(id: string): void {
    const profiles = this.readProfiles()
    const next = profiles.filter((profile) => profile.id !== id)
    if (next.length === profiles.length) throw new AppError('PROFILE_NOT_FOUND')
    this.writeProfiles(next)
  }

  touchProfile(id: string): void {
    const profiles = this.readProfiles()
    const profile = profiles.find((item) => item.id === id)
    if (!profile) return
    profile.lastUsedAt = Date.now()
    this.writeProfiles(profiles)
  }

  private readKnownHosts(): KnownHost[] {
    const value = readJson(
      this.knownHostsFile,
      (parsed) => Array.isArray(parsed) && parsed.every(isKnownHost)
    )
    return Array.isArray(value) ? (value as KnownHost[]).slice(0, MAX_KNOWN_HOSTS) : []
  }

  listKnownHosts(): KnownHost[] {
    return this.readKnownHosts().slice().sort((a, b) => a.key.localeCompare(b.key))
  }

  getKnownHost(host: string, port: number): KnownHost | null {
    const key = knownHostKey(host, port)
    return this.readKnownHosts().find((entry) => entry.key === key) ?? null
  }

  addKnownHost(entry: {
    host: string
    port: number
    keyType: string
    fingerprint: string
  }): KnownHost {
    const key = knownHostKey(entry.host, entry.port)
    const hosts = this.readKnownHosts()
    const existing = hosts.find((item) => item.key === key)
    const next: KnownHost = {
      key,
      host: entry.host,
      port: entry.port,
      keyType: entry.keyType,
      fingerprint: entry.fingerprint,
      firstSeen: existing?.firstSeen ?? Date.now()
    }
    const filtered = hosts.filter((item) => item.key !== key)
    writeJsonAtomic(this.knownHostsFile, [next, ...filtered].slice(0, MAX_KNOWN_HOSTS))
    return next
  }

  forgetKnownHost(key: string): void {
    const hosts = this.readKnownHosts()
    const next = hosts.filter((item) => item.key !== key)
    if (next.length === hosts.length) return
    writeJsonAtomic(this.knownHostsFile, next)
  }

  getLocale(): Locale {
    const value = readJson(this.settingsFile, isSettingsFile)
    return (value as { locale?: Locale } | null)?.locale ?? 'vi'
  }

  setLocale(locale: Locale): void {
    writeJsonAtomic(this.settingsFile, { locale })
  }
}

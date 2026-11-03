import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { normalizeHost, normalizePort, normalizeLabel, normalizeUsername } from '../shared/qr'
import type {
  Bookmark,
  KnownHost,
  KnownHostsHealth,
  Locale,
  Profile,
  ProfileInput,
  WindowState
} from '../shared/types'
import { AppError } from './errors'

const MAX_PROFILES = 200
const MAX_KNOWN_HOSTS = 500
const MAX_BOOKMARKS = 500
const KNOWN_HOSTS_VERSION = 1

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

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

function backupCopy(file: string): void {
  try {
    fs.copyFileSync(file, `${file}.corrupt-${Date.now()}`)
  } catch {
    // best effort
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
    (record.authMethod === undefined ||
      record.authMethod === 'password' ||
      record.authMethod === 'key') &&
    (record.keyPath === undefined || record.keyPath === null || typeof record.keyPath === 'string') &&
    typeof record.createdAt === 'number' &&
    (record.lastUsedAt === null || typeof record.lastUsedAt === 'number')
  )
}

function normalizeProfile(profile: Profile): Profile {
  return {
    ...profile,
    authMethod: profile.authMethod === 'key' ? 'key' : 'password',
    keyPath: profile.authMethod === 'key' ? (profile.keyPath ?? null) : null
  }
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

function isBookmark(value: unknown): value is Bookmark {
  if (value === null || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    typeof record.id === 'string' &&
    typeof record.profileId === 'string' &&
    typeof record.path === 'string' &&
    typeof record.name === 'string' &&
    typeof record.createdAt === 'number'
  )
}

function isWindowState(value: unknown): value is WindowState {
  if (value === null || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    typeof record.width === 'number' &&
    record.width >= 940 &&
    record.width <= 10000 &&
    typeof record.height === 'number' &&
    record.height >= 600 &&
    record.height <= 10000 &&
    (record.x === undefined || typeof record.x === 'number') &&
    (record.y === undefined || typeof record.y === 'number') &&
    typeof record.maximized === 'boolean'
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
  private readonly bookmarksFile: string
  private readonly windowFile: string
  private knownHostsHealth: KnownHostsHealth = 'ok'

  constructor(private readonly baseDir: string) {
    fs.mkdirSync(baseDir, { recursive: true, mode: 0o700 })
    this.profilesFile = path.join(baseDir, 'profiles.json')
    this.knownHostsFile = path.join(baseDir, 'known_hosts.json')
    this.settingsFile = path.join(baseDir, 'settings.json')
    this.bookmarksFile = path.join(baseDir, 'bookmarks.json')
    this.windowFile = path.join(baseDir, 'window.json')
  }

  private readProfiles(): Profile[] {
    const value = readJson(
      this.profilesFile,
      (parsed) => Array.isArray(parsed) && parsed.every(isProfile)
    )
    if (!Array.isArray(value)) return []
    return (value as Profile[]).slice(0, MAX_PROFILES).map(normalizeProfile)
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
        username: input.username,
        authMethod: input.authMethod,
        keyPath: input.authMethod === 'key' ? input.keyPath : null
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
      authMethod: input.authMethod,
      keyPath: input.authMethod === 'key' ? input.keyPath : null,
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
    if (!fs.existsSync(this.knownHostsFile)) return []

    let parsed: unknown
    try {
      parsed = JSON.parse(fs.readFileSync(this.knownHostsFile, 'utf8'))
    } catch {
      this.noteKnownHostsHealth('recovered')
      backupCorrupt(this.knownHostsFile)
      return []
    }

    const rawHosts = Array.isArray(parsed)
      ? parsed
      : isRecord(parsed) && Array.isArray(parsed.hosts)
        ? parsed.hosts
        : null

    if (!rawHosts) {
      this.noteKnownHostsHealth('recovered')
      backupCorrupt(this.knownHostsFile)
      return []
    }

    const valid = rawHosts.filter(isKnownHost).slice(0, MAX_KNOWN_HOSTS)
    if (valid.length !== rawHosts.length) {
      this.noteKnownHostsHealth('partial')
      try {
        backupCopy(this.knownHostsFile)
        this.writeKnownHosts(valid)
      } catch {
        // Keep the valid entries in memory even if the repair write fails.
      }
    }
    return valid
  }

  private writeKnownHosts(hosts: KnownHost[]): void {
    writeJsonAtomic(this.knownHostsFile, {
      version: KNOWN_HOSTS_VERSION,
      hosts: hosts.slice(0, MAX_KNOWN_HOSTS)
    })
  }

  private noteKnownHostsHealth(next: KnownHostsHealth): void {
    const rank: Record<KnownHostsHealth, number> = { ok: 0, partial: 1, recovered: 2 }
    if (rank[next] > rank[this.knownHostsHealth]) this.knownHostsHealth = next
  }

  getKnownHostsHealth(): KnownHostsHealth {
    this.readKnownHosts()
    return this.knownHostsHealth
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
    this.writeKnownHosts([next, ...filtered])
    return next
  }

  forgetKnownHost(key: string): void {
    const hosts = this.readKnownHosts()
    const next = hosts.filter((item) => item.key !== key)
    if (next.length === hosts.length) return
    this.writeKnownHosts(next)
  }

  private readBookmarks(): Bookmark[] {
    const value = readJson(
      this.bookmarksFile,
      (parsed) => Array.isArray(parsed) && parsed.every(isBookmark)
    )
    return Array.isArray(value) ? (value as Bookmark[]).slice(0, MAX_BOOKMARKS) : []
  }

  listBookmarks(profileId: string): Bookmark[] {
    return this.readBookmarks()
      .filter((bookmark) => bookmark.profileId === profileId)
      .sort((left, right) => left.name.localeCompare(right.name))
  }

  addBookmark(profileId: string, targetPath: string): Bookmark {
    const name = targetPath === '/' ? '/' : targetPath.split('/').filter(Boolean).pop() ?? '/'
    const existing = this.readBookmarks().find(
      (bookmark) => bookmark.profileId === profileId && bookmark.path === targetPath
    )
    if (existing) return existing
    const bookmark: Bookmark = {
      id: randomUUID(),
      profileId,
      path: targetPath,
      name,
      createdAt: Date.now()
    }
    writeJsonAtomic(
      this.bookmarksFile,
      [bookmark, ...this.readBookmarks()].slice(0, MAX_BOOKMARKS)
    )
    return bookmark
  }

  removeBookmark(id: string): void {
    const bookmarks = this.readBookmarks()
    const next = bookmarks.filter((bookmark) => bookmark.id !== id)
    if (next.length === bookmarks.length) return
    writeJsonAtomic(this.bookmarksFile, next)
  }

  getWindowState(): WindowState | null {
    const value = readJson(this.windowFile, isWindowState)
    return isWindowState(value) ? value : null
  }

  setWindowState(state: WindowState): void {
    writeJsonAtomic(this.windowFile, state)
  }

  getLocale(): Locale {
    const value = readJson(this.settingsFile, isSettingsFile)
    return (value as { locale?: Locale } | null)?.locale ?? 'vi'
  }

  setLocale(locale: Locale): void {
    writeJsonAtomic(this.settingsFile, { locale })
  }
}

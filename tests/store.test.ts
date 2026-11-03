import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Store, knownHostKey } from '../src/main/store'
import type { KnownHost } from '../src/shared/types'

const dirs: string[] = []

function tempStore(): { dir: string; store: Store } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumine-store-'))
  dirs.push(dir)
  return { dir, store: new Store(dir) }
}

function hostEntry(host: string, port: number): KnownHost {
  return {
    key: knownHostKey(host, port),
    host,
    port,
    keyType: 'ssh-ed25519',
    fingerprint: 'SHA256:test',
    firstSeen: 1
  }
}

function rawFile(dir: string): string {
  return path.join(dir, 'known_hosts.json')
}

function hasBackup(dir: string): boolean {
  return fs.readdirSync(dir).some((name) => name.includes('.corrupt-'))
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('known_hosts storage', () => {
  it('reads the legacy array format', () => {
    const { dir, store } = tempStore()
    fs.writeFileSync(rawFile(dir), JSON.stringify([hostEntry('example.com', 22)]))
    expect(store.listKnownHosts()).toHaveLength(1)
    expect(store.getKnownHostsHealth()).toBe('ok')
  })

  it('keeps valid entries and warns when some entries are malformed', () => {
    const { dir, store } = tempStore()
    fs.writeFileSync(
      rawFile(dir),
      JSON.stringify([hostEntry('example.com', 22), { bogus: true }])
    )

    expect(store.listKnownHosts()).toHaveLength(1)
    expect(store.getKnownHostsHealth()).toBe('partial')
    expect(hasBackup(dir)).toBe(true)

    const repaired = JSON.parse(fs.readFileSync(rawFile(dir), 'utf8'))
    expect(repaired.version).toBe(1)
    expect(repaired.hosts).toHaveLength(1)
  })

  it('backs up a corrupt file and reports recovered health', () => {
    const { dir, store } = tempStore()
    fs.writeFileSync(rawFile(dir), '{not json')

    expect(store.listKnownHosts()).toEqual([])
    expect(store.getKnownHostsHealth()).toBe('recovered')
    expect(hasBackup(dir)).toBe(true)
  })

  it('writes the versioned format on add and forget', () => {
    const { dir, store } = tempStore()
    store.addKnownHost({
      host: 'example.com',
      port: 22,
      keyType: 'ssh-ed25519',
      fingerprint: 'SHA256:test'
    })

    const written = JSON.parse(fs.readFileSync(rawFile(dir), 'utf8'))
    expect(written.version).toBe(1)
    expect(written.hosts).toHaveLength(1)

    store.forgetKnownHost(knownHostKey('example.com', 22))
    expect(store.listKnownHosts()).toEqual([])
  })
})

describe('bookmarks and window state', () => {
  it('stores bookmarks per profile and deduplicates paths', () => {
    const { store } = tempStore()
    const first = store.addBookmark('11111111-1111-4111-8111-111111111111', '/srv/www')
    const again = store.addBookmark('11111111-1111-4111-8111-111111111111', '/srv/www')
    store.addBookmark('22222222-2222-4222-8222-222222222222', '/root')

    expect(again.id).toBe(first.id)
    expect(store.listBookmarks('11111111-1111-4111-8111-111111111111')).toHaveLength(1)
    expect(store.listBookmarks('22222222-2222-4222-8222-222222222222')).toHaveLength(1)

    store.removeBookmark(first.id)
    expect(store.listBookmarks('11111111-1111-4111-8111-111111111111')).toEqual([])
  })

  it('round-trips window state and rejects invalid values', () => {
    const { dir, store } = tempStore()
    store.setWindowState({ width: 1200, height: 800, x: 20, y: 30, maximized: false })
    expect(store.getWindowState()).toEqual({
      width: 1200,
      height: 800,
      x: 20,
      y: 30,
      maximized: false
    })

    fs.writeFileSync(path.join(dir, 'window.json'), JSON.stringify({ width: 10 }))
    expect(store.getWindowState()).toBeNull()
  })
})

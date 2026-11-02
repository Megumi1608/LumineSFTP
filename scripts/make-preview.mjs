import fs from 'node:fs'
import path from 'node:path'

const outDir = path.resolve('out/renderer')
const source = fs.readFileSync(path.join(outDir, 'index.html'), 'utf8')

const profiles = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Studio server',
    host: 'files.example.com',
    port: 2022,
    username: 'demo-user',
    createdAt: Date.now() - 1000 * 60 * 60 * 24 * 31,
    lastUsedAt: Date.now() - 1000 * 60 * 24
  }
]

const knownHosts = [
  {
    key: 'files.example.com:2022',
    host: 'files.example.com',
    port: 2022,
    keyType: 'ssh-ed25519',
    fingerprint: 'SHA256:LgZpRzWEAbVvBimxTv69/UB88PD8jyOSDqfozr+iNX0',
    firstSeen: Date.now() - 1000 * 60 * 60 * 24 * 30
  }
]

const entries = [
  { name: 'assets', kind: 'directory', size: 0, modified: 1793600000 },
  { name: 'drafts', kind: 'directory', size: 0, modified: 1793640000 },
  { name: 'exports', kind: 'directory', size: 0, modified: 1793650000 },
  { name: 'brand-guide.pdf', kind: 'file', size: 2483200, modified: 1793620000 },
  { name: 'hero-shot-01.jpg', kind: 'file', size: 8461820, modified: 1793630000 },
  { name: 'notes.md', kind: 'file', size: 12480, modified: 1793645000 },
  { name: 'archive-2025.zip', kind: 'file', size: 1288490000, modified: 1793500000 },
  { name: 'release-notes.txt', kind: 'file', size: 4180, modified: 1793610000 }
]

function mockScript({ withProfiles, withConnected }) {
  return `<script>
  (() => {
    const profiles = ${JSON.stringify(withProfiles ? profiles : [])};
    const knownHosts = ${JSON.stringify(withProfiles ? knownHosts : [])};
    const entries = ${JSON.stringify(entries)};
    const listing = { ok: true, data: { path: '/home/demo-user', entries } };
    let statusCallback = null;
    const ok = (data = null) => ({ ok: true, data });
    window.lumine = {
      profiles: {
        list: async () => ok(profiles),
        save: async (input) => ok({ ...profiles[0], ...input }),
        remove: async () => ok(null)
      },
      settings: {
        get: async () => ok({ locale: 'vi', version: '0.1.0' }),
        setLocale: async () => ok({ locale: 'vi', version: '0.1.0' })
      },
      knownHosts: {
        list: async () => ok(knownHosts),
        forget: async () => ok(null)
      },
      connect: async () => ok(profiles[0]),
      disconnect: async () => ok(null),
      respondHostKey: async () => ok(null),
      answerInteractive: async () => ok(null),
      sftp: {
        list: async () => listing,
        mkdir: async () => ok(null),
        rename: async () => ok(null),
        remove: async () => ok(null),
        upload: async () => ok({ queued: 1 }),
        download: async () => ok({ queued: 1 }),
        cancel: async () => ok(null)
      },
      updates: {
        get: async () => ok({ state: 'idle', canAutoUpdate: true }),
        check: async () => ok({ state: 'not-available', canAutoUpdate: true }),
        download: async () => ok({ state: 'downloading', percent: 42, canAutoUpdate: true }),
        install: async () => ok(null),
        openRelease: async () => ok(null)
      },
      onStatus: (callback) => {
        statusCallback = callback;
        if (${withConnected ? 'true' : 'false'}) {
          setTimeout(() => callback({ state: 'connected', profileId: profiles[0].id }), 60);
        }
        return () => { statusCallback = null; };
      },
      onHostKey: () => () => {},
      onInteractive: () => () => {},
      onTransfer: () => () => {},
      onUpdate: () => () => {}
    };
  })();
  </script>`
}

const previews = {
  'preview-onboarding.html': { withProfiles: false, withConnected: false },
  'preview-detail.html': { withProfiles: true, withConnected: false },
  'preview-connected.html': { withProfiles: true, withConnected: true }
}

for (const [file, options] of Object.entries(previews)) {
  const html = source
    .replace(/<meta http-equiv="Content-Security-Policy"[^>]*>\s*/i, '')
    .replace('</head>', `${mockScript(options)}\n  </head>`)
  fs.writeFileSync(path.join(outDir, file), html)
  console.log(`wrote out/renderer/${file}`)
}

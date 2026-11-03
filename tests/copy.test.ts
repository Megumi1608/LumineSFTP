import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { CopyService } from '../src/main/copy'
import { listLocal, walkLocal } from '../src/main/local-fs'

const roots: string[] = []

function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lumine-copy-'))
  roots.push(root)
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

describe('CopyService (local → local)', () => {
  it('copies a file and reports progress up to 100%', async () => {
    const root = tempRoot()
    const sourceDir = path.join(root, 'src')
    const targetDir = path.join(root, 'dst')
    fs.mkdirSync(sourceDir)
    fs.mkdirSync(targetDir)
    const source = path.join(sourceDir, 'notes.txt')
    fs.writeFileSync(source, 'xin chào')

    const states: string[] = []
    let transferred = 0
    let service: CopyService | null = null
    const done = new Promise<void>((resolve) => {
      service = new CopyService({
        getSession: () => null,
        emit: (transfer) => {
          states.push(transfer.state)
          transferred = transfer.transferred
          if (transfer.state === 'done' || transfer.state === 'error') resolve()
        }
      })
    })

    service!.start(
      { kind: 'local', path: source },
      { kind: 'local', path: targetDir }
    )
    await done

    expect(states.at(-1)).toBe('done')
    expect(transferred).toBe(Buffer.byteLength('xin chào'))
    expect(fs.readFileSync(path.join(targetDir, 'notes.txt'), 'utf8')).toBe(
      'xin chào'
    )
  })

  it('copies nested folders and keeps the tree', async () => {
    const root = tempRoot()
    const sourceDir = path.join(root, 'album')
    const targetDir = path.join(root, 'backup')
    fs.mkdirSync(path.join(sourceDir, 'a', 'b'), { recursive: true })
    fs.mkdirSync(targetDir)
    fs.writeFileSync(path.join(sourceDir, 'a', 'b', 'photo.txt'), 'ảnh')

    let finish: () => void = () => {}
    const done = new Promise<void>((resolve) => {
      finish = resolve
    })
    const service = new CopyService({
      getSession: () => null,
      emit: (transfer) => {
        if (transfer.state === 'done' || transfer.state === 'error') finish()
      }
    })

    service.start(
      { kind: 'local', path: sourceDir },
      { kind: 'local', path: targetDir }
    )
    await done

    expect(
      fs.readFileSync(path.join(targetDir, 'album', 'a', 'b', 'photo.txt'), 'utf8')
    ).toBe('ảnh')
  })

  it('refuses to overwrite an existing target', async () => {
    const root = tempRoot()
    const sourceDir = path.join(root, 'src')
    const targetDir = path.join(root, 'dst')
    fs.mkdirSync(sourceDir)
    fs.mkdirSync(targetDir)
    const source = path.join(sourceDir, 'same.txt')
    fs.writeFileSync(source, 'new')
    fs.writeFileSync(path.join(targetDir, 'same.txt'), 'old')

    let code: string | undefined
    let finish: () => void = () => {}
    const done = new Promise<void>((resolve) => {
      finish = resolve
    })
    const service = new CopyService({
      getSession: () => null,
      emit: (transfer) => {
        if (transfer.state === 'error') {
          code = transfer.code
          finish()
        }
      }
    })

    service.start(
      { kind: 'local', path: source },
      { kind: 'local', path: targetDir }
    )
    await done

    expect(code).toBe('ALREADY_EXISTS')
    expect(fs.readFileSync(path.join(targetDir, 'same.txt'), 'utf8')).toBe('old')
  })
})

describe('local-fs', () => {
  it('lists entries with a parent and hides nothing', async () => {
    const root = tempRoot()
    fs.mkdirSync(path.join(root, 'folder'))
    fs.writeFileSync(path.join(root, '.cache'), 'x')

    const listing = await listLocal(root)

    expect(listing.path).toBe(path.resolve(root))
    expect(listing.entries.map((entry) => entry.name)).toContain('.cache')
    expect(listing.entries[0]?.kind).toBe('directory')
    expect(listing.parent).toBe(path.dirname(path.resolve(root)))
  })

  it('walks folders and reports the files and directories to create', async () => {
    const root = tempRoot()
    fs.mkdirSync(path.join(root, 'a', 'empty'), { recursive: true })
    fs.writeFileSync(path.join(root, 'a', 'file.txt'), '123')

    const tree = await walkLocal(root)

    expect(tree.directories).toEqual(['a', 'a/empty'])
    expect(tree.files.map((file) => file.relative)).toEqual(['a/file.txt'])
    expect(tree.total).toBe(3)
  })
})

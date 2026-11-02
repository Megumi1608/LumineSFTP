import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  isInsideDirectory,
  safeLocalTarget,
  sanitizeLocalName
} from '../src/main/local-path'

describe('sanitizeLocalName', () => {
  it('strips directory components', () => {
    expect(sanitizeLocalName('../../etc/passwd')).toBe('passwd')
    expect(sanitizeLocalName('..\\..\\windows\\win.ini')).toBe('win.ini')
  })

  it('removes Windows-illegal characters', () => {
    expect(sanitizeLocalName('a:b*c?d"e<f>g|h')).toBe('a_b_c_d_e_f_g_h')
    expect(sanitizeLocalName('bad\u0000name')).toBe('bad_name')
  })

  it('protects reserved device names', () => {
    expect(sanitizeLocalName('CON')).toBe('_CON')
    expect(sanitizeLocalName('con.txt')).toBe('_con.txt')
    expect(sanitizeLocalName('LPT1.log')).toBe('_LPT1.log')
    expect(sanitizeLocalName('COM0.txt')).toBe('COM0.txt')
  })

  it('removes trailing dots and spaces', () => {
    expect(sanitizeLocalName('report.txt...')).toBe('report.txt')
    expect(sanitizeLocalName('name   ')).toBe('name')
  })

  it('falls back for empty and dot names', () => {
    expect(sanitizeLocalName('')).toBe('download')
    expect(sanitizeLocalName('.')).toBe('download')
    expect(sanitizeLocalName('..')).toBe('download')
  })

  it('caps names at 200 characters while keeping a short extension', () => {
    const result = sanitizeLocalName(`${'a'.repeat(300)}.txt`)
    expect(Array.from(result).length).toBeLessThanOrEqual(200)
    expect(result.endsWith('.txt')).toBe(true)
  })

  it('preserves unicode names', () => {
    expect(sanitizeLocalName('báo cáo.xlsx')).toBe('báo cáo.xlsx')
  })
})

describe('path containment', () => {
  const base = path.resolve('C:\\downloads')
  const inside = path.join(base, 'file.txt')
  const outside = path.resolve('C:\\Windows\\win.ini')

  it('accepts a direct child', () => {
    expect(isInsideDirectory(base, inside)).toBe(true)
  })

  it('rejects the directory itself and siblings', () => {
    expect(isInsideDirectory(base, base)).toBe(false)
    expect(isInsideDirectory(base, outside)).toBe(false)
  })

  it('builds safe targets', () => {
    expect(safeLocalTarget(base, '../../evil.exe')).toBe(path.join(base, 'evil.exe'))
  })
})

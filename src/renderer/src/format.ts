import type { Locale } from '../../shared/types'

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB']

export function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0 B'
  let amount = value
  let unit = 0
  while (amount >= 1024 && unit < UNITS.length - 1) {
    amount /= 1024
    unit += 1
  }
  const digits = amount >= 100 || unit === 0 ? 0 : amount >= 10 ? 1 : 2
  return `${amount.toFixed(digits)} ${UNITS[unit]}`
}

export function formatDate(seconds: number, locale: Locale): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—'
  try {
    return new Date(seconds * 1000).toLocaleString(locale === 'vi' ? 'vi-VN' : 'en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    })
  } catch {
    return '—'
  }
}

export function remoteJoin(directory: string, name: string): string {
  if (directory === '/') return `/${name}`
  return `${directory.replace(/\/+$/, '')}/${name}`
}

export function percent(transferred: number, total: number): number {
  if (total <= 0) return 0
  return Math.min(100, Math.max(0, Math.round((transferred / total) * 100)))
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—'
  if (seconds < 60) return `${Math.ceil(seconds)}s`
  const minutes = Math.floor(seconds / 60)
  const rest = Math.round(seconds % 60)
  if (minutes < 60) return `${minutes}m ${rest}s`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

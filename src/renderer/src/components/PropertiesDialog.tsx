import { useState, type FormEvent, type ReactNode } from 'react'
import type { Locale, RemoteEntry } from '../../../shared/types'
import { formatBytes, formatDate } from '../format'
import { translate } from '../i18n'
import { CopyIcon } from './Icons'
import { Modal } from './Modal'

function modeText(mode: number): string {
  return (mode & 0o7777).toString(8).padStart(3, '0')
}

export function PropertiesDialog({
  entry,
  path,
  locale,
  busy,
  error,
  onClose,
  onSubmit
}: {
  entry: RemoteEntry
  path: string
  locale: Locale
  busy: boolean
  error?: string | null
  onClose: () => void
  onSubmit: (mode: number) => void
}): ReactNode {
  const [mode, setMode] = useState(modeText(entry.mode))
  const [copied, setCopied] = useState(false)

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    if (!/^[0-7]{1,4}$/.test(mode)) return
    onSubmit(parseInt(mode, 8))
  }

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(path)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard access is denied; the path is still visible.
    }
  }

  return (
    <Modal
      title={translate(locale, 'propertiesTitle')}
      subtitle={path}
      onClose={onClose}
      footer={
        <>
          <button className="button ghost" type="button" onClick={onClose} disabled={busy}>
            {translate(locale, 'close')}
          </button>
          <button
            className="button primary"
            type="submit"
            form="properties-form"
            disabled={busy || !/^[0-7]{1,4}$/.test(mode)}
          >
            {busy ? translate(locale, 'loading') : translate(locale, 'chmodAction')}
          </button>
        </>
      }
    >
      <form id="properties-form" className="form" onSubmit={submit}>
        <dl className="preview-list">
          <div>
            <dt>{translate(locale, 'pathLabel')}</dt>
            <dd>
              <code>{path}</code>
              <button className="button tiny" type="button" onClick={() => void copy()}>
                <CopyIcon /> {copied ? translate(locale, 'copied') : translate(locale, 'copy')}
              </button>
            </dd>
          </div>
          <div>
            <dt>{translate(locale, 'sizeLabel')}</dt>
            <dd>
              {entry.kind === 'directory'
                ? '—'
                : `${formatBytes(entry.size)} · ${formatDate(entry.modified, locale)}`}
            </dd>
          </div>
          <div>
            <dt>{translate(locale, 'ownerLabel')}</dt>
            <dd className="num">
              {entry.uid} / {entry.gid}
            </dd>
          </div>
        </dl>

        <label className="field">
          <span>{translate(locale, 'modeLabel')}</span>
          <input
            value={mode}
            onChange={(event) => setMode(event.target.value.trim())}
            inputMode="numeric"
            maxLength={4}
            spellCheck={false}
            autoFocus
          />
        </label>
        <div className="field-row">
          {['600', '644', '700', '755'].map((preset) => (
            <button
              className="button tiny"
              type="button"
              key={preset}
              onClick={() => setMode(preset)}
            >
              {preset}
            </button>
          ))}
        </div>
        {error ? <div className="form-error">{error}</div> : null}
      </form>
    </Modal>
  )
}

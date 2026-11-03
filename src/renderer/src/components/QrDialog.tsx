import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { parseQrText, qrErrorMessages } from '../../../shared/qr'
import type { Locale, Profile, QrPayload } from '../../../shared/types'
import { errorText, translate } from '../i18n'
import { QrDecodeError, decodeQrFile } from '../qr-decode'
import { QrIcon } from './Icons'
import { Modal } from './Modal'

export function QrDialog({
  locale,
  onClose,
  onSaved
}: {
  locale: Locale
  onClose: () => void
  onSaved: (profile: Profile, connectNow: boolean) => void
}): ReactNode {
  const [preview, setPreview] = useState<QrPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleText = (text: string): void => {
    const parsed = parseQrText(text)
    if (!parsed.ok) {
      setError(qrErrorMessages[parsed.error][locale])
      setPreview(null)
      return
    }
    setError(null)
    setPreview(parsed.value)
  }

  const handleFile = async (file: File): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const text = await decodeQrFile(file)
      handleText(text)
    } catch (decodeError) {
      if (decodeError instanceof QrDecodeError) {
        setError(errorText(locale, decodeError.code))
      } else {
        setError(errorText(locale, 'QR_UNSUPPORTED'))
      }
      setPreview(null)
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    const onPaste = (event: ClipboardEvent): void => {
      const data = event.clipboardData
      if (!data) return

      for (const item of Array.from(data.items)) {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const file = item.getAsFile()
          if (file) {
            event.preventDefault()
            void handleFile(file)
            return
          }
        }
      }

      const text = data.getData('text/plain')
      if (text.trim()) {
        event.preventDefault()
        handleText(text)
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  })

  const onDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault()
    setDragging(false)
    const file = event.dataTransfer.files[0]
    if (file) void handleFile(file)
  }

  const save = async (connectNow: boolean): Promise<void> => {
    if (!preview) return
    setBusy(true)
    const result = await window.lumine.profiles.save({
      name: preview.name ?? preview.host,
      host: preview.host,
      port: preview.port,
      username: preview.username,
      authMethod: 'password',
      keyPath: null
    })
    setBusy(false)
    if (!result.ok) {
      setError(errorText(locale, result.code, result.detail))
      return
    }
    onSaved(result.data, connectNow)
  }

  return (
    <Modal
      title={translate(locale, 'qrTitle')}
      subtitle={translate(locale, 'qrWarning')}
      onClose={onClose}
      wide
      footer={
        preview ? (
          <>
            <button className="button ghost" type="button" onClick={() => setPreview(null)} disabled={busy}>
              {translate(locale, 'qrTryAnother')}
            </button>
            <button className="button" type="button" onClick={() => void save(false)} disabled={busy}>
              {translate(locale, 'qrSave')}
            </button>
            <button className="button primary" type="button" onClick={() => void save(true)} disabled={busy}>
              {translate(locale, 'qrSaveConnect')}
            </button>
          </>
        ) : (
          <button className="button ghost" type="button" onClick={onClose}>
            {translate(locale, 'cancel')}
          </button>
        )
      }
    >
      {preview ? (
        <div className="qr-preview">
          <div className="preview-badge">
            <QrIcon />
            {translate(locale, 'qrPreviewTitle')}
          </div>
          <dl className="preview-list">
            <div>
              <dt>{translate(locale, 'hostLabel')}</dt>
              <dd>{preview.host}</dd>
            </div>
            <div>
              <dt>{translate(locale, 'portLabel')}</dt>
              <dd>{preview.port}</dd>
            </div>
            <div>
              <dt>{translate(locale, 'usernameLabel')}</dt>
              <dd>{preview.username}</dd>
            </div>
            {preview.name ? (
              <div>
                <dt>{translate(locale, 'nameLabel')}</dt>
                <dd>{preview.name}</dd>
              </div>
            ) : null}
          </dl>
          <div className="notice warning">{translate(locale, 'qrWarning')}</div>
        </div>
      ) : (
        <>
          <div
            className={`drop-zone${dragging ? ' dragging' : ''}`}
            onDragOver={(event) => {
              event.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => inputRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') inputRef.current?.click()
            }}
          >
            <QrIcon />
            <strong>{busy ? translate(locale, 'qrReading') : translate(locale, 'qrDropTitle')}</strong>
            <span>{translate(locale, 'qrDropHint')}</span>
            <span className="muted">{translate(locale, 'qrPasteHint')}</span>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void handleFile(file)
              event.target.value = ''
            }}
          />
          {error ? <div className="form-error">{error}</div> : null}
        </>
      )}
    </Modal>
  )
}

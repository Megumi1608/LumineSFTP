import { useState, type ReactNode } from 'react'
import type { HostKeyMismatchPrompt, Locale } from '../../../shared/types'
import { translate } from '../i18n'
import { WarningIcon } from './Icons'
import { Modal } from './Modal'

export function HostKeyMismatchDialog({
  prompt,
  locale,
  onClose,
  onOpenSettings
}: {
  prompt: HostKeyMismatchPrompt
  locale: Locale
  onClose: () => void
  onOpenSettings: () => void
}): ReactNode {
  const [copied, setCopied] = useState<'expected' | 'received' | null>(null)

  const copy = async (kind: 'expected' | 'received', value: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(value)
    } catch {
      const area = document.createElement('textarea')
      area.value = value
      area.style.position = 'fixed'
      area.style.opacity = '0'
      document.body.appendChild(area)
      area.select()
      try {
        document.execCommand('copy')
      } finally {
        area.remove()
      }
    }
    setCopied(kind)
    setTimeout(() => setCopied(null), 2500)
  }

  return (
    <Modal
      title={translate(locale, 'hostKeyMismatchTitle')}
      subtitle={`${prompt.host}:${prompt.port}`}
      onClose={onClose}
      danger
      footer={
        <>
          <button className="button ghost" type="button" onClick={onClose}>
            {translate(locale, 'hostKeyMismatchClose')}
          </button>
          <button className="button danger" type="button" onClick={onOpenSettings}>
            {translate(locale, 'hostKeyMismatchSettings')}
          </button>
        </>
      }
    >
      <div className="notice danger">
        <WarningIcon />
        <span>{translate(locale, 'hostKeyMismatchIntro')}</span>
      </div>

      <dl className="preview-list">
        <div className="fingerprint-row">
          <dt>
            {translate(locale, 'hostKeyMismatchExpected')} · {prompt.expectedKeyType}
          </dt>
          <dd>
            <code className="fingerprint">{prompt.expectedFingerprint}</code>
            <button
              className="button tiny"
              type="button"
              onClick={() => void copy('expected', prompt.expectedFingerprint)}
            >
              {copied === 'expected' ? translate(locale, 'copied') : translate(locale, 'copy')}
            </button>
          </dd>
        </div>
        <div className="fingerprint-row">
          <dt>
            {translate(locale, 'hostKeyMismatchReceived')} · {prompt.keyType}
          </dt>
          <dd>
            <code className="fingerprint">{prompt.receivedFingerprint}</code>
            <button
              className="button tiny"
              type="button"
              onClick={() => void copy('received', prompt.receivedFingerprint)}
            >
              {copied === 'received' ? translate(locale, 'copied') : translate(locale, 'copy')}
            </button>
          </dd>
        </div>
      </dl>

      <div className="notice warning">{translate(locale, 'hostKeyMismatchWarning')}</div>
    </Modal>
  )
}

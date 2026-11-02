import { useState, type ReactNode } from 'react'
import type { HostKeyPrompt, Locale } from '../../../shared/types'
import { translate } from '../i18n'
import { WarningIcon } from './Icons'
import { Modal } from './Modal'

export function HostKeyDialog({
  prompt,
  locale,
  onRespond
}: {
  prompt: HostKeyPrompt
  locale: Locale
  onRespond: (accept: boolean) => void
}): ReactNode {
  const [copied, setCopied] = useState(false)

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(prompt.fingerprint)
    } catch {
      const area = document.createElement('textarea')
      area.value = prompt.fingerprint
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
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }

  return (
    <Modal
      title={translate(locale, 'hostKeyTitle')}
      subtitle={`${prompt.host}:${prompt.port}`}
      onClose={() => onRespond(false)}
      danger
      footer={
        <>
          <button className="button ghost" type="button" onClick={() => onRespond(false)}>
            {translate(locale, 'hostKeyCancel')}
          </button>
          <button className="button primary" type="button" onClick={() => onRespond(true)}>
            {translate(locale, 'hostKeyAccept')}
          </button>
        </>
      }
    >
      <div className="notice warning">
        <WarningIcon />
        <span>{translate(locale, 'hostKeyIntro')}</span>
      </div>

      <dl className="preview-list">
        <div>
          <dt>{translate(locale, 'hostKeyAlgorithm')}</dt>
          <dd>{prompt.keyType}</dd>
        </div>
        <div className="fingerprint-row">
          <dt>{translate(locale, 'hostKeyFingerprint')}</dt>
          <dd>
            <code className="fingerprint">{prompt.fingerprint}</code>
            <button className="button tiny" type="button" onClick={() => void copy()}>
              {copied ? translate(locale, 'copied') : translate(locale, 'copy')}
            </button>
          </dd>
        </div>
      </dl>

      <p className="hint">{translate(locale, 'hostKeyVerify')}</p>
      <div className="notice danger">{translate(locale, 'hostKeyWarning')}</div>
    </Modal>
  )
}

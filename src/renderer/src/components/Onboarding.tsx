import type { ReactNode } from 'react'
import type { Locale } from '../../../shared/types'
import { translate } from '../i18n'
import { PlusIcon, QrIcon } from './Icons'

export function Onboarding({
  locale,
  onQr,
  onAdd
}: {
  locale: Locale
  onQr: () => void
  onAdd: () => void
}): ReactNode {
  return (
    <div className="onboarding">
      <div className="onboarding-copy">
        <h2>{translate(locale, 'onboardingTitle')}</h2>
        <p>{translate(locale, 'onboardingIntro')}</p>
        <div className="onboarding-actions">
          <button className="button primary" type="button" onClick={onQr}>
            <QrIcon /> {translate(locale, 'importQr')}
          </button>
          <button className="button" type="button" onClick={onAdd}>
            <PlusIcon /> {translate(locale, 'addProfile')}
          </button>
        </div>
      </div>

      <div className="steps">
        <div className="step">
          <span>{translate(locale, 'stepQr')}</span>
          <p>{translate(locale, 'stepQrText')}</p>
        </div>
        <div className="step">
          <span>{translate(locale, 'stepHostKey')}</span>
          <p>{translate(locale, 'stepHostKeyText')}</p>
        </div>
        <div className="step">
          <span>{translate(locale, 'stepPassword')}</span>
          <p>{translate(locale, 'stepPasswordText')}</p>
        </div>
      </div>
    </div>
  )
}

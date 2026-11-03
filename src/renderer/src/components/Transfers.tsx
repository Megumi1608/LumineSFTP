import type { ReactNode } from 'react'
import type { Locale, TransferInfo } from '../../../shared/types'
import { formatBytes, percent } from '../format'
import { errorText, translate, type I18nKey } from '../i18n'
import { CloseIcon, CopyIcon, DownloadIcon, UploadIcon } from './Icons'

const STATE_KEY: Record<TransferInfo['state'], I18nKey> = {
  queued: 'queued',
  running: 'running',
  done: 'done',
  error: 'error',
  cancelled: 'cancelled'
}

const ORDER: Record<TransferInfo['state'], number> = {
  running: 0,
  queued: 1,
  error: 2,
  done: 3,
  cancelled: 4
}

export function Transfers({
  transfers,
  locale,
  onCancel,
  onClear
}: {
  transfers: TransferInfo[]
  locale: Locale
  onCancel: (id: string) => void
  onClear: () => void
}): ReactNode {
  if (transfers.length === 0) return null
  const ordered = transfers
    .slice()
    .sort((left, right) => ORDER[left.state] - ORDER[right.state])

  return (
    <section className="transfers">
      <div className="transfers-head">
        <h3>{translate(locale, 'transferPanel')}</h3>
        <button className="button tiny ghost" type="button" onClick={onClear}>
          {translate(locale, 'clearFinished')}
        </button>
      </div>
      <div className="transfer-list">
        {ordered.map((transfer) => {
          const value = percent(transfer.transferred, transfer.total)
          const canCancel = transfer.state === 'running' || transfer.state === 'queued'
          return (
            <div className={`transfer state-${transfer.state}`} key={transfer.id}>
              <span className={`transfer-icon ${transfer.direction}`}>
                {transfer.direction === 'upload' ? (
                  <UploadIcon />
                ) : transfer.direction === 'copy' ? (
                  <CopyIcon />
                ) : (
                  <DownloadIcon />
                )}
              </span>
              <div className="transfer-main">
                <div className="transfer-line">
                  <span className="ellipsis" title={transfer.name}>
                    {transfer.name}
                  </span>
                  <span className="muted">
                    {transfer.state === 'error' && transfer.code
                      ? errorText(locale, transfer.code)
                      : translate(locale, STATE_KEY[transfer.state])}
                  </span>
                </div>
                <div className="progress">
                  <div className="progress-fill" style={{ width: `${value}%` }} />
                </div>
                <div className="transfer-meta muted">
                  <span>
                    {formatBytes(transfer.transferred)} / {formatBytes(transfer.total)}
                  </span>
                  <span>{value}%</span>
                </div>
              </div>
              {canCancel ? (
                <button
                  className="icon-button"
                  type="button"
                  title={translate(locale, 'cancelTransfer')}
                  onClick={() => onCancel(transfer.id)}
                >
                  <CloseIcon />
                </button>
              ) : null}
            </div>
          )
        })}
      </div>
    </section>
  )
}

import { useEffect, useState, type ReactNode } from 'react'
import type { Locale, RemoteEntry, RemoteListing } from '../../../shared/types'
import { formatBytes, formatDate, remoteJoin } from '../format'
import { translate } from '../i18n'
import {
  ChevronRightIcon,
  ChevronUpIcon,
  DownloadIcon,
  FileIcon,
  FolderIcon,
  FolderPlusIcon,
  LinkIcon,
  PencilIcon,
  RefreshIcon,
  TrashIcon,
  UploadIcon
} from './Icons'

function EntryIcon({ kind }: { kind: RemoteEntry['kind'] }): ReactNode {
  if (kind === 'directory') return <FolderIcon size={17} />
  if (kind === 'link') return <LinkIcon size={17} />
  return <FileIcon size={17} />
}

export function FileBrowser({
  listing,
  locale,
  onOpen,
  onRefresh,
  onUpload,
  onDownload,
  onRename,
  onDelete,
  onNewFolder
}: {
  listing: RemoteListing | null
  locale: Locale
  onOpen: (path: string) => void
  onRefresh: () => void
  onUpload: () => void
  onDownload: (path: string) => void
  onRename: (entry: RemoteEntry) => void
  onDelete: (path: string) => void
  onNewFolder: () => void
}): ReactNode {
  const path = listing?.path ?? '/'
  const entries = listing?.entries ?? []
  const parts = path.split('/').filter(Boolean)
  const parent = path === '/' ? null : `/${parts.slice(0, -1).join('/')}`
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => {
    setSelected(null)
  }, [path])

  const activate = (entry: RemoteEntry): void => {
    const target = remoteJoin(path, entry.name)
    if (entry.kind === 'directory') onOpen(target)
    else if (entry.kind === 'file' || entry.kind === 'link') onDownload(target)
  }

  const canActivate = (entry: RemoteEntry): boolean =>
    entry.kind === 'directory' || entry.kind === 'file' || entry.kind === 'link'

  const rowHint = (entry: RemoteEntry): string | undefined => {
    if (entry.kind === 'directory') return translate(locale, 'openFolderHint')
    if (entry.kind === 'file' || entry.kind === 'link') {
      return translate(locale, 'downloadFileHint')
    }
    return undefined
  }

  return (
    <section className="browser">
      <div className="toolbar">
        <button
          className="icon-button"
          type="button"
          title={translate(locale, 'up')}
          onClick={() => parent !== null && onOpen(parent)}
          disabled={parent === null || !listing}
        >
          <ChevronUpIcon />
        </button>

        <div className="breadcrumbs">
          {listing ? (
            <>
              <button className="crumb" type="button" onClick={() => onOpen('/')}>
                /
              </button>
              {parts.map((part, index) => {
                const target = `/${parts.slice(0, index + 1).join('/')}`
                return (
                  <span className="crumb-wrap" key={target}>
                    <ChevronRightIcon />
                    <button className="crumb" type="button" onClick={() => onOpen(target)}>
                      {part}
                    </button>
                  </span>
                )
              })}
            </>
          ) : (
            <span className="crumb placeholder">…</span>
          )}
        </div>

        <div className="toolbar-actions">
          {listing ? (
            <span className="item-count">
              {translate(locale, 'itemsCount', { n: entries.length })}
            </span>
          ) : null}
          <button
            className="button tiny"
            type="button"
            onClick={onNewFolder}
            disabled={!listing}
          >
            <FolderPlusIcon /> {translate(locale, 'newFolder')}
          </button>
          <button
            className="button primary tiny"
            type="button"
            onClick={onUpload}
            disabled={!listing}
          >
            <UploadIcon /> {translate(locale, 'upload')}
          </button>
          <button
            className="icon-button"
            type="button"
            title={translate(locale, 'refresh')}
            onClick={onRefresh}
            disabled={!listing}
          >
            <RefreshIcon />
          </button>
        </div>
      </div>

      <div className="file-scroll">
        <div className="file-head">
          <span>{translate(locale, 'fileName')}</span>
          <span className="num">{translate(locale, 'fileSize')}</span>
          <span className="num">{translate(locale, 'modified')}</span>
          <span aria-label={translate(locale, 'actions')} />
        </div>

        {!listing
          ? Array.from({ length: 5 }, (_, index) => (
              <div className="file-row skeleton-row" key={`skeleton-${index}`}>
                <span className="skeleton skeleton-name" />
                <span className="skeleton skeleton-size" />
                <span className="skeleton skeleton-date" />
                <span />
              </div>
            ))
          : null}

        {listing && entries.length === 0 ? (
          <div className="empty-folder">
            <p>{translate(locale, 'emptyFolder')}</p>
            <button className="text-action" type="button" onClick={onUpload}>
              {translate(locale, 'emptyFolderAction')}
            </button>
          </div>
        ) : null}

        {listing
          ? entries.map((entry) => {
              const target = remoteJoin(listing.path, entry.name)
              const actionable = canActivate(entry)
              return (
                <div
                  className={`file-row${actionable ? ' clickable' : ''}${
                    selected === entry.name ? ' selected' : ''
                  }`}
                  key={entry.name}
                  onClick={() => {
                    if (actionable) setSelected(entry.name)
                  }}
                  onDoubleClick={() => {
                    if (actionable) activate(entry)
                  }}
                  onKeyDown={(event) => {
                    if (
                      event.target === event.currentTarget &&
                      actionable &&
                      (event.key === 'Enter' || event.key === ' ')
                    ) {
                      event.preventDefault()
                      activate(entry)
                    }
                  }}
                  tabIndex={actionable ? 0 : -1}
                  title={rowHint(entry)}
                  aria-label={entry.name}
                >
                  <div className="file-name">
                    <span className={`entry-icon kind-${entry.kind}`}>
                      <EntryIcon kind={entry.kind} />
                    </span>
                    <span className="ellipsis" title={entry.name}>
                      {entry.name}
                    </span>
                  </div>
                  <span className="file-size num">
                    {entry.kind === 'directory' ? '—' : formatBytes(entry.size)}
                  </span>
                  <span className="file-date num">{formatDate(entry.modified, locale)}</span>
                  <div
                    className="file-actions"
                    onClick={(event) => event.stopPropagation()}
                    onDoubleClick={(event) => event.stopPropagation()}
                  >
                    {entry.kind !== 'directory' ? (
                      <button
                        className="icon-button"
                        type="button"
                        title={translate(locale, 'download')}
                        onClick={() => onDownload(target)}
                      >
                        <DownloadIcon />
                      </button>
                    ) : null}
                    <button
                      className="icon-button"
                      type="button"
                      title={translate(locale, 'rename')}
                      onClick={() => onRename(entry)}
                    >
                      <PencilIcon />
                    </button>
                    <button
                      className="icon-button danger"
                      type="button"
                      title={translate(locale, 'delete')}
                      onClick={() => onDelete(target)}
                    >
                      <TrashIcon />
                    </button>
                  </div>
                </div>
              )
            })
          : null}
      </div>
    </section>
  )
}

import { useEffect, useState, type DragEvent, type MouseEvent, type ReactNode } from 'react'
import type { Locale, RemoteEntry, RemoteListing } from '../../../shared/types'
import { formatBytes, formatDate } from '../format'
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

interface Crumb {
  label: string
  target: string
}

/** Chia đường dẫn thành các mẩu bấm được; local dùng cả `\` và `/`. */
function buildCrumbs(target: string, kind: 'remote' | 'local'): {
  rootLabel: string
  rootTarget: string
  crumbs: Crumb[]
} {
  if (kind === 'remote') {
    const parts = target.split('/').filter(Boolean)
    return {
      rootLabel: '/',
      rootTarget: '/',
      crumbs: parts.map((part, index) => ({
        label: part,
        target: `/${parts.slice(0, index + 1).join('/')}`
      }))
    }
  }

  const drive = /^[A-Za-z]:/.exec(target)
  if (drive) {
    const rootTarget = `${drive[0]}\\`
    const rest = target.slice(rootTarget.length).split(/[\\/]/).filter(Boolean)
    return {
      rootLabel: rootTarget,
      rootTarget,
      crumbs: rest.map((part, index) => ({
        label: part,
        target: `${rootTarget}${rest.slice(0, index + 1).join('\\')}`
      }))
    }
  }

  const parts = target.split(/[\\/]/).filter(Boolean)
  return {
    rootLabel: '/',
    rootTarget: '/',
    crumbs: parts.map((part, index) => ({
      label: part,
      target: `/${parts.slice(0, index + 1).join('/')}`
    }))
  }
}

export function FileBrowser({
  listing,
  locale,
  sourceKind,
  busy,
  onOpenDir,
  onActivate,
  onRefresh,
  onUpload,
  onNewFolder,
  onRowTransfer,
  onRename,
  onDelete,
  onContextMenu,
  onDragStartEntry
}: {
  listing: RemoteListing | null
  locale: Locale
  sourceKind: 'remote' | 'local'
  busy: boolean
  onOpenDir: (path: string) => void
  onActivate: (entry: RemoteEntry, path: string) => void
  onRefresh: () => void
  onUpload?: () => void
  onNewFolder: () => void
  onRowTransfer: (entry: RemoteEntry, path: string) => void
  onRename: (entry: RemoteEntry) => void
  onDelete: (path: string) => void
  onContextMenu: (entry: RemoteEntry | null, event: MouseEvent) => void
  onDragStartEntry: (entry: RemoteEntry, path: string, event: DragEvent) => void
}): ReactNode {
  const path = listing?.path ?? ''
  const entries = listing?.entries ?? []
  const crumbs = buildCrumbs(path, sourceKind)
  const parent = listing?.parent ?? null
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => {
    setSelected(null)
  }, [path])

  const target = (entry: RemoteEntry): string =>
    sourceKind === 'remote'
      ? `${path === '/' ? '' : path}/${entry.name}`
      : `${path}${path.endsWith('\\') || path.endsWith('/') ? '' : sourceKind === 'local' && path.includes('\\') ? '\\' : '/'}${entry.name}`

  const actionable = (entry: RemoteEntry): boolean =>
    entry.kind === 'directory' || entry.kind === 'file' || entry.kind === 'link'

  return (
    <section className="browser">
      <div className="toolbar">
        <button
          className="icon-button"
          type="button"
          title={translate(locale, 'up')}
          onClick={() => parent !== null && onOpenDir(parent)}
          disabled={parent === null || !listing}
        >
          <ChevronUpIcon />
        </button>

        <div className="breadcrumbs">
          {listing ? (
            <>
              <button
                className="crumb"
                type="button"
                onClick={() => onOpenDir(crumbs.rootTarget)}
              >
                {crumbs.rootLabel}
              </button>
              {crumbs.crumbs.map((crumb) => (
                <span className="crumb-wrap" key={crumb.target}>
                  <ChevronRightIcon />
                  <button
                    className="crumb"
                    type="button"
                    onClick={() => onOpenDir(crumb.target)}
                  >
                    {crumb.label}
                  </button>
                </span>
              ))}
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
            disabled={!listing || busy}
          >
            <FolderPlusIcon /> <span className="btn-label">{translate(locale, 'newFolder')}</span>
          </button>
          {onUpload ? (
            <button
              className="button primary tiny"
              type="button"
              onClick={onUpload}
              disabled={!listing || busy}
            >
              <UploadIcon /> <span className="btn-label">{translate(locale, 'upload')}</span>
            </button>
          ) : null}
          <button
            className="icon-button"
            type="button"
            title={translate(locale, 'refresh')}
            onClick={onRefresh}
            disabled={!listing || busy}
          >
            <RefreshIcon />
          </button>
        </div>
      </div>

      <div
        className="file-scroll"
        onContextMenu={(event) => {
          if (event.target === event.currentTarget) {
            event.preventDefault()
            onContextMenu(null, event)
          }
        }}
      >
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
            {onUpload ? (
              <button className="text-action" type="button" onClick={onUpload}>
                {translate(locale, 'emptyFolderAction')}
              </button>
            ) : null}
          </div>
        ) : null}

        {listing
          ? entries.map((entry) => {
              const entryPath = target(entry)
              const canActivate = actionable(entry)
              return (
                <div
                  className={`file-row${canActivate ? ' clickable' : ''}${
                    selected === entry.name ? ' selected' : ''
                  }`}
                  key={entry.name}
                  onClick={() => {
                    if (canActivate) setSelected(entry.name)
                  }}
                  onDoubleClick={() => {
                    if (canActivate) onActivate(entry, entryPath)
                  }}
                  onContextMenu={(event) => {
                    if (!canActivate) return
                    event.preventDefault()
                    event.stopPropagation()
                    setSelected(entry.name)
                    onContextMenu(entry, event)
                  }}
                  onKeyDown={(event) => {
                    if (
                      event.target === event.currentTarget &&
                      canActivate &&
                      (event.key === 'Enter' || event.key === ' ')
                    ) {
                      event.preventDefault()
                      onActivate(entry, entryPath)
                    }
                  }}
                  draggable={canActivate}
                  onDragStart={(event) => {
                    if (!canActivate) return
                    onDragStartEntry(entry, entryPath, event)
                  }}
                  tabIndex={canActivate ? 0 : -1}
                  title={canActivate ? translate(locale, 'openHint') : undefined}
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
                    <button
                      className="icon-button"
                      type="button"
                      title={
                        sourceKind === 'remote'
                          ? translate(locale, 'download')
                          : translate(locale, 'upload')
                      }
                      onClick={() => onRowTransfer(entry, entryPath)}
                    >
                      {sourceKind === 'remote' ? <DownloadIcon /> : <UploadIcon />}
                    </button>
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
                      onClick={() => onDelete(entryPath)}
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
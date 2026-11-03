import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { displayName } from '../../../shared/filename'
import type { Bookmark, Locale, RemoteEntry, RemoteListing } from '../../../shared/types'
import { formatBytes, formatDate, remoteJoin } from '../format'
import { translate } from '../i18n'
import {
  BookmarkIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  CloseIcon,
  CopyIcon,
  DownloadIcon,
  FileIcon,
  FolderIcon,
  FolderPlusIcon,
  InfoIcon,
  LinkIcon,
  PencilIcon,
  RefreshIcon,
  TrashIcon,
  UploadIcon
} from './Icons'

type SortKey = 'name' | 'size' | 'modified'

function EntryIcon({ kind }: { kind: RemoteEntry['kind'] }): ReactNode {
  if (kind === 'directory') return <FolderIcon size={17} />
  if (kind === 'link') return <LinkIcon size={17} />
  return <FileIcon size={17} />
}

function modeText(mode: number): string {
  return (mode & 0o7777).toString(8).padStart(3, '0')
}

export function FileBrowser({
  listing,
  locale,
  bookmarks,
  canBack,
  canForward,
  onBack,
  onForward,
  onOpen,
  onRefresh,
  onUpload,
  onUploadFolder,
  onDownload,
  onRename,
  onDelete,
  onNewFolder,
  onAddBookmark,
  onOpenBookmarks,
  onProperties,
  onCopyPath
}: {
  listing: RemoteListing | null
  locale: Locale
  bookmarks: Bookmark[]
  canBack: boolean
  canForward: boolean
  onBack: () => void
  onForward: () => void
  onOpen: (path: string) => void
  onRefresh: () => void
  onUpload: () => void
  onUploadFolder: () => void
  onDownload: (paths: string[]) => void
  onRename: (entry: RemoteEntry) => void
  onDelete: (paths: string[]) => void
  onNewFolder: () => void
  onAddBookmark: () => void
  onOpenBookmarks: () => void
  onProperties: (entry: RemoteEntry) => void
  onCopyPath: (path: string) => void
}): ReactNode {
  const path = listing?.path ?? '/'
  const entries = listing?.entries ?? []
  const parts = path.split('/').filter(Boolean)
  const parent = path === '/' ? null : `/${parts.slice(0, -1).join('/')}`
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortAsc, setSortAsc] = useState(true)
  const [filter, setFilter] = useState('')
  const [showHidden, setShowHidden] = useState(true)
  const anchor = useRef<number | null>(null)

  useEffect(() => {
    setSelected(new Set())
    setFilter('')
    anchor.current = null
  }, [path])

  const rows = entries
    .filter((entry) => showHidden || !entry.name.startsWith('.'))
    .filter((entry) => !filter || entry.name.toLowerCase().includes(filter.toLowerCase()))
    .slice()
    .sort((left, right) => {
      const leftDir = left.kind === 'directory' ? 0 : 1
      const rightDir = right.kind === 'directory' ? 0 : 1
      if (leftDir !== rightDir) return leftDir - rightDir
      let compared = 0
      if (sortKey === 'name') compared = left.name.localeCompare(right.name)
      if (sortKey === 'size') compared = left.size - right.size
      if (sortKey === 'modified') compared = left.modified - right.modified
      return compared * (sortAsc ? 1 : -1)
    })

  const targetOf = (entry: RemoteEntry): string => remoteJoin(path, entry.name)
  const selectedPaths = (): string[] =>
    rows.filter((entry) => selected.has(entry.name)).map(targetOf)

  const activate = (entry: RemoteEntry): void => {
    const target = targetOf(entry)
    if (entry.kind === 'directory') onOpen(target)
    else if (entry.kind === 'file' || entry.kind === 'link') onDownload([target])
  }

  const canActivate = (entry: RemoteEntry): boolean =>
    entry.kind === 'directory' || entry.kind === 'file' || entry.kind === 'link'

  const rowHint = (entry: RemoteEntry): string => {
    const base =
      entry.kind === 'directory'
        ? translate(locale, 'openFolderHint')
        : entry.kind === 'file' || entry.kind === 'link'
          ? translate(locale, 'downloadFileHint')
          : ''
    const mode = entry.kind === 'directory' ? '' : ` · ${modeText(entry.mode)}`
    return `${base}${mode}`
  }

  const changeSort = (key: SortKey): void => {
    if (key === sortKey) setSortAsc((value) => !value)
    else {
      setSortKey(key)
      setSortAsc(true)
    }
  }

  const sortMark = (key: SortKey): string => (sortKey === key ? (sortAsc ? ' ↑' : ' ↓') : '')

  const selectRow = (entry: RemoteEntry, index: number, event: MouseEvent): void => {
    if (!canActivate(entry)) return
    if (event.shiftKey && anchor.current !== null) {
      const start = Math.min(anchor.current, index)
      const end = Math.max(anchor.current, index)
      const next = new Set(selected)
      for (let cursor = start; cursor <= end; cursor += 1) {
        const item = rows[cursor]
        if (item && canActivate(item)) next.add(item.name)
      }
      setSelected(next)
      return
    }
    if (event.ctrlKey || event.metaKey) {
      const next = new Set(selected)
      if (next.has(entry.name)) next.delete(entry.name)
      else next.add(entry.name)
      setSelected(next)
      anchor.current = index
      return
    }
    setSelected(new Set([entry.name]))
    anchor.current = index
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null
      if (
        target &&
        (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable)
      ) {
        return
      }
      if (document.querySelector('.backdrop')) return

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
        event.preventDefault()
        setSelected(new Set(rows.filter(canActivate).map((entry) => entry.name)))
        return
      }
      if (event.key === 'Escape') {
        setSelected(new Set())
        return
      }
      if (event.key === 'F5') {
        event.preventDefault()
        onRefresh()
        return
      }
      if (event.key === 'F2' && selected.size === 1) {
        const only = rows.find((entry) => selected.has(entry.name))
        if (only) {
          event.preventDefault()
          onRename(only)
        }
        return
      }
      if (event.key === 'Delete' && selected.size > 0) {
        event.preventDefault()
        onDelete(selectedPaths())
        return
      }
      if (event.key === 'Enter' && selected.size === 1) {
        const only = rows.find((entry) => selected.has(entry.name))
        if (only) activate(only)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <section className="browser">
      <div className="toolbar">
        <button
          className="icon-button"
          type="button"
          title={translate(locale, 'back')}
          onClick={onBack}
          disabled={!canBack}
        >
          <ChevronLeftIcon />
        </button>
        <button
          className="icon-button"
          type="button"
          title={translate(locale, 'forward')}
          onClick={onForward}
          disabled={!canForward}
        >
          <ChevronRightIcon />
        </button>
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
                      {displayName(part)}
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
              {translate(locale, 'itemsCount', { n: rows.length })}
            </span>
          ) : null}
          <button
            className="icon-button"
            type="button"
            title={translate(locale, 'addBookmark')}
            onClick={onAddBookmark}
            disabled={!listing}
          >
            <BookmarkIcon />
          </button>
          <button
            className="icon-button"
            type="button"
            title={translate(locale, 'bookmarks')}
            onClick={onOpenBookmarks}
            disabled={bookmarks.length === 0}
          >
            <span className="bookmark-count">{bookmarks.length}</span>
          </button>
          <button
            className="icon-button"
            type="button"
            title={translate(locale, 'copyPath')}
            onClick={() => onCopyPath(path)}
            disabled={!listing}
          >
            <CopyIcon />
          </button>
          <button
            className="button tiny"
            type="button"
            onClick={onNewFolder}
            disabled={!listing}
          >
            <FolderPlusIcon /> {translate(locale, 'newFolder')}
          </button>
          <button
            className="button tiny"
            type="button"
            onClick={onUploadFolder}
            disabled={!listing}
            title={translate(locale, 'uploadFolder')}
          >
            <FolderIcon size={15} /> {translate(locale, 'uploadFolderShort')}
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

      <div className="file-tools">
        <input
          className="filter-input"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder={translate(locale, 'filterPlaceholder')}
          aria-label={translate(locale, 'filterPlaceholder')}
        />
        <button
          className="button tiny ghost"
          type="button"
          onClick={() => setShowHidden((value) => !value)}
        >
          {showHidden ? translate(locale, 'hideHidden') : translate(locale, 'showHidden')}
        </button>
      </div>

      {selected.size > 1 ? (
        <div className="selection-bar">
          <span className="selection-count">
            {translate(locale, 'selectedCount', { n: selected.size })}
          </span>
          <button
            className="button tiny"
            type="button"
            onClick={() => onDownload(selectedPaths())}
          >
            <DownloadIcon /> {translate(locale, 'download')}
          </button>
          <button
            className="button tiny danger"
            type="button"
            onClick={() => onDelete(selectedPaths())}
          >
            <TrashIcon /> {translate(locale, 'delete')}
          </button>
          <button
            className="icon-button"
            type="button"
            title={translate(locale, 'clearSelection')}
            onClick={() => setSelected(new Set())}
          >
            <CloseIcon />
          </button>
        </div>
      ) : null}

      <div className="file-scroll">
        <div className="file-head">
          <button className="head-sort" type="button" onClick={() => changeSort('name')}>
            {translate(locale, 'fileName')}
            {sortMark('name')}
          </button>
          <button className="head-sort num" type="button" onClick={() => changeSort('size')}>
            {translate(locale, 'fileSize')}
            {sortMark('size')}
          </button>
          <button className="head-sort num" type="button" onClick={() => changeSort('modified')}>
            {translate(locale, 'modified')}
            {sortMark('modified')}
          </button>
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

        {listing && rows.length === 0 ? (
          <div className="empty-folder">
            <p>{translate(locale, 'emptyFolder')}</p>
            <button className="text-action" type="button" onClick={onUpload}>
              {translate(locale, 'emptyFolderAction')}
            </button>
          </div>
        ) : null}

        {listing
          ? rows.map((entry, index) => {
              const target = targetOf(entry)
              const shown = displayName(entry.name)
              const actionable = canActivate(entry)
              const isSelected = selected.has(entry.name)
              return (
                <div
                  className={`file-row${actionable ? ' clickable' : ''}${
                    isSelected ? ' selected' : ''
                  }`}
                  key={entry.name}
                  onClick={(event) => selectRow(entry, index, event)}
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
                  aria-label={shown}
                >
                  <div className="file-name">
                    <span className={`entry-icon kind-${entry.kind}`}>
                      <EntryIcon kind={entry.kind} />
                    </span>
                    <span className="ellipsis" title={shown}>
                      {shown}
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
                        onClick={() => onDownload([target])}
                      >
                        <DownloadIcon />
                      </button>
                    ) : null}
                    <button
                      className="icon-button"
                      type="button"
                      title={translate(locale, 'properties')}
                      onClick={() => onProperties(entry)}
                    >
                      <InfoIcon />
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
                      onClick={() => onDelete([target])}
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

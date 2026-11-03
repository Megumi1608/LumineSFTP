import type { ReactNode } from 'react'
import type { Bookmark, Locale } from '../../../shared/types'
import { translate } from '../i18n'
import { BookmarkIcon, TrashIcon } from './Icons'
import { Modal } from './Modal'

export function BookmarksDialog({
  bookmarks,
  locale,
  onOpen,
  onRemove,
  onClose
}: {
  bookmarks: Bookmark[]
  locale: Locale
  onOpen: (path: string) => void
  onRemove: (id: string) => void
  onClose: () => void
}): ReactNode {
  return (
    <Modal
      title={translate(locale, 'bookmarksTitle')}
      onClose={onClose}
      wide
      footer={
        <button className="button primary" type="button" onClick={onClose}>
          {translate(locale, 'close')}
        </button>
      }
    >
      {bookmarks.length === 0 ? (
        <p className="hint">{translate(locale, 'bookmarksEmpty')}</p>
      ) : (
        <div className="bookmark-list">
          {bookmarks.map((bookmark) => (
            <div className="bookmark-row" key={bookmark.id}>
              <span className="bookmark-icon">
                <BookmarkIcon />
              </span>
              <div className="bookmark-copy">
                <strong>{bookmark.name}</strong>
                <code>{bookmark.path}</code>
              </div>
              <button
                className="button tiny"
                type="button"
                onClick={() => {
                  onOpen(bookmark.path)
                  onClose()
                }}
              >
                {translate(locale, 'open')}
              </button>
              <button
                className="icon-button danger"
                type="button"
                title={translate(locale, 'removeBookmark')}
                onClick={() => onRemove(bookmark.id)}
              >
                <TrashIcon />
              </button>
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}

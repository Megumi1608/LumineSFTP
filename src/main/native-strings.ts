import type { Locale } from '../shared/types'

export const nativeStrings: Record<
  Locale,
  {
    chooseFiles: string
    chooseFolder: string
    overwriteTitle: string
    overwriteMessage: (name: string) => string
    overwriteDetail: string
    overwriteAction: string
    keepAction: string
    deleteTitle: string
    deleteMessage: string
    deleteAction: string
    cancel: string
  }
> = {
  vi: {
    chooseFiles: 'Chọn file để tải lên',
    chooseFolder: 'Chọn thư mục để lưu file',
    overwriteTitle: 'File đã tồn tại',
    overwriteMessage: (name) => `"${name}" đã tồn tại. Ghi đè?`,
    overwriteDetail: 'Nếu chọn "Bỏ qua", file hiện có sẽ được giữ nguyên.',
    overwriteAction: 'Ghi đè',
    keepAction: 'Bỏ qua',
    deleteTitle: 'Xoá mục đã chọn?',
    deleteMessage: 'Hành động này không thể hoàn tác.',
    deleteAction: 'Xoá',
    cancel: 'Huỷ'
  },
  en: {
    chooseFiles: 'Choose files to upload',
    chooseFolder: 'Choose a folder to save files',
    overwriteTitle: 'File already exists',
    overwriteMessage: (name) => `"${name}" already exists. Overwrite?`,
    overwriteDetail: 'Choosing "Keep" leaves the existing file untouched.',
    overwriteAction: 'Overwrite',
    keepAction: 'Keep',
    deleteAction: 'Delete',
    deleteTitle: 'Delete the selected item?',
    deleteMessage: 'This action cannot be undone.',
    cancel: 'Cancel'
  }
}

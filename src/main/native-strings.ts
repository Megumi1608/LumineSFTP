import type { Locale } from '../shared/types'

export const nativeStrings: Record<
  Locale,
  {
    chooseFiles: string
    chooseFolder: string
    chooseUploadFolder: string
    conflictTitle: (count: number) => string
    conflictMessage: string
    skipAction: string
    renameAction: string
    chooseKey: string
    keyFiles: string
    overwriteTitle: string
    overwriteMessage: (name: string) => string
    overwriteDetail: string
    overwriteAction: string
    keepAction: string
    deleteTitle: string
    deleteMessage: string
    deleteFolderDetail: (count: number, truncated: boolean) => string
    deleteAction: string
    cancel: string
  }
> = {
  vi: {
    chooseFiles: 'Chọn file để tải lên',
    chooseFolder: 'Chọn thư mục để lưu file',
    chooseUploadFolder: 'Chọn thư mục để tải lên',
    conflictTitle: (count) => `${count} mục đã tồn tại`,
    conflictMessage: 'Chọn cách xử lý cho tất cả mục bị trùng.',
    skipAction: 'Bỏ qua',
    renameAction: 'Đổi tên',
    chooseKey: 'Chọn SSH private key',
    keyFiles: 'SSH key',
    overwriteTitle: 'File đã tồn tại',
    overwriteMessage: (name) => `"${name}" đã tồn tại. Ghi đè?`,
    overwriteDetail: 'Nếu chọn "Bỏ qua", file hiện có sẽ được giữ nguyên.',
    overwriteAction: 'Ghi đè',
    keepAction: 'Bỏ qua',
    deleteTitle: 'Xoá mục đã chọn?',
    deleteMessage: 'Hành động này không thể hoàn tác.',
    deleteFolderDetail: (count, truncated) =>
      `Thư mục và toàn bộ nội dung bên trong sẽ bị xoá (${
        truncated ? `ít nhất ${count}` : `${count}`
      } mục).`,
    deleteAction: 'Xoá',
    cancel: 'Huỷ'
  },
  en: {
    chooseFiles: 'Choose files to upload',
    chooseFolder: 'Choose a folder to save files',
    chooseUploadFolder: 'Choose a folder to upload',
    conflictTitle: (count) => `${count} items already exist`,
    conflictMessage: 'Choose how to handle all conflicting items.',
    skipAction: 'Skip',
    renameAction: 'Rename',
    chooseKey: 'Choose SSH private key',
    keyFiles: 'SSH key',
    overwriteTitle: 'File already exists',
    overwriteMessage: (name) => `"${name}" already exists. Overwrite?`,
    overwriteDetail: 'Choosing "Keep" leaves the existing file untouched.',
    overwriteAction: 'Overwrite',
    keepAction: 'Keep',
    deleteAction: 'Delete',
    deleteTitle: 'Delete the selected item?',
    deleteMessage: 'This action cannot be undone.',
    deleteFolderDetail: (count, truncated) =>
      `The folder and all of its contents will be deleted (${
        truncated ? `at least ${count}` : `${count}`
      } items).`,
    cancel: 'Cancel'
  }
}

export type Locale = 'vi' | 'en'

export type ErrorCode =
  | 'INTERNAL'
  | 'INVALID_INPUT'
  | 'NOT_CONNECTED'
  | 'PROFILE_NOT_FOUND'
  | 'DIALOG_CANCELLED'
  | 'AUTH_FAILED'
  | 'AUTH_CANCELLED'
  | 'SECRET_REQUIRED'
  | 'CONNECTION_REFUSED'
  | 'HOST_NOT_FOUND'
  | 'CONNECTION_TIMEOUT'
  | 'NETWORK_ERROR'
  | 'ALGORITHM_UNSUPPORTED'
  | 'HOST_KEY_MISMATCH'
  | 'HOST_KEY_REJECTED'
  | 'HOST_KEY_TIMEOUT'
  | 'SFTP_UNAVAILABLE'
  | 'PERMISSION_DENIED'
  | 'NO_SUCH_FILE'
  | 'ALREADY_EXISTS'
  | 'INVALID_NAME'
  | 'INVALID_PATH'
  | 'LIST_TOO_LARGE'
  | 'TRANSFER_FAILED'
  | 'TRANSFER_CANCELLED'
  | 'UPDATE_FAILED'
  | 'QR_NOT_FOUND'
  | 'QR_TOO_LARGE'
  | 'QR_UNSUPPORTED'

export type Ok<T> = { ok: true; data: T }
export type Err = { ok: false; code: ErrorCode; detail?: string }
export type Result<T> = Ok<T> | Err

export type AuthMethod = 'password' | 'key'

export interface Profile {
  id: string
  name: string
  host: string
  port: number
  username: string
  authMethod: AuthMethod
  keyPath: string | null
  hasSavedPassword?: boolean
  createdAt: number
  lastUsedAt: number | null
}

export interface ProfileInput {
  name: string
  host: string
  port: number
  username: string
  authMethod: AuthMethod
  keyPath: string | null
}

export interface ConnectSecret {
  password?: string
  passphrase?: string
  saveSecret?: boolean
}

export interface QrPayload {
  host: string
  port: number
  username: string
  name?: string
}

export type ConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'verifying_host'
  | 'authenticating'
  | 'connected'
  | 'error'

export interface ConnectionStatus {
  state: ConnectionState
  /** Phiên nào phát trạng thái này — hai khung có thể cùng lúc có hai phiên. */
  sessionId?: string
  profileId?: string
  profileName?: string
  host?: string
  port?: number
  code?: ErrorCode
  detail?: string
}

export interface HostKeyPrompt {
  sessionId: string
  requestId: string
  host: string
  port: number
  keyType: string
  fingerprint: string
}

export interface HostKeyMismatchPrompt {
  sessionId: string
  host: string
  port: number
  keyType: string
  expectedKeyType: string
  expectedFingerprint: string
  receivedFingerprint: string
}

export interface InteractivePromptLine {
  prompt: string
  echo: boolean
}

export interface InteractiveRequest {
  sessionId: string
  requestId: string
  name: string
  instructions: string
  prompts: InteractivePromptLine[]
}

export type RemoteEntryKind = 'file' | 'directory' | 'link' | 'other'

export interface RemoteEntry {
  name: string
  kind: RemoteEntryKind
  size: number
  modified: number
  mode: number
  uid: number
  gid: number
}

export interface RemoteListing {
  path: string
  entries: RemoteEntry[]
  /** Thư mục cha đã tuyệt đối; null khi đang ở gốc. */
  parent?: string | null
}

export type TransferDirection = 'upload' | 'download' | 'copy'
export type TransferState = 'queued' | 'running' | 'done' | 'error' | 'cancelled'
export type ConflictAction = 'overwrite' | 'skip' | 'rename'
export type ConflictMode = 'error' | ConflictAction

export interface TransferInfo {
  id: string
  direction: TransferDirection
  name: string
  transferred: number
  total: number
  state: TransferState
  code?: ErrorCode
  /** Phiên sở hữu lượt truyền; vắng mặt với job copy do bộ copy điều phối. */
  sessionId?: string
  speed?: number
  eta?: number
  canRetry?: boolean
}

/** Một đầu của thao tác copy: phiên SFTP hoặc đĩa của máy đang chạy app. */
export type Location =
  | { kind: 'remote'; sessionId: string; path: string }
  | { kind: 'local'; path: string }

export interface ConnectResult {
  profile: Profile
  sessionId: string
}

export interface KnownHost {
  key: string
  host: string
  port: number
  keyType: string
  fingerprint: string
  firstSeen: number
}

export interface Bookmark {
  id: string
  profileId: string
  path: string
  name: string
  createdAt: number
}

export interface WindowState {
  width: number
  height: number
  x?: number
  y?: number
  maximized: boolean
}

export type KnownHostsHealth = 'ok' | 'partial' | 'recovered'

export interface Settings {
  locale: Locale
  version: string
  knownHostsHealth: KnownHostsHealth
  secretStorageAvailable: boolean
}

export type UpdateState =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'
  | 'unsupported'

export interface UpdateStatus {
  state: UpdateState
  version?: string
  percent?: number
  message?: string
  canAutoUpdate: boolean
}

export interface LumineApi {
  profiles: {
    list(): Promise<Result<Profile[]>>
    save(input: ProfileInput & { id?: string }): Promise<Result<Profile>>
    remove(id: string): Promise<Result<null>>
    pickKey(): Promise<Result<string | null>>
  }
  settings: {
    get(): Promise<Result<Settings>>
    setLocale(locale: Locale): Promise<Result<Settings>>
  }
  knownHosts: {
    list(): Promise<Result<KnownHost[]>>
    forget(key: string): Promise<Result<null>>
  }
  bookmarks: {
    list(profileId: string): Promise<Result<Bookmark[]>>
    add(profileId: string, path: string): Promise<Result<Bookmark>>
    remove(id: string): Promise<Result<null>>
  }
  secrets: {
    forget(profileId: string): Promise<Result<Profile>>
  }
  connect(
    profileId: string,
    secret: ConnectSecret,
    sessionId: string
  ): Promise<Result<ConnectResult>>
  disconnect(sessionId: string): Promise<Result<null>>
  respondHostKey(
    sessionId: string,
    requestId: string,
    accept: boolean
  ): Promise<Result<null>>
  answerInteractive(
    sessionId: string,
    requestId: string,
    cancelled: boolean,
    answers: string[]
  ): Promise<Result<null>>
  sftp: {
    list(sessionId: string, path: string): Promise<Result<RemoteListing>>
    mkdir(sessionId: string, dir: string, name: string): Promise<Result<null>>
    rename(
      sessionId: string,
      dir: string,
      from: string,
      to: string
    ): Promise<Result<null>>
    remove(sessionId: string, paths: string[]): Promise<Result<{ queued: number }>>
    upload(sessionId: string, dir: string): Promise<Result<{ queued: number }>>
    uploadFolder(sessionId: string, dir: string): Promise<Result<{ queued: number }>>
    download(
      sessionId: string,
      paths: string[]
    ): Promise<Result<{ queued: number }>>
    /** Tải về thư mục tạm của app rồi mở bằng ứng dụng mặc định. */
    open(sessionId: string, path: string): Promise<Result<{ jobId: string }>>
    retry(id: string): Promise<Result<null>>
    reveal(id: string): Promise<Result<null>>
    chmod(sessionId: string, path: string, mode: number): Promise<Result<null>>
  }
  local: {
    home(): Promise<Result<{ path: string }>>
    list(path: string): Promise<Result<RemoteListing>>
    mkdir(dir: string, name: string): Promise<Result<null>>
    rename(dir: string, from: string, to: string): Promise<Result<null>>
    remove(path: string): Promise<Result<null>>
    open(path: string): Promise<Result<null>>
  }
  transfer: {
    /** Copy file/thư mục giữa hai đầu: remote↔remote, remote↔local. */
    copy(from: Location, to: Location): Promise<Result<{ jobId: string }>>
    cancel(id: string): Promise<Result<null>>
  }
  updates: {
    get(): Promise<Result<UpdateStatus>>
    check(): Promise<Result<UpdateStatus>>
    download(): Promise<Result<UpdateStatus>>
    install(): Promise<Result<null>>
    openRelease(): Promise<Result<null>>
  }
  onStatus(callback: (status: ConnectionStatus) => void): () => void
  onHostKey(callback: (prompt: HostKeyPrompt) => void): () => void
  onHostKeyMismatch(callback: (prompt: HostKeyMismatchPrompt) => void): () => void
  onInteractive(callback: (request: InteractiveRequest) => void): () => void
  onTransfer(callback: (transfer: TransferInfo) => void): () => void
  onUpdate(callback: (status: UpdateStatus) => void): () => void
}

export const IPC = {
  profilesList: 'profiles:list',
  profilesSave: 'profiles:save',
  profilesRemove: 'profiles:remove',
  profilesPickKey: 'profiles:pick-key',
  secretsForget: 'secrets:forget',
  settingsGet: 'settings:get',
  settingsSetLocale: 'settings:set-locale',
  knownHostsList: 'known-hosts:list',
  knownHostsForget: 'known-hosts:forget',
  bookmarksList: 'bookmarks:list',
  bookmarksAdd: 'bookmarks:add',
  bookmarksRemove: 'bookmarks:remove',
  connect: 'connection:connect',
  disconnect: 'connection:disconnect',
  hostKeyRespond: 'connection:hostkey-respond',
  interactiveAnswer: 'connection:interactive-answer',
  sftpList: 'sftp:list',
  sftpMkdir: 'sftp:mkdir',
  sftpRename: 'sftp:rename',
  sftpRemove: 'sftp:remove',
  sftpUpload: 'sftp:upload',
  sftpUploadFolder: 'sftp:upload-folder',
  sftpDownload: 'sftp:download',
  sftpOpen: 'sftp:open',
  sftpRetry: 'sftp:retry',
  sftpReveal: 'sftp:reveal',
  sftpChmod: 'sftp:chmod',
  localHome: 'local:home',
  localList: 'local:list',
  localMkdir: 'local:mkdir',
  localRename: 'local:rename',
  localRemove: 'local:remove',
  localOpen: 'local:open',
  transferCopy: 'transfer:copy',
  transferCancel: 'transfer:cancel',
  updatesGet: 'updates:get',
  updatesCheck: 'updates:check',
  updatesDownload: 'updates:download',
  updatesInstall: 'updates:install',
  updatesOpenRelease: 'updates:open-release',
  eventStatus: 'event:status',
  eventHostKey: 'event:hostkey',
  eventHostKeyMismatch: 'event:hostkey-mismatch',
  eventInteractive: 'event:interactive',
  eventTransfer: 'event:transfer',
  eventUpdate: 'event:update'
} as const

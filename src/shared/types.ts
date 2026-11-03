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
  profileId?: string
  profileName?: string
  host?: string
  port?: number
  code?: ErrorCode
  detail?: string
}

export interface HostKeyPrompt {
  requestId: string
  host: string
  port: number
  keyType: string
  fingerprint: string
}

export interface HostKeyMismatchPrompt {
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
}

export type TransferDirection = 'upload' | 'download'
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
  speed?: number
  eta?: number
  canRetry?: boolean
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
  secrets: {
    forget(profileId: string): Promise<Result<Profile>>
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
  connect(profileId: string, secret: ConnectSecret): Promise<Result<Profile>>
  disconnect(): Promise<Result<null>>
  respondHostKey(requestId: string, accept: boolean): Promise<Result<null>>
  answerInteractive(
    requestId: string,
    cancelled: boolean,
    answers: string[]
  ): Promise<Result<null>>
  sftp: {
    list(path: string): Promise<Result<RemoteListing>>
    mkdir(dir: string, name: string): Promise<Result<null>>
    rename(dir: string, from: string, to: string): Promise<Result<null>>
    remove(paths: string[]): Promise<Result<{ queued: number }>>
    upload(dir: string): Promise<Result<{ queued: number }>>
    uploadFolder(dir: string): Promise<Result<{ queued: number }>>
    download(paths: string[]): Promise<Result<{ queued: number }>>
    cancel(id: string): Promise<Result<null>>
    retry(id: string): Promise<Result<null>>
    reveal(id: string): Promise<Result<null>>
    chmod(path: string, mode: number): Promise<Result<null>>
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
  sftpCancel: 'sftp:cancel',
  sftpRetry: 'sftp:retry',
  sftpReveal: 'sftp:reveal',
  sftpChmod: 'sftp:chmod',
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

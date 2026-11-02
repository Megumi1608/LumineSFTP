# Lumine SFTP — Kế hoạch triển khai

> SFTP client desktop tối giản cho Windows & macOS, nhập cấu hình kết nối bằng mã QR.
> Trạng thái: **Đã triển khai v0.1.0** — UI mono trắng–đen; auto-update qua GitHub Releases. Build và upload thủ công, không dùng CI.

---

## 1. Mục tiêu

- Chạy native trên **Windows 10/11 (x64)** và **macOS 13+ (Apple Silicon; x64 nếu cần)**.
- Kết nối SFTP bằng **host / port / username / password**.
- Nhập nhanh cấu hình từ **QR code** dạng:

  ```json
  {"host":"files.example.com","port":2022,"username":"demo-user"}
  ```

- Duyệt file remote, upload, download, tạo thư mục, đổi tên, xoá.
- Bảo mật đầy đủ theo mô hình threat bên dưới.
- **YAGNI**: không terminal, không sync, không FTP, không cloud,
  không telemetry, không lưu mật khẩu, không quét camera.

### Quyết định đã chốt với bạn

| Hạng mục | Quyết định |
|---|---|
| Nền tảng code | **Tự viết bản gọn trên `ssh2`** (Electron + TypeScript), tái dùng pattern bảo mật đã kiểm chứng từ `harbor-ssh` (MIT) |
| Nhập QR | **Ảnh (chọn file / kéo-thả) + clipboard**, không dùng camera |
| Mật khẩu | **Hỏi mỗi lần kết nối**, không lưu xuống đĩa |
| Secret trong QR | **Không** — parser từ chối `password` / `privateKey` / `passphrase` |
| Xác thực | **Password** (kèm fallback keyboard-interactive) |
| Ngôn ngữ UI | **Tiếng Việt + English** |

### Vì sao không fork nguyên app có sẵn

Đã khảo sát `harbor-ssh`, `fileterm`, `ssh-x`, `Netcatty`, FileZilla… Các bản
Electron/Tauri hiện có đều **terminal-first**, kéo theo 20–50× bề mặt cần thiết
(terminal, jump host, port forwarding, SQLite native, AI copilot, update checker).
Fork rồi cắt bớt tốn công hơn và khó audit bảo mật hơn. Ta giữ phần tốt nhất:
`ssh2` (thư viện SSH/SFTP thuần JS, không native build) + các pattern
host-key TOFU / IPC validation / sanitize đường dẫn đã thấy ở harbor-ssh (MIT).

> Server đã kiểm tra: `files.example.com:2022` phân giải → `203.0.113.10`,
> SSH ed25519, fingerprint `SHA256:LgZpRzWEAbVvBimxTv69/UB88PD8jyOSDqfozr+iNX0`.
> Dùng để đối chiếu khi test kết nối thật.

---

## 2. Kiến trúc

```
┌─────────────────────────── Electron ───────────────────────────┐
│ Renderer (React 19 + Vite)                                     │
│  - UI, i18n, QR decode (jsQR)                                  │
│  - KHÔNG có network, KHÔNG có Node API                         │
│         │ contextBridge (preload, sandbox)                     │
│         ▼                                                      │
│ Main process (Node)                                            │
│  - ssh2 Client + SFTP subsystem                                │
│  - host-key TOFU store, profile store                          │
│  - IPC validation, dialog, file streams                        │
└────────────────────────────────────────────────────────────────┘
```

- **Electron 45** + **TypeScript** + **React 19** + **Vite** (`electron-vite`).
- **ssh2 1.17** cho SSH/SFTP — thuần JS, không cần rebuild native trên Win/Mac.
- **jsQR 1.4** giải mã QR thuần JS (không wasm → CSP chặt, không cần quyền camera).
- **electron-builder 26** đóng gói NSIS (Win) + DMG universal (mac).
- Không dùng cơ sở dữ liệu: 3 file JSON nhỏ, ghi atomic, permission `0600`.

### Vòng đời kết nối (một session tại một thời điểm — đủ cho YAGNI)

```
idle → connecting → hostkey? → authenticating → connected → disconnected
                        │                            │
                        └── mismatch/timeout ────────┴── error
```

- Chỉ mở **SFTP subsystem**, không mở shell, không exec, không agent forwarding.
- Bắt đầu ở `realpath('.')` (home của user).

---

## 3. Cấu trúc repo

```
LumineSFTP/
├─ package.json                 # pin exact version, lockfile commit
├─ electron.vite.config.ts
├─ electron-builder.yml
├─ tsconfig.json / tsconfig.node.json / tsconfig.web.json
├─ src/
│  ├─ main/
│  │  ├─ index.ts               # app, BrowserWindow, CSP, hardening, fuses
│  │  ├─ ipc.ts                 # đăng ký channel + validate payload
│  │  ├─ ssh.ts                 # SshSession: connect, hostVerifier, auth, events
│  │  ├─ sftp.ts                # list/mkdir/rename/delete + transfer queue
│  │  ├─ store.ts               # profiles.json, known_hosts.json, settings.json
│  │  ├─ local-path.ts          # sanitize tên file, chống path traversal
│  │  ├─ errors.ts              # error code → renderer tự dịch
│  │  └─ log.ts                 # log dev, redact secret
│  ├─ preload/index.ts          # contextBridge, API hẹp
│  ├─ shared/
│  │  ├─ types.ts
│  │  ├─ contract.ts            # validator cho mọi IPC input
│  │  └─ qr.ts                  # parse + validate payload QR (dùng chung, test được)
│  └─ renderer/
│     ├─ index.html
│     └─ src/
│        ├─ main.tsx, App.tsx
│        ├─ components/         # ProfileList, ConnectDialog, HostKeyDialog,
│        │                      # FileBrowser, TransferPanel, QrImport, Settings
│        ├─ i18n/{vi,en}.ts
│        └─ styles.css
├─ tests/                       # vitest: qr, local-path, contract, store
├─ docs/
│  ├─ SECURITY.md               # threat model + checklist
│  └─ QR-FORMAT.md              # đặc tả payload
└─ docs/                         # SECURITY.md, QR-FORMAT.md
```

---

## 4. Nhập QR — luồng & đặc tả

### Luồng UX

1. Nút **“Nhập từ QR”** (màn hình chính và màn hình thêm profile).
2. Người dùng chọn một trong: kéo-thả ảnh, chọn file ảnh, `Ctrl/Cmd+V` ảnh.
3. Decode trong renderer → chuỗi JSON → **preview**, không tự kết nối.
4. Preview hiển thị `host`, `port`, `username`, cảnh báo *“QR là dữ liệu không
   tin cậy — kiểm tra kỹ trước khi kết nối”*.
5. Người dùng bấm **Lưu** hoặc **Lưu & kết nối** → mới chuyển sang nhập mật khẩu.
6. Main process **validate lại payload** trước khi ghi profile (defense in depth).

### Đặc tả payload (`docs/QR-FORMAT.md`)

```jsonc
{
  "host": "files.example.com",   // bắt buộc
  "port": 2022,                    // bắt buộc, 1..65535 (chấp nhận cả "2022")
  "username": "demo-user", // bắt buộc
  "name": "Server của tôi"        // tuỳ chọn, ≤ 80 ký tự
}
```

Chuẩn hoá & từ chối:

- Chuỗi decode tối đa **2 KB**; trim; cho phép dấu `;` thừa ở cuối.
- Phải là JSON object; không array/null.
- **Chỉ** 4 khoá trên. Bất kỳ khoá lạ nào → lỗi (`QR_UNKNOWN_FIELD`).
- Nếu có `password`, `privateKey`, `passphrase` → lỗi riêng
  (`QR_SECRET_REJECTED`) và **không** lưu/kết nối.
- `host`:
  - 1..253 ký tự, trim, bỏ `[ ]` của IPv6.
  - Từ chối khoảng trắng, ký tự điều khiển, `/ \ @ : ? #`, scheme, path, port.
  - IPv4/IPv6 hợp lệ, hoặc domain → `domainToASCII`, kiểm tra từng label
    (`a-z0-9-`, không bắt đầu/kết thúc bằng `-`, ≤ 63).
- `port`: số nguyên hoặc chuỗi `^\d{1,5}$` → int, `1..65535`.
- `username`: 1..128, không ký tự điều khiển, trim.
- `name`: tuỳ chọn, ≤ 80, mặc định = host.
- Ảnh: PNG/JPEG/WebP ≤ 10 MB, downscale cạnh dài ≤ 1600 px trước khi decode
  (chống ảnh lớn làm treo UI); thử `inversionAttempts: 'attemptBoth'`.

### Bảo mật QR

QR là **input không tin cậy**. Vì vậy:

- Không auto-connect, không auto-login, không fetch URL trong payload.
- Hiển thị giá trị đã parse để người dùng xác nhận.
- Host-key pinning chống QR độc hại trỏ tới server của kẻ tấn công.
- Từ chối secret trong QR để tránh lộ mật khẩu qua ảnh chụp màn hình.

---

## 5. SSH/SFTP & host key

### Kết nối

```ts
new Client().connect({
  host, port, username, password,
  readyTimeout: 30_000,
  keepaliveInterval: 15_000,
  keepaliveCountMax: 3,
  tryKeyboard: true,          // fallback, có dialog giới hạn 8 vòng
  hostVerifier: (key, cb) => …, // xem dưới
  // KHÔNG: agent, forwardAgent, shell, exec, sock, proxy
});
```

- Host key dùng **SHA-256 fingerprint** (`SHA256:<base64 không padding>`).
- `known_hosts.json` khoá theo `host.toLowerCase():port`.

### Chính sách host key (TOFU nghiêm ngặt)

| Tình huống | Hành vi |
|---|---|
| Chưa từng kết nối | Hiện fingerprint + loại key, người dùng **Accept / Cancel**; timeout 60 s → huỷ |
| Đã lưu & khớp | Tự động chấp nhận |
| Đã lưu & **khác** | **Huỷ kết nối ngay**, báo `HOST_KEY_MISMATCH`, chỉ cho phép xoá pin trong Settings (kèm cảnh báo MITM); không có nút “vẫn kết nối” trong luồng |
| Timeout / lỗi | Huỷ, không lưu |

- Chỉ lưu pin **sau khi** người dùng chấp nhận.
- Nút “Copy fingerprint” để đối chiếu với quản trị viên.
- Màn hình Settings liệt kê known hosts, có “Quên” từng host.

> Lần kết nối đầu tiên vẫn là TOFU: nếu kẻ tấn công kiểm soát kết nối đầu,
> pin sẽ ghi nhầm. UI nhắc người dùng xác minh fingerprint khi cần.

### Thao tác SFTP (v1)

| Thao tác | Ghi chú |
|---|---|
| List | `realpath` + `readdir`; tối đa 10.000 entry; sắp xếp thư mục trước |
| Upload | Multi-select file; stream; tối đa 2 transfer song song |
| Download | Chọn thư mục đích; stream; progress; cancel |
| New folder | Validate tên |
| Rename | Validate tên, không cho `/`, NUL, `.`/`..` |
| Delete | Confirm hiển thị full path; đệ quy với cảnh báo; **chặn xoá `/`** |
| Refresh / breadcrumb / Up | Có |

Ghi file an toàn:

- Download: ghi `.<name>.lumine-part-<random>` trong thư mục đích → `rename`
  khi xong; xoá temp khi lỗi/huỷ.
- Upload: ghi temp cùng thư mục remote → `rename` khi xong.
- Trùng tên: hỏi **Overwrite / Skip / Rename**, có “áp dụng cho tất cả”.
- Tên file remote (do server kiểm soát) khi lưu local phải sanitize:
  - chỉ lấy basename; thay `\` (Unix cho phép) bằng `_`;
  - bỏ ký tự điều khiển, `< > : " | ? *`, CR/LF;
  - bỏ dấu chấm/khoảng trắng cuối (Windows);
  - chặn reserved names: `CON, PRN, AUX, NUL, COM1-9, LPT1-9`;
  - giới hạn 200 ký tự; fallback `download`;
  - `path.resolve(dest, name)` phải nằm trong `dest` (chống zip-slip).
- Không follow symlink khi ghi; symlink hiển thị riêng, download sẽ đọc nội dung
  đích (hành vi SFTP chuẩn) — ghi rõ trong SECURITY.md.

---

## 6. Bảo mật — threat model & checklist

### Tài sản cần bảo vệ

1. Mật khẩu SFTP (chỉ tồn tại trong RAM, trong lúc kết nối).
2. Tính toàn vẹn kênh SSH (chống MITM).
3. Máy local (không bị RCE/path traversal từ dữ liệu server/QR).
4. File trên server (không bị xoá/ghi nhầm ngoài ý muốn).

### Threat & biện pháp

| Threat | Biện pháp |
|---|---|
| QR độc hại trỏ host lạ | Preview bắt buộc xác nhận + host-key TOFU |
| MITM / server giả | Pin SHA-256, mismatch → chặn cứng |
| Mật khẩu lộ qua đĩa/log | Không lưu, không log, redact lỗi; không telemetry |
| Malicious filename (traversal, reserved, rất dài, ANSI) | Sanitize + giới hạn + render dạng text (React escape) |
| Renderer RCE từ nội dung remote | `contextIsolation`, `sandbox`, `nodeIntegration:false`, CSP chặt, không remote content |
| IPC bị lạm dụng | Allowlist channel, validate sender + schema, không nhận object tuỳ ý |
| Dependency supply chain | Pin exact, lockfile, `npm install`, `npm audit` |
| App bị chạy như Node | Electron fuses: tắt `RunAsNode`, `NODE_OPTIONS`, inspect args |
| Clickjacking/navigation | Chặn `will-navigate`, `setWindowOpenHandler` deny, không webview |
| Quyền hệ thống thừa | Từ chối mọi permission request (camera/mic/geo/notification) |

### Hardening Electron

```ts
webPreferences: {
  preload, sandbox: true, contextIsolation: true,
  nodeIntegration: false, nodeIntegrationInWorker: false,
  webviewTag: false, spellcheck: false,
  devTools: !app.isPackaged
}
```

CSP production (qua `onHeadersReceived` + meta):

```
default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:; font-src 'self'; connect-src 'none';
base-uri 'none'; form-action 'none'; frame-ancestors 'none'
```

- Dev mode nới CSP tối thiểu cho Vite HMR, **không** áp dụng cho bản build.
- `app.on('web-contents-created')`: chặn mọi điều hướng và cửa sổ mới.
- Không `shell.openExternal` với dữ liệu người dùng; link ngoài (nếu có) chỉ
  allowlist `https://`.
- `session.setPermissionRequestHandler(() => callback(false))`.

### Dữ liệu lưu đĩa (không có secret)

| File | Nội dung | Quyền |
|---|---|---|
| `profiles.json` | `{id, name, host, port, username, createdAt, lastUsedAt}` | 0600 |
| `known_hosts.json` | `{"host:port": {algo, fingerprint, firstSeen}}` | 0600 |
| `settings.json` | `{locale: "vi" \\| "en"}` | 0600 |

- Ghi atomic: temp file `wx` → `rename`.
- File hỏng → backup `.corrupt-<ts>`, khởi tạo rỗng, báo người dùng.
- Windows: `chmod` là no-op; file nằm trong profile user (ACL kế thừa) — chấp nhận.
- Đường dẫn: `%APPDATA%\Lumine SFTP`, `~/Library/Application Support/Lumine SFTP`.

---

## 7. UI/UX (tối giản)

**Màn hình chính**

- Sidebar: danh sách profile (tên, `user@host:port`), nút **+ Thêm** / **Nhập QR**.
- Vùng phải: trạng thái rỗng hoặc file browser sau khi kết nối.
- Toolbar: Up, breadcrumb, Refresh, Upload, New folder, Disconnect.

**Dialog**

- `ConnectDialog`: hiển thị profile, ô mật khẩu (password, không echo), nút Connect.
- `HostKeyDialog`: loại key, fingerprint, cảnh báo, Accept/Cancel.
- `QrImportDialog`: drop zone + paste + chọn file; preview + Lưu.
- `TransferPanel`: tiến độ, tốc độ, huỷ.
- `Settings`: ngôn ngữ, known hosts (fingerprint, quên), phiên bản, license.

**i18n**

- Dictionary thuần TS (`vi.ts`, `en.ts`), không thư viện.
- Main trả **error code**; renderer dịch. Mặc định `vi`, lưu lựa chọn.

---

## 8. Đóng gói & phân phối

`electron-builder.yml`:

- **Windows**: NSIS x64, per-user (không cần admin), shortcut menu Start.
- **macOS**: DMG **universal** (arm64 + x64), `hardenedRuntime: true`.
- `asar: true`; fuses: tắt RunAsNode / NODE_OPTIONS / inspect, `onlyLoadAppFromAsar`.
- Auto-update qua GitHub Releases (Windows; macOS cần ký số), không crash reporter.

Chưa có chứng chỉ ký số:

- Windows: SmartScreen sẽ cảnh báo → hướng dẫn “More info → Run anyway”.
- macOS: Gatekeeper chặn app tải từ mạng → hướng dẫn
  `xattr -dr com.apple.quarantine "/Applications/Lumine SFTP.app"`.
- Nếu bạn có Apple Developer ID / chứng chỉ Windows, cấu hình khi build để ký + notarize.

Build & phát hành thủ công (không CI):

- Windows: `npm run package:win`, tạo release và upload `.exe`, `.blockmap`, `latest.yml`.
- macOS: chạy `npm run package:mac` **trên máy macOS**, upload `.dmg`, `.zip`, `latest-mac.yml`.
- Release phải published thì auto-update mới thấy.

---

## 9. Kiểm thử

### Unit (Vitest)

- `parseQrPayload`: payload mẫu, dấu `;` thừa, port dạng chuỗi, IPv6, domain IDN,
  từ chối `password`/field lạ, host có scheme/path, port 0/65536, chuỗi > 2 KB,
  control chars, JSON hỏng.
- `sanitizeLocalName`: `../`, `..\\`, `CON`, `a:b`, tên 300 ký tự, emoji/Unicode,
  dấu chấm cuối, path tuyệt đối.
- `known_hosts`: match / mismatch / host:port case-insensitive.
- `store`: ghi atomic, file hỏng → backup, schema sai.
- `contract`: mọi IPC input hợp lệ/không hợp lệ.

### Integration (Docker có sẵn trên máy)

- `docker run atmoz/sftp` (hoặc `linuxserver/openssh-server`) với user/password test.
- Test: connect → host key lần đầu → list → upload → download → so sánh hash →
  rename → mkdir → delete → disconnect.
- Test sai mật khẩu, sai host key (đổi key server → phải bị chặn).

### E2E / thủ công

- Playwright Electron: app mở, CSP không lỗi console, luồng QR paste → preview.
- Checklist thủ công Windows 11 + macOS:
  - QR từ ảnh chụp / ảnh chọn file / clipboard.
  - Unicode, file > 1 GB (progress/cancel).
  - Tên file xấu do server trả về.
  - Mất mạng giữa transfer → temp được dọn.
- Kết nối thật tới `files.example.com:2022` (bạn nhập mật khẩu, mình không lưu).

---

## 10. Các phase triển khai

| Phase | Nội dung | Tiêu chí xong |
|---|---|---|
| **0. Scaffold** | `electron-vite` + TS + React; ESLint/Prettier; cấu hình build | `npm run dev` mở cửa sổ trống, typecheck pass |
| **1. Security shell** | BrowserWindow hardening, CSP, permission handler, preload API, IPC contract, store JSON, logging redact | Unit test contract/store pass; kiểm tra không có Node trong renderer |
| **2. SSH/SFTP engine** | `SshSession`, hostVerifier TOFU, known_hosts, auth password + keyboard-interactive, list/mkdir/rename/delete, transfer queue 2 luồng, temp + rename, cancel | Test Docker pass; mismatch bị chặn |
| **3. UI** | Profile list, connect dialog, host key dialog, file browser, transfers, settings, i18n vi/en | Duyệt + upload/download được trên Windows |
| **4. QR** | `qr.ts` parser + validators, decode ảnh/clipboard, preview/confirm | Payload mẫu hoạt động; secret bị từ chối |
| **5. Đóng gói & docs** | electron-builder NSIS + DMG universal, README, SECURITY.md, QR-FORMAT.md | Cài được trên Win; DMG build trên macOS; test pass |
| **6. QA** | Test với server thật, Unicode, file lớn, huỷ, host key đổi | Checklist QA ký nhận |

Ước lượng: ~5–6 ngày người; khi làm liên tục trong phiên có thể xong Phase 0–4
trước, Phase 5–6 cần build/QA thực tế.

---

## 11. Tiêu chí nghiệm thu

- [ ] Nhập QR từ ảnh/clipboard đúng payload mẫu, hiện preview, không auto-connect.
- [ ] QR chứa `password` bị từ chối rõ ràng.
- [ ] Kết nối `files.example.com:2022` bằng password, duyệt home.
- [ ] Lần đầu hiện fingerprint ed25519; lần sau tự động; đổi key → chặn.
- [ ] Upload/download/mkdir/rename/delete hoạt động; file tên xấu không thoát thư mục đích.
- [ ] Không có mật khẩu trong file/log/telemetry.
- [ ] `npm install && npm test && npm run build` xanh trên Windows; macOS build DMG trên máy Mac.
- [ ] App chạy được trên Windows 11 và macOS (arm64).

---

## 12. Rủi ro & cách xử lý

| Rủi ro | Xử lý |
|---|---|
| macOS không build/test được trên máy Windows | Build trên MacBook bằng `npm run package:mac`; không cross-build DMG |
| App unsigned bị Gatekeeper/SmartScreen chặn | Hướng dẫn trong README; ký nếu có chứng chỉ |
| Server dùng thuật toán cũ (`ssh-rsa` SHA-1) | `ssh2` mặc định hiện đại; nếu lỗi, ghi nhận và chỉ bật tối thiểu, có cảnh báo |
| Electron ~100 MB | Chấp nhận; Tauri là phương án khác nếu cần siêu nhẹ (không chọn) |
| TOFU lần đầu vẫn có thể bị MITM | Nhắc xác minh fingerprint; hiển thị rõ |
| Keyboard-interactive prompt lạ | Giới hạn 8 vòng / 16 prompt, timeout 90 s |
| Thư mục remote > 10.000 entry | Báo lỗi, yêu cầu mở thư mục con |

---

## 13. Non-goals (không làm)

Terminal/SSH shell · FTP/FTPS/S3/WebDAV · sync/thư mục local · SSH key auth ·
port forwarding/jump host · lưu mật khẩu · quét camera ·
telemetry · chỉnh sửa file remote · phân quyền/chmod · tìm kiếm remote ·
đa ngôn ngữ ngoài vi/en · Windows ARM.

---

## 14. Việc cần bạn cung cấp khi vào Phase 6

1. Mật khẩu test cho `files.example.com` (nhập trực tiếp vào app, **không** gửi qua chat
   nếu không muốn; mình có thể hướng dẫn bạn test).
2. Xác nhận tên app/icon (mặc định: **Lumine SFTP**, icon đơn giản).
3. Có chứng chỉ ký số hay không (mặc định: không, build unsigned).

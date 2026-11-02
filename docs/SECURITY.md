# Security model — Lumine SFTP

Tài liệu này mô tả mô hình bảo mật, các biện pháp đã triển khai và giới hạn còn lại.

## 1. Tài sản cần bảo vệ

1. **Mật khẩu SFTP** — chỉ tồn tại trong RAM trong lúc kết nối.
2. **Tính toàn vẹn kênh SSH** — chống máy chủ giả / MITM.
3. **Máy local** — không bị RCE, path traversal hoặc ghi file ngoài ý muốn từ dữ liệu server/QR.
4. **Dữ liệu trên server** — không bị xoá/ghi nhầm ngoài thao tác người dùng xác nhận.

## 2. Những gì KHÔNG được lưu

- Không lưu mật khẩu, passphrase, private key.
- Không lưu nội dung file, không log tên file / đường dẫn / lỗi có chứa secret.
- Không telemetry, không crash reporter.
- Không có keychain/credential vault vì không có secret cần lưu.

### Auto-update

- Chỉ tải từ GitHub Releases của repo chính thức, qua HTTPS.
- URL feed được đóng gói trong `app-update.yml`; renderer không thể thay đổi feed.
- `electron-updater` xác minh SHA-512 của gói tải về từ `latest.yml` / `latest-mac.yml` trước khi cài.
- Không nhúng GitHub token vào app; repo là public.
- **Windows chưa ký số**: installer không được xác thực publisher, nên bảo vệ yếu hơn bản ký số. Muốn chắc chắn, cấu hình code signing.
- **macOS chưa ký số**: app không bật auto-install; người dùng tải DMG thủ công. macOS yêu cầu chữ ký Developer ID + notarization để Squirrel.Mac cài cập nhật.
- Auto-check chạy sau ~12 giây khi app packaged và có thể kiểm tra thủ công trong Settings.

Chỉ lưu:

| File | Nội dung | Quyền |
|---|---|---|
| `profiles.json` | `id`, `name`, `host`, `port`, `username`, timestamps | `0600` (Windows: ACL kế thừa user profile) |
| `known_hosts.json` | `host:port`, key type, fingerprint SHA-256, `firstSeen` | `0600` |
| `settings.json` | `locale` | `0600` |

Ghi file theo kiểu atomic (`temp` + `rename`), tạo với `wx` để tránh ghi đè ngoài ý muốn. File hỏng được đổi tên thành `.corrupt-<timestamp>` thay vì ghi đè dữ liệu cũ.

## 3. Xác thực máy chủ (host key)

- Dùng **SHA-256 fingerprint** theo chuẩn OpenSSH: `SHA256:<base64 không padding>`.
- Pin theo `host:port`, host được lower-case / IDNA-normalize.
- **Lần đầu**: hiển thị key type + fingerprint, yêu cầu người dùng chấp nhận (timeout 60 giây).
- **Lần sau**: tự động chấp nhận nếu fingerprint khớp.
- **Mismatch**: **huỷ kết nối ngay**, không có nút "vẫn kết nối" trong luồng. Muốn kết nối lại phải vào Settings → xoá pin (kèm giải thích MITM).
- Chỉ lưu pin sau khi người dùng chấp nhận.
- Kết nối chỉ mở **SFTP subsystem**; không mở shell/exec, không agent forwarding, không port forwarding, không jump host.

### Giới hạn TOFU

Lần kết nối đầu tiên vẫn có thể bị MITM nếu kẻ tấn công kiểm soát kết nối đầu. UI nhắc người dùng đối chiếu fingerprint với quản trị viên. Với môi trường yêu cầu cao, hãy xác minh fingerprint ngoài kênh.

## 4. QR code là dữ liệu không tin cậy

- Chỉ chấp nhận JSON object với đúng 4 khoá: `host`, `port`, `username`, `name` (tuỳ chọn).
- Từ chối `password`, `passphrase`, `privateKey`, `secret`, `token`, `key` và mọi field lạ.
- Giới hạn 2 KB; host ≤ 253 ký tự; port 1–65535; username ≤ 128; name ≤ 80.
- Host phải là IP/domain hợp lệ; từ chối scheme, path, query, `user@`, port nhúng, khoảng trắng, ký tự điều khiển.
- Không tự kết nối. Luôn hiển thị preview để người dùng xác nhận.
- Decode ảnh trong renderer bằng `jsQR` (thuần JS, không wasm); ảnh tối đa 10 MB, downscale cạnh dài ≤ 1600 px.
- Không cấp quyền camera; app từ chối mọi permission request.

## 5. Hardening Electron

- `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, `nodeIntegrationInWorker: false`, `webviewTag: false`.
- Preload chỉ expose API hẹp qua `contextBridge`; không expose `ipcRenderer`, `require`, `process`.
- CSP production:
  `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'none'; base-uri 'none'; form-action 'none'`
- `style-src 'unsafe-inline'` chỉ để React đặt style tiến trình; không có `script-src 'unsafe-inline'`.
- Renderer **không có network**: `connect-src 'none'`; mọi kết nối mạng nằm ở main process.
- Từ chối mọi `permission request` / `permission check` (camera, mic, geolocation, notification, clipboard-read…).
- Chặn `will-navigate`, `will-redirect`, `window.open`, `webview` attach.
- Electron fuses: tắt `RunAsNode`, `NODE_OPTIONS`, CLI inspect; chỉ load app từ ASAR.
- DevTools chỉ bật khi chưa packaged.

## 6. IPC

- Allowlist channel cố định (`src/shared/types.ts` → `IPC`).
- Mỗi handler kiểm tra `event.sender === mainWindow.webContents`.
- Mọi payload được validate độc lập ở main process (`src/shared/contract.ts`), không tin renderer.
- Trả về `{ ok: false, code, detail? }`; renderer tự dịch lỗi. Không trả stack trace.
- Không có IPC nào cho phép renderer chỉ định đường dẫn local tuỳ ý cho upload/download:
  - Upload: main process mở native file dialog và chỉ dùng đường dẫn người dùng chọn.
  - Download: main process mở native folder dialog; tên file remote được sanitize.
- Xoá và ghi đè luôn có xác nhận native ở main process (không chỉ tin nút bấm ở renderer).

## 7. An toàn file local

Tên file remote do server kiểm soát, được xử lý trước khi dùng làm đường dẫn local:

- Bỏ mọi thành phần thư mục (`/`, `\`), chỉ giữ basename.
- Thay ký tự điều khiển và `< > : " | ? *` bằng `_`.
- Bỏ dấu chấm / khoảng trắng cuối (Windows).
- Chặn reserved names: `CON`, `PRN`, `AUX`, `NUL`, `COM1-9`, `LPT1-9` (kể cả có extension).
- Giới hạn 200 ký tự (giữ extension ngắn).
- Fallback `download` nếu rỗng / `.` / `..`.
- `path.resolve(dest, name)` phải nằm trong `dest`; nếu không → từ chối.

Download ghi vào `.<name>.lumine-<random>.part` rồi `rename` khi xong; xoá temp khi lỗi/huỷ.
Upload ghi temp trên server rồi `rename` khi xong.

## 8. Giới hạn tài nguyên

- Tối đa 10.000 entry mỗi lần list; quá → báo lỗi, không treo UI.
- Tối đa 2 transfer chạy song song; hàng đợi 50.
- Đệ quy xoá sâu tối đa 32 cấp, tối đa 10.000 mục.
- Path remote ≤ 4096 ký tự; tên ≤ 255.
- Keyboard-interactive: tối đa 8 vòng / 16 prompt; timeout 90 giây.
- Host key prompt timeout 60 giây; kết nối `readyTimeout` 30 giây; keepalive 15 giây.

## 9. Những gì không bảo vệ

- **Máy local đã bị compromise**: kẻ tấn công có thể đọc RAM/process, keylog, hoặc sửa file cấu hình. Không có phần mềm nào chống được điều này.
- **Server độc hại**: app chỉ bảo vệ kênh và thao tác local; nội dung file tải về là dữ liệu không tin cậy — không tự mở/exec.
- **TOFU lần đầu** như trên.
- **Build chưa ký số**: có thể bị cảnh báo SmartScreen/Gatekeeper; không chống được malware thay thế installer nếu tải từ nguồn không tin cậy.

## 10. Báo lỗi bảo mật

Đây là dự án cá nhân. Nếu phát hiện lỗi, vui lòng mở issue **không kèm mật khẩu, private key, hay log chứa dữ liệu thật**. Mô tả: phiên bản, hệ điều hành, bước tái hiện, hành vi mong đợi.

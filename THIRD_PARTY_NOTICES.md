# Third-party notices

Lumine SFTP sử dụng các thư viện sau. Giấy phép gốc thuộc về tác giả tương ứng.

## Runtime

| Thư viện | Giấy phép | Trang |
|---|---|---|
| Electron | MIT | https://github.com/electron/electron |
| React / React DOM | MIT | https://github.com/facebook/react |
| ssh2 | MIT | https://github.com/mscdex/ssh2 |
| jsQR | Apache-2.0 | https://github.com/cozmo/jsQR |
| electron-updater | MIT | https://github.com/electron-userland/electron-builder |

## Build / test (không phân phối trong app)

| Thư viện | Giấy phép |
|---|---|
| TypeScript | Apache-2.0 |
| Vite | MIT |
| electron-vite | MIT |
| electron-builder | MIT |
| Vitest | MIT |
| Playwright Core | Apache-2.0 |
| qrcode (chỉ tạo ảnh test) | MIT |

## Ghi công thiết kế

Một số pattern bảo mật (host-key TOFU, kiểm tra IPC, lưu secret bằng hệ điều hành)
được tham khảo từ [harbor-ssh](https://github.com/miketam/harbor-ssh) (MIT).
Dự án này không copy nguyên mã nguồn từ harbor-ssh.

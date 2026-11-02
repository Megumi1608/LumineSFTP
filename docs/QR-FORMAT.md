# QR payload format

Lumine SFTP đọc một chuỗi JSON từ mã QR (hoặc dán trực tiếp).

## Định dạng

```json
{
  "host": "files.example.com",
  "port": 2022,
  "username": "demo-user"
}
```

Ví dụ tối giản (một dòng, đúng như QR thường chứa):

```json
{"host":"files.example.com","port":2022,"username":"demo-user"}
```

Có thể thêm tên gợi ý:

```json
{"host":"files.example.com","port":2022,"username":"demo-user","name":"Server nhà"}
```

## Trường

| Trường | Bắt buộc | Kiểu | Giới hạn |
|---|---|---|---|
| `host` | Có | string | 1–253 ký tự; IPv4, IPv6 (có/không ngoặc vuông), hoặc domain (IDN được chuyển punycode) |
| `port` | Có | number hoặc string số | số nguyên 1–65535 |
| `username` | Có | string | 1–128 ký tự, không ký tự điều khiển |
| `name` | Không | string | 1–80 ký tự, không ký tự điều khiển |

## Quy tắc chuẩn hoá

- Trim khoảng trắng đầu/cuối của toàn bộ chuỗi.
- Cho phép dấu `;` thừa ở cuối (ví dụ ảnh QR sinh kèm dấu chấm phẩy).
- Host được lower-case; domain có dấu chấm cuối được bỏ.
- IPv6: `[2001:db8::1]` → `2001:db8::1`.
- `port` dạng chuỗi `"2022"` được chấp nhận và chuyển thành số.
- `name` không có → dùng `host` làm tên kết nối.

## Bị từ chối

- Chuỗi > 2 KB.
- Không phải JSON, JSON không phải object (array/null/số/chuỗi).
- Khoá lạ ngoài 4 trường trên.
- Bất kỳ trường bí mật nào: `password`, `passwd`, `passphrase`, `privateKey`, `private_key`, `secret`, `token`, `key` → lỗi `SECRET_REJECTED`.
- Host chứa scheme (`https://`), path, query, `user@`, port nhúng, khoảng trắng, ký tự điều khiển, underscore, label sai.
- Port 0, > 65535, số thập phân, chữ.
- Username rỗng hoặc chứa ký tự điều khiển.

## Bảo mật

QR là **input không tin cậy**:

1. App hiển thị preview, không tự kết nối.
2. App không nhận mật khẩu/khoá từ QR.
3. Host key của máy chủ vẫn phải được xác minh (lần đầu) hoặc khớp pin (các lần sau). QR độc hại trỏ tới server khác sẽ bị chặn ở bước host key nếu fingerprint không khớp.
4. Không có URL nào trong payload được fetch.

## Lỗi hiển thị

| Mã | Ý nghĩa |
|---|---|
| `EMPTY` | Không có dữ liệu |
| `TOO_LARGE` | > 2 KB |
| `NOT_JSON` | JSON không hợp lệ |
| `NOT_OBJECT` | Không phải object |
| `UNKNOWN_FIELD` | Có khoá lạ |
| `SECRET_REJECTED` | Có mật khẩu/khoá bí mật |
| `INVALID_HOST` | Host sai |
| `INVALID_PORT` | Port sai |
| `INVALID_USERNAME` | Username sai |
| `INVALID_NAME` | Tên gợi ý sai |
| `QR_NOT_FOUND` | Ảnh không chứa QR |
| `QR_TOO_LARGE` | Ảnh > 10 MB |
| `QR_UNSUPPORTED` | Định dạng ảnh không hỗ trợ |

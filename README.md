# WebRTC Group Video Call — Bài tập mở rộng

Ứng dụng gọi video nhóm bằng WebRTC với:
- **Room ID**: nhiều người vào cùng một phòng bằng mã phòng.
- **Mesh topology**: mỗi peer kết nối P2P với tất cả các peer khác trong phòng.
- **TURN server (coturn)**: cho phép gọi qua internet, xuyên NAT/firewall.
- **Chat text** bonus đi qua signaling server.
- Bật/tắt mic, cam, sao chép Room ID, danh sách peer realtime.

## Kiến trúc

```
         ┌────────────────────────────┐
         │   Signaling Server (WSS)   │  ← chỉ truyền SDP/ICE, KHÔNG truyền media
         │   Node.js + Express + ws   │
         └─────┬──────────────────┬───┘
               │                  │
        Room "abc123"      Room "lop-TH01"
         ┌─┼─┐               ┌─┼─┐
         │ │ │               │ │ │
     Peer A B C           Peer D E F      ← media đi trực tiếp P2P
     (mesh: A↔B, A↔C, B↔C)
                              ↑
                              │ nếu NAT đối xứng
                              ↓
                      ┌──────────────┐
                      │ TURN (coturn)│  ← relay khi không xuyên được NAT
                      │  ở VPS public│
                      └──────────────┘
```

## Cấu trúc thư mục

```
webrtc-group-call/
├── server.js              ← Signaling server (HTTPS + WSS)
├── package.json
├── certs/
│   ├── key.pem            ← Sinh bằng openssl
│   └── cert.pem
├── public/
│   ├── index.html         ← Giao diện lobby + call room
│   ├── style.css
│   ├── app.js             ← Client WebRTC (mesh)
│   └── ice-config.js      ← STUN/TURN config
├── TURN-SETUP.md          ← Hướng dẫn cài coturn trên VPS
└── README.md
```

## Chạy trên mạng LAN

### 1. Cài dependency

```bash
cd webrtc-group-call
npm install
```

### 2. Sinh chứng chỉ SSL tự ký

```bash
mkdir -p certs
openssl req -newkey rsa:2048 -nodes -keyout certs/key.pem -x509 -days 365 -out certs/cert.pem -subj "/CN=localhost"
```

### 3. Chạy server

```bash
npm start
```

Server sẽ lắng nghe tại `https://0.0.0.0:3000`.

### 4. Mở từ các thiết bị

1. Xem IP LAN của máy chạy server: `ipconfig` (Windows) hoặc `ip a` (Linux).
2. Trên máy/điện thoại khác cùng LAN, mở `https://<IP-LAN>:3000`.
3. Trình duyệt cảnh báo "Not secure" (vì cert tự ký) → bấm **Advanced → Proceed**.
4. Nhập tên + Room ID → bấm **Vào phòng**.
5. Mở tab/thiết bị thứ 2, thứ 3, thứ 4… cùng Room ID để test mesh.

> **Mẹo test trên 1 máy**: mở nhiều tab ẩn danh, mỗi tab một tên khác nhưng cùng Room ID. Nhớ cho phép camera/mic cho từng tab.

## Chạy qua internet (có TURN)

1. Thuê VPS có IP công cộng, cài Ubuntu 22.04 (Vultr, DigitalOcean, AWS Lightsail, Linode… ~3–5 USD/tháng).
2. Đọc `TURN-SETUP.md` và cài coturn lên VPS.
3. Mở `public/ice-config.js`, thay domain/IP/user/pass của TURN.
4. Deploy `server.js` lên VPS (hoặc port-forward máy local ra internet).
5. Truy cập qua domain HTTPS của VPS.

## Cách mesh hoạt động (quan trọng cho báo cáo)

Quy ước "ai gọi ai" để **tránh glare** (cả 2 cùng gửi offer):

1. Khi client X vào phòng, server trả về danh sách peer đã có sẵn: `[A, B, C]`.
2. **X** (người mới) tạo offer tới từng người: X→A, X→B, X→C.
3. **A, B, C** (người cũ) chỉ đợi offer rồi trả lời bằng answer.
4. Khi client mới Y vào tiếp: Y tạo offer tới A, B, C, **X** → 4 kết nối mới.

Số kết nối P2P trong phòng N người: **N × (N−1) / 2**.

| N | Số kết nối | Băng thông mỗi máy (HD) |
|---|---|---|
| 2 | 1 | ~1 Mbps |
| 4 | 6 | ~3 Mbps |
| 8 | 28 | ~7 Mbps |

→ Mesh chỉ phù hợp với phòng nhỏ (≤6-8 người). Lớn hơn phải dùng **SFU** (Selective Forwarding Unit) như mediasoup, Janus, LiveKit.

## Debug

- Mở **DevTools → Console** xem log trạng thái.
- Truy cập `https://<server>:3000/rooms` để xem các phòng đang mở.
- Nếu peer không thấy nhau:
  - Kiểm tra tường lửa cho port 3000.
  - Trên trang `chrome://webrtc-internals/` xem `iceConnectionState`.
  - Nếu `iceConnectionState = failed` và ở xa nhau → cần TURN.

# WebRTC Group Video Call — Bài tập mở rộng

Ứng dụng gọi video nhóm bằng WebRTC với:
- **Room ID**: nhiều người vào cùng một phòng bằng mã phòng.
- **Mesh topology**: mỗi peer kết nối P2P với tất cả các peer khác trong phòng.
- **ICE đầy đủ**: STUN (Google) + TURN (Open Relay, miễn phí) — gọi được qua internet, xuyên NAT/firewall.
- **Chat text** đi qua signaling server.
- Bật/tắt mic, cam, sao chép Room ID.

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
     Peer A B C           Peer D E F    ← media đi P2P trực tiếp (host/srflx candidate)
     (A↔B, A↔C, B↔C)
                              ↑
                              │ khi P2P thất bại (NAT đối xứng, firewall)
                              ↓
                 ┌──────────────────────────────┐
                 │ TURN: Open Relay             │  ← relay toàn bộ media
                 │ openrelay.metered.ca         │    (relay candidate)
                 │ Miễn phí, không cần VPS      │
                 └──────────────────────────────┘
```

## Cấu trúc thư mục

```
WebRTC_HCMUS/
├── server.js              ← Signaling server (HTTPS local / HTTP cloud)
├── package.json
├── public/
│   ├── index.html         ← Giao diện lobby + call room
│   ├── style.css
│   ├── app.js             ← Client WebRTC (mesh + ICE logging)
│   └── ice-config.js      ← Cấu hình STUN + TURN
├── TURN-SETUP.md          ← Hướng dẫn tự cài coturn trên VPS (tham khảo thêm)
├── report.md              ← Báo cáo nộp bài
└── README.md
```

> `certs/` và `node_modules/` được loại khỏi git (xem `.gitignore`).

---

## Chạy trên mạng LAN

### 1. Cài dependency

```bash
npm install
```

### 2. Sinh chứng chỉ SSL tự ký

Trình duyệt chỉ cấp quyền `getUserMedia` trên HTTPS. Tạo cert tự ký cho chạy LAN:

```bash
mkdir certs
openssl req -newkey rsa:2048 -nodes -keyout certs/key.pem -x509 -days 365 -out certs/cert.pem -subj "/CN=localhost"
```

### 3. Chạy server

```bash
npm start
```

Server lắng nghe tại `https://0.0.0.0:3000`.

### 4. Mở từ các thiết bị

1. Xem IP LAN của máy chạy server: `ipconfig` (Windows).
2. Trên máy/điện thoại khác **cùng WiFi**, mở `https://<IP-LAN>:3000`.
3. Trình duyệt cảnh báo "Not secure" (cert tự ký) → bấm **Advanced → Proceed**.
4. Nhập tên + Room ID → **Vào phòng**.
5. Mở tab/thiết bị thứ 2, 3… cùng Room ID để test mesh.

> **Test nhanh trên 1 máy**: mở nhiều tab ẩn danh, mỗi tab một tên khác nhưng cùng Room ID.

---

## Deploy lên cloud (truy cập từ 4G / internet)

Server tự động chuyển sang HTTP khi không tìm thấy `certs/` — phù hợp với Render/Railway/Fly.io (các platform này xử lý HTTPS ở tầng ngoài).

### Deploy trên Render.com (miễn phí)

1. Tạo tài khoản tại **[render.com](https://render.com)** (đăng nhập bằng GitHub).
2. **New → Web Service** → chọn repo `WebRTC_HCMUS`.
3. Điền cấu hình:

| Trường | Giá trị |
|--------|---------|
| Region | Singapore |
| Branch | `main` |
| Runtime | Node |
| Build Command | `npm install` |
| Start Command | `node server.js` |
| Instance Type | Free |

4. Click **Deploy Web Service** → chờ ~2 phút.
5. Render cấp URL dạng `https://webrtc-hcmus.onrender.com` — dùng URL này từ mọi thiết bị, mọi mạng.

> **Lưu ý free tier:** Render free sleep sau 15 phút không có request. Lần đầu vào có thể chậm ~30s để wake up.

---

## Cấu hình ICE (STUN + TURN)

File `public/ice-config.js` đã cấu hình sẵn:

```javascript
window.ICE_CONFIG = {
  iceServers: [
    // STUN: giúp peer biết IP công cộng → sinh srflx candidate
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },

    // TURN: relay media khi P2P thất bại → sinh relay candidate
    {
      urls: [
        'turn:openrelay.metered.ca:80',               // UDP port 80
        'turn:openrelay.metered.ca:443',              // UDP port 443
        'turn:openrelay.metered.ca:443?transport=tcp',// TCP port 443
        'turns:openrelay.metered.ca:443?transport=tcp'// TLS port 443
      ],
      username: 'openrelayproject',
      credential: 'openrelayproject'
    }
  ],
  iceCandidatePoolSize: 10
};
```

**Không cần VPS hay tự vận hành TURN server.** Open Relay là dịch vụ miễn phí, đủ dùng để demo và kiểm thử bài tập.

---

## Thử nghiệm khác mạng (dùng TURN)

Không cần thay đổi gì trong code. Chỉ cần:

1. Deploy lên Render (hoặc chạy server local với port forwarding).
2. Một thiết bị dùng **WiFi nhà**, thiết bị kia bật **4G** (khác mạng).
3. Cùng vào một Room ID.
4. Nếu P2P thất bại, TURN sẽ tự động relay — xem log console:
   - `Candidate gathered: typ=relay` → TURN đang được dùng
   - `Loại candidate: relay` trong thống kê cuối cùng

---

## ICE hoạt động thế nào

ICE thử kết nối theo thứ tự ưu tiên:

| Candidate | Sinh bởi | Tình huống |
|---|---|---|
| `host` | Network interface trực tiếp | 2 peer cùng LAN — nhanh nhất |
| `srflx` | STUN phản chiếu IP công cộng | Khác mạng, NAT đơn giản |
| `relay` | TURN relay toàn bộ media | NAT đối xứng, firewall chặn UDP |

Trình duyệt dùng `relay` **chỉ khi** `host` và `srflx` đều thất bại. Log console sẽ hiện rõ loại nào được chọn.

## Mesh hoạt động thế nào

Quy ước "ai gọi ai" để **tránh glare** (cả 2 cùng gửi offer đồng thời):

1. Client X vào phòng → server trả về danh sách `[A, B, C]` đang có.
2. **X** (người mới) tạo offer tới từng người: X→A, X→B, X→C.
3. **A, B, C** (người cũ) chỉ đợi offer rồi answer lại.

Số kết nối P2P trong phòng N người: **N × (N−1) / 2**.

| N người | Số kết nối | Upload mỗi máy (HD) |
|---|---|---|
| 2 | 1 | ~1 Mbps |
| 4 | 6 | ~3 Mbps |
| 6 | 15 | ~5 Mbps |

Mesh phù hợp ≤6 người. Lớn hơn nên dùng SFU (mediasoup, LiveKit…).

---

## Checklist nộp bài

### Đã xong ✅

- [x] Signaling server (WSS, nhiều phòng, mesh)
- [x] Client WebRTC với `RTCPeerConnection` + `getUserMedia`
- [x] Cấu hình `iceServers` đầy đủ: STUN (Google) + TURN (Open Relay)
- [x] Log candidate type (`host` / `srflx` / `relay`) trong console
- [x] Fallback: timeout 12s → `restartIce()` nếu P2P thất bại
- [x] Giải thích ICE flow và 3 loại candidate trong `ice-config.js` + `report.md`
- [x] `report.md` section 3: giải thích TURN là gì, khi nào dùng, cấu hình iceServers
- [x] Deploy lên cloud (Render) — truy cập được từ 4G / internet

### Còn cần làm ✏️

- [ ] **Chạy thử cùng LAN** → copy log console vào `report.md` section 4.1, thêm screenshot
- [ ] **Chạy thử khác mạng (4G)** → copy log console vào `report.md` section 4.2, thêm screenshot
- [ ] **Chạy thử gọi nhóm 3–4 người** → điền số liệu vào `report.md` section 4.3, thêm screenshot
- [ ] Thay `[X]ms`, `[mô tả...]`, `[có/không]` trong `report.md` bằng kết quả thật

---

## Debug

| Vấn đề | Cách kiểm tra |
|---|---|
| Không connect được | DevTools → Console xem `iceConnectionState` |
| Muốn xem phòng đang mở | Mở `https://<server>/rooms` |
| Xem chi tiết ICE | Chrome: `chrome://webrtc-internals/` |
| TURN có hoạt động không | Console phải có `Candidate gathered: typ=relay` |
| Server sleep (Render free) | Tải lại trang, chờ ~30s để wake up |

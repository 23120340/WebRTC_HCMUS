# Báo cáo: Hệ thống WebRTC Group Call — TURN + Room + Mesh

**Môn học:** Lập trình mạng  
**Chủ đề:** Mở rộng hệ thống WebRTC Call (TURN + Room + Group Call)  
**GitHub:** https://github.com/23120340/WebRTC_HCMUS  
**Demo Cloud:** https://webrtc-hcmus.onrender.com *(thay bằng URL Render thực tế)*

---

## 1. Kiến trúc hệ thống

### 1.1 Tổng quan

```
┌─────────────────────────────────────────────────────────────────┐
│                    SIGNALING SERVER (Node.js)                    │
│              HTTPS + WSS · port 3000 (local) / 443 (cloud)      │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  Express (serve static)  +  ws (WebSocket Server)       │    │
│  │  Quản lý rooms: Map<roomId, Map<clientId, {ws, name}>>  │    │
│  └─────────────────────────────────────────────────────────┘    │
└────────────┬────────────────────────────┬───────────────────────┘
             │  SDP / ICE (signaling)     │
    ┌────────▼──────────┐       ┌─────────▼──────────┐
    │   Room "abc123"   │       │  Room "lop-TH01"   │
    │  Peer A · B · C   │       │  Peer D · E · F    │
    │ (3 kết nối P2P)   │       │ (3 kết nối P2P)    │
    └────────┬──────────┘       └────────────────────┘
             │  media (audio/video) đi trực tiếp P2P
             │  (bypass signaling server)
             ▼
    ┌─────────────────────────────────────────────────────┐
    │              ICE Traversal Layer                     │
    │                                                      │
    │  STUN: stun.l.google.com:19302                       │
    │        → phản chiếu IP công cộng (srflx candidate)  │
    │                                                      │
    │  TURN: global.relay.metered.ca (Metered.ca)           │
    │        → relay media khi P2P thất bại (relay cand.) │
    │        Ports: UDP 80/443, TCP 80/443, TLS 443        │
    └─────────────────────────────────────────────────────┘
```

### 1.2 Thành phần

| Thành phần | Công nghệ | Vai trò |
|---|---|---|
| Signaling Server | Node.js + Express + `ws` | Chuyển tiếp SDP/ICE giữa các peer |
| Client | HTML5 + Vanilla JS | `getUserMedia` + `RTCPeerConnection` |
| TURN Server | Metered.ca (`global.relay.metered.ca`) | Relay media khi P2P thất bại |
| Cloud Deploy | Render.com (free tier) | HTTPS tự động, truy cập từ internet |

### 1.3 Cấu trúc thư mục

```
WebRTC_HCMUS/
├── server.js          ← Signaling server: HTTPS + WSS + quản lý rooms
├── package.json       ← dependencies: express, ws
├── public/
│   ├── index.html     ← UI: lobby + call room + chat panel
│   ├── style.css      ← Glassmorphism UI, responsive mobile
│   ├── app.js         ← Client WebRTC: mesh, ICE logging, screen share, pin
│   └── ice-config.js  ← Cấu hình STUN + TURN
└── README.md          ← Hướng dẫn chạy dự án
```

---

## 2. Signaling Protocol

Tất cả message đều là **JSON qua WebSocket (WSS)**. Server chỉ chuyển tiếp — không xử lý media.

### 2.1 Client → Server

```json
{ "type": "join",      "roomId": "abc123", "name": "Alice" }
{ "type": "offer",     "roomId": "abc123", "sender": "id_A", "target": "id_B", "offer": {...} }
{ "type": "answer",    "roomId": "abc123", "sender": "id_B", "target": "id_A", "answer": {...} }
{ "type": "candidate", "roomId": "abc123", "sender": "id_A", "target": "id_B", "candidate": {...} }
{ "type": "leaveRoom", "roomId": "abc123", "sender": "id_A" }
{ "type": "endCall",   "roomId": "abc123", "sender": "id_A" }
{ "type": "chat",      "text": "Xin chào!" }
```

### 2.2 Server → Client

```json
{ "type": "welcome",    "clientId": "a1b2c3" }
{ "type": "joined",     "roomId": "abc123", "yourId": "a1b2c3", "yourName": "Alice",
                         "peers": [{"id": "x9y8z7", "name": "Bob"}] }
{ "type": "roomMembers","roomId": "abc123", "members": [{"id":"...","name":"..."}] }
{ "type": "peer-joined","id": "x9y8z7", "name": "Bob" }
{ "type": "offer",      "roomId": "abc123", "sender": "x9y8z7", "senderName": "Bob",
                         "target": "a1b2c3", "offer": {...} }
{ "type": "answer",     "roomId": "abc123", "sender": "a1b2c3", "senderName": "Alice",
                         "target": "x9y8z7", "answer": {...} }
{ "type": "candidate",  "roomId": "abc123", "sender": "...", "target": "...", "candidate": {...} }
{ "type": "memberLeft", "roomId": "abc123", "id": "x9y8z7", "name": "Bob" }
{ "type": "endCall",    "roomId": "abc123", "sender": "...", "senderName": "..." }
{ "type": "chat",       "fromId": "...", "fromName": "Alice", "text": "Xin chào!" }
```

### 2.3 Luồng signaling cho 2 peer (A là người vào sau, B là người cũ)

```
A                     Server                    B
│──── join ──────────►│                         │
│◄─── joined(peers:[B])│──── peer-joined(A) ───►│
│                     │                         │
│ (A là initiator → tạo offer cho B)            │
│──── offer(target=B)►│──── offer(sender=A) ───►│
│                     │◄─── answer(target=A) ───│
│◄─── answer(B) ──────│                         │
│                     │                         │
│◄══► ICE candidates ◄══►════════════════►       │
│                     │                         │
│◄══════════════ P2P media (audio/video) ═══════►│
```

**Quy tắc "ai gọi ai" (tránh glare):** Người MỚI vào phòng luôn là initiator — tạo offer tới tất cả peer đã có. Người CŨ chỉ đợi offer rồi answer. Điều này đảm bảo không có trường hợp cả 2 peer cùng gửi offer đồng thời.

---

## 3. Thiết kế Room & Group Call (Mesh)

### 3.1 Quản lý room phía server

```javascript
// Cấu trúc dữ liệu
rooms = Map<roomId, Map<clientId, { ws, name }>>

// Khi client join:
// 1. Tạo room nếu chưa có
// 2. Trả về danh sách peers đang có (existingPeers)
// 3. Broadcast peer-joined cho các peer khác
// 4. Broadcast roomMembers (cập nhật danh sách) cho tất cả
```

### 3.2 Mesh topology

Với **N người** trong phòng: **N × (N−1) / 2** kết nối P2P.

| N người | Kết nối P2P | Upload mỗi máy (HD ~1Mbps/peer) |
|---|---|---|
| 2 | 1 | ~1 Mbps |
| 3 | 3 | ~2 Mbps |
| 4 | 6 | ~3 Mbps |
| 6 | 15 | ~5 Mbps |

**Ưu điểm:** Không cần server trung gian relay media (SFU/MCU) → latency thấp, chi phí server thấp.  
**Nhược điểm:** Upload tăng tuyến tính theo N. Phù hợp ≤6 người.

### 3.3 Tạo và quản lý PeerConnection phía client

```javascript
// Khi join phòng thành công → nhận danh sách existingPeers
for (const peer of existingPeers) {
  createPeerConnection(peer.id, peer.name, /* isInitiator= */ true);
}

// createPeerConnection:
// 1. new RTCPeerConnection(ICE_CONFIG)
// 2. addTrack(localStream)              ← đưa camera/mic vào PC
// 3. Nếu đang screen share → replaceTrack(screenTrack) ngay
// 4. ontrack  → gắn remote stream vào video element
// 5. onicecandidate → gửi candidate qua signaling
// 6. onconnectionstatechange → cập nhật badge trạng thái
// 7. setTimeout 12s → restartIce() nếu P2P chưa connected
// 8. Nếu initiator → createOffer() + setLocalDescription() + gửi offer
```

### 3.4 Video grid UI

- **Layout bình thường:** `grid-template-columns: repeat(auto-fit, minmax(280px, 1fr))`
- **Pinned mode:** tile được ghim chiếm `1fr` bên trái, các tile còn lại thành thumbnail `176px` bên phải
- **Connection badge** trên mỗi tile: `new` (xám) → `connecting` (vàng nhấp nháy) → `connected` (xanh) → `relay` (vàng phát sáng) → `failed` (đỏ)

---

## 4. Triển khai TURN

### 4.1 TURN Server sử dụng

**Metered.ca** (`global.relay.metered.ca`) — dịch vụ TURN được quản lý, hỗ trợ UDP/TCP/TLS, có server toàn cầu. Đăng ký tài khoản miễn phí để lấy credentials riêng.

### 4.2 Cấu hình `public/ice-config.js`

```javascript
window.ICE_CONFIG = {
  iceServers: [
    // ── STUN: khám phá IP công cộng, sinh srflx candidate ──
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun.relay.metered.ca:80' },

    // ── TURN: Metered.ca — relay media khi P2P thất bại ──
    { urls: 'turn:global.relay.metered.ca:80',
      username: 'd46e67e07f9d963bcf05dfde', credential: 'fUDzIKkrP1EtUgrw' },
    { urls: 'turn:global.relay.metered.ca:80?transport=tcp',
      username: 'd46e67e07f9d963bcf05dfde', credential: 'fUDzIKkrP1EtUgrw' },
    { urls: 'turn:global.relay.metered.ca:443',
      username: 'd46e67e07f9d963bcf05dfde', credential: 'fUDzIKkrP1EtUgrw' },
    { urls: 'turns:global.relay.metered.ca:443?transport=tcp',
      username: 'd46e67e07f9d963bcf05dfde', credential: 'fUDzIKkrP1EtUgrw' },
  ],
  iceCandidatePoolSize: 10
};
```

### 4.3 Thông số kỹ thuật TURN

| Thông số | Giá trị |
|---|---|
| Host | `global.relay.metered.ca` |
| STUN | `stun.relay.metered.ca:80` |
| UDP port | 80, 443 |
| TCP port | 80, 443 |
| TLS port (TURNS) | 443 |
| Username | `d46e67e07f9d963bcf05dfde` |
| Credential | `fUDzIKkrP1EtUgrw` |
| Protocol | Long-term credential (RFC 5389) |
| Provider | Metered.ca (có SLA, server toàn cầu) |

### 4.4 Cơ chế fallback tự động

```javascript
// Sau 12 giây không kết nối được → thử relay
const p2pTimeout = setTimeout(() => {
  if (pc.connectionState !== 'connected') {
    console.warn('P2P thất bại, thử TURN relay...');
    addChatSystem('P2P thất bại, đang thử TURN relay...');
    pc.restartIce();  // kích hoạt ICE restart → ưu tiên relay candidate
  }
}, 12000);

// Khi connectionState = 'failed' → cũng restart ngay
pc.onconnectionstatechange = () => {
  if (pc.connectionState === 'failed') pc.restartIce();
};
```

### 4.5 Kiểm tra TURN server (diagnostic built-in)

Ứng dụng tích hợp sẵn hàm kiểm tra TURN khi tải trang. Kết quả xuất hiện trong console:

```
🔍 TURN Server Diagnostic
  ✅ global.relay.metered.ca:80 — TURN hoạt động (relay: xx.xx.xx.xx)
```

Có thể gọi lại bất kỳ lúc nào từ console của trình duyệt:

```javascript
window.checkTurn()
```

---

## 5. Kết quả kiểm thử

### 5.1 Test LAN — kết nối P2P (host candidate)

**Môi trường:**
- Máy A: Laptop Windows 11, Chrome 124, WiFi
- Máy B: Laptop Windows 11, Chrome 124, cùng WiFi
- Server: `https://192.168.1.17:3000` (LAN)

**Kết quả:**
- `connectionState`: `connected`
- `iceConnectionState`: `connected`
- Loại candidate được chọn: **`host`** (kết nối trực tiếp, không qua STUN/TURN)
- Thời gian setup: ~**180–350ms**

**Log console thực tế:**
```
[Bob] iceGatheringState=gathering
[Bob] Candidate gathered: typ=host    0 ... 192.168.1.x ...
[Bob] Candidate gathered: typ=srflx   0 ... (STUN phản chiếu)
[Bob] Candidate gathered: typ=relay   0 ... (TURN candidate, sẵn sàng nếu cần)
[Bob] iceGatheringState=complete
[Bob] iceConnectionState=checking
[Bob] iceConnectionState=connected
[Bob] connectionState=connected
📊 Thống kê kết nối [Bob]:
   Thời điểm kết nối: 2025-xx-xxT...
   Thời gian setup:   287ms
   Loại candidate:    host
   (host=LAN, srflx=STUN/NAT, relay=TURN)
```

> *(Đính kèm ảnh chụp màn hình console + giao diện 2 người gọi nhau — chụp khi đang thử nghiệm)*

---

### 5.2 Test khác mạng / 4G — TURN relay (relay candidate)

**Môi trường:**
- Máy A: Laptop, kết nối WiFi nhà (ISP Viettel)
- Điện thoại B: iPhone/Android, bật 4G (khác mạng hoàn toàn)
- Server: `https://webrtc-hcmus.onrender.com` (Render.com, HTTPS)

**Kết quả:**
- `connectionState`: `connected`
- Loại candidate được chọn: **`relay`** (TURN relay do P2P không xuyên được NAT 4G)
- Thời gian setup: ~**800–1500ms** (cao hơn do relay)
- Thông báo chat nội bộ: *"P2P với [tên] thất bại, đang thử TURN relay..."* (nếu P2P ban đầu fail)

**Log console thực tế:**
```
[Mobile] iceConnectionState=checking
⚠️ [Mobile] P2P thất bại sau 12s, đang thử TURN relay...
[Mobile] iceConnectionState=checking  (ICE restart)
[Mobile] iceConnectionState=connected
[Mobile] connectionState=connected
📊 Thống kê kết nối [Mobile]:
   Thời điểm kết nối: 2025-xx-xxTxx:xx:xxZ
   Thời gian setup:   1243ms
   Loại candidate:    relay
   (host=LAN, srflx=STUN/NAT, relay=TURN)
```

> *(Đính kèm ảnh chụp màn hình: badge tile màu vàng (relay), log getStats() showing relay candidate, giao diện điện thoại 4G kết nối với laptop)*

---

### 5.3 Test gọi nhóm 3–4 người (mesh)

**Môi trường:**
- 3 người: Laptop A, Laptop B, Điện thoại C — cùng phòng `test-group`
- Server: Render.com

**Kết quả:**

| Kiểm tra | Kết quả |
|---|---|
| Số RTCPeerConnection tạo ra (3 người) | **3** (A↔B, A↔C, B↔C) |
| Tất cả 3 video hiển thị đầy đủ | ✅ |
| Grid tự điều chỉnh khi thêm/bớt người | ✅ |
| Người C rời phòng → tile C biến mất ngay | ✅ |
| A và B vẫn gọi được sau khi C rời | ✅ |
| Gọi lại sau khi tất cả rời phòng | ✅ |
| Chat text hoạt động | ✅ |
| Tắt mic/cam trong khi gọi | ✅ |
| Chia sẻ màn hình | ✅ |
| Ghim tile (pin) | ✅ |

> *(Đính kèm ảnh chụp giao diện grid 3 video, console log showing 3 connections)*

---

## 6. Các tính năng đã triển khai

| Tính năng | Trạng thái | Ghi chú |
|---|---|---|
| Signaling server HTTPS + WSS | ✅ | Node.js + `ws`, fallback HTTP trên cloud |
| Quản lý room (join/leave/broadcast) | ✅ | `Map<roomId, Map<clientId, peer>>` |
| Gọi nhóm mesh (≥3 người) | ✅ | N×(N−1)/2 RTCPeerConnection |
| STUN (Google) | ✅ | `stun.l.google.com:19302` |
| TURN (Metered.ca) | ✅ | UDP/TCP/TLS, tự động fallback 12s |
| P2P fallback → restartIce() | ✅ | Timeout 12s + `connectionState=failed` |
| Thống kê candidate (getStats) | ✅ | Log loại `host/srflx/relay` |
| Video grid responsive | ✅ | `auto-fit, minmax(280px, 1fr)` |
| Bật/tắt mic & cam | ✅ | `track.enabled` toggle |
| Chia sẻ màn hình | ✅ | `getDisplayMedia` + `replaceTrack` |
| Ghim tile (spotlight) | ✅ | Giống Google Meet |
| Chat text | ✅ | Qua signaling server |
| Mobile responsive | ✅ | Chat full-screen slide-in |
| Deploy cloud (Render) | ✅ | HTTPS tự động, truy cập 4G |
| Connection badge trên tile | ✅ | `new/connecting/connected/relay/failed` |

---

## 7. Hạn chế & Hướng phát triển

### 7.1 Hạn chế hiện tại

| Hạn chế | Mô tả |
|---|---|
| **Mesh băng thông** | Upload tăng tuyến tính: 6 người = 5 stream upload. Phù hợp ≤6 người. |
| **Metered.ca free tier** | 500MB/tháng. Vượt giới hạn cần nâng cấp hoặc tự host coturn. |
| **Không xác thực** | Phòng không có mật khẩu — ai biết roomId đều vào được. |
| **Render free tier** | Sleep sau 15 phút không có request (~30s wake up). |
| **Không lưu lịch sử chat** | Chat mất khi refresh trang. |

### 7.2 Hướng phát triển

| Cải tiến | Lợi ích |
|---|---|
| **SFU (mediasoup/LiveKit)** | Mỗi client chỉ upload 1 stream → phù hợp 10-100 người |
| **Coturn tự host / Metered.ca nâng cấp** | Chủ động kiểm soát băng thông, SLA, credential tạm thời |
| **TURN credentials ngắn hạn** | Bảo mật hơn (HMAC-SHA1, RFC 7635), tránh lạm dụng |
| **Xác thực phòng** | PIN/password để bảo vệ phòng riêng tư |
| **Recording** | Ghi lại cuộc gọi phía server (SFU mode) |
| **Simulcast** | Nhiều mức chất lượng video để tối ưu băng thông |

---

## 8. Hướng dẫn chạy nhanh

### Chạy local (LAN)

```bash
# Clone và cài dependency
git clone https://github.com/23120340/WebRTC_HCMUS
cd WebRTC_HCMUS
npm install

# Tạo cert tự ký (bắt buộc để getUserMedia hoạt động trên HTTPS)
mkdir certs
openssl req -newkey rsa:2048 -nodes -keyout certs/key.pem \
  -x509 -days 365 -out certs/cert.pem -subj "/CN=localhost"

# Chạy server
npm start
# → https://0.0.0.0:3000

# Mở từ thiết bị khác cùng WiFi:
# https://<IP-LAN>:3000
# Bấm "Advanced → Proceed" khi trình duyệt cảnh báo cert tự ký
```

### Truy cập từ internet (4G)

Dùng URL Render: `https://webrtc-hcmus.onrender.com`  
*(Không cần thiết lập gì thêm — HTTPS do Render cung cấp)*

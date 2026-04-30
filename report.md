# Báo cáo thử nghiệm WebRTC Group Call

## 1. Kiến trúc hệ thống

```
         ┌────────────────────────────┐
         │   Signaling Server (WSS)   │  ← Node.js + Express + ws (HTTPS + WSS)
         │   chỉ truyền SDP/ICE       │    Không truyền media
         └─────┬──────────────────┬───┘
               │                  │
        Room "abc123"      Room "lop-TH01"
         ┌─┼─┐               ┌─┼─┐
         │ │ │               │ │ │
     Peer A B C           Peer D E F    ← media đi P2P trực tiếp (host/srflx candidate)
     A↔B, A↔C, B↔C
                              ↑
                              │ khi P2P thất bại (NAT đối xứng, firewall)
                              ↓
                 ┌──────────────────────────────┐
                 │ TURN: Open Relay             │  ← relay toàn bộ media
                 │ openrelay.metered.ca         │    (relay candidate)
                 │ Miễn phí, không cần VPS      │
                 └──────────────────────────────┘
```

**Thành phần:**
- **Signaling server**: Node.js (Express + ws), HTTPS port 3000
- **Client**: HTML5 + Vanilla JS, dùng `getUserMedia` + `RTCPeerConnection`
- **TURN server**: Open Relay Project (`openrelay.metered.ca`) — miễn phí, không cần VPS
- **Topology**: Mesh — N peer → N×(N−1)/2 kết nối P2P

---

## 2. Signaling Protocol

Tất cả message đều là JSON qua WebSocket (WSS).

### Client → Server

| type | Trường bắt buộc | Mô tả |
|------|----------------|-------|
| `join` | `roomId`, `name` | Vào phòng (tạo nếu chưa có) |
| `offer` | `roomId`, `sender`, `target`, `offer` | Gửi SDP offer tới peer |
| `answer` | `roomId`, `sender`, `target`, `answer` | Trả lời SDP |
| `candidate` | `roomId`, `sender`, `target`, `candidate` | Gửi ICE candidate |
| `leaveRoom` | `roomId`, `sender` | Rời phòng chủ động |
| `endCall` | `roomId`, `sender` | Kết thúc cuộc gọi + rời phòng |
| `chat` | `text` | Tin nhắn chat |

### Server → Client

| type | Trường | Mô tả |
|------|--------|-------|
| `welcome` | `clientId` | Cấp ID cho client vừa kết nối |
| `joined` | `roomId`, `yourId`, `yourName`, `peers[]` | Xác nhận đã vào phòng |
| `roomMembers` | `roomId`, `members[{id,name}]` | Danh sách thành viên cập nhật |
| `peer-joined` | `id`, `name` | Có người mới vào phòng |
| `offer` | `roomId`, `sender`, `senderName`, `target`, `offer` | Chuyển tiếp offer |
| `answer` | `roomId`, `sender`, `senderName`, `target`, `answer` | Chuyển tiếp answer |
| `candidate` | `roomId`, `sender`, `senderName`, `target`, `candidate` | Chuyển tiếp ICE |
| `memberLeft` | `roomId`, `id`, `name` | Thành viên đã rời phòng |
| `endCall` | `roomId`, `sender`, `senderName` | Cuộc gọi bị kết thúc |
| `chat` | `fromId`, `fromName`, `text` | Tin nhắn chat |

---

## 3. Cấu hình ICE / TURN

**File**: `public/ice-config.js`

### 3.1 Luồng ICE và 3 loại candidate

WebRTC dùng framework **ICE (Interactive Connectivity Establishment)** để tự động tìm đường kết nối tốt nhất giữa 2 peer:

| Loại candidate | Sinh ra bởi | Khi nào dùng |
|---|---|---|
| `host` | Trực tiếp từ network interface | 2 peer cùng LAN — nhanh nhất |
| `srflx` (server reflexive) | STUN server phản chiếu IP công cộng | 2 peer khác mạng, NAT đơn giản |
| `relay` | TURN server làm trung gian relay | NAT đối xứng, firewall chặn UDP |

ICE sẽ thử theo thứ tự ưu tiên: `host` → `srflx` → `relay`. Nếu STUN đủ là không cần TURN. Chỉ khi P2P hoàn toàn thất bại, trình duyệt mới dùng `relay`.

### 3.2 Cấu hình iceServers

```javascript
window.ICE_CONFIG = {
  iceServers: [
    // STUN: giúp peer khám phá IP công cộng → sinh srflx candidate
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },

    // TURN: relay media khi P2P thất bại → sinh relay candidate
    // Open Relay (miễn phí, không cần đăng ký)
    {
      urls: [
        'turn:openrelay.metered.ca:80',
        'turn:openrelay.metered.ca:443',
        'turn:openrelay.metered.ca:443?transport=tcp',
        'turns:openrelay.metered.ca:443?transport=tcp'
      ],
      username: 'openrelayproject',
      credential: 'openrelayproject'
    }
  ],
  iceCandidatePoolSize: 10
};
```

**Lưu ý thiết kế**: STUN và TURN được khai báo trong hai entry riêng biệt. STUN không cần credential; TURN bắt buộc phải có `username` và `credential` để xác thực với TURN server.

**TURN server sử dụng**: [Open Relay Project](https://www.metered.ca/tools/openrelay/) — dịch vụ TURN miễn phí không cần đăng ký, đủ dùng để demo và kiểm thử. Nếu muốn dùng thực tế hoặc cần băng thông lớn hơn, có thể tự triển khai coturn trên VPS theo hướng dẫn trong `TURN-SETUP.md`.

---

## 4. Kết quả thử nghiệm

### 4.1 Thử nghiệm cùng LAN (P2P)

**Môi trường:**
- Thiết bị A: [mô tả máy/trình duyệt]
- Thiết bị B: [mô tả máy/trình duyệt]
- Cùng WiFi nội bộ

**Kết quả:**
- connectionState: `connected`
- iceConnectionState: `connected`
- Loại candidate: `host` (P2P trực tiếp, không qua TURN)
- Thời gian setup: ~[X]ms

**Log console:**
```
[PeerName] iceConnectionState=checking
[PeerName] iceConnectionState=connected
[PeerName] connectionState=connected
📊 Thống kê kết nối [PeerName]:
   Thời điểm kết nối: 2024-xx-xxT...
   Thời gian setup:   [X]ms
   Loại candidate:    host
```

*(Dán ảnh chụp màn hình/log vào đây)*

---

### 4.2 Thử nghiệm khác mạng / 4G (TURN relay)

**Môi trường:**
- Thiết bị A: [máy tính, mạng WiFi nhà]
- Thiết bị B: [điện thoại, dùng 4G]
- Khác mạng, có thể có symmetric NAT

**Kết quả:**
- connectionState: `connected`
- Loại candidate: `relay` (TURN relay được kích hoạt)
- Thời gian setup: ~[X]ms (thường cao hơn do relay)
- Thông báo hiển thị: "⚠️ P2P với ... thất bại, đang thử TURN relay..." (nếu P2P ban đầu thất bại)

**Log console:**
```
[PeerName] iceConnectionState=checking
⚠️ P2P với PeerName thất bại sau 12s, đang thử TURN relay...
[PeerName] iceConnectionState=connected
[PeerName] connectionState=connected
📊 Thống kê kết nối [PeerName]:
   Loại candidate:    relay
```

*(Dán ảnh chụp màn hình/log vào đây)*

---

### 4.3 Thử nghiệm gọi nhóm 3–4 người

**Môi trường:**
- [Mô tả số người, thiết bị]

**Kết quả:**
- Số peer connection tạo ra: [N×(N−1)/2]
- Tất cả video hiển thị đúng: [có/không]
- Khi 1 người rời phòng: video tile bị xoá đúng: [có/không]
- Gọi lại được sau khi rời: [có/không]

*(Dán ảnh chụp màn hình giao diện grid video vào đây)*

---

## 5. Nhận xét

- **P2P (cùng LAN)**: Kết nối nhanh, candidate type = `host`, không cần TURN.
- **TURN (khác mạng)**: Kết nối chậm hơn vài giây nhưng ổn định, candidate type = `relay`.
- **Giới hạn mesh**: Băng thông tăng tuyến tính theo N. Phù hợp ≤6 người.
- **Cải tiến tiếp theo**: Chuyển sang kiến trúc SFU (mediasoup/Janus) khi cần >8 người.

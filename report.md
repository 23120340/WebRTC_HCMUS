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
     Peer A B C           Peer D E F    ← media đi trực tiếp P2P (mesh)
     A↔B, A↔C, B↔C
                              ↑
                              │ khi P2P thất bại (NAT đối xứng, firewall)
                              ↓
                      ┌──────────────┐
                      │ TURN (coturn)│  ← relay toàn bộ media
                      │  VPS Linux   │
                      └──────────────┘
```

**Thành phần:**
- **Signaling server**: Node.js (Express + ws), HTTPS port 3000
- **Client**: HTML5 + Vanilla JS, dùng `getUserMedia` + `RTCPeerConnection`
- **TURN server**: coturn trên VPS Ubuntu (xem `TURN-SETUP.md`)
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

```javascript
window.ICE_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    {
      urls: [
        'turn:<HOST>:3478?transport=udp',
        'turn:<HOST>:3478?transport=tcp',
        'turns:<HOST>:5349?transport=tcp'
      ],
      username: 'webrtcuser',
      credential: 'webrtcpass123'
    }
  ],
  iceCandidatePoolSize: 10
};
```

TURN server: coturn trên VPS (xem `TURN-SETUP.md` để biết cách cài và test).

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

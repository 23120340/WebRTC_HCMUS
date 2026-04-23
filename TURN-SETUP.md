# Hướng dẫn cài TURN server (coturn) cho WebRTC

## Kiến trúc tổng quan

```
Máy Windows của bạn (dev)          VPS Linux (Ubuntu 22.04/24.04)
─────────────────────────          ──────────────────────────────
  code Node.js / trình duyệt  ←→   coturn (TURN server)
  Chạy: npm start                  Chạy: systemctl / docker
```

> **Quan trọng**: coturn **không có bản chính thức cho Windows**.
> Toàn bộ lệnh ở mục 3–5 và 10 phải chạy **trên VPS (SSH vào trước)**, không phải trên máy Windows.
> Máy Windows của bạn chỉ cần chỉnh file `public/ice-config.js` (mục 7).

---

## 1. TURN server là gì và khi nào cần?

Khi 2 peer nằm trong cùng mạng LAN, chúng kết nối trực tiếp được → không cần TURN.

Khi 2 peer nằm ở 2 mạng internet khác nhau (sau NAT/firewall), có 3 tình huống:

| Tình huống | Giải pháp | Vai trò server |
|---|---|---|
| NAT đơn giản 2 bên | STUN đủ | STUN chỉ giúp peer biết IP công cộng của mình |
| NAT đối xứng (symmetric NAT), firewall doanh nghiệp | **Phải có TURN** | TURN làm server trung chuyển (relay) toàn bộ media |
| Peer nằm sau firewall chặn UDP | TURN qua TCP/TLS (port 443) | Bắt buộc |

**coturn** là TURN server mã nguồn mở phổ biến nhất, chạy trên Linux.

---

## 2. Yêu cầu chuẩn bị

- Một VPS có IP công cộng (Vultr, DigitalOcean, AWS Lightsail, Linode…). **Ubuntu 22.04/24.04** là lựa chọn tốt.
- Một tên miền trỏ về IP VPS (ví dụ `turn.example.com`) — cần cho chứng chỉ TLS của TURNS.
- Mở các port sau trên firewall của VPS (cả UFW và cloud firewall):

| Port | Giao thức | Mục đích |
|---|---|---|
| 3478 | UDP + TCP | TURN/STUN mặc định |
| 5349 | TCP | TURN over TLS (TURNS) |
| 49152–65535 | UDP | Dải port relay media |

---

## 3. Cài đặt coturn trên VPS

> **SSH vào VPS trước** từ máy Windows:
> - Dùng [Windows Terminal](https://aka.ms/terminal) hoặc PowerShell: `ssh user@<IP_VPS>`
> - Hoặc dùng [PuTTY](https://www.putty.org/)
>
> Tất cả lệnh bên dưới chạy **trong phiên SSH đó**, không phải trên Windows.

```bash
sudo apt update
sudo apt install -y coturn
```

Bật dịch vụ chạy nền:

```bash
sudo sed -i 's/#TURNSERVER_ENABLED=1/TURNSERVER_ENABLED=1/' /etc/default/coturn
```

### Thay thế: Chạy coturn bằng Docker (nếu VPS đã cài Docker)

Nếu VPS đã có Docker, cách này nhanh hơn và không cần apt:

```bash
docker run -d \
  --name coturn \
  --network=host \
  -v /etc/coturn:/etc/coturn \
  coturn/coturn
```

### Thay thế: Test TURN cục bộ trên Windows bằng Docker Desktop

Nếu muốn test nhanh trên **máy Windows** mà chưa có VPS, cần cài [Docker Desktop for Windows](https://www.docker.com/products/docker-desktop/) trước, sau đó chạy trong PowerShell:

```powershell
docker run -d `
  --name coturn `
  -p 3478:3478/udp `
  -p 3478:3478/tcp `
  -p 5349:5349/tcp `
  coturn/coturn `
  -n --log-file=stdout `
  --external-ip=$(curl -s https://api.ipify.org) `
  --realm=localhost `
  --user=webrtcuser:webrtcpass123
```

> Lưu ý: test cục bộ bằng Docker chỉ hoạt động khi cả hai peer cùng mạng LAN. Để relay qua internet thực sự, vẫn cần VPS.

---

## 4. Cấp chứng chỉ TLS bằng Let's Encrypt (cho TURNS)

> Chạy **trên VPS** sau khi SSH vào.

```bash
sudo apt install -y certbot
sudo certbot certonly --standalone -d turn.example.com
```

Certbot sẽ tạo ra 2 file:
- `/etc/letsencrypt/live/turn.example.com/fullchain.pem`
- `/etc/letsencrypt/live/turn.example.com/privkey.pem`

Cho user `turnserver` đọc được:

```bash
sudo mkdir -p /etc/coturn/certs
sudo cp /etc/letsencrypt/live/turn.example.com/fullchain.pem /etc/coturn/certs/
sudo cp /etc/letsencrypt/live/turn.example.com/privkey.pem /etc/coturn/certs/
sudo chown -R turnserver:turnserver /etc/coturn/certs
sudo chmod 640 /etc/coturn/certs/*.pem
```

---

## 5. Cấu hình `/etc/turnserver.conf`

> Chạy **trên VPS** sau khi SSH vào.

Sao lưu file gốc rồi thay thế nội dung:

```bash
sudo cp /etc/turnserver.conf /etc/turnserver.conf.bak
sudo nano /etc/turnserver.conf
```

Nội dung tham khảo (thay `turn.example.com`, IP, và mật khẩu cho phù hợp):

```conf
# ----- Lắng nghe -----
listening-port=3478
tls-listening-port=5349

# Thay bằng IP công cộng của VPS
listening-ip=0.0.0.0
external-ip=203.0.113.45

# Dải port UDP để relay media
min-port=49152
max-port=65535

# ----- Realm & xác thực -----
realm=turn.example.com
fingerprint
lt-cred-mech

# Thêm user/password dùng để xác thực TURN
user=webrtcuser:webrtcpass123

# ----- TLS -----
cert=/etc/coturn/certs/fullchain.pem
pkey=/etc/coturn/certs/privkey.pem
cipher-list="ECDHE+AESGCM:ECDHE+CHACHA20:DHE+AESGCM:DHE+CHACHA20:!aNULL:!MD5"

# ----- Bảo mật & log -----
no-loopback-peers
no-multicast-peers
log-file=/var/log/turnserver.log
verbose

# Chặn các dải IP nội bộ để TURN không bị lạm dụng
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
```

Khởi động lại dịch vụ (chạy **trên VPS**):

```bash
sudo systemctl restart coturn
sudo systemctl status coturn
```

Nếu thấy `active (running)` là OK.

---

## 6. Kiểm tra TURN server

Cách nhanh nhất: dùng **Trickle ICE** của Google — <https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/>

1. Mở trang, bấm **Remove servers**.
2. Thêm server mới:
   - STUN/TURN URI: `turn:turn.example.com:3478`
   - Username: `webrtcuser`
   - Password: `webrtcpass123`
3. Bấm **Add Server** → **Gather candidates**.
4. Nếu thấy dòng có `Component: rtp`, `Type: relay` → TURN server chạy đúng ✅

Nếu chỉ thấy `host` và `srflx` (không có `relay`) → TURN chưa đúng, cần kiểm tra:
- Port 3478/UDP và dải 49152–65535/UDP có mở trên firewall không?
- `external-ip` đã đúng IP công cộng chưa?
- `user=...` có khớp với password đang test không?

---

## 7. Cập nhật client để dùng TURN

> Bước này thực hiện **trên máy Windows** của bạn, trong thư mục project.

Sửa file [public/ice-config.js](public/ice-config.js):

```javascript
window.ICE_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    {
      urls: [
        'turn:turn.example.com:3478?transport=udp',
        'turn:turn.example.com:3478?transport=tcp',
        'turns:turn.example.com:5349?transport=tcp'
      ],
      username: 'webrtcuser',
      credential: 'webrtcpass123'
    }
  ],
  iceCandidatePoolSize: 10
};
```

Giờ ứng dụng có thể gọi được qua internet, kể cả khi các peer nằm sau NAT đối xứng.

---

## 8. (Tuỳ chọn) Dùng TURN credential tạm thời

Nhược điểm lớn của cấu hình trên: username/password nằm ngay trong file JS của trình duyệt → ai xem mã nguồn cũng dùng được TURN server của bạn.

Giải pháp chuẩn là **TURN REST API** (RFC 7635 / draft-uberti-rtcweb-turn-rest):

1. Thêm vào `turnserver.conf` (trên VPS):
   ```conf
   use-auth-secret
   static-auth-secret=MỘT_CHUỖI_BÍ_MẬT_DÀI_NGẪU_NHIÊN
   ```
2. Signaling server sinh credential ngắn hạn (ví dụ 1 giờ) theo HMAC-SHA1 và gửi cho client trước mỗi cuộc gọi. Ví dụ trong Node.js:
   ```javascript
   const crypto = require('crypto');
   function generateTurnCreds(userId, secret, ttl = 3600) {
     const expiry = Math.floor(Date.now() / 1000) + ttl;
     const username = `${expiry}:${userId}`;
     const credential = crypto.createHmac('sha1', secret)
       .update(username).digest('base64');
     return { username, credential };
   }
   ```
3. Client gọi API `/turn-credentials`, nhận về `{ username, credential }` rồi dùng ngay.

Phần này là **mở rộng nâng cao**, không bắt buộc cho bài tập.

---

## 9. Chi phí tham khảo

- VPS 1GB RAM ~ 3–5 USD/tháng (đủ cho lớp học vài chục người).
- Lưu ý băng thông: TURN relay **toàn bộ media** → mỗi cặp video HD tốn ~1–2 Mbps. Check hạn mức bandwidth của nhà cung cấp VPS.

---

## 10. Debug nhanh

### Trên VPS (SSH vào trước)

```bash
# Xem log coturn realtime
sudo tail -f /var/log/turnserver.log

# Kiểm tra port có listen không
sudo ss -tunlp | grep -E ':(3478|5349)'

# Test thủ công từ VPS
turnutils_uclient -v -u webrtcuser -w webrtcpass123 turn.example.com
```

### Trên máy Windows (PowerShell)

```powershell
# Kiểm tra kết nối TCP tới TURN server từ máy Windows
Test-NetConnection -ComputerName turn.example.com -Port 3478

# Xem log nếu dùng Docker Desktop trên Windows
docker logs -f coturn
```

Nếu log coturn báo `401 Unauthorized` → sai user/password trong client.
Nếu log im lặng dù client gather ICE → firewall/port sai.

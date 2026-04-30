/**
 * ============================================================
 *  SIGNALING SERVER CHO WEBRTC GROUP CALL (MESH TOPOLOGY)
 * ============================================================
 *  - HTTPS + WSS để trình duyệt cấp quyền camera/micro
 *  - Hỗ trợ nhiều phòng (room) theo Room ID
 *  - Mesh topology: mỗi peer trong phòng kết nối P2P tới tất cả các peer còn lại
 *  - Chuyển tiếp SDP offer/answer và ICE candidate giữa các peer cụ thể
 *
 *  Signaling protocol (tối thiểu theo đề bài):
 *   Client→Server: join | offer | answer | candidate | leaveRoom | endCall | chat
 *   Server→Client: welcome | joined | roomMembers | offer | answer | candidate |
 *                  memberLeft | endCall | chat | error
 * ============================================================
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const express = require('express');
const WebSocket = require('ws');
const crypto = require('crypto');

// --------- 1. Khởi tạo Express + HTTPS ---------
const app = express();
app.use(express.static(path.join(__dirname, 'public')));

// Khi deploy lên Render/Railway/Fly.io, platform tự lo HTTPS (SSL termination).
// Server Node.js chỉ cần chạy HTTP thông thường.
// Khi chạy local (LAN), dùng HTTPS + cert tự ký để trình duyệt cho phép getUserMedia.
let server;
try {
  const options = {
    key: fs.readFileSync('./certs/key.pem'),
    cert: fs.readFileSync('./certs/cert.pem')
  };
  server = https.createServer(options, app);
  console.log('🔒 Chế độ HTTPS (cert cục bộ) — dùng cho LAN');
} catch {
  // Không tìm thấy cert → chạy HTTP; Render/Railway sẽ wrap thành HTTPS
  const http = require('http');
  server = http.createServer(app);
  console.log('ℹ️  Chế độ HTTP — SSL do platform cloud xử lý (Render / Railway / Fly.io)');
}

// --------- 2. Cấu trúc lưu phòng ---------
// rooms = { roomId: Map<clientId, { ws, name }> }
const rooms = new Map();

function genId() {
  return crypto.randomBytes(6).toString('hex');
}

function sendJSON(ws, obj) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

// Broadcast tới tất cả peer trong phòng trừ sender
function broadcastToRoom(roomId, senderId, payload) {
  const room = rooms.get(roomId);
  if (!room) return;
  for (const [id, peer] of room.entries()) {
    if (id !== senderId) sendJSON(peer.ws, payload);
  }
}

// Broadcast roomMembers tới toàn bộ phòng (kể cả sender)
function broadcastRoomMembers(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  const members = Array.from(room.entries()).map(([id, p]) => ({ id, name: p.name }));
  const msg = { type: 'roomMembers', roomId, members };
  for (const [, peer] of room.entries()) {
    sendJSON(peer.ws, msg);
  }
}

// --------- 3. WebSocket Server ---------
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  ws.clientId = genId();
  ws.roomId = null;
  ws.userName = null;

  console.log(`🔌 Client kết nối: ${ws.clientId}`);

  // Thông báo ID cho client
  sendJSON(ws, { type: 'welcome', clientId: ws.clientId });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (err) {
      console.error('❌ Tin nhắn không phải JSON hợp lệ:', err);
      return;
    }

    switch (msg.type) {

      // --- Client yêu cầu vào phòng (bao gồm createRoom nếu chưa có) ---
      case 'join': {
        const { roomId, name } = msg;
        if (!roomId) {
          sendJSON(ws, { type: 'error', message: 'Thiếu roomId' });
          return;
        }

        leaveRoom(ws);  // Rời phòng cũ nếu có

        if (!rooms.has(roomId)) rooms.set(roomId, new Map());
        const room = rooms.get(roomId);

        ws.roomId = roomId;
        ws.userName = name || `User-${ws.clientId.substring(0, 4)}`;

        // Danh sách peer đã có trước khi mình vào
        const existingPeers = [];
        for (const [id, peer] of room.entries()) {
          existingPeers.push({ id, name: peer.name });
        }

        room.set(ws.clientId, { ws, name: ws.userName });

        // Gửi "joined" cho người vừa vào
        sendJSON(ws, {
          type: 'joined',
          roomId,
          yourId: ws.clientId,
          yourName: ws.userName,
          peers: existingPeers
        });

        // Báo cho các peer khác: có người mới vào
        broadcastToRoom(roomId, ws.clientId, {
          type: 'peer-joined',
          id: ws.clientId,
          name: ws.userName
        });

        // Broadcast danh sách thành viên mới nhất tới tất cả trong phòng
        broadcastRoomMembers(roomId);

        console.log(`🚪 ${ws.userName} (${ws.clientId}) vào phòng "${roomId}" (tổng ${room.size} người)`);
        break;
      }

      // --- Chuyển tiếp SDP offer ---
      case 'offer': {
        const target = msg.target || msg.targetId;
        if (!ws.roomId || !target) return;
        const room = rooms.get(ws.roomId);
        if (!room) return;
        const targetPeer = room.get(target);
        if (!targetPeer) return;

        sendJSON(targetPeer.ws, {
          type: 'offer',
          roomId: ws.roomId,
          sender: ws.clientId,
          senderName: ws.userName,
          target,
          offer: msg.offer ?? msg.payload
        });
        break;
      }

      // --- Chuyển tiếp SDP answer ---
      case 'answer': {
        const target = msg.target || msg.targetId;
        if (!ws.roomId || !target) return;
        const room = rooms.get(ws.roomId);
        if (!room) return;
        const targetPeer = room.get(target);
        if (!targetPeer) return;

        sendJSON(targetPeer.ws, {
          type: 'answer',
          roomId: ws.roomId,
          sender: ws.clientId,
          senderName: ws.userName,
          target,
          answer: msg.answer ?? msg.payload
        });
        break;
      }

      // --- Chuyển tiếp ICE candidate ---
      case 'candidate': {
        const target = msg.target || msg.targetId;
        if (!ws.roomId || !target) return;
        const room = rooms.get(ws.roomId);
        if (!room) return;
        const targetPeer = room.get(target);
        if (!targetPeer) return;

        sendJSON(targetPeer.ws, {
          type: 'candidate',
          roomId: ws.roomId,
          sender: ws.clientId,
          senderName: ws.userName,
          target,
          candidate: msg.candidate ?? msg.payload
        });
        break;
      }

      // --- Client rời phòng (chủ động) ---
      case 'leaveRoom':
      case 'leave': {
        leaveRoom(ws);
        break;
      }

      // --- Kết thúc cuộc gọi (broadcast cho tất cả trong phòng) ---
      case 'endCall': {
        if (!ws.roomId) return;
        broadcastToRoom(ws.roomId, ws.clientId, {
          type: 'endCall',
          roomId: ws.roomId,
          sender: ws.clientId,
          senderName: ws.userName
        });
        leaveRoom(ws);
        break;
      }

      // --- Tin nhắn chat ---
      case 'chat': {
        if (!ws.roomId) return;
        broadcastToRoom(ws.roomId, ws.clientId, {
          type: 'chat',
          fromId: ws.clientId,
          fromName: ws.userName,
          text: msg.text
        });
        break;
      }

      default:
        console.warn('⚠️  Loại message không hỗ trợ:', msg.type);
    }
  });

  ws.on('close', () => {
    console.log(`🔌 Client ngắt kết nối: ${ws.clientId}`);
    leaveRoom(ws);
  });

  ws.on('error', (err) => {
    console.error(`❌ WS error (${ws.clientId}):`, err.message);
  });
});

// Helper: xử lý khi một client rời phòng
function leaveRoom(ws) {
  if (!ws.roomId) return;
  const roomId = ws.roomId;
  const room = rooms.get(roomId);
  if (room) {
    room.delete(ws.clientId);

    // Báo cho các peer còn lại
    broadcastToRoom(roomId, ws.clientId, {
      type: 'memberLeft',
      roomId,
      name: ws.userName,
      id: ws.clientId
    });

    console.log(`🚪 ${ws.userName} rời phòng "${roomId}" (còn ${room.size} người)`);

    if (room.size === 0) {
      rooms.delete(roomId);
      console.log(`🗑️  Phòng "${roomId}" trống, đã xoá.`);
    } else {
      // Cập nhật danh sách thành viên cho những người còn lại
      broadcastRoomMembers(roomId);
    }
  }
  ws.roomId = null;
}

// --------- 4. Endpoint debug: xem phòng đang mở ---------
app.get('/rooms', (req, res) => {
  // ?json=1 → trả về JSON thuần (dùng cho script/curl)
  if (req.query.json !== undefined) {
    const info = {};
    for (const [id, room] of rooms.entries()) {
      info[id] = Array.from(room.values()).map(p => p.name);
    }
    return res.json(info);
  }

  const roomList = [];
  for (const [id, room] of rooms.entries()) {
    roomList.push({ id, members: Array.from(room.values()).map(p => p.name) });
  }

  const totalPeers = roomList.reduce((s, r) => s + r.members.length, 0);
  const now = new Date().toLocaleTimeString('vi-VN');

  const roomCards = roomList.length === 0
    ? `<div class="empty">
         <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
           <path d="M15 10l4.553-2.069A1 1 0 0121 8.82v6.36a1 1 0 01-1.447.89L15 14"/>
           <rect x="3" y="6" width="12" height="12" rx="3"/>
           <line x1="2" y1="2" x2="22" y2="22"/>
         </svg>
         <div class="empty-title">Chưa có phòng nào đang hoạt động</div>
         <div class="empty-hint">Vào <a href="/">trang chính</a> để tạo phòng mới</div>
       </div>`
    : roomList.map((r, i) => {
        const memberTags = r.members
          .map(name => `<span class="tag"><span class="tag-dot"></span>${escapeHtml(name)}</span>`)
          .join('');
        const connections = r.members.length * (r.members.length - 1) / 2;
        return `
          <div class="room-card" style="animation-delay:${i * 0.06}s">
            <div class="room-header">
              <span class="room-id-badge">${escapeHtml(r.id)}</span>
              <span class="room-meta">${r.members.length} người · ${connections} kết nối P2P</span>
            </div>
            <div class="member-list">${memberTags}</div>
          </div>`;
      }).join('');

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  res.send(`<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Phòng đang hoạt động — WebRTC</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Vina+Sans&family=Montserrat:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: 'Montserrat', -apple-system, sans-serif;
      background: #030712;
      color: #f1f5f9;
      min-height: 100vh;
      overflow-x: hidden;
    }

    /* Ambient orbs */
    .orb {
      position: fixed; border-radius: 50%;
      filter: blur(80px); pointer-events: none; z-index: 0;
    }
    .orb-1 {
      width: 500px; height: 500px;
      background: radial-gradient(circle, rgba(59,130,246,.16) 0%, transparent 70%);
      top: -160px; left: -120px;
    }
    .orb-2 {
      width: 420px; height: 420px;
      background: radial-gradient(circle, rgba(99,102,241,.12) 0%, transparent 70%);
      top: 5%; right: -120px;
    }

    /* Sticky header */
    header {
      position: sticky; top: 0; z-index: 10;
      display: flex; align-items: center; justify-content: space-between;
      padding: 12px 28px;
      background: rgba(3,7,18,.78);
      backdrop-filter: blur(22px);
      -webkit-backdrop-filter: blur(22px);
      border-bottom: 1px solid rgba(255,255,255,.08);
    }
    .hd-left { display: flex; align-items: center; gap: 12px; }
    .hd-logo {
      width: 36px; height: 36px;
      background: linear-gradient(135deg, #3b82f6, #6366f1);
      border-radius: 10px;
      display: flex; align-items: center; justify-content: center;
      box-shadow: 0 4px 14px rgba(59,130,246,.35);
      flex-shrink: 0;
    }
    header h1 {
      font-family: 'Vina Sans', sans-serif;
      font-size: 20px; font-weight: 400;
      letter-spacing: .12em;
      background: linear-gradient(135deg, #f1f5f9, #94a3b8);
      -webkit-background-clip: text; -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    .hd-back {
      display: flex; align-items: center; gap: 6px;
      font-size: 12px; font-weight: 600;
      color: #94a3b8; text-decoration: none;
      padding: 7px 14px;
      border: 1px solid rgba(255,255,255,.1);
      border-radius: 8px;
      transition: border-color .2s, color .2s;
    }
    .hd-back:hover { border-color: #3b82f6; color: #f1f5f9; }

    main { position: relative; z-index: 1; max-width: 740px; margin: 36px auto; padding: 0 20px 40px; }

    /* Refresh bar */
    .refresh-bar {
      display: flex; align-items: center; justify-content: space-between;
      margin-bottom: 20px; gap: 12px;
    }
    .live-badge {
      display: flex; align-items: center; gap: 8px;
      font-size: 12px; font-weight: 600; color: #94a3b8;
    }
    .dot {
      width: 8px; height: 8px; border-radius: 50%;
      background: #22c55e;
      box-shadow: 0 0 8px rgba(34,197,94,.6);
      animation: pulse 2s infinite;
    }
    @keyframes pulse { 0%,100%{opacity:1;} 50%{opacity:.35;} }
    .refresh-btn {
      display: flex; align-items: center; gap: 6px;
      background: rgba(255,255,255,.05);
      border: 1px solid rgba(255,255,255,.1);
      color: #f1f5f9;
      padding: 7px 14px; border-radius: 8px;
      cursor: pointer;
      font-family: 'Montserrat', sans-serif;
      font-size: 12px; font-weight: 600;
      transition: background .2s, border-color .2s;
    }
    .refresh-btn:hover { background: rgba(255,255,255,.09); border-color: rgba(255,255,255,.2); }

    /* Stats */
    .stats-bar { display: flex; gap: 14px; margin-bottom: 28px; flex-wrap: wrap; }
    .stat {
      flex: 1; min-width: 130px;
      background: rgba(255,255,255,.04);
      backdrop-filter: blur(18px); -webkit-backdrop-filter: blur(18px);
      border: 1px solid rgba(255,255,255,.08);
      border-radius: 14px;
      padding: 18px 22px;
      animation: fadeUp .4s cubic-bezier(.22,1,.36,1) both;
    }
    .stat:nth-child(2) { animation-delay: .07s; }
    @keyframes fadeUp { from{opacity:0;transform:translateY(16px)} to{opacity:1;transform:none} }
    .stat-value {
      font-family: 'Vina Sans', sans-serif;
      font-size: 36px; font-weight: 400;
      background: linear-gradient(135deg, #3b82f6, #6366f1);
      -webkit-background-clip: text; -webkit-text-fill-color: transparent;
      background-clip: text;
      line-height: 1;
    }
    .stat-label { font-size: 11px; font-weight: 600; color: #64748b; margin-top: 6px; letter-spacing: .06em; text-transform: uppercase; }

    /* Room cards */
    .room-card {
      background: rgba(255,255,255,.04);
      backdrop-filter: blur(18px); -webkit-backdrop-filter: blur(18px);
      border: 1px solid rgba(255,255,255,.08);
      border-radius: 16px;
      padding: 20px 24px;
      margin-bottom: 14px;
      transition: border-color .2s, box-shadow .2s, transform .2s;
      animation: fadeUp .45s cubic-bezier(.22,1,.36,1) both;
    }
    .room-card:hover {
      border-color: rgba(59,130,246,.4);
      box-shadow: 0 0 0 1px rgba(59,130,246,.1);
      transform: translateY(-2px);
    }
    .room-header {
      display: flex; align-items: center; justify-content: space-between;
      margin-bottom: 14px; flex-wrap: wrap; gap: 10px;
    }
    .room-id-badge {
      font-family: 'Courier New', monospace;
      font-weight: 700; font-size: 15px;
      background: rgba(59,130,246,.1);
      border: 1px solid rgba(59,130,246,.25);
      color: #93c5fd;
      padding: 5px 14px; border-radius: 20px;
      letter-spacing: .04em;
    }
    .room-meta { font-size: 12px; font-weight: 600; color: #64748b; letter-spacing: .03em; }
    .member-list { display: flex; flex-wrap: wrap; gap: 8px; }
    .tag {
      display: flex; align-items: center; gap: 6px;
      background: rgba(255,255,255,.06);
      border: 1px solid rgba(255,255,255,.1);
      color: #cbd5e1;
      font-size: 12px; font-weight: 600;
      padding: 5px 12px; border-radius: 20px;
    }
    .tag-dot { width: 6px; height: 6px; border-radius: 50%; background: #22c55e; flex-shrink: 0; }

    /* Empty state */
    .empty {
      text-align: center; padding: 80px 20px;
      color: #334155;
      animation: fadeUp .5s cubic-bezier(.22,1,.36,1) both;
    }
    .empty svg { margin-bottom: 20px; opacity: .4; }
    .empty-title { font-size: 16px; font-weight: 700; color: #475569; margin-bottom: 8px; }
    .empty-hint { font-size: 13px; color: #334155; }
    .empty-hint a { color: #3b82f6; text-decoration: none; }
    .empty-hint a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="orb orb-1"></div>
  <div class="orb orb-2"></div>

  <header>
    <div class="hd-left">
      <div class="hd-logo">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M15 10l4.553-2.069A1 1 0 0121 8.82v6.36a1 1 0 01-1.447.89L15 14"/>
          <rect x="3" y="6" width="12" height="12" rx="3"/>
        </svg>
      </div>
      <h1>WebRTC Rooms</h1>
    </div>
    <a class="hd-back" href="/">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="15 18 9 12 15 6"/>
      </svg>
      Trang chính
    </a>
  </header>

  <main>
    <div class="refresh-bar">
      <div class="live-badge">
        <span class="dot"></span>
        Cập nhật lúc ${now} · làm mới sau <span id="cd" style="color:#f1f5f9;font-weight:700;margin:0 2px">10</span>s
      </div>
      <button class="refresh-btn" onclick="location.reload()">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/>
        </svg>
        Làm mới
      </button>
    </div>

    <div class="stats-bar">
      <div class="stat">
        <div class="stat-value">${roomList.length}</div>
        <div class="stat-label">Phòng đang mở</div>
      </div>
      <div class="stat">
        <div class="stat-value">${totalPeers}</div>
        <div class="stat-label">Người kết nối</div>
      </div>
    </div>

    ${roomCards}
  </main>

  <script>
    let s = 10;
    const el = document.getElementById('cd');
    setInterval(() => { s--; el.textContent = s; if (s <= 0) location.reload(); }, 1000);
  </script>
</body>
</html>`);
});

// --------- 5. Khởi động server ---------
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log('=====================================================');
  console.log(`✅ WebRTC Signaling Server (HTTPS + WSS)`);
  console.log(`   Đang chạy tại: https://<IP-máy-bạn>:${PORT}`);
  console.log(`   Xem phòng:     https://<IP-máy-bạn>:${PORT}/rooms`);
  console.log('=====================================================');
});

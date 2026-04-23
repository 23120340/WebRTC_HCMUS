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
  const info = {};
  for (const [id, room] of rooms.entries()) {
    info[id] = Array.from(room.values()).map(p => p.name);
  }
  res.json(info);
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

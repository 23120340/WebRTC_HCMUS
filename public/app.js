/**
 * ============================================================
 *  WEBRTC GROUP CALL CLIENT (MESH TOPOLOGY)
 * ============================================================
 *  Với N người trong phòng → có N*(N-1)/2 kết nối P2P.
 *  Mỗi client giữ một Map<peerId, RTCPeerConnection>.
 *
 *  QUY TẮC "AI GỌI AI" (tránh glare):
 *   - Người MỚI vào phòng tạo OFFER tới tất cả peer đang có sẵn.
 *   - Người CŨ chỉ đợi OFFER rồi tạo ANSWER.
 * ============================================================
 */

// ================== STATE ==================
let ws = null;
let localStream = null;
let myId = null;
let myName = null;
let currentRoom = null;
const peers = new Map();   // peerId -> { pc, name, videoEl, statusEl }
let screenStream = null;
let isScreenSharing = false;
let pinnedId = null;

// ================== DOM ==================
const $ = (sel) => document.querySelector(sel);
const lobby    = $('#lobby');
const callRoom = $('#callRoom');
const videoGrid     = $('#videoGrid');
const lobbyStatus   = $('#lobbyStatus');
const chatMessages  = $('#chatMessages');
const chatPanel     = $('#chatPanel');

// ================== LOBBY HANDLERS ==================
$('#btnRandomRoom').addEventListener('click', () => {
  $('#inputRoom').value = Math.random().toString(36).substring(2, 8);
});

$('#btnJoin').addEventListener('click', joinRoom);
$('#inputRoom').addEventListener('keydown', e => { if (e.key === 'Enter') joinRoom(); });

async function joinRoom() {
  const name   = $('#inputName').value.trim();
  const roomId = $('#inputRoom').value.trim();
  if (!name || !roomId) {
    lobbyStatus.textContent = '  Vui lòng nhập tên và mã phòng.';
    return;
  }

  lobbyStatus.textContent = ' Đang xin quyền camera/micro...';
  $('#btnJoin').disabled = true;

  // Lấy local stream TRƯỚC khi mở WebSocket để khi nhận peer list đã có track
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480 },
      audio: true
    });
  } catch (err) {
    lobbyStatus.textContent = ' Không truy cập được camera/micro: ' + err.message;
    $('#btnJoin').disabled = false;
    return;
  }

  myName = name;
  currentRoom = roomId;

  const wsUrl = `wss://${location.host}`;
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    lobbyStatus.textContent = ' Đã kết nối signaling. Đang vào phòng...';
    ws.send(JSON.stringify({ type: 'join', roomId, name }));
  };

  ws.onmessage = handleSignalingMessage;

  ws.onerror = () => {
    lobbyStatus.textContent = ' Không kết nối được server signaling.';
    $('#btnJoin').disabled = false;
  };

  ws.onclose = () => {
    console.log('WS closed');
  };
}

// ================== WEBSOCKET MESSAGE HANDLER ==================
async function handleSignalingMessage(event) {
  let msg;
  try {
    const text = event.data instanceof Blob ? await event.data.text() : event.data;
    msg = JSON.parse(text);
  } catch (e) {
    console.error('Message không phải JSON:', e);
    return;
  }

  switch (msg.type) {

    case 'welcome':
      myId = msg.clientId;
      console.log(' Welcome, myId =', myId);
      break;

    case 'joined':
      // Server xác nhận đã vào phòng + trả danh sách peer có sẵn
      myId = msg.yourId;
      onJoinedRoom(msg.peers);
      break;

    case 'roomMembers':
      // Cập nhật danh sách thành viên (dùng cho log/debug)
      console.log(`👥 Thành viên phòng [${msg.roomId}]:`, msg.members.map(m => m.name).join(', '));
      break;

    case 'peer-joined':
      addChatSystem(`${msg.name} đã vào phòng`);
      break;

    case 'memberLeft':
      onPeerLeft(msg.id, msg.name);
      break;

    case 'offer':
      await onReceiveOffer(msg.sender, msg.senderName, msg.offer);
      break;

    case 'answer':
      await onReceiveAnswer(msg.sender, msg.answer);
      break;

    case 'candidate':
      await onReceiveIce(msg.sender, msg.candidate);
      break;

    case 'endCall':
      addChatSystem(`${msg.senderName} đã kết thúc cuộc gọi`);
      leaveRoom();
      break;

    case 'chat':
      addChatMessage(msg.fromName, msg.text);
      break;

    case 'error':
      console.error('Server error:', msg.message);
      break;
  }
}

// ================== JOIN ROOM THÀNH CÔNG ==================
function onJoinedRoom(existingPeers) {
  lobby.classList.add('hidden');
  callRoom.classList.remove('hidden');
  $('#roomIdDisplay').textContent = currentRoom;
  $('#myNameDisplay').innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg> ${escapeHtml(myName)}`;

  addVideoTile('local', myName + ' (bạn)', localStream, true);

  // Người mới: tạo offer tới tất cả peer đang có sẵn
  for (const peer of existingPeers) {
    createPeerConnection(peer.id, peer.name, /* isInitiator */ true);
  }

  addChatSystem(`Bạn đã vào phòng "${currentRoom}"`);
}

// ================== TẠO PEER CONNECTION ==================
async function createPeerConnection(peerId, peerName, isInitiator) {
  console.log(` Tạo PC tới ${peerName} (${peerId}), initiator=${isInitiator}`);

  const pc = new RTCPeerConnection(window.ICE_CONFIG);
  const tile = addVideoTile(peerId, peerName, null, false);
  const videoEl  = tile.querySelector('video');
  const statusEl = tile.querySelector('.conn-status');

  peers.set(peerId, { pc, name: peerName, videoEl, statusEl });

  // Đưa local tracks vào peer connection
  localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

  // Nếu đang share màn hình, peer mới phải nhận screen track ngay từ đầu
  if (isScreenSharing && screenStream) {
    const screenTrack = screenStream.getVideoTracks()[0];
    const videoSender = pc.getSenders().find(s => s.track?.kind === 'video');
    if (videoSender && screenTrack) videoSender.replaceTrack(screenTrack);
  }

  // Nhận remote track → gắn vào video element
  pc.ontrack = (event) => {
    console.log(` Nhận remote track từ ${peerName}`);
    if (videoEl.srcObject !== event.streams[0]) {
      videoEl.srcObject = event.streams[0];
    }
  };

  // Gửi ICE candidate khi trình duyệt tìm ra + log loại candidate
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      // Parse loại candidate từ SDP string: "... typ host|srflx|relay ..."
      const candType = event.candidate.candidate.match(/\btyp\s+(\w+)/)?.[1] ?? 'unknown';
      const candPreview = event.candidate.candidate.substring(0, 70);
      console.log(`[${peerName}]  Candidate gathered: typ=${candType}  ${candPreview}…`);
      sendSignal('candidate', peerId, event.candidate);
    } else {
      console.log(`[${peerName}]  ICE gathering hoàn tất (null candidate)`);
    }
  };

  // Log tiến trình gathering: new → gathering → complete
  pc.onicegatheringstatechange = () => {
    console.log(`[${peerName}] iceGatheringState=${pc.iceGatheringState}`);
  };

  // Log iceConnectionState (checking → connected → completed)
  pc.oniceconnectionstatechange = () => {
    console.log(`[${peerName}] iceConnectionState=${pc.iceConnectionState}`);
  };

  // ---- Hiển thị connectionState trên tile + xử lý fallback ----
  const callStartTime = Date.now();
  let iceRestartCount = 0;
  const MAX_ICE_RESTARTS = 2;

  async function doIceRestart() {
    if (iceRestartCount >= MAX_ICE_RESTARTS) {
      console.error(`[${peerName}] Đã thử ${MAX_ICE_RESTARTS} lần restartIce, bỏ cuộc.`);
      addChatSystem(`Không thể kết nối tới ${peerName} — kiểm tra TURN server.`);
      return;
    }
    iceRestartCount++;
    console.warn(`[${peerName}] ICE restart lần ${iceRestartCount}/${MAX_ICE_RESTARTS}...`);
    if (isInitiator) {
      try {
        const offer = await pc.createOffer({ iceRestart: true });
        await pc.setLocalDescription(offer);
        sendSignal('offer', peerId, offer);
      } catch (err) {
        console.error(`[${peerName}] Lỗi tạo offer khi ICE restart:`, err);
      }
    } else {
      pc.restartIce();
    }
  }

  // Timeout: 12 giây không kết nối được → thử ICE restart với TURN
  const p2pTimeout = setTimeout(() => {
    if (pc.connectionState !== 'connected' && pc.connectionState !== 'closed') {
      console.warn(`[${peerName}] P2P thất bại sau 12s, đang thử TURN relay...`);
      addChatSystem(`P2P với ${peerName} thất bại, đang thử TURN relay...`);
      doIceRestart();
    }
  }, 12000);

  pc.onconnectionstatechange = () => {
    const state = pc.connectionState;
    const now = new Date().toLocaleTimeString('vi-VN');
    console.log(`[${peerName}] connectionState=${state} (${now})`);

    // Cập nhật badge trạng thái trên tile
    if (statusEl) {
      statusEl.dataset.state = state;
      statusEl.title = state;
    }

    if (state === 'connected') {
      clearTimeout(p2pTimeout);
      iceRestartCount = 0;
      const setupMs = Date.now() - callStartTime;
      console.log(` [${peerName}] Kết nối thành công sau ${setupMs}ms`);
      logConnectionStats(pc, peerName, callStartTime);
    }

    if (state === 'failed') {
      clearTimeout(p2pTimeout);
      doIceRestart();
    }

    if (state === 'disconnected' || state === 'closed') {
      clearTimeout(p2pTimeout);
      const endTime = new Date().toLocaleTimeString('vi-VN');
      console.log(` [${peerName}] Kết nối kết thúc lúc ${endTime}`);
    }
  };

  // Nếu mình là người khởi tạo → tạo offer ngay
  if (isInitiator) {
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      sendSignal('offer', peerId, offer);
    } catch (err) {
      console.error('Lỗi tạo offer:', err);
    }
  }

  return pc;
}

// ================== THỐNG KÊ KẾT NỐI (A3) ==================
async function logConnectionStats(pc, peerName, callStartTime) {
  try {
    const stats = await pc.getStats();
    let candidateType = 'unknown';
    let localCandidateId = null;

    // Tìm candidate pair đang được chọn: nominated=true, state=succeeded, priority cao nhất
    let bestPriority = -1;
    stats.forEach(report => {
      if (report.type === 'candidate-pair' && report.nominated && report.state === 'succeeded') {
        const priority = report.priority ?? 0;
        if (priority > bestPriority) {
          bestPriority = priority;
          localCandidateId = report.localCandidateId;
        }
      }
    });

    if (localCandidateId) {
      const localCandidate = stats.get(localCandidateId);
      if (localCandidate) {
        candidateType = localCandidate.candidateType;
        // host = cùng mạng LAN, srflx = STUN xuyên NAT, relay = TURN relay
      }
    }

    const setupMs = Date.now() - callStartTime;
    const now = new Date().toISOString();
    console.log(
      ` Thống kê kết nối [${peerName}]:\n` +
      `   Thời điểm kết nối: ${now}\n` +
      `   Thời gian setup:   ${setupMs}ms\n` +
      `   Loại candidate:    ${candidateType}\n` +
      `   (host=LAN, srflx=STUN/NAT, relay=TURN)`
    );

    // Hiển thị loại kết nối trên badge của tile
    const peerData = peers.get(
      [...peers.entries()].find(([, v]) => v.pc === pc)?.[0]
    );
    if (peerData?.statusEl) {
      peerData.statusEl.title = `${candidateType} · ${setupMs}ms`;
      peerData.statusEl.dataset.candType = candidateType;
    }
  } catch (e) {
    console.error('getStats error:', e);
  }
}

// ================== NHẬN OFFER/ANSWER/ICE ==================
async function onReceiveOffer(fromId, fromName, offer) {
  let peer = peers.get(fromId);
  if (!peer) {
    await createPeerConnection(fromId, fromName, /* isInitiator */ false);
    peer = peers.get(fromId);
  }
  try {
    await peer.pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await peer.pc.createAnswer();
    await peer.pc.setLocalDescription(answer);
    sendSignal('answer', fromId, answer);
  } catch (err) {
    console.error('Lỗi xử lý offer:', err);
  }
}

async function onReceiveAnswer(fromId, answer) {
  const peer = peers.get(fromId);
  if (!peer) return;
  try {
    await peer.pc.setRemoteDescription(new RTCSessionDescription(answer));
  } catch (err) {
    console.error('Lỗi setRemoteDescription(answer):', err);
  }
}

async function onReceiveIce(fromId, candidate) {
  const peer = peers.get(fromId);
  if (!peer) return;
  try {
    await peer.pc.addIceCandidate(new RTCIceCandidate(candidate));
  } catch (err) {
    console.error('Lỗi addIceCandidate:', err);
  }
}

// ================== PEER LEFT ==================
function onPeerLeft(peerId, peerName) {
  if (pinnedId === peerId) unpinAll();
  const peer = peers.get(peerId);
  if (peer) {
    peer.pc.close();
    const tile = peer.videoEl.closest('.video-tile');
    if (tile) tile.remove();
    peers.delete(peerId);
  }
  addChatSystem(`${peerName || peerId} đã rời phòng`);
}

// ================== UI: VIDEO TILE ==================
function addVideoTile(id, label, stream, isLocal) {
  const tpl = $('#videoTileTemplate');
  const tile = tpl.content.firstElementChild.cloneNode(true);
  tile.dataset.peerId = id;
  if (isLocal) tile.classList.add('is-local');
  tile.querySelector('.tile-label').textContent = label;
  const video = tile.querySelector('video');
  if (stream) video.srcObject = stream;
  if (isLocal) {
    video.muted = true;
    const statusEl = tile.querySelector('.conn-status');
    if (statusEl) statusEl.remove();
    const pinBtn = tile.querySelector('.pin-btn');
    if (pinBtn) pinBtn.remove();
  } else {
    const pinBtn = tile.querySelector('.pin-btn');
    if (pinBtn) {
      pinBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        togglePin(id);
      });
    }
  }
  videoGrid.appendChild(tile);
  return tile;
}

// ================== GỬI TÍN HIỆU TỚI PEER QUA WS ==================
// Format theo đề bài: {type, roomId, sender, target, offer/answer/candidate}
function sendSignal(type, targetId, payload) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const msg = { type, roomId: currentRoom, sender: myId, target: targetId };
  if (type === 'offer')     msg.offer     = payload;
  else if (type === 'answer')    msg.answer    = payload;
  else if (type === 'candidate') msg.candidate = payload;
  ws.send(JSON.stringify(msg));
}

// ================== MEDIA CONTROLS ==================
const ICON = {
  micOn: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/><path d="M19 10v2a7 7 0 01-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>`,
  micOff: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 005.12 2.12M15 9.34V4a3 3 0 00-5.94-.6"/><path d="M17 16.95A7 7 0 015 12v-2m14 0v2a7 7 0 01-.11 1.23"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>`,
  camOn: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15 10l4.553-2.069A1 1 0 0121 8.82v6.36a1 1 0 01-1.447.89L15 14"/><rect x="3" y="6" width="12" height="12" rx="3"/></svg>`,
  camOff: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M16 16v1a2 2 0 01-2 2H3a2 2 0 01-2-2V7a2 2 0 012-2h2m5.66 0H14a2 2 0 012 2v3.34l1 1 5-4.34v10"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`,
  screenOn:  `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="13" rx="2"/><path d="M8 21h8"/><path d="M12 16v5"/><polyline points="10 8 12 6 14 8"/><line x1="12" y1="6" x2="12" y2="13"/></svg>`,
  screenOff: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="13" rx="2"/><path d="M8 21h8"/><path d="M12 16v5"/><line x1="9.5" y1="7.5" x2="14.5" y2="12.5"/><line x1="14.5" y1="7.5" x2="9.5" y2="12.5"/></svg>`,
};

$('#btnToggleMic').addEventListener('click', () => {
  const track = localStream?.getAudioTracks()[0];
  if (!track) return;
  track.enabled = !track.enabled;
  const btn = $('#btnToggleMic');
  btn.innerHTML = track.enabled ? ICON.micOn : ICON.micOff;
  btn.dataset.label = track.enabled ? 'Tắt mic' : 'Bật mic';
  btn.classList.toggle('off', !track.enabled);
});

$('#btnToggleCam').addEventListener('click', () => {
  const track = localStream?.getVideoTracks()[0];
  if (!track) return;
  track.enabled = !track.enabled;
  const btn = $('#btnToggleCam');
  btn.innerHTML = track.enabled ? ICON.camOn : ICON.camOff;
  btn.dataset.label = track.enabled ? 'Tắt cam' : 'Bật cam';
  btn.classList.toggle('off', !track.enabled);
});

$('#btnToggleChat').addEventListener('click', () => {
  if (window.innerWidth <= 768) {
    chatPanel.classList.add('mobile-open');
    chatPanel.querySelector('#chatInput')?.focus();
  } else {
    chatPanel.classList.toggle('hidden-panel');
  }
});

$('#btnCloseChat').addEventListener('click', () => {
  chatPanel.classList.remove('mobile-open');
});

// Reset về desktop state khi xoay màn hình / resize
window.addEventListener('resize', () => {
  if (window.innerWidth > 768) {
    chatPanel.classList.remove('mobile-open');
  }
});

$('#btnScreenShare').addEventListener('click', toggleScreenShare);

$('#btnLeave').addEventListener('click', leaveRoom);

$('#btnCopyRoom').addEventListener('click', () => {
  navigator.clipboard?.writeText(currentRoom);
  const btn = $('#btnCopyRoom');
  btn.innerHTML = '✔';
  btn.style.color = '#22c55e';
  setTimeout(() => {
    btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>`;
    btn.style.color = '';
  }, 1400);
});

// ================== SCREEN SHARE ==================
async function toggleScreenShare() {
  if (isScreenSharing) {
    await stopScreenShare();
  } else {
    await startScreenShare();
  }
}

async function startScreenShare() {
  try {
    screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: { cursor: 'always' },
      audio: false
    });
  } catch (err) {
    if (err.name !== 'NotAllowedError') console.error('getDisplayMedia:', err);
    return;
  }

  const screenTrack = screenStream.getVideoTracks()[0];

  // Swap video track trên tất cả peer connections (không cần renegotiate)
  const swaps = [];
  for (const [, peer] of peers.entries()) {
    const sender = peer.pc.getSenders().find(s => s.track?.kind === 'video');
    if (sender) swaps.push(sender.replaceTrack(screenTrack));
  }
  await Promise.all(swaps);

  // Cập nhật local video tile
  const localVideo = document.querySelector('[data-peer-id="local"] video');
  if (localVideo) {
    localVideo.srcObject = new MediaStream([screenTrack, ...localStream.getAudioTracks()]);
  }

  isScreenSharing = true;
  updateScreenShareBtn();

  // Người dùng bấm "Stop sharing" trên trình duyệt → tự dừng
  screenTrack.addEventListener('ended', stopScreenShare, { once: true });
}

async function stopScreenShare() {
  if (!isScreenSharing) return;

  screenStream?.getTracks().forEach(t => t.stop());
  screenStream = null;

  // Khôi phục camera track
  const cameraTrack = localStream?.getVideoTracks()[0];
  if (cameraTrack) {
    const swaps = [];
    for (const [, peer] of peers.entries()) {
      const sender = peer.pc.getSenders().find(s => s.track?.kind === 'video');
      if (sender) swaps.push(sender.replaceTrack(cameraTrack));
    }
    await Promise.all(swaps);
  }

  // Khôi phục local video
  const localVideo = document.querySelector('[data-peer-id="local"] video');
  if (localVideo) localVideo.srcObject = localStream;

  isScreenSharing = false;
  updateScreenShareBtn();
}

function updateScreenShareBtn() {
  const btn = $('#btnScreenShare');
  if (!btn) return;
  if (isScreenSharing) {
    btn.innerHTML = ICON.screenOff;
    btn.dataset.label = 'Dừng chia sẻ';
    btn.classList.add('ctrl-btn--sharing');
  } else {
    btn.innerHTML = ICON.screenOn;
    btn.dataset.label = 'Chia sẻ màn hình';
    btn.classList.remove('ctrl-btn--sharing');
  }
}

// ================== PIN ==================
function togglePin(peerId) {
  if (pinnedId === peerId) {
    unpinAll();
  } else {
    unpinAll();
    const tile = videoGrid.querySelector(`[data-peer-id="${peerId}"]`);
    if (tile) {
      tile.classList.add('pinned');
      tile.querySelector('.pin-btn')?.classList.add('active');
    }
    pinnedId = peerId;
    videoGrid.classList.add('has-pin');
  }
}

function unpinAll() {
  const pinned = videoGrid.querySelector('.video-tile.pinned');
  if (pinned) {
    pinned.classList.remove('pinned');
    pinned.querySelector('.pin-btn')?.classList.remove('active');
  }
  pinnedId = null;
  videoGrid.classList.remove('has-pin');
}

// ================== CHAT ==================
$('#btnSendChat').addEventListener('click', sendChat);
$('#chatInput').addEventListener('keydown', e => { if (e.key === 'Enter') sendChat(); });

function sendChat() {
  const text = $('#chatInput').value.trim();
  if (!text || !ws) return;
  ws.send(JSON.stringify({ type: 'chat', text }));
  addChatMessage(myName + ' (bạn)', text);
  $('#chatInput').value = '';
}

function addChatMessage(from, text) {
  const div = document.createElement('div');
  div.className = 'chat-msg';
  div.innerHTML = `<div class="from">${escapeHtml(from)}</div><div class="body">${escapeHtml(text)}</div>`;
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function addChatSystem(text) {
  const div = document.createElement('div');
  div.className = 'chat-msg system';
  div.textContent = text;
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// ================== LEAVE ROOM ==================
function leaveRoom() {
  // Dừng screen share nếu đang chia sẻ
  if (isScreenSharing) {
    screenStream?.getTracks().forEach(t => t.stop());
    screenStream = null;
    isScreenSharing = false;
    updateScreenShareBtn();
  }

  // Đóng tất cả peer connection
  for (const [, peer] of peers.entries()) {
    peer.pc.close();
  }
  peers.clear();

  // Dừng local stream
  localStream?.getTracks().forEach(t => t.stop());
  localStream = null;

  // Báo server & đóng WS
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'leaveRoom', roomId: currentRoom, sender: myId }));
    ws.close();
  }

  // Bỏ ghim
  pinnedId = null;
  videoGrid.classList.remove('has-pin');

  // Reset UI
  videoGrid.innerHTML = '';
  chatMessages.innerHTML = '';
  callRoom.classList.add('hidden');
  lobby.classList.remove('hidden');
  $('#btnJoin').disabled = false;
  lobbyStatus.textContent = '';
  myId = null;
  currentRoom = null;

  // Reset trạng thái nút mic/cam về mặc định (bật)
  const btnMic = $('#btnToggleMic');
  btnMic.innerHTML = ICON.micOn;
  btnMic.dataset.label = 'Tắt mic';
  btnMic.classList.remove('off');

  const btnCam = $('#btnToggleCam');
  btnCam.innerHTML = ICON.camOn;
  btnCam.dataset.label = 'Tắt cam';
  btnCam.classList.remove('off');
}

// Cảnh báo khi đóng tab
window.addEventListener('beforeunload', () => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'leaveRoom', roomId: currentRoom, sender: myId }));
  }
});

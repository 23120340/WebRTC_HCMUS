/**
 * ============================================================
 *  CẤU HÌNH ICE SERVERS (STUN + TURN)
 * ============================================================
 *  1. host   — IP nội bộ (LAN). P2P trực tiếp khi cùng mạng.
 *  2. srflx  — STUN phản chiếu IP công cộng sau NAT đơn giản.
 *  3. relay  — TURN relay toàn bộ media. Bắt buộc khi một bên
 *              nằm sau symmetric NAT hoặc firewall (thường là 4G/5G).
 * ============================================================
 */

// ---- Danh sách TURN servers (thử theo thứ tự) ----
const TURN_SERVERS = [
  // Open Relay — public, không cần tài khoản (rate-limited)
  {
    urls: [
      'turn:openrelay.metered.ca:80',
      'turn:openrelay.metered.ca:443',
      'turn:openrelay.metered.ca:443?transport=tcp',
      'turns:openrelay.metered.ca:443?transport=tcp'
    ],
    username: 'openrelayproject',
    credential: 'openrelayproject'
  },

  // ---- Metered.ca riêng (thay YOUR_KEY_ID / YOUR_KEY_SECRET) ----
  // Đăng ký miễn phí: https://www.metered.ca/ → Dashboard → TURN Credentials
  // {
  //   urls: [
  //     'turn:relay.metered.ca:80',
  //     'turn:relay.metered.ca:443',
  //     'turn:relay.metered.ca:443?transport=tcp',
  //     'turns:relay.metered.ca:443?transport=tcp'
  //   ],
  //   username: 'YOUR_KEY_ID',
  //   credential: 'YOUR_KEY_SECRET'
  // },
];

window.ICE_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    ...TURN_SERVERS
  ],
  iceCandidatePoolSize: 10
};

// ============================================================
//  TURN CONNECTIVITY DIAGNOSTIC
//  Chạy khi page load — logs vào console để debug
// ============================================================
async function probeTurnServer(serverConfig, label) {
  return new Promise((resolve) => {
    const pc = new RTCPeerConnection({
      iceServers: [serverConfig],
      iceTransportPolicy: 'relay'  // chỉ cho phép relay → buộc dùng TURN
    });

    let found = false;
    const timer = setTimeout(() => {
      pc.close();
      resolve({ label, ok: false, reason: 'timeout 5s' });
    }, 5000);

    pc.onicecandidate = (e) => {
      if (e.candidate && e.candidate.type === 'relay' && !found) {
        found = true;
        clearTimeout(timer);
        pc.close();
        resolve({ label, ok: true, candidate: e.candidate.address });
      }
    };

    pc.onicegatheringstatechange = () => {
      if (pc.iceGatheringState === 'complete' && !found) {
        clearTimeout(timer);
        pc.close();
        resolve({ label, ok: false, reason: 'gathering complete, no relay' });
      }
    };

    // Cần data channel để trigger ICE gathering
    pc.createDataChannel('probe');
    pc.createOffer()
      .then(o => pc.setLocalDescription(o))
      .catch(err => {
        clearTimeout(timer);
        pc.close();
        resolve({ label, ok: false, reason: err.message });
      });
  });
}

async function runTurnDiagnostic() {
  console.group('%c🔍 TURN Server Diagnostic', 'font-weight:bold;color:#60a5fa');
  const results = await Promise.all(
    TURN_SERVERS.map((srv, i) => {
      const urls = Array.isArray(srv.urls) ? srv.urls : [srv.urls];
      const label = urls[0].replace('turn:', '').replace('turns:', '');
      return probeTurnServer(srv, label);
    })
  );

  let anyOk = false;
  for (const r of results) {
    if (r.ok) {
      console.log(`%c  ✅ ${r.label} — TURN hoạt động (relay: ${r.candidate})`, 'color:#4ade80');
      anyOk = true;
    } else {
      console.warn(`  ❌ ${r.label} — THẤT BẠI (${r.reason})`);
    }
  }

  if (!anyOk) {
    console.error(
      '  ⚠️  Không có TURN server nào hoạt động!\n' +
      '  → Kết nối với mobile/4G sẽ thất bại.\n' +
      '  → Kiểm tra mạng có chặn UDP/TCP 443 ra ngoài không.\n' +
      '  → Đăng ký metered.ca để có TURN server riêng đáng tin cậy.'
    );
  }
  console.groupEnd();
  return anyOk;
}

// Chạy diagnostic sau khi page load xong
window.addEventListener('DOMContentLoaded', () => {
  // Chạy sau 500ms để không tranh CPU với render ban đầu
  setTimeout(runTurnDiagnostic, 500);
});

// Cho phép gọi lại từ console: window.checkTurn()
window.checkTurn = runTurnDiagnostic;

/**
 * ============================================================
 *  CẤU HÌNH ICE SERVERS (STUN + TURN)
 * ============================================================
 *  WebRTC dùng framework ICE (Interactive Connectivity
 *  Establishment) để tìm đường kết nối tốt nhất. Có 3 loại
 *  ICE candidate theo thứ tự ưu tiên giảm dần:
 *
 *  1. host   — IP nội bộ (LAN/loopback). Kết nối P2P trực tiếp
 *              khi cả hai peer cùng mạng. Nhanh nhất, không qua
 *              server trung gian.
 *
 *  2. srflx  — Server Reflexive. STUN server phản chiếu lại IP
 *              công cộng (public IP) của peer sau NAT. Dùng khi
 *              2 peer khác mạng nhưng NAT đơn giản (full-cone /
 *              port-restricted cone).
 *
 *  3. relay  — TURN server relay toàn bộ media. Bắt buộc khi
 *              một hoặc cả hai peer nằm sau symmetric NAT hoặc
 *              firewall chặt UDP (thường gặp với 4G/5G).
 *
 *  Cấu hình này dùng:
 *  - STUN : Google STUN (miễn phí, công khai)
 *  - TURN : freestun.net (miễn phí, không cần đăng ký)
 *           + Metered.ca (đăng ký miễn phí tại metered.ca
 *             → App Settings → TURN Credentials)
 * ============================================================
 */
window.ICE_CONFIG = {
  iceServers: [
    // ---- STUN: giúp peer khám phá IP công cộng → sinh srflx candidate ----
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },

    // ---- TURN: Open Relay (metered.ca) — public, không cần tài khoản ----
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

    // ---- TURN: Metered.ca — đăng ký miễn phí để lấy credentials riêng ----
    // Tạo tài khoản tại https://www.metered.ca/ → Dashboard → TURN Credentials
    // Thay YOUR_KEY_ID và YOUR_KEY_SECRET bên dưới để có băng thông ổn định hơn:
    // {
    //   urls: [
    //     'turn:relay.metered.ca:80',
    //     'turn:relay.metered.ca:443',
    //     'turn:relay.metered.ca:443?transport=tcp',
    //     'turns:relay.metered.ca:443?transport=tcp'
    //   ],
    //   username: 'YOUR_KEY_ID',
    //   credential: 'YOUR_KEY_SECRET'
    // }
  ],
  iceCandidatePoolSize: 10
};

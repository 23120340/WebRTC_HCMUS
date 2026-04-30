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
 *              firewall chặn UDP. Chậm hơn nhưng đảm bảo kết
 *              nối thành công trong mọi tình huống.
 *
 *  Cấu hình này dùng:
 *  - STUN : Google STUN (miễn phí, công khai)
 *  - TURN : Open Relay Project (openrelay.metered.ca)
 *           → Miễn phí, không cần đăng ký, đủ để demo và thử
 *             nghiệm bài tập. Không cần VPS hay tự vận hành.
 * ============================================================
 */
window.ICE_CONFIG = {
  iceServers: [
    // ---- STUN: giúp peer khám phá IP công cộng → sinh srflx candidate ----
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },

    // ---- TURN: relay media khi P2P thất bại → sinh relay candidate ----
    // Open Relay (https://www.metered.ca/tools/openrelay/) — miễn phí, không cần đăng ký
    {
      urls: [
        'turn:openrelay.metered.ca:80',            // UDP qua cổng 80 (vượt hầu hết firewall)
        'turn:openrelay.metered.ca:443',            // UDP qua cổng 443
        'turn:openrelay.metered.ca:443?transport=tcp', // TCP qua cổng 443
        'turns:openrelay.metered.ca:443?transport=tcp' // TLS qua cổng 443 (an toàn nhất)
      ],
      username: 'openrelayproject',
      credential: 'openrelayproject'
    }
  ],
  iceCandidatePoolSize: 10
};

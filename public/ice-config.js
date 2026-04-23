/**
 * ============================================================
 *  CẤU HÌNH ICE SERVERS (STUN + TURN)
 * ============================================================
 *
 *  CHỌN 1 TRONG 2 CẤU HÌNH TURN BÊN DƯỚI:
 *
 *  A) Metered.ca (khuyến nghị — đăng ký miễn phí, 500 MB/tháng):
 *     1. Vào https://dashboard.metered.ca/signup → tạo tài khoản miễn phí
 *     2. Vào TURN > Credentials → sao chép host, username, credential
 *     3. Dán vào khối TURN_A bên dưới và bỏ comment
 *
 *  B) Open Relay (không cần đăng ký, bandwidth hạn chế — chỉ dùng để test):
 *     Bỏ comment khối TURN_B bên dưới.
 *
 *  Xem TURN-SETUP.md mục "Free Options" để biết thêm chi tiết.
 * ============================================================
 */
window.ICE_CONFIG = {
  iceServers: [
    // ---- STUN miễn phí của Google ----
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },

    // ---- TURN_A: Metered.ca (tài khoản riêng — thay thông tin bên dưới) ----
    // {
    //   urls: [
    //     'turn:<YOUR_METERED_HOST>:80?transport=udp',
    //     'turn:<YOUR_METERED_HOST>:80?transport=tcp',
    //     'turns:<YOUR_METERED_HOST>:443?transport=tcp'
    //   ],
    //   username: '<YOUR_METERED_USERNAME>',
    //   credential: '<YOUR_METERED_CREDENTIAL>'
    // },

    // ---- TURN_B: Open Relay (không cần đăng ký, chỉ test) ----
    {
      urls: [
        'stun:openrelay.metered.ca:80',
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

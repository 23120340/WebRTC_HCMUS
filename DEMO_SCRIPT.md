# Kịch bản quay video demo — WebRTC Group Call

**Thời lượng mục tiêu:** 3–4 phút  
**Cần chuẩn bị:** 3 thiết bị (hoặc 2 máy + 1 điện thoại 4G)  
**URL sử dụng:** `https://webrtc-hcmus.onrender.com`

---

## Chuẩn bị trước khi quay

- [ ] Mở Render URL trên cả 3 thiết bị, đảm bảo server đã wake up (load lần đầu ~30s)
- [ ] Tắt thông báo hệ thống, âm lượng loa vừa phải (tránh echo)
- [ ] Chuẩn bị sẵn DevTools (F12) trên ít nhất 1 máy để show log
- [ ] Ghi màn hình bằng OBS/ShareX/QuickTime, capture cả tiếng
- [ ] Đặt phòng test: `demo-nop-bai` (hoặc tên ngắn dễ nhớ)

---

## Kịch bản chi tiết

### [0:00 – 0:20] Giới thiệu nhanh

> *Nói hoặc để text overlay:*  
> "Demo hệ thống WebRTC Group Call — Mesh topology + TURN server + Room management"

**Làm trên màn hình:**
- Show trang chủ `https://webrtc-hcmus.onrender.com`
- Zoom vào form lobby: ô Tên + ô Mã phòng + nút Vào phòng

---

### [0:20 – 0:50] Tạo phòng và join (3 người)

**Thiết bị 1 (Laptop A — màn hình đang quay):**
1. Nhập tên: `Alice`
2. Nhập mã phòng: `demo-nop-bai`
3. Bấm **Vào phòng** → camera/mic bật → vào call room

**Thiết bị 2 (Laptop B hoặc tab ẩn danh):**
1. Nhập tên: `Bob`
2. Nhập cùng mã phòng: `demo-nop-bai`
3. Bấm **Vào phòng** → *Alice thấy video Bob xuất hiện tự động*

**Thiết bị 3 (Điện thoại, dùng 4G — không cùng WiFi):**
1. Mở `https://webrtc-hcmus.onrender.com` trên 4G
2. Nhập tên: `Charlie`  
3. Nhập cùng mã phòng → join
4. *→ Alice và Bob thấy tile Charlie xuất hiện*

**Điều cần show rõ:**
- Grid video 3 người hiển thị đầy đủ
- Badge trạng thái trên mỗi tile: màu xanh lá = `connected`
- Charlie kết nối qua 4G → badge có thể đổi sang màu vàng = `relay` (TURN đang dùng)

---

### [0:50 – 1:20] Chứng minh TURN relay

**Trên Laptop A, mở DevTools (F12) → Console:**

1. Zoom vào console log, show log của Charlie (4G):
```
[Charlie] iceConnectionState=checking
[Charlie] Candidate gathered: typ=relay  ...
[Charlie] connectionState=connected
📊 Thống kê kết nối [Charlie]:
   Loại candidate: relay
```

2. **Hoặc** nếu kết nối ngay bằng P2P (srflx), giả lập bằng cách:
   - Tắt WiFi trên Laptop A trong khi đang gọi → `connectionState=disconnected`
   - Bật lại → hệ thống tự restartIce() → kết nối lại
   - Show log `restartIce()` trong console

> **Nói:** *"Badge màu vàng và log 'relay' xác nhận TURN server đang relay media cho peer dùng 4G"*

---

### [1:20 – 1:50] Các tính năng trong cuộc gọi

**Thực hiện từng thao tác, mỗi thao tác ~5 giây:**

1. **Tắt mic:** Bấm nút mic → icon đổi (thanh gạch chéo) → Bob/Charlie không nghe tiếng
2. **Bật lại mic:** Bấm lần nữa → icon trở về bình thường
3. **Tắt cam:** Bấm nút cam → video tile của Alice tối đen
4. **Bật lại cam**
5. **Chat:** Bấm nút chat → panel chat mở → gõ "Xin chào nhóm!" → Enter → Bob/Charlie thấy tin nhắn
6. **Chia sẻ màn hình:** Bấm nút màn hình → chọn tab/window → *Bob nhìn thấy màn hình của Alice*
   - Nút nhấp nháy xanh = đang share
   - Bấm lại → dừng → quay về camera

---

### [1:50 – 2:20] Tính năng ghim tile (Pin)

1. **Hover chuột** vào tile của Bob → thấy nút ghim (📌) góc trên trái
2. **Bấm ghim** → layout đổi: Bob's tile lớn bên trái, Alice + Charlie thành thumbnail nhỏ bên phải
3. Show layout "spotlight" giống Google Meet
4. **Bấm lại nút ghim** trên tile Bob → quay về layout grid bình thường

---

### [2:20 – 2:50] Charlie rời phòng → gọi lại không lỗi

1. **Charlie** (điện thoại) bấm nút **Rời phòng**
2. **Trên Alice:** tile Charlie biến mất tự động, chat hiện *"Charlie đã rời phòng"*
3. **Alice và Bob** vẫn gọi được bình thường (2 người còn lại)

**Gọi lại không lỗi:**
4. **Charlie** vào lại phòng `demo-nop-bai` với tên mới `Charlie2`
5. Tile `Charlie2` xuất hiện trên Alice + Bob
6. Grid tự điều chỉnh thành 3 người lại

---

### [2:50 – 3:20] Hangup và gọi lại

1. **Alice** bấm nút **Rời phòng** (nút đỏ) → quay về lobby
2. Bob và Charlie2 vẫn gọi nhau bình thường
3. **Alice** nhập lại tên `Alice` + mã phòng → vào phòng lại
4. Kết nối được ngay, grid 3 người bình thường

> **Nói:** *"Sau khi hangup và vào lại, hệ thống kết nối được ngay — không bị lỗi 'dừng xong không gọi lại được'"*

---

### [3:20 – 3:40] Mobile UI (tùy chọn)

Nếu quay cả màn hình điện thoại (Charlie, 4G):

1. Show giao diện lobby mobile
2. Show call room mobile: video grid 1 cột
3. Bấm nút chat → chat slide in full-screen từ phải
4. Bấm nút ← → chat đóng lại, quay về video

---

### [3:40 – 4:00] Kết thúc

> *Nói hoặc text overlay:*  
> "Hệ thống hỗ trợ: Room · Mesh Group Call · STUN/TURN · Screen Share · Mobile UI · Cloud Deploy"

- Show `/rooms` endpoint: `https://webrtc-hcmus.onrender.com/rooms` → thấy room `demo-nop-bai` với 3 thành viên
- Fade out

---

## Checklist trước khi nộp video

- [ ] Thấy rõ ít nhất **3 người** kết nối cùng lúc
- [ ] Có **log hoặc badge relay** chứng minh TURN hoạt động
- [ ] Thao tác **hangup + gọi lại** không lỗi
- [ ] Video **không bị lag/đơ** quá nhiều (nếu có, note trong report)
- [ ] Âm thanh rõ, không bị tiếng echo quá lớn
- [ ] Xuất file `.mp4`, kiểm tra play được trước khi nộp

---

## Mẹo quay

| Vấn đề | Giải pháp |
|---|---|
| Render sleep → server không kết nối | Load URL trước 2 phút, chờ wake up |
| 3 thiết bị khó điều phối | Nhờ 1-2 bạn hỗ trợ, hoặc dùng tab ẩn danh (2 người) + điện thoại |
| Echo tiếng | Dùng tai nghe, hoặc tắt mic các máy phụ |
| Badge không hiện `relay` | Thử dùng 4G thật, hoặc dùng tethering từ điện thoại |
| Quên show log | Mở DevTools trước, filter Console bằng "Thống kê" hoặc "relay" |

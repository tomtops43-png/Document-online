// ========================================================
// camera.js — ถ่ายรูป/เลือกรูป + resize ฝั่ง client ด้วย canvas
// ด้านยาวสุด 1280px, JPEG quality 0.8 → คืน base64 (ไม่รวม data: prefix)
// ========================================================

const Camera = {
  // สร้าง <input type="file"> ซ่อนไว้ แล้วเปิดกล้อง/แกลเลอรี
  // คืน Promise<{base64, dataUrl}> หรือ null ถ้าผู้ใช้ยกเลิก
  capture() {
    return new Promise(function (resolve, reject) {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.capture = 'environment'; // กล้องหลังบนแท็บเล็ต
      input.style.display = 'none';
      document.body.appendChild(input);

      input.addEventListener('change', async function () {
        const file = input.files && input.files[0];
        input.remove();
        if (!file) { resolve(null); return; }
        try {
          resolve(await Camera.resize(file));
        } catch (err) {
          reject(err);
        }
      });

      // ถ้าผู้ใช้ปิด dialog โดยไม่เลือก — ตรวจตอน window ได้ focus กลับ
      window.addEventListener('focus', function onFocus() {
        window.removeEventListener('focus', onFocus);
        setTimeout(function () {
          if (document.body.contains(input) && (!input.files || !input.files.length)) {
            input.remove();
            resolve(null);
          }
        }, 800);
      });

      input.click();
    });
  },

  // ย่อรูปด้วย canvas ให้ด้านยาวสุดไม่เกิน PHOTO_MAX_DIMENSION
  resize(file) {
    return new Promise(function (resolve, reject) {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = function () {
        URL.revokeObjectURL(url);
        const maxDim = CONFIG.PHOTO_MAX_DIMENSION;
        let w = img.naturalWidth, h = img.naturalHeight;
        if (Math.max(w, h) > maxDim) {
          const scale = maxDim / Math.max(w, h);
          w = Math.round(w * scale);
          h = Math.round(h * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL('image/jpeg', CONFIG.PHOTO_JPEG_QUALITY);
        resolve({
          dataUrl: dataUrl,
          base64: dataUrl.split(',')[1] // ตัด "data:image/jpeg;base64," ออก
        });
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('อ่านไฟล์รูปไม่สำเร็จ'));
      };
      img.src = url;
    });
  }
};

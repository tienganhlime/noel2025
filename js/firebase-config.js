// js/firebase-config.js

// TODO: Thay thế bằng Firebase config của bạn
const firebaseConfig = {
  apiKey: "AIzaSyAA8XMQuMf-SF5x7RScH4h4C0aTLatnxwI",
  authDomain: "noel-event.firebaseapp.com",
  projectId: "noel-event",
  storageBucket: "noel-event.firebasestorage.app",
  messagingSenderId: "108708305282",
  appId: "1:108708305282:web:10c88b862ec2276788d79b"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);

// Initialize services
const auth = firebase.auth();
const db = firebase.firestore();
// Không cần Storage nữa - lưu ảnh dạng Base64 trong Firestore

// Helper functions
const formatCurrency = (amount) => {
  return new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND'
  }).format(amount);
};

const formatDateTime = (timestamp) => {
  if (!timestamp) return '-';
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  return date.toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};

const formatDate = (timestamp) => {
  if (!timestamp) return '-';
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  return date.toLocaleDateString('vi-VN');
};

const formatTime = (timestamp) => {
  if (!timestamp) return '-';
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  return date.toLocaleTimeString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit'
  });
};

// Generate unique QR code
const generateQRCode = () => {
  return 'QR_' + Math.random().toString(36).substr(2, 9).toUpperCase();
};

// ===== IMGBB CONFIGURATION =====
// TODO: Thay YOUR_IMGBB_API_KEY bằng API key của bạn từ https://api.imgbb.com/
const IMGBB_API_KEY = '3b8cdfb8564d60c61ceaf76d3d248e1e';

// Upload image to ImgBB
const uploadImage = async (file, path) => {
  try {
    // Resize ảnh trước khi upload để nhanh hơn
    const resizedBase64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        resizeImage(reader.result, 1200, 1200, resolve);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    
    // Loại bỏ phần "data:image/jpeg;base64," để lấy base64 thuần
    const base64Data = resizedBase64.split(',')[1];
    
    // Upload lên ImgBB
    const formData = new FormData();
    formData.append('image', base64Data);
    
    const response = await fetch(`https://api.imgbb.com/1/upload?key=${IMGBB_API_KEY}`, {
      method: 'POST',
      body: formData
    });
    
    const data = await response.json();
    
    if (data.success) {
      return data.data.url; // URL ảnh trên ImgBB
    } else {
      throw new Error('ImgBB upload failed: ' + (data.error?.message || 'Unknown error'));
    }
  } catch (error) {
    console.error('Upload error:', error);
    throw error;
  }
};

// Resize ảnh để giảm dung lượng và tăng tốc upload
const resizeImage = (base64, maxWidth, maxHeight, callback) => {
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    let width = img.width;
    let height = img.height;
    
    // Tính toán kích thước mới giữ tỷ lệ
    if (width > height) {
      if (width > maxWidth) {
        height *= maxWidth / width;
        width = maxWidth;
      }
    } else {
      if (height > maxHeight) {
        width *= maxHeight / height;
        height = maxHeight;
      }
    }
    
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, width, height);
    
    // Chuyển thành base64 với chất lượng 0.8
    callback(canvas.toDataURL('image/jpeg', 0.8));
  };
  img.src = base64;
};

// Get current user email
const getCurrentUserEmail = () => {
  return auth.currentUser ? auth.currentUser.email : 'unknown';
};

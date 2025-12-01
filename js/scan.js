// js/scan.js

let currentStudent = null;
let capturedPhoto = null;
let videoStream = null;
let captureStream = null;
let scanningActive = false;
let searchFilter = 'checked-in';
let scanCount = 0;
let currentFacingMode = 'environment'; // ← THÊM DÒNG NÀY

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  startQRScanner();
  setupSearchListeners();
});

// Tab switching
function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
  
  if (tab === 'scan') {
    document.querySelector('[onclick="switchTab(\'scan\')"]').classList.add('active');
    document.getElementById('scanTab').classList.add('active');
    startQRScanner();
  } else {
    document.querySelector('[onclick="switchTab(\'search\')"]').classList.add('active');
    document.getElementById('searchTab').classList.add('active');
    stopQRScanner();
    loadStudentsForSearch();
  }
}

// Start QR Scanner
async function startQRScanner() {
  const video = document.getElementById('video');
  const statusDiv = document.getElementById('scanStatus');
  
  try {
    // Request camera với constraints tốt hơn
    const constraints = {
      video: { 
        facingMode: 'environment',
        width: { ideal: 1280 },
        height: { ideal: 720 }
      }
    };
    
    videoStream = await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject = videoStream;
    
    // Đợi video sẵn sàng
    video.onloadedmetadata = () => {
      video.play();
      scanningActive = true;
      statusDiv.innerHTML = '<div class="success">Camera đã sẵn sàng. Đưa QR code vào khung hình...</div>';
      scanQRCode();
    };
    
  } catch (error) {
    console.error('Camera error:', error);
    let errorMsg = 'Không thể truy cập camera. ';
    
    if (error.name === 'NotAllowedError') {
      errorMsg += 'Vui lòng cho phép truy cập camera trong cài đặt trình duyệt.';
    } else if (error.name === 'NotFoundError') {
      errorMsg += 'Không tìm thấy camera trên thiết bị.';
    } else {
      errorMsg += error.message;
    }
    
    statusDiv.innerHTML = `<div class="error">${errorMsg}</div>`;
  }
}

// Stop QR Scanner
function stopQRScanner() {
  scanningActive = false;
  if (videoStream) {
    videoStream.getTracks().forEach(track => track.stop());
    videoStream = null;
  }
}

// Scan QR Code
function scanQRCode() {
  if (!scanningActive) return;
  
  const video = document.getElementById('video');
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  
  // Đợi video ready
  if (video.readyState !== video.HAVE_ENOUGH_DATA) {
    requestAnimationFrame(scanQRCode);
    return;
  }
  
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  
  if (canvas.width > 0 && canvas.height > 0) {
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    
    // Check if jsQR exists
    if (typeof jsQR === 'undefined') {
      console.error('jsQR library not loaded!');
      document.getElementById('scanStatus').innerHTML = '<div class="error">Lỗi: Thư viện QR scanner chưa load</div>';
      return;
    }
    
    const code = jsQR(imageData.data, imageData.width, imageData.height, {
      inversionAttempts: "dontInvert",
    });
    
    if (code) {
      console.log('QR Code detected:', code.data);
      scanningActive = false;
      handleQRCodeScanned(code.data);
      return;
    }
  }
  
  requestAnimationFrame(scanQRCode);
}

// Handle QR Code scanned
async function handleQRCodeScanned(qrData) {
  const statusDiv = document.getElementById('scanStatus');
  statusDiv.innerHTML = '<div class="loading">Đang tải thông tin...</div>';
  
  try {
    const snapshot = await db.collection('students').where('qrCode', '==', qrData).get();
    
    if (snapshot.empty) {
      statusDiv.innerHTML = '<div class="error">Không tìm thấy học sinh với mã QR này</div>';
      setTimeout(() => {
        statusDiv.innerHTML = '';
        scanningActive = true;
        scanQRCode();
      }, 2000);
      return;
    }
    
    const doc = snapshot.docs[0];
    currentStudent = { id: doc.id, ...doc.data() };
    
    stopQRScanner();
    showStudentDetail(currentStudent);
    
  } catch (error) {
    console.error('Error loading student:', error);
    statusDiv.innerHTML = '<div class="error">Lỗi: ' + error.message + '</div>';
  }
}

// Show student detail
function showStudentDetail(student) {
  const detailDiv = document.getElementById('studentDetail');
  const contentDiv = document.getElementById('studentContent');
  
  document.getElementById('scanTab').style.display = 'none';
  document.getElementById('searchTab').style.display = 'none';
  detailDiv.style.display = 'block';
  
  // Check-in case
  if (student.status === 'not-arrived') {
    const feeDisplay = student.feeStatus === 'paid' ? `
      <div class="fee-info fee-paid">
        <p>💰 Phí: ${formatCurrency(student.feeAmount)}</p>
        <p class="fee-status">✅ ĐÃ ĐÓNG TRƯỚC</p>
      </div>
    ` : `
      <div class="fee-info fee-unpaid">
        <p>💰 Phí cần thu: ${formatCurrency(student.feeAmount)}</p>
        <p class="fee-status">⚠️ CHƯA ĐÓNG PHÍ</p>
        <label class="checkbox-label">
          <input type="checkbox" id="feeCollectedCheckbox">
          <span>✓ Đã thu ${formatCurrency(student.feeAmount)}</span>
        </label>
      </div>
    `;
    
    contentDiv.innerHTML = `
      <button onclick="backToScan()" class="btn-back">← Quay lại</button>
      
      <div class="student-header">
        <h2>📛 ${student.name}</h2>
        <p class="student-class">🎓 Lớp ${student.class}</p>
        <p>👨‍👩‍👦 Đi cùng: ${student.accompaniedBy}</p>
        <p>🎟️ Số coupon: ${student.coupons}</p>
      </div>
      
      ${feeDisplay}
      
      <div class="action-section">
        <p class="status-text">Chưa check-in</p>
        <button onclick="openCameraForCheckIn()" class="btn-primary btn-large">📷 Chụp ảnh check-in</button>
      </div>
    `;
  }
  // Check-out case
  else if (student.status === 'checked-in') {
    contentDiv.innerHTML = `
      <button onclick="backToScan()" class="btn-back">← Quay lại</button>
      
      <div class="student-header">
        <h2>📛 ${student.name}</h2>
        <p class="student-class">🎓 Lớp ${student.class}</p>
      </div>
      
      <div class="checkin-info">
        <h3>✅ Check-in</h3>
        <p>Thời gian: ${formatDateTime(student.checkIn.time)}</p>
        ${student.checkIn.photoUrl ? `<img src="${student.checkIn.photoUrl}" alt="Ảnh check-in" class="check-photo">` : ''}
        <p class="time-elapsed">⏰ Đã ở đây: ${getTimeElapsed(student.checkIn.time)}</p>
      </div>
      
      <div class="action-section">
        <button onclick="openCameraForCheckOut()" class="btn-success btn-large">📷 Chụp ảnh về với phụ huynh</button>
      </div>
    `;
  }
  // Already checked-out
  else if (student.status === 'checked-out') {
    contentDiv.innerHTML = `
      <button onclick="backToScan()" class="btn-back">← Quay lại</button>
      
      <div class="completed-status">
        <h2>✅ ĐÃ CHECK-OUT</h2>
      </div>
      
      <div class="student-header">
        <h2>📛 ${student.name}</h2>
        <p class="student-class">🎓 Lớp ${student.class}</p>
      </div>
      
      <div class="checkin-info">
        <h3>Check-in</h3>
        <p>${formatDateTime(student.checkIn.time)}</p>
        ${student.checkIn.photoUrl ? `<img src="${student.checkIn.photoUrl}" alt="Ảnh check-in" class="check-photo">` : ''}
      </div>
      
      <div class="checkout-info">
        <h3>Check-out</h3>
        <p>${formatDateTime(student.checkOut.time)}</p>
        ${student.checkOut.photoUrl ? `<img src="${student.checkOut.photoUrl}" alt="Ảnh check-out" class="check-photo">` : ''}
      </div>
    `;
  }
}

// Back to scan
function backToScan() {
  document.getElementById('studentDetail').style.display = 'none';
  document.getElementById('scanTab').style.display = 'block';
  currentStudent = null;
  capturedPhoto = null;
  scanningActive = true;
  startQRScanner();
}

// Get time elapsed
function getTimeElapsed(timestamp) {
  const now = new Date();
  const checkInTime = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  const diffMs = now - checkInTime;
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  return `${hours} giờ ${minutes} phút`;
}

// Open camera for check-in
async function openCameraForCheckIn() {
  // Validate fee if unpaid
  if (currentStudent.feeStatus === 'unpaid') {
    const checkbox = document.getElementById('feeCollectedCheckbox');
    if (!checkbox.checked) {
      alert('⚠️ Vui lòng xác nhận đã thu phí!');
      return;
    }
  }
  
  await openCamera();
}

// Open camera for check-out
async function openCameraForCheckOut() {
  await openCamera();
}

// Open camera
async function openCamera() {
  const captureDiv = document.getElementById('cameraCapture');
  const video = document.getElementById('captureVideo');
  
  try {
    // Dùng camera SAU (environment) để chụp học sinh
    captureStream = await navigator.mediaDevices.getUserMedia({
      video: { 
        facingMode: 'environment' // Camera sau
      }
    });
    video.srcObject = captureStream;
    
    document.getElementById('studentDetail').style.display = 'none';
    captureDiv.style.display = 'block';
  } catch (error) {
    console.error('Camera error:', error);
    
    // Nếu không có camera sau, thử camera trước
    if (error.name === 'OverconstrainedError' || error.name === 'ConstraintNotSatisfiedError') {
      try {
        captureStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user' } // Camera trước
        });
        video.srcObject = captureStream;
        
        document.getElementById('studentDetail').style.display = 'none';
        captureDiv.style.display = 'block';
        
        alert('⚠️ Không tìm thấy camera sau. Đang dùng camera trước.');
      } catch (err2) {
        alert('Không thể mở camera: ' + err2.message);
      }
    } else {
      alert('Không thể mở camera: ' + error.message);
    }
  }
}

// Close camera capture
function closeCameraCapture() {
  if (captureStream) {
    captureStream.getTracks().forEach(track => track.stop());
    captureStream = null;
  }
  document.getElementById('cameraCapture').style.display = 'none';
  document.getElementById('studentDetail').style.display = 'block';
}
// Switch camera (front/back)
async function switchCamera() {
  currentFacingMode = currentFacingMode === 'environment' ? 'user' : 'environment';
  
  if (captureStream) {
    captureStream.getTracks().forEach(track => track.stop());
  }
  
  const video = document.getElementById('captureVideo');
  try {
    captureStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: currentFacingMode }
    });
    video.srcObject = captureStream;
  } catch (error) {
    console.error('Switch camera error:', error);
    alert('Không thể chuyển camera: ' + error.message);
    
    currentFacingMode = currentFacingMode === 'environment' ? 'user' : 'environment';
    try {
      captureStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: currentFacingMode }
      });
      video.srcObject = captureStream;
    } catch (err2) {
      alert('Lỗi camera: ' + err2.message);
    }
  }
}
// Take picture
function takePicture() {
  const video = document.getElementById('captureVideo');
  const canvas = document.getElementById('captureCanvas');
  const context = canvas.getContext('2d');
  
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  context.drawImage(video, 0, 0);
  
  capturedPhoto = canvas.toDataURL('image/jpeg', 0.8);
  
  // Close camera
  if (captureStream) {
    captureStream.getTracks().forEach(track => track.stop());
    captureStream = null;
  }
  
  // Show preview
  document.getElementById('cameraCapture').style.display = 'none';
  showPhotoPreview();
}

// Show photo preview
function showPhotoPreview() {
  const previewDiv = document.getElementById('photoPreview');
  const previewImage = document.getElementById('previewImage');
  const controls = previewDiv.querySelector('.preview-controls');
  
  previewImage.src = capturedPhoto;
  previewDiv.style.display = 'block';
  
  // Update button based on status
  if (currentStudent.status === 'not-arrived') {
    controls.innerHTML = `
      <button onclick="confirmCheckIn()" class="btn-success btn-large">✓ Xác nhận CHECK-IN</button>
      <button onclick="retakePhoto()" class="btn-secondary">↻ Chụp lại</button>
    `;
  } else if (currentStudent.status === 'checked-in') {
    controls.innerHTML = `
      <button onclick="confirmCheckOut()" class="btn-success btn-large">✓ Xác nhận CHECK-OUT</button>
      <button onclick="retakePhoto()" class="btn-secondary">↻ Chụp lại</button>
    `;
  }
}

// Retake photo
function retakePhoto() {
  document.getElementById('photoPreview').style.display = 'none';
  capturedPhoto = null;
  
  if (currentStudent.status === 'not-arrived') {
    openCameraForCheckIn();
  } else {
    openCameraForCheckOut();
  }
}

// Confirm check-in
async function confirmCheckIn() {
  if (!capturedPhoto || !currentStudent) return;
  
  try {
    // Show loading
    document.getElementById('photoPreview').innerHTML = '<div class="loading">Đang xử lý...</div>';
    
    // Upload photo
    const blob = await fetch(capturedPhoto).then(r => r.blob());
    const fileName = `checkin/${currentStudent.id}_${Date.now()}.jpg`;
    const photoUrl = await uploadImage(blob, fileName);
    
    // Update student
    const updateData = {
      status: 'checked-in',
      checkIn: {
        time: firebase.firestore.Timestamp.now(),
        photoUrl: photoUrl,
        feeCollected: currentStudent.feeStatus === 'paid' ? false : true
      }
    };
    
    // Update fee if collected
    if (currentStudent.feeStatus === 'unpaid') {
      updateData.feeStatus = 'paid';
      updateData.feePaidAt = firebase.firestore.Timestamp.now();
      updateData.feePaidBy = 'staff_checkin';
      updateData.feeHistory = firebase.firestore.FieldValue.arrayUnion({
        timestamp: firebase.firestore.Timestamp.now(),
        changedBy: 'staff_checkin',
        action: 'collected',
        oldStatus: 'unpaid',
        newStatus: 'paid',
        amount: currentStudent.feeAmount,
        note: 'Thu phí tại check-in'
      });
    }
    
    await db.collection('students').doc(currentStudent.id).update(updateData);
    
    // Show success
    document.getElementById('photoPreview').innerHTML = `
      <div class="success-message">
        <h2>✅ Check-in thành công!</h2>
        <p>${currentStudent.name}</p>
        <button onclick="backToScan()" class="btn-primary">Tiếp tục quét</button>
      </div>
    `;
    
  } catch (error) {
    console.error('Check-in error:', error);
    alert('Lỗi check-in: ' + error.message);
    document.getElementById('photoPreview').style.display = 'none';
    document.getElementById('studentDetail').style.display = 'block';
  }
}

// Confirm check-out
async function confirmCheckOut() {
  if (!capturedPhoto || !currentStudent) return;
  
  try {
    // Show loading
    document.getElementById('photoPreview').innerHTML = '<div class="loading">Đang xử lý...</div>';
    
    // Upload photo
    const blob = await fetch(capturedPhoto).then(r => r.blob());
    const fileName = `checkout/${currentStudent.id}_${Date.now()}.jpg`;
    const photoUrl = await uploadImage(blob, fileName);
    
    // Update student
    await db.collection('students').doc(currentStudent.id).update({
      status: 'checked-out',
      checkOut: {
        time: firebase.firestore.Timestamp.now(),
        photoUrl: photoUrl
      }
    });
    
    // Show success
    document.getElementById('photoPreview').innerHTML = `
      <div class="success-message">
        <h2>✅ Check-out thành công!</h2>
        <p>${currentStudent.name}</p>
        <button onclick="backToScan()" class="btn-primary">Tiếp tục quét</button>
      </div>
    `;
    
  } catch (error) {
    console.error('Check-out error:', error);
    alert('Lỗi check-out: ' + error.message);
    document.getElementById('photoPreview').style.display = 'none';
    document.getElementById('studentDetail').style.display = 'block';
  }
}

// Search functionality
function setupSearchListeners() {
  document.getElementById('searchStudentInput').addEventListener('input', searchStudents);
  
  document.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      searchFilter = chip.dataset.filter;
      searchStudents();
    });
  });
}

async function loadStudentsForSearch() {
  searchStudents();
}

async function searchStudents() {
  const searchTerm = document.getElementById('searchStudentInput').value.toLowerCase();
  const resultsDiv = document.getElementById('searchResults');
  
  try {
    let query = db.collection('students');
    
    if (searchFilter === 'checked-in') {
      query = query.where('status', '==', 'checked-in');
    }
    
    const snapshot = await query.get();
    let students = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    
    // Filter by search term
    if (searchTerm) {
      students = students.filter(s => s.name.toLowerCase().includes(searchTerm));
    }
    
    if (students.length === 0) {
      resultsDiv.innerHTML = '<div class="empty-state">Không tìm thấy học sinh</div>';
      return;
    }
    
    const html = students.map(s => `
      <div class="student-search-item" onclick="selectStudent('${s.id}')">
        <h3>${s.name}</h3>
        <p>Lớp ${s.class} • ${s.status === 'checked-in' ? '✅ Đã check-in' : s.status}</p>
      </div>
    `).join('');
    
    resultsDiv.innerHTML = html;
    
  } catch (error) {
    console.error('Search error:', error);
    resultsDiv.innerHTML = '<div class="error">Lỗi tìm kiếm</div>';
  }
}

async function selectStudent(studentId) {
  try {
    const doc = await db.collection('students').doc(studentId).get();
    if (doc.exists) {
      currentStudent = { id: doc.id, ...doc.data() };
      showStudentDetail(currentStudent);
    }
  } catch (error) {
    console.error('Load student error:', error);
    alert('Lỗi: ' + error.message);
  }
}

// Test QR Code manually
function testQRCode() {
  const qrCode = prompt('Nhập mã QR để test (hoặc để trống để test với mã mẫu):');
  const testCode = qrCode || 'QR_TEST123';
  console.log('Testing with QR code:', testCode);
  handleQRCodeScanned(testCode);
}

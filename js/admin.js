// js/admin.js

let allStudents = [];
let currentFilter = 'all';

// Check authentication
auth.onAuthStateChanged((user) => {
  if (!user) {
    window.location.href = 'login.html';
  } else {
    document.getElementById('userEmail').textContent = user.email;
    loadStudents();
  }
});

// Logout
function handleLogout() {
  auth.signOut().then(() => {
    window.location.href = 'login.html';
  });
}

// Upload Excel file
async function handleUpload() {
  const fileInput = document.getElementById('excelFile');
  const statusDiv = document.getElementById('uploadStatus');
  
  if (!fileInput.files[0]) {
    statusDiv.innerHTML = '<div class="error">Vui lòng chọn file Excel</div>';
    return;
  }
  
  statusDiv.innerHTML = '<div class="loading">Đang xử lý file...</div>';
  
  const file = fileInput.files[0];
  const reader = new FileReader();
  
  reader.onload = async (e) => {
    try {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const jsonData = XLSX.utils.sheet_to_json(firstSheet);
      
      statusDiv.innerHTML = `<div class="loading">Đang tạo ${jsonData.length} học sinh...</div>`;
      
      let count = 0;
      
      for (const row of jsonData) {
        const qrCode = generateQRCode();
        
        // Parse fee status
        const feeStatusText = (row['Đã đóng phí'] || '').toString().toLowerCase();
        const feeStatus = (feeStatusText.includes('rồi') || feeStatusText.includes('đã')) ? 'paid' : 'unpaid';
        
        // Parse accompanied by
        const accompaniedText = (row['Đi cùng bố mẹ'] || '').toString();
        const accompaniedBy = accompaniedText.toLowerCase().includes('không') ? 'Không' : accompaniedText;
        
        const studentData = {
          name: row['Họ tên'] || '',
          class: row['Lớp'] || '',
          accompaniedBy: accompaniedBy,
          coupons: parseInt(row['Số coupon']) || 0,
          feeAmount: parseInt(row['Số tiền phí']) || 0,
          feeStatus: feeStatus,
          feePaidAt: feeStatus === 'paid' ? firebase.firestore.Timestamp.now() : null,
          feePaidBy: feeStatus === 'paid' ? 'before_event' : null,
          feeNote: feeStatus === 'paid' ? 'Đã đóng trước sự kiện' : '',
          feeHistory: feeStatus === 'paid' ? [{
            timestamp: firebase.firestore.Timestamp.now(),
            changedBy: getCurrentUserEmail(),
            action: 'marked_paid',
            oldStatus: 'unpaid',
            newStatus: 'paid',
            amount: parseInt(row['Số tiền phí']) || 0,
            note: 'Import từ Excel - Đã đóng trước'
          }] : [],
          qrCode: qrCode,
          status: 'not-arrived',
          checkIn: null,
          checkOut: null,
          createdAt: firebase.firestore.Timestamp.now()
        };
        
        await db.collection('students').add(studentData);
        count++;
        statusDiv.innerHTML = `<div class="loading">Đã tạo ${count}/${jsonData.length} học sinh...</div>`;
      }
      
      statusDiv.innerHTML = `<div class="success">✅ Đã tạo thành công ${count} học sinh!</div>`;
      loadStudents();
      fileInput.value = '';
      
    } catch (error) {
      console.error('Upload error:', error);
      statusDiv.innerHTML = `<div class="error">Lỗi: ${error.message}</div>`;
    }
  };
  
  reader.readAsArrayBuffer(file);
}

// Load students from Firestore
async function loadStudents() {
  try {
    const snapshot = await db.collection('students').get();
    allStudents = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
    
    updateStatistics();
    renderStudents();
    
  } catch (error) {
    console.error('Load error:', error);
    document.getElementById('studentsList').innerHTML = '<div class="error">Lỗi tải dữ liệu</div>';
  }
}

// Update statistics
function updateStatistics() {
  const total = allStudents.length;
  const checkedIn = allStudents.filter(s => s.status === 'checked-in').length;
  const checkedOut = allStudents.filter(s => s.status === 'checked-out').length;
  const notArrived = allStudents.filter(s => s.status === 'not-arrived').length;
  const feePaid = allStudents.filter(s => s.feeStatus === 'paid').length;
  const feeUnpaid = allStudents.filter(s => s.feeStatus === 'unpaid').length;
  const totalMoney = allStudents
    .filter(s => s.feeStatus === 'paid')
    .reduce((sum, s) => sum + (s.feeAmount || 0), 0);
  
  document.getElementById('statTotal').textContent = total;
  document.getElementById('statCheckedIn').textContent = checkedIn;
  document.getElementById('statCheckedOut').textContent = checkedOut;
  document.getElementById('statNotArrived').textContent = notArrived;
  document.getElementById('statFeePaid').textContent = feePaid;
  document.getElementById('statFeeUnpaid').textContent = feeUnpaid;
  document.getElementById('statTotalMoney').textContent = formatCurrency(totalMoney);
}

// Render students list
function renderStudents() {
  const listDiv = document.getElementById('studentsList');
  const searchTerm = document.getElementById('searchInput').value.toLowerCase();
  
  let filtered = allStudents.filter(student => {
    // Search filter
    if (searchTerm && !student.name.toLowerCase().includes(searchTerm)) {
      return false;
    }
    
    // Status filter
    if (currentFilter === 'not-arrived' && student.status !== 'not-arrived') return false;
    if (currentFilter === 'checked-in' && student.status !== 'checked-in') return false;
    if (currentFilter === 'checked-out' && student.status !== 'checked-out') return false;
    if (currentFilter === 'fee-paid' && student.feeStatus !== 'paid') return false;
    if (currentFilter === 'fee-unpaid' && student.feeStatus !== 'unpaid') return false;
    if (currentFilter === 'with-parents' && student.accompaniedBy === 'Không') return false;
    if (currentFilter === 'alone' && student.accompaniedBy !== 'Không') return false;
    
    return true;
  });
  
  if (filtered.length === 0) {
    listDiv.innerHTML = '<div class="empty-state">Không tìm thấy học sinh nào</div>';
    return;
  }
  
  const html = filtered.map(student => {
    const statusBadge = getStatusBadge(student.status);
    const feeBadge = getFeeBadge(student.feeStatus);
    
    return `
      <div class="student-card">
        <div class="student-info">
          <h3>${student.name}</h3>
          <p>Lớp: ${student.class}</p>
          <div class="badges">
            ${statusBadge}
            ${feeBadge}
          </div>
        </div>
        <div class="student-actions">
          <button onclick="showQRCode('${student.id}')" class="btn-secondary">📱 QR Code</button>
          <button onclick="showStudentDetail('${student.id}')" class="btn-primary">Chi tiết</button>
        </div>
      </div>
    `;
  }).join('');
  
  listDiv.innerHTML = html;
}

// Get status badge HTML
function getStatusBadge(status) {
  const badges = {
    'not-arrived': '<span class="badge badge-gray">Chưa đến</span>',
    'checked-in': '<span class="badge badge-blue">Đã check-in</span>',
    'checked-out': '<span class="badge badge-green">Đã check-out</span>'
  };
  return badges[status] || '';
}

// Get fee badge HTML
function getFeeBadge(feeStatus) {
  return feeStatus === 'paid' 
    ? '<span class="badge badge-success">💰 Đã đóng phí</span>'
    : '<span class="badge badge-warning">⏳ Chưa đóng phí</span>';
}

// Show QR Code modal
function showQRCode(studentId) {
  const student = allStudents.find(s => s.id === studentId);
  if (!student) return;
  
  const modal = document.getElementById('qrModal');
  const content = document.getElementById('qrContent');
  
  content.innerHTML = `
    <h2>Mã QR Check-in</h2>
    <div id="qrcode"></div>
    <div class="qr-info">
      <h3>${student.name}</h3>
      <p>Lớp ${student.class}</p>
    </div>
    <p class="qr-hint">Chụp màn hình để gửi cho phụ huynh</p>
  `;
  
  modal.style.display = 'block';
  
  // Generate QR code
  setTimeout(() => {
    new QRCode(document.getElementById('qrcode'), {
      text: student.qrCode,
      width: 256,
      height: 256
    });
  }, 100);
}

function closeQRModal() {
  document.getElementById('qrModal').style.display = 'none';
}

// Show student detail modal
function showStudentDetail(studentId) {
  const student = allStudents.find(s => s.id === studentId);
  if (!student) return;
  
  const modal = document.getElementById('studentModal');
  const content = document.getElementById('modalContent');
  
  const checkInInfo = student.checkIn ? `
    <div class="detail-section">
      <h3>✅ Check-in</h3>
      <p>Thời gian: ${formatDateTime(student.checkIn.time)}</p>
      ${student.checkIn.photoUrl ? `<img src="${student.checkIn.photoUrl}" alt="Ảnh check-in" class="check-photo">` : ''}
    </div>
  ` : '';
  
  const checkOutInfo = student.checkOut ? `
    <div class="detail-section">
      <h3>👋 Check-out</h3>
      <p>Thời gian: ${formatDateTime(student.checkOut.time)}</p>
      ${student.checkOut.photoUrl ? `<img src="${student.checkOut.photoUrl}" alt="Ảnh check-out" class="check-photo">` : ''}
    </div>
  ` : '';
  
  const feeHistoryHtml = (student.feeHistory || []).map(h => `
    <li>${formatDateTime(h.timestamp)} - ${h.note} (${h.changedBy})</li>
  `).join('');
  
  content.innerHTML = `
    <h2>📋 Chi tiết học sinh</h2>
    
    <div class="detail-section">
      <h3>📛 ${student.name}</h3>
      <p>🎓 Lớp: ${student.class}</p>
      <p>👨‍👩‍👦 Đi cùng: ${student.accompaniedBy}</p>
      <p>🎟️ Số coupon: ${student.coupons}</p>
    </div>
    
    <div class="detail-section">
      <h3>💰 Thông tin phí</h3>
      <div class="form-group">
        <label>Số tiền phí:</label>
        <input type="number" id="editFeeAmount" value="${student.feeAmount}" class="form-input">
      </div>
      <div class="form-group">
        <label>Trạng thái:</label>
        <div class="radio-group">
          <label>
            <input type="radio" name="feeStatus" value="paid" ${student.feeStatus === 'paid' ? 'checked' : ''}>
            Đã đóng
          </label>
          <label>
            <input type="radio" name="feeStatus" value="unpaid" ${student.feeStatus === 'unpaid' ? 'checked' : ''}>
            Chưa đóng
          </label>
        </div>
      </div>
      <div class="form-group">
        <label>Ghi chú:</label>
        <textarea id="editFeeNote" class="form-input" rows="2">${student.feeNote || ''}</textarea>
      </div>
      ${feeHistoryHtml ? `
        <div class="fee-history">
          <h4>📜 Lịch sử thay đổi phí:</h4>
          <ul>${feeHistoryHtml}</ul>
        </div>
      ` : ''}
      <button onclick="saveFeeUpdate('${student.id}')" class="btn-success">💾 Lưu thay đổi phí</button>
    </div>
    
    ${checkInInfo}
    ${checkOutInfo}
  `;
  
  modal.style.display = 'block';
}

function closeModal() {
  document.getElementById('studentModal').style.display = 'none';
}

// Save fee update
async function saveFeeUpdate(studentId) {
  const student = allStudents.find(s => s.id === studentId);
  if (!student) return;
  
  const newAmount = parseInt(document.getElementById('editFeeAmount').value);
  const newStatus = document.querySelector('input[name="feeStatus"]:checked').value;
  const newNote = document.getElementById('editFeeNote').value;
  
  const updateData = {
    feeAmount: newAmount,
    feeStatus: newStatus,
    feeNote: newNote
  };
  
  // Add to history if status changed
  if (student.feeStatus !== newStatus) {
    const historyEntry = {
      timestamp: firebase.firestore.Timestamp.now(),
      changedBy: getCurrentUserEmail(),
      action: 'updated',
      oldStatus: student.feeStatus,
      newStatus: newStatus,
      amount: newAmount,
      note: newNote || 'Admin cập nhật'
    };
    
    updateData.feeHistory = firebase.firestore.FieldValue.arrayUnion(historyEntry);
    
    if (newStatus === 'paid') {
      updateData.feePaidAt = firebase.firestore.Timestamp.now();
      updateData.feePaidBy = 'admin';
    }
  }
  
  try {
    await db.collection('students').doc(studentId).update(updateData);
    alert('✅ Đã cập nhật thông tin phí!');
    closeModal();
    loadStudents();
  } catch (error) {
    console.error('Update error:', error);
    alert('❌ Lỗi cập nhật: ' + error.message);
  }
}

// Export to Excel
function exportToExcel() {
  const exportData = allStudents.map(s => ({
    'Họ tên': s.name,
    'Lớp': s.class,
    'Đi cùng': s.accompaniedBy,
    'Số coupon': s.coupons,
    'Phí': s.feeAmount,
    'Trạng thái phí': s.feeStatus === 'paid' ? 'Đã đóng' : 'Chưa đóng',
    'Check-in': s.checkIn ? formatDateTime(s.checkIn.time) : '-',
    'Check-out': s.checkOut ? formatDateTime(s.checkOut.time) : '-',
    'Ghi chú': s.feeNote || '-'
  }));
  
  const ws = XLSX.utils.json_to_sheet(exportData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Danh sách');
  XLSX.writeFile(wb, `event-checkin-${Date.now()}.xlsx`);
}

// Filter buttons
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.filter;
      renderStudents();
    });
  });
  
  document.getElementById('searchInput').addEventListener('input', renderStudents);
});

// Close modal on outside click
window.onclick = function(event) {
  const modal = document.getElementById('studentModal');
  const qrModal = document.getElementById('qrModal');
  if (event.target === modal) {
    closeModal();
  }
  if (event.target === qrModal) {
    closeQRModal();
  }
}

// js/admin.js

let allStudents = [];
let currentFilter = 'all';
let editingStudentId = null; 

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
  <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
    <h3>📋 ${student.name}</h3>
    <div style="display: flex; gap: 10px;">
      <button onclick="showEditStudentForm('${student.id}')" class="btn-secondary">✏️ Sửa</button>
      <button onclick="deleteStudent('${student.id}')" class="btn-secondary" style="background: #dc3545;">🗑️ Xóa</button>
    </div>
  </div>
    <p>Thời gian: ${formatDateTime(student.checkIn.time)}</p>
    ${student.checkIn.photoUrl ? `<img src="${student.checkIn.photoUrl}" alt="Ảnh check-in" class="check-photo">` : ''}
    <button onclick="deleteCheckIn('${student.id}')" class="btn-secondary" style="margin-top: 10px;">🗑️ Xóa check-in</button>
  </div>
` : '';
  
  const checkOutInfo = student.checkOut ? `
  <div class="detail-section">
    <h3>👋 Check-out</h3>
    <p>Thời gian: ${formatDateTime(student.checkOut.time)}</p>
    ${student.checkOut.photoUrl ? `<img src="${student.checkOut.photoUrl}" alt="Ảnh check-out" class="check-photo">` : ''}
    <button onclick="deleteCheckOut('${student.id}')" class="btn-secondary" style="margin-top: 10px;">🗑️ Xóa check-out</button>
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
  // Filter buttons
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
  const addModal = document.getElementById('addStudentModal');
  if (event.target === modal) {
    closeModal();
  }
  if (event.target === qrModal) {
    closeQRModal();
  }
  if (event.target === addModal) {
    closeAddStudentModal();
  }
}

// Download Excel template
function downloadExcelTemplate() {
  const templateData = [
    {
      'Họ tên': 'Nguyễn Văn A',
      'Lớp': '1A',
      'Đi cùng bố mẹ': 'Có (2 người)',
      'Số coupon': 3,
      'Đã đóng phí': 'Rồi',
      'Số tiền phí': 200000
    },
    {
      'Họ tên': 'Trần Thị B',
      'Lớp': '1B',
      'Đi cùng bố mẹ': 'Không',
      'Số coupon': 2,
      'Đã đóng phí': 'Chưa',
      'Số tiền phí': 200000
    },
    {
      'Họ tên': 'Lê Văn C',
      'Lớp': '2A',
      'Đi cùng bố mẹ': 'Có (1 người)',
      'Số coupon': 5,
      'Đã đóng phí': 'Rồi',
      'Số tiền phí': 200000
    }
  ];
  
  const ws = XLSX.utils.json_to_sheet(templateData);
  
  // Set column widths
  ws['!cols'] = [
    { wch: 20 }, // Họ tên
    { wch: 10 }, // Lớp
    { wch: 20 }, // Đi cùng bố mẹ
    { wch: 12 }, // Số coupon
    { wch: 15 }, // Đã đóng phí
    { wch: 15 }  // Số tiền phí
  ];
  
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Danh sách mẫu');
  
  // Add instructions sheet
  const instructionsData = [
    { 'Hướng dẫn': 'Cột "Họ tên": Nhập họ tên đầy đủ của học sinh' },
    { 'Hướng dẫn': 'Cột "Lớp": Nhập lớp (VD: 1A, 2B, 3C...)' },
    { 'Hướng dẫn': 'Cột "Đi cùng bố mẹ": Nhập "Không" nếu đi một mình, hoặc "Có (2 người)" nếu đi cùng' },
    { 'Hướng dẫn': 'Cột "Số coupon": Nhập số lượng coupon (số nguyên)' },
    { 'Hướng dẫn': 'Cột "Đã đóng phí": Nhập "Rồi" hoặc "Đã" nếu đã đóng, "Chưa" nếu chưa đóng' },
    { 'Hướng dẫn': 'Cột "Số tiền phí": Nhập số tiền (VD: 200000) - không có dấu phẩy' },
    { 'Hướng dẫn': '' },
    { 'Hướng dẫn': 'Sau khi điền xong, lưu file và upload lên hệ thống' }
  ];
  const wsInstructions = XLSX.utils.json_to_sheet(instructionsData);
  wsInstructions['!cols'] = [{ wch: 80 }];
  XLSX.utils.book_append_sheet(wb, wsInstructions, 'Hướng dẫn');
  
  XLSX.writeFile(wb, 'Mau_Danh_Sach_Hoc_Sinh.xlsx');
}

// Show add student form
function showAddStudentForm() {
  editingStudentId = null; // Reset editing mode
  
  const modal = document.getElementById('addStudentModal');
  modal.style.display = 'block';
  
  // Reset title and button text
  document.querySelector('#addStudentModal h2').textContent = '➕ Thêm học sinh mới';
  document.querySelector('#addStudentForm button[type="submit"]').textContent = '💾 Lưu học sinh';
  
  // Reset form
  document.getElementById('addStudentForm').reset();
  document.getElementById('newStudentFee').value = 200000;
  document.getElementById('newStudentCoupons').value = 0;
}

function closeAddStudentModal() {
  document.getElementById('addStudentModal').style.display = 'none';
}

// Delete check-in
async function deleteCheckIn(studentId) {
  if (!confirm('⚠️ Bạn có chắc muốn xóa thông tin check-in? Học sinh sẽ quay về trạng thái "Chưa đến".')) {
    return;
  }
  
  try {
    await db.collection('students').doc(studentId).update({
      status: 'not-arrived',
      checkIn: null
    });
    
    alert('✅ Đã xóa check-in!');
    closeModal();
    loadStudents();
  } catch (error) {
    console.error('Delete check-in error:', error);
    alert('❌ Lỗi xóa: ' + error.message);
  }
}

// Delete check-out
async function deleteCheckOut(studentId) {
  if (!confirm('⚠️ Bạn có chắc muốn xóa thông tin check-out? Học sinh sẽ quay về trạng thái "Đã check-in".')) {
    return;
  }
  
  try {
    await db.collection('students').doc(studentId).update({
      status: 'checked-in',
      checkOut: null
    });
    
    alert('✅ Đã xóa check-out!');
    closeModal();
    loadStudents();
  } catch (error) {
    console.error('Delete check-out error:', error);
    alert('❌ Lỗi xóa: ' + error.message);
  }
}
// Show edit student form
function showEditStudentForm(studentId) {
  const student = allStudents.find(s => s.id === studentId);
  if (!student) return;
  
  editingStudentId = studentId;
  
  // Fill form with current data
  document.getElementById('newStudentName').value = student.name;
  document.getElementById('newStudentClass').value = student.class;
  document.getElementById('newStudentAccompanied').value = student.accompaniedBy;
  document.getElementById('newStudentCoupons').value = student.coupons;
  document.getElementById('newStudentFee').value = student.feeAmount;
  
  if (student.feeStatus === 'paid') {
    document.querySelector('input[name="newFeeStatus"][value="paid"]').checked = true;
  } else {
    document.querySelector('input[name="newFeeStatus"][value="unpaid"]').checked = true;
  }
  
  document.getElementById('newStudentNote').value = student.feeNote || '';
  
  // Change modal title and button
  document.querySelector('#addStudentModal h2').textContent = '✏️ Sửa thông tin học sinh';
  document.querySelector('#addStudentForm button[type="submit"]').textContent = '💾 Cập nhật học sinh';
  
  // Close detail modal and show edit modal
  closeModal();
  document.getElementById('addStudentModal').style.display = 'block';
}

// Update handleAddStudent to support editing
async function handleAddStudentOrUpdate(event) {
  event.preventDefault();
  
  const name = document.getElementById('newStudentName').value.trim();
  const studentClass = document.getElementById('newStudentClass').value.trim();
  const accompanied = document.getElementById('newStudentAccompanied').value;
  const coupons = parseInt(document.getElementById('newStudentCoupons').value);
  const feeAmount = parseInt(document.getElementById('newStudentFee').value);
  const feeStatus = document.querySelector('input[name="newFeeStatus"]:checked').value;
  const note = document.getElementById('newStudentNote').value.trim();
  
  if (!name || !studentClass) {
    alert('⚠️ Vui lòng nhập đầy đủ họ tên và lớp!');
    return;
  }
  
  const submitBtn = event.target.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  
  try {
    // EDITING MODE
    if (editingStudentId) {
      const student = allStudents.find(s => s.id === editingStudentId);
      
      const updateData = {
        name: name,
        class: studentClass,
        accompaniedBy: accompanied,
        coupons: coupons,
        feeAmount: feeAmount,
        feeStatus: feeStatus,
        feeNote: note
      };
      
      // Add to history if fee status changed
      if (student.feeStatus !== feeStatus) {
        const historyEntry = {
          timestamp: firebase.firestore.Timestamp.now(),
          changedBy: getCurrentUserEmail(),
          action: 'updated',
          oldStatus: student.feeStatus,
          newStatus: feeStatus,
          amount: feeAmount,
          note: note || 'Admin cập nhật'
        };
        
        updateData.feeHistory = firebase.firestore.FieldValue.arrayUnion(historyEntry);
        
        if (feeStatus === 'paid') {
          updateData.feePaidAt = firebase.firestore.Timestamp.now();
          updateData.feePaidBy = 'admin';
        }
      }
      
      await db.collection('students').doc(editingStudentId).update(updateData);
      alert('✅ Đã cập nhật thông tin học sinh: ' + name);
      
      editingStudentId = null;
      closeAddStudentModal();
      loadStudents();
      
    } 
    // ADDING MODE
    else {
      const qrCode = generateQRCode();
      
      const studentData = {
        name: name,
        class: studentClass,
        accompaniedBy: accompanied,
        coupons: coupons,
        feeAmount: feeAmount,
        feeStatus: feeStatus,
        feePaidAt: feeStatus === 'paid' ? firebase.firestore.Timestamp.now() : null,
        feePaidBy: feeStatus === 'paid' ? 'admin' : null,
        feeNote: note || (feeStatus === 'paid' ? 'Đã đóng trước sự kiện' : ''),
        feeHistory: feeStatus === 'paid' ? [{
          timestamp: firebase.firestore.Timestamp.now(),
          changedBy: getCurrentUserEmail(),
          action: 'marked_paid',
          oldStatus: 'unpaid',
          newStatus: 'paid',
          amount: feeAmount,
          note: note || 'Thêm mới - Đã đóng trước'
        }] : [],
        qrCode: qrCode,
        status: 'not-arrived',
        checkIn: null,
        checkOut: null,
        createdAt: firebase.firestore.Timestamp.now()
      };
      
      await db.collection('students').add(studentData);
      alert('✅ Đã thêm học sinh: ' + name);
      closeAddStudentModal();
      loadStudents();
    }
    
  } catch (error) {
    console.error('Save error:', error);
    alert('❌ Lỗi: ' + error.message);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = editingStudentId ? '💾 Cập nhật học sinh' : '💾 Lưu học sinh';
  }
}

// Delete student
async function deleteStudent(studentId) {
  const student = allStudents.find(s => s.id === studentId);
  if (!student) return;
  
  const confirmMsg = `⚠️ BẠN CÓ CHẮC CHẮN MUỐN XÓA?

Học sinh: ${student.name}
Lớp: ${student.class}

⛔ Hành động này KHÔNG THỂ hoàn tác!
Tất cả thông tin check-in/out và ảnh sẽ bị xóa vĩnh viễn.

Nhập "XOA" (viết hoa) để xác nhận:`;
  
  const confirmation = prompt(confirmMsg);
  
  if (confirmation !== 'XOA') {
    alert('❌ Đã hủy xóa.');
    return;
  }
  
  try {
    await db.collection('students').doc(studentId).delete();
    alert('✅ Đã xóa học sinh: ' + student.name);
    closeModal();
    loadStudents();
  } catch (error) {
    console.error('Delete error:', error);
    alert('❌ Lỗi xóa: ' + error.message);
  }
}
// ==================== PRINT QR CODES ====================
// ==================== PRINT QR CODES ====================
async function printAllQRCodes() {
  if (!allStudents || allStudents.length === 0) {
    alert('⚠️ Chưa có học sinh nào trong hệ thống!');
    return;
  }

  if (!confirm(`Bạn có muốn in ${allStudents.length} mã QR không?`)) {
    return;
  }

  const loadingDiv = document.createElement('div');
  loadingDiv.style.cssText = 'position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: white; padding: 30px; border-radius: 10px; box-shadow: 0 4px 20px rgba(0,0,0,0.3); z-index: 99999; text-align: center;';
  loadingDiv.innerHTML = '<div style="font-size: 20px; font-weight: bold; margin-bottom: 10px;">⏳ Đang tạo mã QR...</div><div style="color: #666;">Vui lòng đợi...</div>';
  document.body.appendChild(loadingDiv);

  try {
    let printContainer = document.getElementById('printContainer');
    if (!printContainer) {
      printContainer = document.createElement('div');
      printContainer.id = 'printContainer';
      printContainer.className = 'print-container';
      document.body.appendChild(printContainer);
    }
    printContainer.innerHTML = '';

    const logoUrl = 'https://gofirst.pro/images/uploads/62/baseimg/logo_16541442053.png';
    const hotline = '0976222792';
    const studentsPerPage = 6;
    const totalPages = Math.ceil(allStudents.length / studentsPerPage);

    // Tạo tất cả QR code TRƯỚC
    const qrPromises = allStudents.map(student => {
      return new Promise((resolve) => {
        const tempDiv = document.createElement('div');
        new QRCode(tempDiv, {
          text: student.qrCode,
          width: 100,
          height: 100,
          correctLevel: QRCode.CorrectLevel.H
        });
        setTimeout(() => {
          const canvas = tempDiv.querySelector('canvas');
          if (canvas) {
            resolve({
              id: student.id,
              dataUrl: canvas.toDataURL('image/png')
            });
          } else {
            resolve({ id: student.id, dataUrl: null });
          }
        }, 100);
      });
    });

    const qrResults = await Promise.all(qrPromises);
    const qrMap = {};
    qrResults.forEach(r => {
      qrMap[r.id] = r.dataUrl;
    });

    // Tạo các trang in
    for (let pageIndex = 0; pageIndex < totalPages; pageIndex++) {
      const pageDiv = document.createElement('div');
      pageDiv.className = 'qr-page';

      const startIdx = pageIndex * studentsPerPage;
      const endIdx = Math.min(startIdx + studentsPerPage, allStudents.length);
      const studentsInPage = allStudents.slice(startIdx, endIdx);

      for (let rowIndex = 0; rowIndex < 3; rowIndex++) {
        const rowDiv = document.createElement('div');
        rowDiv.className = 'qr-row';

        for (let colIndex = 0; colIndex < 2; colIndex++) {
          const studentIndex = rowIndex * 2 + colIndex;
          
          if (studentIndex < studentsInPage.length) {
            const student = studentsInPage[studentIndex];
            const cardDiv = document.createElement('div');
            cardDiv.className = 'qr-card';

            // Logo
            const logoImg = document.createElement('img');
            logoImg.src = logoUrl;
            logoImg.className = 'qr-card-logo';
            logoImg.alt = 'LIME';
            logoImg.onerror = function() { this.style.display = 'none'; };
            cardDiv.appendChild(logoImg);

            // QR Code từ data URL
            const qrDiv = document.createElement('div');
            qrDiv.className = 'qr-card-qrcode';
            if (qrMap[student.id]) {
              const qrImg = document.createElement('img');
              qrImg.src = qrMap[student.id];
              qrImg.style.width = '100px';
              qrImg.style.height = '100px';
              qrDiv.appendChild(qrImg);
            }
            cardDiv.appendChild(qrDiv);

            // Thông tin
            const nameDiv = document.createElement('div');
            nameDiv.className = 'qr-card-name';
            nameDiv.textContent = student.name;
            cardDiv.appendChild(nameDiv);

            const classDiv = document.createElement('div');
            classDiv.className = 'qr-card-class';
            classDiv.textContent = `Lớp: ${student.class}`;
            cardDiv.appendChild(classDiv);

            const hotlineDiv = document.createElement('div');
            hotlineDiv.className = 'qr-card-hotline';
            hotlineDiv.textContent = `📞 Hotline: ${hotline}`;
            cardDiv.appendChild(hotlineDiv);

            rowDiv.appendChild(cardDiv);
          }
        }
        pageDiv.appendChild(rowDiv);
      }
      printContainer.appendChild(pageDiv);
    }

    document.body.removeChild(loadingDiv);

    // Hiện container và in
    printContainer.style.position = 'static';
    printContainer.style.visibility = 'visible';
    printContainer.style.left = '0';
    
    setTimeout(() => {
      window.print();
      
      setTimeout(() => {
        printContainer.style.position = 'absolute';
        printContainer.style.visibility = 'hidden';
        printContainer.style.left = '-9999px';
      }, 1000);
    }, 300);

  } catch (error) {
    console.error('Error:', error);
    alert('❌ Có lỗi khi tạo mã QR: ' + error.message);
    if (document.body.contains(loadingDiv)) {
      document.body.removeChild(loadingDiv);
    }
  }
}

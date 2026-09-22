// File: src/utils/customerExcel.js
// Tiện ích Nhập / Xuất danh sách khách hàng bằng file Excel
import * as XLSX from 'xlsx';
import { removeDiacritics, normalizeText } from './textNormalize';

export { removeDiacritics, normalizeText };
const normalizeHeader = normalizeText;

// Các biến thể tiêu đề cột (đã chuẩn hoá bỏ dấu, bỏ khoảng trắng) ứng với từng field dữ liệu
const HEADER_ALIASES = {
  customerId: ['makh', 'ma', 'macongty', 'mahkd', 'customerid'],
  companyName: ['tencongty', 'tencongtyhkd', 'tencty', 'tenkhachhang', 'congtyhkd', 'tencongtyhkd'],
  address: ['diachi'],
  taxCode: ['masothue', 'mst'],
  phone: ['sodienthoai', 'sdt', 'dienthoai', 'phone'],
  email: ['email'],
  bankAccount: ['sotaikhoan', 'stk', 'sotk'],
  bankName: ['nganhang', 'tennganhang'],
  representative: ['nguoidaidien', 'daidien'],
  position: ['chucvu'],
  receiverName: ['tennguoinhan', 'nguoinhan', 'nguoinhanhang'],
  receivingAddress: ['diachinhan', 'diachinhanhang'],
  saleCode: ['masale'],
  saleName: ['tensale'],
  departmentName: ['phongban'],
};

function buildFieldMap(headerRow) {
  const map = {}; // colIndex -> fieldKey
  headerRow.forEach((h, idx) => {
    const norm = normalizeHeader(h);
    if (!norm) return;
    for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
      if (aliases.includes(norm)) { map[idx] = field; break; }
    }
  });
  return map;
}

// Tự dò dòng tiêu đề thật trong vài dòng đầu (nhiều file có vài dòng trống/tiêu đề phụ phía trên) —
// quét tối đa 15 dòng đầu, chọn dòng khớp được nhiều cột nhất và bắt buộc phải nhận ra Mã KH + Tên công ty.
function findHeaderRow(raw) {
  let best = { rowIndex: 0, fieldMap: {}, score: -1 };
  const maxScan = Math.min(raw.length, 15);
  for (let r = 0; r < maxScan; r++) {
    const fieldMap = buildFieldMap(raw[r] || []);
    const values = Object.values(fieldMap);
    const ok = values.includes('customerId') && values.includes('companyName');
    const score = Object.keys(fieldMap).length + (ok ? 100 : 0);
    if (ok && score > best.score) best = { rowIndex: r, fieldMap, score };
  }
  return best;
}

export const TEMPLATE_HEADERS = [
  'Mã KH', 'Tên công ty / HKD', 'Địa chỉ', 'Mã số thuế', 'Số điện thoại', 'Email',
  'Số tài khoản', 'Ngân hàng', 'Người đại diện', 'Chức vụ', 'Tên người nhận', 'Địa chỉ nhận',
  'Mã Sale', 'Tên Sale', 'Phòng ban',
];

// Tải file mẫu Excel để điền
export function downloadCustomerTemplate() {
  const example = [
    'KH001', 'CÔNG TY TNHH VÍ DỤ', '123 Đường ABC, Quận 1, TP.HCM', '0312345678',
    '0901234567', 'contact@vidu.com', '19012345678', 'Vietcombank', 'Nguyễn Văn A', 'Giám đốc',
    'Trần Thị C', '456 Đường XYZ, Quận 2, TP.HCM',
    'CTS01', 'Nguyễn Thị B', 'Phòng Kinh doanh 1',
  ];
  const ws = XLSX.utils.aoa_to_sheet([TEMPLATE_HEADERS, example]);
  ws['!cols'] = TEMPLATE_HEADERS.map(() => ({ wch: 22 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Khách hàng');
  XLSX.writeFile(wb, 'Mau_nhap_khach_hang_CTS.xlsx');
}

// Đọc file Excel khách hàng do người dùng chọn -> trả về { rows, errors }
// saleProfiles: danh sách tài khoản sale thật [{ uuid, name, ma_sale, deptName }] để đối chiếu tên trong file
export async function parseCustomersFile(file, departments = {}, saleProfiles = []) {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  if (raw.length < 2) return { rows: [], errors: ['File không có dữ liệu (cần ít nhất 1 dòng tiêu đề + 1 dòng khách hàng).'] };

  const { rowIndex: headerRowIndex, fieldMap } = findHeaderRow(raw);
  if (!Object.values(fieldMap).includes('customerId') || !Object.values(fieldMap).includes('companyName')) {
    return { rows: [], errors: ['Không nhận diện được cột "Mã KH" hoặc "Tên công ty / HKD" trong 15 dòng đầu của file. Vui lòng dùng đúng file mẫu.'] };
  }

  const deptByName = {};
  Object.entries(departments).forEach(([id, d]) => {
    deptByName[normalizeHeader(d.name)] = id;
  });

  // Đối chiếu theo tên hoặc mã sale (không phân biệt hoa/thường, có dấu/không dấu)
  const saleByKey = {};
  saleProfiles.forEach((p) => {
    if (p.name) saleByKey[normalizeHeader(p.name)] = p;
    if (p.ma_sale) saleByKey[normalizeHeader(p.ma_sale)] = p;
  });

  const rows = [];
  const errors = [];
  const seenIds = new Set();

  for (let r = headerRowIndex + 1; r < raw.length; r++) {
    const line = raw[r];
    if (!line || line.every((c) => String(c).trim() === '')) continue; // bỏ qua dòng trống
    const rowNum = r + 1;

    const obj = {};
    line.forEach((cell, idx) => {
      const field = fieldMap[idx];
      if (field) obj[field] = String(cell ?? '').trim();
    });

    const customerId = obj.customerId;
    const companyName = obj.companyName;
    if (!customerId) { errors.push(`Dòng ${rowNum}: thiếu "Mã KH", đã bỏ qua.`); continue; }
    if (!companyName) { errors.push(`Dòng ${rowNum} (${customerId}): thiếu "Tên công ty / HKD", đã bỏ qua.`); continue; }
    if (seenIds.has(customerId)) { errors.push(`Dòng ${rowNum}: mã KH "${customerId}" bị trùng trong file, đã bỏ qua.`); continue; }

    // Đối chiếu tên sale trong file với danh sách tài khoản sale thật — không khớp thì bỏ qua cả dòng
    const saleKeyRaw = obj.saleName || obj.saleCode || '';
    const saleProfile = saleByKey[normalizeHeader(saleKeyRaw)];
    if (!saleKeyRaw) { errors.push(`Dòng ${rowNum} (${customerId}): không có tên Sale, đã bỏ qua dòng này.`); continue; }
    if (!saleProfile) { errors.push(`Dòng ${rowNum} (${customerId}): không tìm thấy Sale tên "${saleKeyRaw}" trong hệ thống, đã bỏ qua dòng này.`); continue; }

    seenIds.add(customerId);

    let departmentId = '';
    if (obj.departmentName) {
      departmentId = deptByName[normalizeHeader(obj.departmentName)] || '';
      if (!departmentId) errors.push(`Dòng ${rowNum} (${customerId}): không tìm thấy phòng ban "${obj.departmentName}", để trống phòng ban.`);
    }

    rows.push({
      customerId,
      data: {
        companyName,
        address: obj.address || '',
        taxCode: obj.taxCode || '',
        phone: obj.phone || '',
        email: obj.email || '',
        bankAccount: obj.bankAccount || '',
        bankName: obj.bankName || '',
        representative: obj.representative || '',
        position: obj.position || '',
        receiverName: obj.receiverName || '',
        receivingAddress: obj.receivingAddress || '',
        assignedSale: { code: saleProfile.ma_sale || '', name: saleProfile.name || '', accountId: saleProfile.uuid || '' },
        departmentId,
      },
    });
  }

  return { rows, errors };
}

// Xuất danh sách khách hàng đang hiển thị ra file Excel
// entries: mảng [ [id, customerData], ... ]
export function exportCustomersToExcel(entries, departments = {}) {
  const deptName = (id) => departments[id]?.name || '';
  const data = entries.map(([id, c]) => ({
    'Mã KH': id,
    'Tên công ty / HKD': c.companyName || '',
    'Địa chỉ': c.address || '',
    'Mã số thuế': c.taxCode || '',
    'Số điện thoại': c.phone || '',
    'Email': c.email || '',
    'Số tài khoản': c.bankAccount || '',
    'Ngân hàng': c.bankName || '',
    'Người đại diện': c.representative || '',
    'Chức vụ': c.position || '',
    'Tên người nhận': c.receiverName || '',
    'Địa chỉ nhận': c.receivingAddress || '',
    'Mã Sale': c.assignedSale?.code || '',
    'Tên Sale': c.assignedSale?.name || '',
    'Phòng ban': deptName(c.departmentId),
  }));
  const ws = XLSX.utils.json_to_sheet(data, { header: TEMPLATE_HEADERS });
  ws['!cols'] = TEMPLATE_HEADERS.map(() => ({ wch: 22 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Khách hàng');
  const today = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `Danh_sach_khach_hang_CTS_${today}.xlsx`);
}

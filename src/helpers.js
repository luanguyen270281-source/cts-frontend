// File: src/helpers.js
import { normalizeText } from './utils/customerExcel';

// Lấy đúng Mã Sale của khách hàng để dùng khi sinh số hợp đồng/ĐĐH.
// Một số khách hàng cũ chỉ lưu Tên Sale mà chưa lưu Mã Sale (dữ liệu trước khi có dropdown chọn sale) —
// hàm này tự đối chiếu theo tên với hồ sơ đang đăng nhập hoặc danh sách saleProfiles (admin) để tìm ra mã đúng.
export const resolveSaleCode = (customer, { profile, saleProfiles = [] } = {}) => {
  const assigned = customer?.assignedSale;
  if (assigned?.code) return assigned.code;
  const name = assigned?.name;
  if (!name) return '';
  const target = normalizeText(name);
  if (profile?.full_name && normalizeText(profile.full_name) === target) return profile.ma_sale || '';
  const found = saleProfiles.find((p) => normalizeText(p.name) === target);
  return found?.ma_sale || '';
};

export const fmtDate = (d) => {
  if (!d) return '';
  const dt = new Date(d + 'T00:00:00');
  return `ngày ${dt.getDate()} tháng ${dt.getMonth() + 1} năm ${dt.getFullYear()}`;
};

// Định dạng số có dấu CHẤM phân cách hàng nghìn — TỰ VIẾT, KHÔNG dùng toLocaleString('vi-VN')
// vì toLocaleString phụ thuộc vào bộ ngôn ngữ cài trên từng máy/trình duyệt: máy có locale vi-VN thì
// hiện "5.000.000" (dấu chấm), máy thiếu locale lại hiện "5,000,000" (dấu phẩy) hoặc "5000000" —
// gây ra tình trạng "mỗi máy hiển thị một khác". Hàm này cho kết quả GIỐNG NHAU trên mọi máy.
// maxDecimals: số chữ số thập phân tối đa (mặc định 0 = làm tròn về số nguyên). Việc làm tròn này
// khử luôn phần thập phân rác kiểu "32.886.216,000000004" — do sai số dấu phẩy động khi máy tính
// nhân/cộng số thực (vd 0.1+0.2 = 0.30000000000000004).
export const formatThousands = (raw, maxDecimals = 0) => {
  if (raw === '' || raw === null || raw === undefined) return '';
  let n = Number(raw);
  if (!isFinite(n)) return '';
  // Làm tròn tới maxDecimals chữ số thập phân để bỏ phần rác do sai số dấu phẩy động
  const factor = Math.pow(10, maxDecimals);
  n = Math.round(n * factor) / factor;
  const neg = n < 0;
  const [intPart, decPart] = Math.abs(n).toString().split('.');
  const withDots = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return (neg ? '-' : '') + withDots + (decPart ? ',' + decPart : '');
};

// Tiền VNĐ: luôn là số nguyên (không có xu lẻ), làm tròn để khử phần thập phân rác.
export const fmtNum = (n) => formatThousands(Number(n || 0), 0);

export const calcTotals = (goods) => {
  let subtotal = 0, vat = 0;
  (goods || []).forEach(g => {
    const pre = Number(g.thanhTien) || 0;
    const rate = g.vatRate !== undefined ? Number(g.vatRate) : 8;
    subtotal += pre;
    vat += Math.round(pre * rate / 100);
  });
  return { subtotal, vat, total: subtotal + vat };
};

// Tổng giá trị tiền hàng (USD) — dùng cho hợp đồng ủy thác nhập khẩu (không tính VAT, chỉ cộng thành tiền)
export const calcUSDTotal = (goods) => (goods || []).reduce((sum, g) => sum + (Number(g.thanhTien) || 0), 0);

const readHundred = (n) => {
  const ones = ['', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];
  if (n === 0) return '';
  const h = Math.floor(n / 100), t = Math.floor((n % 100) / 10), o = n % 10;
  let s = '';
  if (h) s += ones[h] + ' trăm';
  if (t === 1) {
    s += ' mười';
    if (o === 5) s += ' lăm'; else if (o) s += ' ' + ones[o];
  } else if (t > 1) {
    s += ' ' + ones[t] + ' mươi';
    if (o === 1) s += ' mốt'; else if (o === 5) s += ' lăm'; else if (o) s += ' ' + ones[o];
  } else if (h && o) {
    s += ' lẻ ' + ones[o];
  } else if (o) {
    s += ones[o];
  }
  return s.trim();
};

export const numberToWords = (n, unit = 'đồng') => {
  const num = Math.round(Number(n) || 0);
  if (num === 0) return `Không ${unit}`;
  const units = ['', 'nghìn', 'triệu', 'tỷ'];
  let parts = [], tmp = num, i = 0;
  while (tmp > 0) { parts.push([tmp % 1000, units[i++]]); tmp = Math.floor(tmp / 1000); }
  const words = parts.reverse().filter(p => p[0]).map(([v, u]) => readHundred(v) + (u ? ' ' + u : '')).join(' ');
  return words.charAt(0).toUpperCase() + words.slice(1) + ` ${unit}`;
};

export const getInitials = (name) => {
  if (!name) return '';
  const cleaned = name
    .replace(/công\s+ty/gi, ' ')
    .replace(/\btnhh\b/gi, ' ')
    .replace(/cổ\s+phần/gi, ' ')
    .replace(/\bcp\b/gi, ' ')
    .replace(/\bhkd\b/gi, ' ')
    .replace(/\bmtv\b/gi, ' ');
  const words = cleaned.trim().split(/\s+/).filter(w => w.length > 0);
  if (words.length === 0) return name[0]?.toUpperCase() || '';
  return words.map(w => w[0].toUpperCase()).join('');
};

export const genSellerId = (sellers) => {
  const nums = Object.keys(sellers).map(k => parseInt(k.replace('SELLER', ''))).filter(x => !isNaN(x));
  const next = nums.length ? Math.max(...nums) + 1 : 1;
  return 'SELLER' + String(next).padStart(3, '0');
};

// Mã cho "Bên bán nước ngoài" (nhà máy Trung Quốc...) — dùng riêng cho Sales Contract, KHÔNG liên quan tới
// "sellers" (Công ty Bên Bán = chính CTS) đang dùng cho HĐNT/ĐĐH/BBBG.
export const genForeignSellerId = (foreignSellers) => {
  const nums = Object.keys(foreignSellers).map(k => parseInt(k.replace('FSELLER', ''))).filter(x => !isNaN(x));
  const next = nums.length ? Math.max(...nums) + 1 : 1;
  return 'FSELLER' + String(next).padStart(3, '0');
};

export const genDeptId = (departments) => {
  const nums = Object.keys(departments).map(k => parseInt(k.replace('DEPT', ''))).filter(x => !isNaN(x));
  const next = nums.length ? Math.max(...nums) + 1 : 1;
  return 'DEPT' + String(next).padStart(3, '0');
};

export const CONTRACT_ABBR = {
  HDNT: 'HĐNTMB', DDH: 'ĐĐH', BBBG: 'BBBG',
  HDNT_VC: 'HĐNTVC', DDH_VC: 'ĐHVC', BBBG_VC: 'BBBGVC',
  HDNT_UT: 'HĐNTUT', DDH_UT: 'ĐHUT', BBBG_UT: 'BBBGUT',
};

// Màu badge dùng chung cho mọi nơi hiển thị loại hợp đồng (Dashboard, danh sách, ContractViewer...)
export const TYPE_COLOR = {
  HDNT: 'green', DDH: 'yellow', BBBG: 'purple',
  HDNT_VC: 'green', DDH_VC: 'yellow', BBBG_VC: 'purple',
  HDNT_UT: 'green', DDH_UT: 'yellow', BBBG_UT: 'purple',
};

export const fmtYYMMDD = (dateStr) => {
  if (!dateStr) return 'YYMMDD';
  const d = new Date(dateStr + 'T00:00:00');
  return String(d.getFullYear()).slice(2) + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
};

// DDMMYY — dùng riêng cho số hợp đồng Sales Contract (theo đúng quy ước bên bán Trung Quốc hay dùng, vd GJ/AD-250726)
export const fmtDDMMYY = (dateStr) => {
  if (!dateStr) return 'DDMMYY';
  const d = new Date(dateStr + 'T00:00:00');
  return String(d.getDate()).padStart(2, '0') + String(d.getMonth() + 1).padStart(2, '0') + String(d.getFullYear()).slice(2);
};

// Gợi ý số Sales Contract dạng "GJ/AD-250726" (chữ đầu Seller / chữ đầu Buyer - DDMMYY). Chỉ là gợi ý, người dùng sửa được.
export const buildSalesContractNo = ({ sellerName, buyerName, date }) => {
  const sellerInit = getInitials(sellerName) || 'XX';
  const buyerInit = getInitials(buyerName) || 'XX';
  return `${sellerInit}/${buyerInit}-${fmtDDMMYY(date)}`;
};

// Đọc số tiền USD ra chữ tiếng Anh, dùng cho dòng "Say: ..." trên Sales Contract (vd "Twenty-eight thousand ... US dollars only.")
export const amountToWordsEN = (amount) => {
  const onesW = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
    'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tensW = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const threeDigitsEN = (n) => {
    let str = '';
    if (n >= 100) {
      str += onesW[Math.floor(n / 100)] + ' Hundred';
      n %= 100;
      if (n > 0) str += ' ';
    }
    if (n >= 20) {
      str += tensW[Math.floor(n / 10)];
      // Chuẩn Anh–Mỹ: viết hoa chữ cái đầu của cả phần đơn vị (Ninety-Two, không phải Ninety-two)
      if (n % 10 > 0) str += '-' + onesW[n % 10];
    } else if (n > 0) {
      str += onesW[n];
    }
    return str;
  };
  // Đọc một số nguyên (>=0) thành chữ theo nhóm nghìn/triệu/tỷ. Trả '' nếu bằng 0.
  const intToWords = (num) => {
    if (num === 0) return '';
    const groupsW = ['', ' Thousand', ' Million', ' Billion'];
    let n = num, groupIndex = 0;
    const parts = [];
    while (n > 0) {
      const chunk = n % 1000;
      if (chunk > 0) parts.unshift(threeDigitsEN(chunk) + groupsW[groupIndex]);
      n = Math.floor(n / 1000);
      groupIndex++;
    }
    return parts.join(' ');
  };
  const dollars = Math.floor(Number(amount) || 0);
  const cents = Math.round(((Number(amount) || 0) - dollars) * 100);
  if (dollars === 0 && cents === 0) return 'Zero US Dollars Only.';

  let words = intToWords(dollars);
  words += (dollars === 1 ? ' US Dollar' : ' US Dollars');
  // Phần xu đọc thành chữ: "and Eighty-One Cents"
  if (cents > 0) {
    words += ' and ' + threeDigitsEN(cents) + (cents === 1 ? ' Cent' : ' Cents');
  }
  return words + ' Only.';
};

export const buildContractId = ({ type, date, saleCode, stt, sellerName, customerName }) => {
  const seq = String(stt || '').replace(/\D/g, '').slice(0, 3);
  const sellerInit = getInitials(sellerName) || '—';
  const customerInit = getInitials(customerName) || '—';
  const yymmdd = fmtYYMMDD(date);
  const maSale = saleCode || '—';
  const sttPad = seq ? seq.padStart(3, '0') : '—';
  const loai = CONTRACT_ABBR[type] || type;
  return `${yymmdd}/${maSale}/${sttPad}/${loai}/${sellerInit}-${customerInit}`;
};

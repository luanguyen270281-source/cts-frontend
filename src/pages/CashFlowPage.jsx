// File: src/pages/CashFlowPage.jsx
// Bảng theo dõi dòng tiền dạng nhập liệu trực tiếp kiểu Excel (mỗi dòng = 1 lô hàng).
import { useState, useMemo, useRef, useEffect, Fragment } from 'react';
import { fmtNum, formatThousands } from '../helpers';
import * as XLSX from 'xlsx';
import { Pagination } from '../components/Pagination';
import { buildCustomerOptions, resolveCustomerId, parseCustomerOptionValue, encodeCustomerOptionValue } from '../utils/customerOptions';
import { PaymentRequestPrint } from './PaymentRequestPrint';
import { api } from '../lib/api';

const num = (v) => Number(v) || 0;
const EMPTY_SET = new Set();

// Input số có dấu phân cách hàng nghìn, hiện định dạng NGAY KHI GÕ mà KHÔNG làm nhảy/lệch con trỏ
// (bug cũ: gõ "5000" bị nhảy thành "5500" do React đặt lại value đã format nhưng không tính lại vị trí
// con trỏ theo số chữ số đã gõ trước đó — dẫn đến chữ số tiếp theo bị chèn sai chỗ).
// Cách sửa: đếm số CHỮ SỐ đứng trước con trỏ ở giá trị cũ, sau khi format lại thì đặt con trỏ ngay sau
// đúng số chữ số đó trong chuỗi mới.
const FormattedNumberInput = ({ value, onChange, onBlur, disabled, className }) => {
  const ref = useRef(null);
  const focusedRef = useRef(false);
  const fmt = (raw) => (raw === '' || raw === null || raw === undefined ? '' : formatThousands(raw));
  const [text, setText] = useState(fmt(value));

  // Chỉ đồng bộ text theo value từ ngoài KHI ô KHÔNG đang được gõ, VÀ số thực sự khác nhau.
  // So sánh theo phần chữ số thuần (bỏ dấu chấm) để không bị lệch khi format đổi dấu phân cách.
  useEffect(() => {
    if (focusedRef.current) return; // đang gõ thì tuyệt đối không đè
    const incoming = (value === '' || value === null || value === undefined) ? '' : String(value).replace(/[^\d]/g, '');
    const current = text.replace(/[^\d]/g, '');
    if (incoming !== current) setText(fmt(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const handleChange = (e) => {
    const input = e.target;
    const caret = input.selectionStart ?? input.value.length;
    const digitsBeforeCaret = input.value.slice(0, caret).replace(/[^\d]/g, '').length;
    const raw = input.value.replace(/[^\d]/g, '');
    const formatted = fmt(raw);
    setText(formatted);
    onChange(raw === '' ? '' : raw);
    requestAnimationFrame(() => {
      if (!ref.current) return;
      let seen = 0, pos = formatted.length;
      if (digitsBeforeCaret === 0) {
        pos = 0;
      } else {
        for (let i = 0; i < formatted.length; i++) {
          if (/\d/.test(formatted[i])) {
            seen++;
            if (seen === digitsBeforeCaret) { pos = i + 1; break; }
          }
        }
      }
      ref.current.setSelectionRange(pos, pos);
    });
  };

  return (
    <input
      ref={ref}
      type="text" inputMode="numeric" value={text} disabled={disabled}
      onFocus={() => { focusedRef.current = true; }}
      onBlur={(e) => { focusedRef.current = false; setText(fmt(value)); onBlur && onBlur(e); }}
      onChange={handleChange}
      className={className}
    />
  );
};

// Ô nhập tổng ở dòng gốc (Phải trả cho CTS / Khách chuyển tiền lần 2 / Giá trị xuất hóa đơn) — hiện dấu chấm
// phân cách hàng nghìn NGAY KHI GÕ (không phải chỉ sau khi rời khỏi ô), rồi lưu khi rời khỏi ô (onBlur).
const GroupSumInput = ({ initial, onCommit }) => {
  const ref = useRef(null);
  const fmt = (raw) => (raw === '' || raw === null || raw === undefined ? '' : formatThousands(raw));
  const [text, setText] = useState(initial ? fmt(initial) : '');

  const handleChange = (e) => {
    const input = e.target;
    const caret = input.selectionStart ?? input.value.length;
    const digitsBeforeCaret = input.value.slice(0, caret).replace(/[^\d]/g, '').length;
    const raw = input.value.replace(/[^\d]/g, '');
    const formatted = raw === '' ? '' : fmt(raw);
    setText(formatted);
    requestAnimationFrame(() => {
      if (!ref.current) return;
      let seen = 0, pos = formatted.length;
      if (digitsBeforeCaret === 0) {
        pos = 0;
      } else {
        for (let i = 0; i < formatted.length; i++) {
          if (/\d/.test(formatted[i])) {
            seen++;
            if (seen === digitsBeforeCaret) { pos = i + 1; break; }
          }
        }
      }
      ref.current.setSelectionRange(pos, pos);
    });
  };

  return (
    <input
      ref={ref}
      type="text" inputMode="numeric" value={text}
      onChange={handleChange}
      onBlur={() => onCommit(text.replace(/\D/g, ''))}
      className="w-full min-w-0 box-border border-2 border-blue-300 rounded px-1.5 py-1 text-sm text-right bg-blue-50/40"
    />
  );
};

// Tính các cột suy ra (không lưu riêng, luôn tính lại từ dữ liệu gốc để không bị lệch)
// Math.round các kết quả tiền VNĐ để khử sai số dấu phẩy động (vd 32886216.000000004 → 32886216).
export const deriveComputed = (r) => {
  const amountVnd = Math.round(num(r.exchange_rate) * num(r.amount_cny)); // Tiền hàng (VNĐ) = Tỷ giá x Số tệ
  const invoiceAmount = Math.round(amountVnd + num(r.tax_service_fee)); // Tổng (= giá trị xuất hóa đơn) = Tiền hàng + Thuế + phí dịch vụ
  const totalCustomerTransferred = Math.round(num(r.customer_paid_total) + num(r.deposit_vnd) + num(r.actual_collected)); // Tổng đã thu = Lần 1 (Tiền hàng + Tiền cọc) + Lần 2 (Số tiền chuyển)
  const diffAmount = Math.round(invoiceAmount - totalCustomerTransferred); // Còn lại = Tổng hóa đơn - Tổng đã thu
  const remainingDebt = diffAmount; // Công nợ còn lại = Còn lại
  // Riêng cho "Theo dõi chi tiết" của Hợp đồng ngoại thương (COLS_FX):
  const fxAmountVnd = Math.round(num(r.exchange_rate) * num(r.voucher_amount_fx)); // Tổng tiền Việt = Tỉ giá $ × Tiền hàng ($)
  const fxRemaining = num(r.fx_converted_total) - num(r.amount_cny); // Còn lại = Tổng tiền tệ quy đổi (H) - Số tệ (I)
  return { amountVnd, invoiceAmount, remainingDebt, totalCustomerTransferred, diffAmount, fxAmountVnd, fxRemaining };
};

// Các cột lấy giá trị từ Đề Nghị Thanh Toán — khoá không cho sửa trực tiếp ở đây (trừ khi đang tạo dòng mới),
// muốn sửa phải quay lại Đề Nghị Thanh Toán.
const DNTT_FIELDS = ['seller_id', 'customer_id', 'goods_desc', 'deposit_vnd', 'customer_paid_total',
  'customer_paid_date', 'bank_account', 'bank_name', 'exchange_rate', 'amount_cny', 'payment_request_no'];
// Chỉ gộp ô thật (rowSpan) với các cột chắc chắn giống nhau cho CẢ đề nghị thanh toán —
// không gộp Mô tả/Tiền cọc/Tổng KH đã chuyển/Tỷ giá/Số tệ vì mỗi dòng chứng từ có thể khác nhau.
// Đã bỏ gộp hoàn toàn (Số đề nghị TT / Cty thu tiền / Khách hàng / Ngày KH chuyển tiền / Số tài khoản / Ngân hàng) —
// mỗi dòng hiện riêng; việc gộp nhóm dòng nay chuyển sang cơ chế "Mã lô" (xem phần renderRow/batch grouping).
const MERGEABLE_KEYS = [];

// Đổi vị trí cột (0,1,2...) thành chữ cái kiểu Excel (A, B, ..., Z, AA, AB...)
const excelColLetter = (n) => {
  let s = '';
  n += 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
};

// Cấu hình cột — đúng thứ tự + nhóm tiêu đề theo file Excel chị Ly cung cấp (group1/group2 dùng để vẽ
// tiêu đề gộp 3 hàng: group1 = tiêu đề lớn, group2 = tiêu đề nhỏ bên trong, cột không có group2 chiếm
// trọn chiều cao 2 hàng dưới nếu group1 có group2 ở cột khác cùng nhóm).
// formula: ký hiệu công thức hiển thị ở tiêu đề cho cột tự động tính (dùng chữ cái cột theo thứ tự bên dưới)
const COLS = [
  { key: 'batch_code', label: 'Báo giá', type: 'text', w: 180, group1: 'Thông tin khách hàng' },
  { key: 'payment_request_no', label: 'Số đề nghị TT', type: 'text', w: 170, fromDntt: true, group1: 'Thông tin khách hàng' },
  { key: 'customer_code_display', label: 'Mã khách', type: 'customerCode', w: 100, group1: 'Thông tin khách hàng' },
  { key: 'customer_id', label: 'Tên xuất hóa đơn', type: 'customer', w: 180, fromDntt: true, group1: 'Thông tin khách hàng' },
  { key: 'seller_id', label: 'Cty thu tiền (bên bán)', type: 'seller', w: 200, fromDntt: true, group1: 'Công ty bán hàng' },
  { key: 'bank_account', label: 'Số tài khoản', type: 'text', w: 160, fromDntt: true, group1: 'Công ty bán hàng' },
  { key: 'bank_name', label: 'Ngân hàng', type: 'text', w: 180, fromDntt: true, group1: 'Công ty bán hàng' },
  { key: 'goods_desc', label: 'Diễn giải', type: 'text', w: 170, fromDntt: true, group1: 'Phải thu khách hàng' },
  { key: 'amountVnd', label: 'Tiền hàng', type: 'computed', w: 125, formula: 'J×K', group1: 'Phải thu khách hàng', group2: 'VNĐ' },
  { key: 'exchange_rate', label: 'Tỉ giá', type: 'number', w: 85, fromDntt: true, group1: 'Phải thu khách hàng', group2: 'Tệ' },
  { key: 'amount_cny', label: 'Số tệ (Tiền hàng tệ)', type: 'number', w: 120, fromDntt: true, group1: 'Phải thu khách hàng', group2: 'Tệ' },
  { key: 'factory_paid_date', label: 'Ngày chuyển xưởng', type: 'date', w: 150, group1: 'Phải thu khách hàng', group2: 'Tệ' },
  { key: 'tax_service_fee', label: 'Thuế + phí dịch vụ', type: 'number', w: 125, group1: 'Phải thu khách hàng' },
  { key: 'invoice_amount', label: 'Tổng (= giá trị xuất hóa đơn)', type: 'computed', w: 200, formula: 'I+M', group1: 'Phải thu khách hàng' },
  { key: 'customer_paid_date', label: 'Ngày KH chuyển tiền', type: 'date', w: 150, fromDntt: true, group1: 'Đã thu khách hàng', group2: 'Lần 1' },
  { key: 'customer_paid_total', label: 'Tiền hàng', type: 'number', w: 125, fromDntt: true, group1: 'Đã thu khách hàng', group2: 'Lần 1' },
  { key: 'deposit_vnd', label: 'Tiền cọc (VNĐ)', type: 'number', w: 125, fromDntt: true, group1: 'Đã thu khách hàng', group2: 'Lần 1' },
  { key: 'customer_final_payment_date', label: 'Ngày KH chuyển tiền', type: 'date', w: 170, group1: 'Đã thu khách hàng', group2: 'Lần 2' },
  { key: 'actual_collected', label: 'Số tiền chuyển', type: 'number', w: 125, group1: 'Đã thu khách hàng', group2: 'Lần 2' },
  { key: 'totalCustomerTransferred', label: 'Tổng', type: 'computed', w: 125, formula: 'P+Q+S', group1: 'Đã thu khách hàng' },
  { key: 'diffAmount', label: 'Còn lại', type: 'computed', w: 125, formula: 'N-T', group1: 'Còn lại' },
  { key: 'note', label: 'Ghi chú', type: 'text', w: 160, group1: 'Ghi chú' },
  { key: 'sale_code_display', label: 'Mã Sale', type: 'saleInfo', w: 110 },
  { key: 'sale_name_display', label: 'Tên Sale', type: 'saleInfo', w: 160 },
];

// Bản rút gọn cột riêng cho "Theo dõi dòng tiền" của Hợp đồng ngoại thương — bỏ hẳn các cột không dùng
// (Mã lô, Cty thu tiền, Số tài khoản, Ngân hàng, Phải trả cho CTS, Còn phải thanh toán, Khách chuyển tiền lần 2,
// Ngày khách thanh toán lần 2, Giá trị xuất hóa đơn, Chênh lệch, Tiền hàng dự kiến, Phần dư sau khi thanh toán,
// Tổng tiền KH chuyển vào Cty); "Tiền vào" (Đã thu khách — customer_paid_total) và "Tiền ra" (Đã thanh toán
// ngoại tệ — amount_cny) đặt cạnh nhau để dễ so sánh từng dòng; "Tiền cọc" đổi tên thành "CTS phải thu".
// Bản cột riêng cho "Theo dõi dòng tiền" (Theo dõi chi tiết) của Hợp đồng ngoại thương — theo đúng mẫu Excel
// chị Ly cung cấp: Thông tin khách hàng | Đã thu khách hàng (Tỉ giá $, Tiền hàng $, Tổng tiền Việt tự tính,
// Tổng tiền tệ quy đổi nhập tay) | Phải thu khách hàng (Số tệ, Ngày chuyển xưởng) | Còn lại (tự tính) | Ghi chú.
const COLS_FX = [
  { key: 'batch_code', label: 'Báo giá', type: 'text', w: 65, group1: 'Thông tin khách hàng' },
  { key: 'payment_request_no', label: 'Số đề nghị TT', type: 'text', w: 90, fromDntt: true, group1: 'Thông tin khách hàng' },
  { key: 'customer_code_display', label: 'Mã khách', type: 'customerCode', w: 70, group1: 'Thông tin khách hàng' },
  { key: 'customer_id', label: 'Tên xuất hóa đơn', type: 'customer', w: 140, fromDntt: true, group1: 'Thông tin khách hàng' },
  { key: 'exchange_rate', label: 'Tỉ giá $', type: 'number', w: 75, fromDntt: true, group1: 'Đã thu khách hàng' },
  { key: 'voucher_amount_fx', label: 'Tiền hàng ($)', type: 'number', w: 95, fromDntt: true, group1: 'Đã thu khách hàng' },
  { key: 'fxAmountVnd', label: 'Tổng tiền Việt', type: 'computed', w: 100, formula: 'E×F', group1: 'Đã thu khách hàng' },
  { key: 'fx_converted_total', label: 'Tổng tiền tệ quy đổi', type: 'number', w: 110, group1: 'Đã thu khách hàng' },
  { key: 'amount_cny', label: 'Số tệ (Tiền hàng tệ)', type: 'number', w: 110, fromDntt: true, group1: 'Phải thu khách hàng' },
  { key: 'factory_paid_date', label: 'Ngày chuyển xưởng', type: 'date', w: 125, group1: 'Phải thu khách hàng' },
  { key: 'fxRemaining', label: 'Còn lại', type: 'computed', w: 80, formula: 'H-I', group1: 'Còn lại' },
  { key: 'note', label: 'Ghi chú', type: 'text', w: 100, group1: 'Ghi chú' },
  { key: 'sale_code_display', label: 'Mã Sale', type: 'saleInfo', w: 110 },
  { key: 'sale_name_display', label: 'Tên Sale', type: 'saleInfo', w: 160 },
];

const ALL_COLS_FOR_TYPES = [...COLS, ...COLS_FX];
const NUMBER_KEYS = ALL_COLS_FOR_TYPES.filter(c => c.type === 'number').map(c => c.key);
const DATE_KEYS = ALL_COLS_FOR_TYPES.filter(c => c.type === 'date').map(c => c.key);
const CHECKBOX_KEYS = ALL_COLS_FOR_TYPES.filter(c => c.type === 'checkbox').map(c => c.key);
// Các cột tiền/số lượng sẽ CỘNG DỒN lên dòng gốc khi gộp theo Mã lô (Tỷ giá không cộng vì là đơn giá, không phải tổng)
const SUM_KEYS = ['deposit_vnd', 'customer_paid_total', 'amount_cny', 'tax_service_fee', 'actual_collected', 'fx_converted_total', 'voucher_amount_fx'];
// Trong số các cột trên, đây là các cột NHẬP TAY (không khoá từ Đề Nghị Thanh Toán) — khi đã gộp nhóm,
// chị sẽ nhập thẳng TỔNG ở dòng gốc, không nhập riêng từng dòng con nữa.
const EDITABLE_SUM_KEYS = ['actual_collected', 'tax_service_fee'];

const BLANK_ROW = { customer_id: '', seller_id: '' };

// Ô "Số hóa đơn" — gõ để tìm trong "Hàng hóa theo hóa đơn", chọn xong tự điền Giá trị xuất hóa đơn
const InvoiceLinkCell = ({ value, onChange, onPick, onBlur, disabled }) => {
  const [query, setQuery] = useState(value || '');
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef(null);
  const timerRef = useRef(null);
  const justPickedRef = useRef(false); // tránh lưu đè bằng dữ liệu cũ khi vừa chọn 1 gợi ý (blur bắn ra ngay sau đó)

  useEffect(() => { setQuery(value || ''); }, [value]);

  useEffect(() => {
    const onClickOutside = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const doSearch = (q) => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      if (!q.trim()) { setResults([]); return; }
      setLoading(true);
      try {
        const { rows } = await api.listInvoiceGoodsPaged({ search: q.trim(), limit: 10 });
        setResults(rows);
      } catch { setResults([]); }
      setLoading(false);
    }, 300);
  };

  return (
    <div ref={boxRef} className="relative">
      <input
        type="text" value={query} disabled={disabled}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); onChange?.(e.target.value); doSearch(e.target.value); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => { if (justPickedRef.current) { justPickedRef.current = false; return; } onBlur?.(); }, 150)}
        placeholder="Gõ để tìm số hóa đơn..."
        className="w-full border-0 focus:outline-none focus:ring-2 focus:ring-blue-300 rounded px-2 py-1.5 text-sm bg-white disabled:bg-gray-100"
      />
      {open && query.trim() && (
        <div className="absolute z-30 mt-1 w-72 bg-white border border-gray-200 rounded-lg shadow-lg max-h-56 overflow-y-auto">
          {loading ? (
            <div className="px-3 py-2 text-xs text-gray-400">Đang tìm...</div>
          ) : results.length === 0 ? (
            <div className="px-3 py-2 text-xs text-gray-400">Không tìm thấy hóa đơn phù hợp</div>
          ) : results.map((inv) => (
            <button key={inv.id} type="button"
              onClick={() => { justPickedRef.current = true; setQuery(inv.invoice_no); setOpen(false); onPick(inv); }}
              className="w-full text-left px-3 py-2 text-xs hover:bg-blue-50 border-b border-gray-50 last:border-0">
              <div className="font-mono font-medium text-blue-600">{inv.invoice_no}</div>
              <div className="text-gray-500">{inv.customer_name} — {fmtNum(inv.total)} đ</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const Cell = ({ col, value, onChange, onBlur, disabled }) => {
  if (col.type === 'computed') {
    const isMoney = typeof value === 'number';
    return <div className="px-2 py-1.5 text-right text-emerald-800 bg-emerald-50 whitespace-nowrap font-medium">{isMoney ? fmtNum(value) : (value || '')}</div>;
  }
  if (col.type === 'checkbox') {
    return (
      <div className={`flex justify-center py-1.5 ${disabled ? 'bg-amber-50/60' : ''}`}>
        <input type="checkbox" checked={!!value} disabled={disabled} onChange={e => { onChange(e.target.checked); onBlur?.(); }} />
      </div>
    );
  }
  const common = `w-full min-w-0 box-border border focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-blue-300 rounded px-2 py-1.5 text-sm disabled:text-gray-500 ${disabled ? 'bg-amber-50/60 border-transparent' : 'bg-white border-gray-200 hover:border-gray-300'}`;
  if (col.type === 'date') {
    return <input type="date" value={value || ''} disabled={disabled} onChange={e => onChange(e.target.value)} onBlur={onBlur} className={common + ' text-right'} />;
  }
  if (col.type === 'number') {
    return (
      <FormattedNumberInput
        value={value} disabled={disabled}
        onChange={onChange} onBlur={onBlur}
        className={common + ' text-right'}
      />
    );
  }
  // Ô chữ đã khóa (lấy từ ĐNTT): hiện dạng chữ xuống dòng đầy đủ, không cắt bớt như ô input 1 dòng
  if (col.type === 'text' && disabled) {
    return <div className="w-full px-2 py-1.5 text-sm text-gray-600 bg-amber-50/60 leading-snug" style={{ whiteSpace: 'normal', overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{value || ''}</div>;
  }
  return <input type="text" value={value ?? ''} disabled={disabled} onChange={e => onChange(e.target.value)} onBlur={onBlur} className={common} />;
};

export const CashFlowPage = ({ batches = [], customers = {}, sellers = {}, isAdmin = false, saleProfiles = [], onSave, onDelete, initialCustomerFilter = '', onBack, onOpenPaymentRequest, isFxContract = false }) => {
  const baseCols = (isFxContract ? COLS_FX : COLS).filter(c => isAdmin || c.type !== 'saleInfo'); // Hợp đồng ngoại thương dùng bộ cột rút gọn riêng; Mã/Tên Sale chỉ admin thấy

  // ── Cho phép KÉO GIÃN / THU HẸP độ rộng cột ─────────────────────────
  // Lưu độ rộng người dùng tùy chỉnh theo key cột (ghi đè giá trị w mặc định).
  // Dùng khóa lưu riêng cho FX và bản thường để 2 bảng không lẫn nhau.
  const COLW_KEY = isFxContract ? 'cashFlowFx.colWidths' : 'cashFlow.colWidths';
  const [colWOverride, setColWOverride] = useState(() => {
    try { return JSON.parse(localStorage.getItem(COLW_KEY) || '{}'); } catch { return {}; }
  });
  useEffect(() => {
    try { localStorage.setItem(COLW_KEY, JSON.stringify(colWOverride)); } catch {}
  }, [colWOverride, COLW_KEY]);
  // cols đã áp override: mọi chỗ render đọc col.w nên chỉ cần thay w là đủ.
  const cols = useMemo(
    () => baseCols.map(c => (colWOverride[c.key] ? { ...c, w: colWOverride[c.key] } : c)),
    [baseCols, colWOverride]
  );
  // Kéo mép phải tiêu đề cột con để đổi độ rộng; nhấp đúp trả về mặc định.
  const colDragRef = useRef(null);
  const startColResize = (key, baseW, e) => {
    e.preventDefault();
    e.stopPropagation();
    colDragRef.current = { key, startX: e.clientX, startW: colWOverride[key] || baseW };
    const onMove = (ev) => {
      const d = colDragRef.current;
      if (!d) return;
      const next = Math.max(60, d.startW + (ev.clientX - d.startX));
      setColWOverride(prev => (prev[d.key] === next ? prev : { ...prev, [d.key]: next }));
    };
    const onUp = () => {
      colDragRef.current = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };
  const resetColW = (key) => setColWOverride(prev => { const n = { ...prev }; delete n[key]; return n; });

  const [view, setView] = useState('batches'); // 'batches' | 'print'
  const [search, setSearch] = useState('');
  const [customerFilter, setCustomerFilter] = useState(initialCustomerFilter);
  const [sellerFilter, setSellerFilter] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [drafts, setDrafts] = useState({}); // { [rowId]: { field: value } } — chỉnh sửa tạm trước khi lưu
  const [newRow, setNewRow] = useState(BLANK_ROW);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [saving, setSaving] = useState(null);
  const [collapsedBatches, setCollapsedBatches] = useState(new Set()); // các Mã lô đang thu gọn (ẩn dòng con)
  const [grouping, setGrouping] = useState(false); // đang gán Mã lô chung cho các dòng đã chọn
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 50; // số nhóm/dòng hiển thị mỗi trang

  const customerLabel = (id) => customers[id] ? `${customers[id].companyName} (${id})` : (id || '—');
  // Nếu dòng này được tạo từ 1 Mã nhánh cụ thể (qua Đề Nghị Thanh Toán), hiện đúng tên nhánh đó
  // thay vì luôn hiện tên khách hàng gốc.
  const customerDisplayLabel = (row) => {
    const id = row.customer_id;
    const c = customers[id];
    if (!c) return id || '—';
    if (row.branch_tax_code) {
      const branch = (c.branches || []).find(b => b.id === row.branch_tax_code);
      if (branch) return `${branch.companyName || branch.taxCode} (${id})`;
    }
    return customerLabel(id);
  };
  const sellerLabel = (id) => sellers[id] ? sellers[id].companyName : (id || '—');

  const merged = useMemo(() => batches.map(b => ({ ...b, ...(drafts[b.id] || {}) })), [batches, drafts]);

  const filtered = merged.filter(b => {
    const s = search.trim().toLowerCase();
    const matchSearch = !s
      || (b.batch_code || '').toLowerCase().includes(s)
      || (b.payment_request_no || '').toLowerCase().includes(s)
      || customerLabel(b.customer_id).toLowerCase().includes(s)
      || (b.invoice_no || '').toLowerCase().includes(s);
    const matchCustomer = !customerFilter || b.customer_id === customerFilter;
    const matchSeller = !sellerFilter || b.seller_id === sellerFilter;
    const matchDate = !dateFilter || b.customer_paid_date === dateFilter;
    return matchSearch && matchCustomer && matchSeller && matchDate;
  }).sort((a, b) => {
    // Mới nhất lên đầu: ưu tiên ngày đề nghị (order_date), rồi tới thời gian tạo bản ghi (created_at)
    const da = a.order_date || a.customer_paid_date || '';
    const db = b.order_date || b.customer_paid_date || '';
    if (da !== db) return db.localeCompare(da);
    return (b.created_at || '').localeCompare(a.created_at || '');
  });

  const buildPayload = (row) => {
    const computed = deriveComputed(row);
    const payload = { customer_id: row.customer_id || null, seller_id: row.seller_id || null };
    cols.forEach(c => {
      if (c.type === 'computed' || c.type === 'customerCode' || c.type === 'saleInfo') return; // cột ảo chỉ để hiển thị, không phải cột thật trong Supabase
      const v = row[c.key];
      if (CHECKBOX_KEYS.includes(c.key)) payload[c.key] = v ? 1 : 0;
      else if (NUMBER_KEYS.includes(c.key)) payload[c.key] = (v === '' || v === undefined || v === null) ? null : Number(v);
      else if (DATE_KEYS.includes(c.key)) payload[c.key] = v || null;
      else payload[c.key] = v ?? null;
    });
    // Tự lấy Ngày KH chuyển tiền làm Ngày đặt hàng (không còn ô nhập riêng)
    payload.order_date = row.customer_paid_date || null;
    // Lưu kèm các cột tổng hợp quan trọng để tiện xuất báo cáo/đối chiếu về sau
    payload.amount_vnd = computed.amountVnd;
    payload.invoice_amount = computed.invoiceAmount; // Tổng (= giá trị xuất hóa đơn) — giờ tự tính = Tiền hàng + Thuế phí, không nhập tay nữa
    payload.remaining_debt = computed.remainingDebt;
    payload.total_customer_transferred = computed.totalCustomerTransferred;
    payload.diff_amount = computed.diffAmount;
    return payload;
  };

  const toggleCollapseBatch = (code) => setCollapsedBatches(s => {
    const next = new Set(s);
    next.has(code) ? next.delete(code) : next.add(code);
    return next;
  });

  // Gộp các dòng đã chọn (checkbox) thành 1 lô NGAY, không hỏi Mã lô — tự gán 1 mã tạm để liên kết
  // các dòng lại với nhau; chị có thể bấm vào ô Báo giá ở dòng gốc để tự gõ lại tên mình muốn bất cứ lúc nào.
  // Cho phép gộp bất kỳ dòng nào đã chọn, KHÔNG bắt buộc cùng Số đề nghị TT.
  const handleGroupSelected = async () => {
    if (selectedIds.size < 2) return;
    const maxNo = merged.reduce((max, b) => {
      const m = /^LO(\d+)$/i.exec((b.batch_code || '').trim());
      return m ? Math.max(max, Number(m[1])) : max;
    }, 0);
    const code = `LO${maxNo + 1}`;
    setGrouping(true);
    try {
      for (const id of selectedIds) {
        await onSave(id, { batch_code: code });
      }
      setSelectedIds(new Set());
    } catch (e) {
      alert('Có lỗi khi gộp lô: ' + e.message);
    } finally {
      setGrouping(false);
    }
  };

  // Đổi lại tên Mã lô cho cả nhóm — gõ trực tiếp ở dòng gốc, áp dụng cho tất cả các dòng con.
  const renameGroupCode = async (items, newCode) => {
    const code = newCode.trim();
    if (!code) return;
    const toUpdate = items.filter(it => it.row.batch_code !== code);
    if (toUpdate.length === 0) return;
    setGrouping(true);
    try {
      for (const it of toUpdate) {
        await onSave(it.row.id, { batch_code: code });
      }
    } catch (e) {
      alert('Có lỗi khi đổi Mã lô: ' + e.message);
    } finally {
      setGrouping(false);
    }
  };

  // Bỏ gộp 1 nhóm Mã lô: xoá Mã lô khỏi tất cả các dòng, ĐỒNG THỜI tách hẳn thành các Đề Nghị Thanh Toán
  // độc lập — dòng đầu tiên giữ nguyên Số đề nghị TT cũ, các dòng còn lại được đổi sang số riêng (thêm hậu tố
  // -2, -3...) để không còn dính chung 1 đề nghị nữa, tránh sửa 1 dòng lại kéo theo dòng kia.
  const handleUngroup = async (items) => {
    setGrouping(true);
    try {
      const [first, ...rest] = items;
      if (first) await onSave(first.row.id, { batch_code: null });
      for (let idx = 0; idx < rest.length; idx++) {
        const it = rest[idx];
        const patch = { batch_code: null };
        const origReq = (it.row.payment_request_no ?? '').toString().trim();
        if (origReq) patch.payment_request_no = `${origReq}-${idx + 2}`;
        await onSave(it.row.id, patch);
      }
    } catch (e) {
      alert('Có lỗi khi bỏ gộp: ' + e.message);
    } finally {
      setGrouping(false);
    }
  };

  const commitRow = async (id, row) => {
    setSaving(id || 'new');
    try {
      const saved = await onSave(id, buildPayload(row));
      if (id) setDrafts(d => { const next = { ...d }; delete next[id]; return next; });
      else setNewRow(BLANK_ROW);
      return saved;
    } catch (e) {
      alert('Không lưu được: ' + e.message);
      throw e;
    } finally {
      setSaving(null);
    }
  };

  const editExisting = (row, key, value) => {
    setDrafts(d => {
      const current = { ...(d[row.id] || {}), [key]: value };
      if (key === 'seller_id' && sellers[value]) {
        current.bank_account = sellers[value].bankAccount || '';
        current.bank_name = sellers[value].bankName || '';
      }
      return { ...d, [row.id]: current };
    });
  };

  const editNew = (key, value) => {
    setNewRow(r => {
      const next = { ...r, [key]: value };
      if (key === 'seller_id' && sellers[value]) {
        next.bank_account = sellers[value].bankAccount || '';
        next.bank_name = sellers[value].bankName || '';
      }
      return next;
    });
  };

  const toggleSelect = (id) => setSelectedIds(s => {
    const next = new Set(s);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const selectedBatches = merged.filter(b => selectedIds.has(b.id));

  if (view === 'print') {
    const firstCustomer = selectedBatches[0]?.customer_id;
    return (
      <PaymentRequestPrint
        customerId={firstCustomer}
        customer={customers[firstCustomer]}
        batches={selectedBatches}
        customers={customers}
        sellers={sellers}
        onSave={onSave}
        onDelete={onDelete}
        onClose={() => setView('batches')}
      />
    );
  }

  const customerOptions = buildCustomerOptions(customers);
  const sellerOptions = Object.entries(sellers).map(([id, s]) => ({ value: id, label: s.shortName ? `[${s.shortName}] ${s.companyName}` : s.companyName }));
  const saleInfoByUuid = Object.fromEntries(saleProfiles.map(p => [p.uuid, { code: p.ma_sale, name: p.name }]));
  const customerFilterOptions = Object.entries(customers).map(([id, c]) => ({ value: id, label: `${id} — ${c.companyName}` }));

  // Mỗi dòng có 1 ô tích riêng — việc gộp nhóm hiển thị (root/con) nay xử lý riêng ở displayItems bên dưới.
  const filteredWithMeta = useMemo(() => filtered.map((row) => ({
    row, isFirstInGroup: true, groupSize: 1, groupIds: [row.id],
  })), [filtered]);

  // Chỉ gộp gốc/con theo Mã lô (do người dùng tự gán qua "Gộp thành lô") — Số đề nghị TT luôn hiện riêng
  // từng dòng, không tự động gộp nữa (dễ gây nhầm lẫn khi nhiều dòng chỉ tình cờ trùng số).
  const displayItems = useMemo(() => {
    const byCode = {};
    filteredWithMeta.forEach(it => { if (it.row.batch_code) (byCode[it.row.batch_code] ||= []).push(it); });
    const consumedByBatch = new Set();
    const result = [];
    filteredWithMeta.forEach(it => {
      if (consumedByBatch.has(it.row.id)) return;
      const code = it.row.batch_code;
      const group = code ? byCode[code] : null;
      if (group && group.length > 1) {
        group.forEach(g => consumedByBatch.add(g.row.id));
        result.push({ kind: 'group', groupKey: `batch-${code}`, keyField: 'batch_code', label: code, items: group });
      } else {
        result.push({ kind: 'single', item: it });
      }
    });
    return result;
  }, [filteredWithMeta]);

  // Phân trang: cắt displayItems theo trang hiện tại
  const totalPages = Math.max(1, Math.ceil(displayItems.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pagedItems = displayItems.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  // Nếu số trang giảm (do lọc) mà trang hiện tại vượt quá, kéo về trang cuối
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [totalPages, page]);
  // Về trang 1 khi đổi bộ lọc/tìm kiếm
  useEffect(() => { setPage(1); }, [search, customerFilter, sellerFilter, dateFilter]);

  // Dòng "gốc" của 1 nhóm Mã lô: tổng cộng dồn các cột tiền
  // (SUM_KEYS + các cột tự tính), các cột còn lại hiện giá trị chung nếu mọi dòng con giống nhau, ngược lại hiện "—".
  // Nhập TỔNG trực tiếp ở dòng gốc cho các cột tiền nhập tay (Phải trả cho CTS, Khách chuyển tiền lần 2,
  // Giá trị xuất hóa đơn): lưu toàn bộ số vừa nhập vào dòng ĐẦU TIÊN của nhóm, các dòng con còn lại đặt về 0 —
  // để tổng cộng dồn hiển thị ở dòng gốc luôn đúng bằng đúng số chị vừa gõ, không cần nhập riêng từng dòng con.

  // Áp dụng 1 giá trị chung (không phải tiền, VD ngày) cho cả nhóm: lưu vào dòng ĐẦU TIÊN, xoá ở các dòng con còn lại.
  const setGroupField = async (rows, key, value) => {
    const [first, ...rest] = rows;
    await commitRow(first.id, { ...first, [key]: value });
    for (const r of rest) {
      if (r[key]) await commitRow(r.id, { ...r, [key]: null });
    }
  };

  const setGroupTotal = async (rows, key, value) => {
    const val = value === '' ? 0 : Number(value) || 0;
    const [first, ...rest] = rows;
    await commitRow(first.id, { ...first, [key]: val });
    for (const r of rest) {
      if (num(r[key]) !== 0) await commitRow(r.id, { ...r, [key]: 0 });
    }
  };

  // Các cột có giá trị GIỐNG NHAU cho cả nhóm (trừ cột định danh nhóm và các cột tiền/tự tính đã xử lý riêng) —
  // những cột này chỉ cần hiện 1 lần ở dòng gốc, dòng con sẽ để trống.
  const getCommonKeys = (items, keyField) => {
    const rows = items.map(it => it.row);
    const keys = new Set([keyField]); // cột định danh nhóm (Mã lô) luôn giống nhau cả nhóm — ẩn ở dòng con
    // Số đề nghị TT luôn hiện đầy đủ ở MỌI dòng (kể cả dòng con) để bấm vào xem/sửa lại đề nghị đó.
    const NEVER_BLANK_KEYS = ['payment_request_no'];
    cols.forEach(col => {
      if (col.key === keyField || col.type === 'computed' || SUM_KEYS.includes(col.key) || NEVER_BLANK_KEYS.includes(col.key)) return;
      const vals = new Set(rows.map(r => r[col.key] ?? ''));
      if (vals.size === 1 && rows[0][col.key] !== null && rows[0][col.key] !== '' && rows[0][col.key] !== undefined) keys.add(col.key);
    });
    return keys;
  };

  const renderGroupRoot = (groupKey, keyField, label, items) => {
    const rows = items.map(it => it.row);
    const groupIds = rows.map(r => r.id);
    const collapsed = collapsedBatches.has(groupKey);
    const sumField = (key) => rows.reduce((s, r) => s + num(r[key]), 0);
    const sumComputed = (fn) => rows.reduce((s, r) => s + fn(deriveComputed(r)), 0);
    const commonValue = (key) => {
      const vals = new Set(rows.map(r => r[key] ?? ''));
      return vals.size === 1 ? rows[0][key] : null;
    };
    const computedFns = {
      amountVnd: (c) => c.amountVnd,
      invoice_amount: (c) => c.invoiceAmount,
      totalCustomerTransferred: (c) => c.totalCustomerTransferred,
      diffAmount: (c) => c.diffAmount,
      fxAmountVnd: (c) => c.fxAmountVnd,
      fxRemaining: (c) => c.fxRemaining,
    };
    return (
      <tr key={`group-${groupKey}`} className="bg-yellow-50 hover:bg-yellow-100/70 border-b border-gray-200">
        <td className="sticky left-0 bg-yellow-50 px-2 border-r border-gray-200 align-top">
          <input type="checkbox" checked={groupIds.every(id => selectedIds.has(id))} onChange={() => toggleSelectGroup(groupIds)} />
        </td>
        {cols.map(col => {
          let content;
          if (col.key === keyField) {
            content = (
              <span className="flex items-center gap-1.5">
                <button type="button" onClick={() => toggleCollapseBatch(groupKey)} className="text-gray-400 hover:text-blue-700">
                  {collapsed ? '⌄' : '︿'}
                </button>
                {keyField === 'payment_request_no' ? (
                  <button type="button" onClick={() => onOpenPaymentRequest?.(rows[0].customer_id, rows[0].payment_request_no, rows.map(r => r.id))} className="text-blue-600 hover:text-blue-800 underline font-medium" title="Bấm để sửa lại ở Đề Nghị Thanh Toán">
                    {label}
                  </button>
                ) : (
                  <input
                    type="text" defaultValue={label} key={`${groupKey}-code-${label}`}
                    onBlur={(e) => renameGroupCode(items, e.target.value)}
                    title="Gõ để đổi tên Mã lô cho cả nhóm"
                    className="w-full min-w-0 box-border border-2 border-blue-300 rounded px-1.5 py-0.5 text-sm text-blue-600 font-medium bg-blue-50/40"
                  />
                )}
                <button type="button" onClick={() => handleUngroup(items)} className="text-xs text-red-400 hover:text-red-600 underline" title="Bỏ gộp — tách các dòng con ra hiện riêng lại">
                  Bỏ gộp
                </button>
              </span>
            );
          } else if (col.key === 'customer_final_payment_date') {
            const same = commonValue('customer_final_payment_date');
            content = (
              <input
                type="date" defaultValue={same || ''} key={`${groupKey}-cfpd-${same}`}
                onBlur={(e) => setGroupField(rows, 'customer_final_payment_date', e.target.value || null)}
                className="w-full min-w-0 box-border border-2 border-blue-300 rounded px-1.5 py-1 text-sm text-right bg-blue-50/40"
              />
            );
          } else if (col.key === 'note') {
            const same = commonValue('note');
            content = (
              <input
                type="text" defaultValue={same || ''} key={`${groupKey}-note-${same}`}
                onBlur={(e) => setGroupField(rows, 'note', e.target.value || null)}
                className="w-full min-w-0 box-border border-2 border-blue-300 rounded px-1.5 py-1 text-sm bg-blue-50/40"
              />
            );
          } else if (EDITABLE_SUM_KEYS.includes(col.key)) {
            content = (
              <GroupSumInput
                key={`${groupKey}-${col.key}-${sumField(col.key)}`}
                initial={sumField(col.key)}
                onCommit={(raw) => setGroupTotal(rows, col.key, raw)}
              />
            );
          } else if (SUM_KEYS.includes(col.key)) {
            content = <span className="block text-right">{fmtNum(sumField(col.key))}</span>;
          } else if (col.type === 'computed' && computedFns[col.key]) {
            content = <span className="block text-right text-emerald-800">{fmtNum(sumComputed(computedFns[col.key]))}</span>;
          } else if (col.key === 'seller_id') {
            const same = commonValue('seller_id');
            const label = same ? (sellers[same] ? (sellers[same].shortName ? `[${sellers[same].shortName}] ${sellers[same].companyName}` : sellers[same].companyName) : same) : null;
            content = label ? <span className="whitespace-normal break-words leading-snug">{label}</span> : <span className="text-gray-400">—</span>;
          } else if (col.key === 'customer_code_display') {
            const same = commonValue('customer_id');
            content = same ? <span className="text-gray-500">{same}</span> : <span className="text-gray-400">—</span>;
          } else if (col.type === 'saleInfo') {
            const sameCreator = commonValue('created_by');
            const info = sameCreator ? saleInfoByUuid[sameCreator] : null;
            const val = col.key === 'sale_code_display' ? info?.code : info?.name;
            content = val ? <span className="text-gray-500">{val}</span> : <span className="text-gray-400">—</span>;
          } else if (col.key === 'customer_id') {
            const same = commonValue('customer_id');
            const sameBranch = commonValue('branch_tax_code');
            let label = null;
            if (same) {
              const c = customers[same];
              const branch = sameBranch && c ? (c.branches || []).find(b => b.id === sameBranch) : null;
              label = branch ? `${branch.companyName || branch.taxCode} (${same})` : customerLabel(same);
            }
            content = label ? <span className="whitespace-normal break-words leading-snug">{label}</span> : <span className="text-gray-400">—</span>;
          } else {
            const same = commonValue(col.key);
            if (same === null || same === '' || same === undefined) content = <span className="text-gray-400">—</span>;
            else content = <span className={col.type === 'number' ? 'block text-right' : ''}>{col.type === 'number' ? fmtNum(same) : same}</span>;
          }
          return (
            <td key={col.key} style={{ minWidth: col.w, whiteSpace: "nowrap" }} className="border-r border-b border-gray-100 px-2 py-1.5 text-sm align-top">
              {content}
            </td>
          );
        })}
        <td className="sticky right-0 bg-yellow-50 px-2 border-l border-gray-200"></td>
      </tr>
    );
  };

  // Cùng 1 đề nghị thanh toán thì chọn/bỏ chọn tất cả các dòng trong nhóm cùng lúc
  const toggleSelectGroup = (ids) => setSelectedIds(s => {
    const next = new Set(s);
    const allSelected = ids.every(id => next.has(id));
    ids.forEach(id => allSelected ? next.delete(id) : next.add(id));
    return next;
  });

  const renderRow = (row, isNew, isFirstInGroup = true, groupSize = 1, groupIds = [row.id], isChild = false, commonKeys = EMPTY_SET) => {
    const computed = deriveComputed(row);
    const disabledAdminOnly = !isAdmin;
    return (
      <tr key={isNew ? 'new' : row.id} className={isNew ? 'bg-blue-50/40' : (isChild ? 'bg-white hover:bg-gray-50' : 'bg-yellow-50 hover:bg-yellow-100/70')}>
        {!isNew && isFirstInGroup && (
          isChild
            ? <td className="sticky left-0 bg-white px-2 border-r border-gray-200 text-center text-gray-300 text-xs" title="Đã gộp — chọn ở dòng gốc phía trên">🔒</td>
            : (
              <td rowSpan={groupSize > 1 ? groupSize : undefined} className="sticky left-0 bg-yellow-50 px-2 border-r border-gray-200 align-top">
                <input type="checkbox" checked={selectedIds.has(row.id)} onChange={() => toggleSelectGroup(groupIds)} />
              </td>
            )
        )}
        {isNew && <td className="sticky left-0 bg-blue-50/40 px-2 border-r border-gray-200 text-center text-blue-500 text-xs">Mới</td>}
        {cols.map(col => {
          if (isChild && commonKeys.has(col.key)) {
            // Thông tin này giống nhau cho cả nhóm (kể cả cột định danh nhóm) — đã hiện 1 lần ở dòng gốc rồi, dòng con để trống.
            return <td key={col.key} style={{ minWidth: col.w, whiteSpace: "nowrap" }} className="border-r border-gray-100 bg-white text-center text-gray-300 text-xs" title="Đã hiện ở dòng gốc phía trên">🔒</td>;
          }
          if (col.key === 'batch_code' && !isChild) {
            // Dòng đơn lẻ/chưa gộp — ô Mã lô style giống hệt ô "gõ được ở dòng gốc" (viền xanh) để nhất quán,
            // gõ trùng mã ở 2 dòng sẽ tự gộp lại thành nhóm.
            return (
              <td key={col.key} style={{ minWidth: col.w, whiteSpace: "nowrap" }} className="border-r border-gray-100 p-1">
                <input
                  type="text" defaultValue={row.batch_code || ''} key={`${row.id || 'new'}-batch-${row.batch_code || ''}`}
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (isNew) { editNew('batch_code', v); if (row.customer_id) commitRow(null, { ...row, batch_code: v }); }
                    else commitRow(row.id, { ...row, batch_code: v });
                  }}
                  className="w-full min-w-0 box-border border-2 border-blue-300 rounded px-1.5 py-1 text-sm bg-blue-50/40"
                />
              </td>
            );
          }
          if (col.type === 'seller') {
            const disabled = col.fromDntt && !isNew;
            const merging = disabled && MERGEABLE_KEYS.includes(col.key);
            if (merging && !isFirstInGroup) return null; // đã được gộp vào ô của dòng đầu nhóm
            const rowSpan = merging && groupSize > 1 ? groupSize : undefined;
            if (disabled) {
              const label = sellers[row.seller_id] ? (sellers[row.seller_id].shortName ? `[${sellers[row.seller_id].shortName}] ${sellers[row.seller_id].companyName}` : sellers[row.seller_id].companyName) : '';
              return (
                <td key={col.key} rowSpan={rowSpan} style={{ minWidth: col.w, maxWidth: col.w }} className="border-r border-b border-gray-100 px-2 py-1.5 text-sm bg-amber-50/60 text-gray-600 whitespace-normal break-words leading-snug align-top">
                  {label}
                </td>
              );
            }
            return (
              <td key={col.key} style={{ minWidth: col.w, maxWidth: col.w, ...(col.type === "text" ? {} : { whiteSpace: "nowrap" }) }} className="border-r border-gray-100 p-0">
                <select value={row.seller_id || ''} disabled={disabled}
                  onChange={e => isNew ? editNew('seller_id', e.target.value) : editExisting(row, 'seller_id', e.target.value)}
                  onBlur={() => !isNew && drafts[row.id] && commitRow(row.id, row)}
                  className="w-full border border-gray-200 hover:border-gray-300 text-sm px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-blue-300 bg-white">
                  <option value="">-- Chọn --</option>
                  {sellerOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </td>
            );
          }
          if (col.type === 'customerCode') {
            return (
              <td key={col.key} style={{ minWidth: col.w, whiteSpace: "nowrap" }} className="border-r border-gray-100 px-2 py-1.5 text-sm text-gray-500">
                {row.customer_id || '—'}
              </td>
            );
          }
          if (col.type === 'saleInfo') {
            const info = saleInfoByUuid[row.created_by];
            const val = col.key === 'sale_code_display' ? info?.code : info?.name;
            return (
              <td key={col.key} style={{ minWidth: col.w, whiteSpace: "nowrap" }} className="border-r border-gray-100 px-2 py-1.5 text-sm text-gray-500">
                {val || '—'}
              </td>
            );
          }
          if (col.type === 'customer') {
            const disabled = col.fromDntt && !isNew;
            const merging = disabled && MERGEABLE_KEYS.includes(col.key);
            if (merging && !isFirstInGroup) return null;
            const rowSpan = merging && groupSize > 1 ? groupSize : undefined;
            if (disabled) {
              return (
                <td key={col.key} rowSpan={rowSpan} style={{ minWidth: col.w, maxWidth: col.w }} className="border-r border-b border-gray-100 px-2 py-1.5 text-sm bg-amber-50/60 text-gray-600 whitespace-normal break-words leading-snug align-top">
                  {customerDisplayLabel(row)}
                </td>
              );
            }
            return (
              <td key={col.key} style={{ minWidth: col.w, maxWidth: col.w, ...(col.type === "text" ? {} : { whiteSpace: "nowrap" }) }} className="border-r border-gray-100 p-0">
                <select value={(() => {
                    const idx = row.branch_tax_code ? (customers[row.customer_id]?.branches || []).findIndex(b => b.id === row.branch_tax_code) : -1;
                    return encodeCustomerOptionValue(row.customer_id || '', idx >= 0 ? idx : null);
                  })()} disabled={disabled}
                  onChange={e => {
                    const { customerId: v, branchIndex } = parseCustomerOptionValue(e.target.value);
                    const branchTaxCode = branchIndex != null ? (customers[v]?.branches?.[branchIndex]?.id || null) : null;
                    if (isNew) { editNew('customer_id', v); editNew('branch_tax_code', branchTaxCode); }
                    else { editExisting(row, 'customer_id', v); editExisting(row, 'branch_tax_code', branchTaxCode); }
                  }}
                  onBlur={async () => { if (isNew && row.customer_id) await commitRow(null, row); else if (!isNew && drafts[row.id]) await commitRow(row.id, row); }}
                  className="w-full border border-gray-200 hover:border-gray-300 text-sm px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-blue-300 bg-white">
                  <option value="">-- Chọn khách hàng --</option>
                  {customerOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </td>
            );
          }
          if (col.type === 'computed') {
            const map = { amountVnd: computed.amountVnd, invoice_amount: computed.invoiceAmount,
              remainingDebt: computed.remainingDebt,
              totalCustomerTransferred: computed.totalCustomerTransferred, diffAmount: computed.diffAmount,
              fxAmountVnd: computed.fxAmountVnd, fxRemaining: computed.fxRemaining };
            // "Tiền hàng", "Tổng (= giá trị xuất hóa đơn)", "Tổng tiền Việt" và "Còn lại" (Hợp đồng ngoại thương)
            // vẫn hiện chi tiết từng dòng con — các cột tự tính còn lại chỉ hiện tổng ở dòng gốc như trước.
            const SHOW_DETAIL_AT_CHILD = ['amountVnd', 'invoice_amount', 'fxAmountVnd', 'fxRemaining'];
            const blankAtChild = isChild && !SHOW_DETAIL_AT_CHILD.includes(col.key);
            return <td key={col.key} style={{ minWidth: col.w, whiteSpace: "nowrap" }} className="border-r border-gray-100"><Cell col={col} value={blankAtChild ? '' : map[col.key]} /></td>;
          }
          if (isChild && col.key === 'customer_final_payment_date') {
            // Ngày khách thanh toán lần 2 chỉ cần lấy/hiện ở dòng gốc — dòng con để trống.
            return <td key={col.key} style={{ minWidth: col.w, whiteSpace: "nowrap" }} className="border-r border-gray-100 bg-white text-center text-gray-300 text-xs" title="Đã hiện ở dòng gốc phía trên">🔒</td>;
          }
          if (isChild && EDITABLE_SUM_KEYS.includes(col.key)) {
            // Đã gộp nhóm — số tổng nhập ở dòng gốc phía trên, dòng con không nhập riêng nữa.
            return <td key={col.key} style={{ minWidth: col.w, whiteSpace: "nowrap" }} className="border-r border-gray-100 bg-white text-center text-gray-300 text-xs" title="Nhập ở dòng gốc phía trên">🔒</td>;
          }
          const disabled = (col.fromDntt && !isNew) || (col.adminOnly && disabledAdminOnly);
          const merging = disabled && MERGEABLE_KEYS.includes(col.key);
          if (merging && !isFirstInGroup) return null; // đã được gộp vào ô của dòng đầu nhóm
          const rowSpan = merging && groupSize > 1 ? groupSize : undefined;
          if (col.key === 'payment_request_no' && !isNew && row.payment_request_no != null) {
            return (
              <td key={col.key} rowSpan={rowSpan} style={{ minWidth: col.w, whiteSpace: "nowrap" }} className="border-r border-b border-gray-100 align-top px-2 py-1.5 text-sm bg-amber-50/60 text-right">
                <button type="button" onClick={() => onOpenPaymentRequest?.(row.customer_id, row.payment_request_no, [row.id])}
                  className="text-blue-600 hover:text-blue-800 underline font-medium" title="Bấm để sửa lại ở Đề Nghị Thanh Toán">
                  {row.payment_request_no}
                </button>
              </td>
            );
          }
          if (rowSpan) {
            let display = row[col.key] ?? '';
            if (col.type === 'number' && display !== '') display = fmtNum(display);
            return (
              <td key={col.key} rowSpan={rowSpan} style={{ minWidth: col.w, ...(col.type==='number'||col.type==='computed'||col.type==='date' ? { whiteSpace: 'nowrap' } : { maxWidth: col.w }) }} className={`border-r border-b border-gray-100 align-top px-2 py-1.5 text-sm bg-amber-50/60 text-gray-600 ${col.type==='number'||col.type==='computed'||col.type==='date' ? '' : 'whitespace-normal break-words'} leading-snug ${col.type === 'number' ? 'text-right' : ''}`}>
                {display}
              </td>
            );
          }
          return (
            <td key={col.key} style={{ minWidth: col.w, maxWidth: col.w, ...(col.type === "text" ? {} : { whiteSpace: "nowrap" }) }} className="border-r border-gray-100 p-0">
              <Cell col={col} value={row[col.key]} disabled={disabled}
                onChange={(v) => isNew ? editNew(col.key, v) : editExisting(row, col.key, v)}
                onBlur={() => { if (isNew) { if (row.customer_id) commitRow(null, row); } else if (drafts[row.id]) commitRow(row.id, row); }} />
            </td>
          );
        })}
        {!isNew && (
          <td className={`sticky right-0 px-2 border-l border-gray-200 whitespace-nowrap ${isChild ? 'bg-white' : 'bg-yellow-50'}`}>
            {saving === row.id && <span className="text-xs text-blue-500 mr-2">Đang lưu...</span>}
            <button onClick={() => onDelete(row.id)} className="text-red-500 hover:text-red-700 text-xs">Xóa</button>
          </td>
        )}
        {isNew && <td className="sticky right-0 bg-blue-50/40 px-2 border-l border-gray-200"></td>}
      </tr>
    );
  };

  const exportExcel = () => {
    const computedMapFor = (row) => {
      const c = deriveComputed(row);
      return { amountVnd: c.amountVnd, invoice_amount: c.invoiceAmount, totalCustomerTransferred: c.totalCustomerTransferred, diffAmount: c.diffAmount, fxAmountVnd: c.fxAmountVnd, fxRemaining: c.fxRemaining };
    };
    const data = filtered.map(row => {
      const computedMap = computedMapFor(row);
      const obj = {};
      cols.forEach(col => {
        let val;
        if (col.type === 'computed') val = computedMap[col.key];
        else if (col.type === 'customerCode') val = row.customer_id;
        else if (col.type === 'customer') val = customerDisplayLabel(row);
        else if (col.type === 'seller') val = sellerLabel(row.seller_id);
        else if (col.type === 'saleInfo') {
          const info = saleInfoByUuid[row.created_by];
          val = col.key === 'sale_code_display' ? info?.code : info?.name;
        } else val = row[col.key];
        obj[col.label] = val ?? '';
      });
      return obj;
    });
    const ws = XLSX.utils.json_to_sheet(data);
    ws['!cols'] = cols.map(() => ({ wch: 20 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Theo doi dong tien');
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    XLSX.writeFile(wb, `Theo_doi_dong_tien_CTS_${today}.xlsx`);
  };

  return (
    <div className="-mx-6">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3 px-6">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="text-gray-500 hover:text-gray-700">📊 ← Quay lại tổng hợp</button>
          <h1 className="text-2xl font-bold text-gray-800">💰 Theo dõi dòng tiền</h1>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={exportExcel} className="bg-emerald-600 text-white px-4 py-2 rounded-lg hover:bg-emerald-700 text-sm font-medium shadow">
            📥 Xuất Excel
          </button>
          {selectedIds.size >= 2 && (
            <button onClick={handleGroupSelected} disabled={grouping} className="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 text-sm font-medium shadow disabled:opacity-50">
              {grouping ? '⏳ Đang gộp...' : `🔗 Gộp thành 1 báo giá (${selectedIds.size})`}
            </button>
          )}
          {selectedIds.size > 0 && (
            <button onClick={() => setView('print')} className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 text-sm font-medium shadow">
              🖨️ In Đề Nghị Thanh Toán ({selectedIds.size})
            </button>
          )}
        </div>
      </div>

      <p className="text-xs text-gray-400 mb-3 px-6">Bảng chỉ để theo dõi/bổ sung thêm thông tin cho các lô đã có từ Đề Nghị Thanh Toán — không tạo lô mới trực tiếp ở đây. Nhấn số ở cột "Số đề nghị TT" để quay lại sửa ở Đề Nghị Thanh Toán. Kéo ngang để xem hết các cột.</p>

      <div className="flex items-center gap-3 mb-4 flex-wrap px-6">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 Tìm theo báo giá, số đề nghị, khách hàng, số hóa đơn..."
          className="flex-1 min-w-[240px] border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
        <select value={customerFilter} onChange={e => setCustomerFilter(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2.5 text-sm bg-white min-w-[200px] focus:outline-none focus:ring-2 focus:ring-blue-300">
          <option value="">Tất cả khách hàng</option>
          {customerFilterOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select value={sellerFilter} onChange={e => setSellerFilter(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2.5 text-sm bg-white min-w-[200px] focus:outline-none focus:ring-2 focus:ring-blue-300">
          <option value="">Tất cả công ty bán</option>
          {sellerOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <input type="date" value={dateFilter} onChange={e => setDateFilter(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-300" />
        {dateFilter && <button onClick={() => setDateFilter('')} className="text-xs text-gray-400 hover:text-gray-600 underline">Bỏ lọc ngày</button>}
      </div>

      <div className="flex items-center gap-4 mb-3 text-xs px-6 flex-wrap">
        <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-amber-100 border border-amber-300 inline-block"></span> Lấy từ Đề Nghị Thanh Toán — muốn sửa vào lại mục "Đề Nghị Thanh Toán"</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-yellow-50 border border-yellow-200 inline-block"></span> Dòng gốc / dòng chưa gộp — nền vàng như nhau, dòng gốc có mũi tên để thu gọn/mở ra</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-white border border-gray-300 inline-block"></span> Dòng con (đã gộp vào 1 nhóm) — nền trắng để phân biệt</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-gray-200 inline-flex items-center justify-center text-[8px]">🔒</span> Đã gộp — khoá ở dòng con, xem/sửa ở dòng gốc phía trên</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-blue-50 border-2 border-blue-300 inline-block"></span> Gõ được ở dòng gốc — áp dụng cho cả nhóm</span>
      </div>

      <div className="bg-white border-y border-gray-200 overflow-auto" style={{ maxHeight: '75vh' }}>
        <table className="text-sm border-collapse" style={{ tableLayout: 'auto' }}>
          <thead className="sticky top-0 z-10">
            {(() => {
              const buildSpanRow = (getKey, getLabel) => {
                const out = [];
                let i = 0;
                while (i < cols.length) {
                  const k = getKey(cols[i]);
                  let span = 1;
                  while (i + span < cols.length && getKey(cols[i + span]) === k) span++;
                  out.push({ label: getLabel(cols[i]), span });
                  i += span;
                }
                return out;
              };
              const row1Groups = buildSpanRow(c => c.group1 || '', c => c.group1 || '');
              const hasGroup2 = cols.some(c => c.group2);
              const row2Groups = hasGroup2 ? buildSpanRow(c => `${c.group1 || ''}::${c.group2 || ''}`, c => c.group2 || '') : [];
              const headerRowSpan = hasGroup2 ? 3 : 2;
              // Mỗi cụm (group1) 1 màu riêng để nhìn tách bạch từng khối — hàng 2 dùng bản nhạt hơn của cùng màu.
              const GROUP_COLORS = {
                'Thông tin khách hàng': { dark: 'bg-sky-200 text-sky-900', light: 'bg-sky-50 text-sky-700' },
                'Công ty bán hàng': { dark: 'bg-violet-200 text-violet-900', light: 'bg-violet-50 text-violet-700' },
                'Phải thu khách hàng': { dark: 'bg-amber-200 text-amber-900', light: 'bg-amber-50 text-amber-700' },
                'Đã thu khách hàng': { dark: 'bg-emerald-200 text-emerald-900', light: 'bg-emerald-50 text-emerald-700' },
                'Còn lại': { dark: 'bg-rose-200 text-rose-900', light: 'bg-rose-50 text-rose-700' },
                'Ghi chú': { dark: 'bg-gray-200 text-gray-700', light: 'bg-gray-50 text-gray-600' },
              };
              const colorFor = (label) => GROUP_COLORS[label] || { dark: 'bg-slate-200 text-slate-700', light: 'bg-slate-50 text-slate-600' };
              // Màu riêng cho từng nhóm PHỤ (group2) để phân biệt rõ VNĐ/Tệ, Lần 1/Lần 2 — không chỉ dựa vào chữ.
              const GROUP2_COLORS = {
                'VNĐ': 'bg-indigo-100 text-indigo-800',
                'Tệ': 'bg-amber-100 text-amber-900',
                'Lần 1': 'bg-emerald-100 text-emerald-800',
                'Lần 2': 'bg-teal-100 text-teal-800',
              };
              return (
                <>
                  <tr className="text-xs uppercase">
                    <th rowSpan={headerRowSpan} className="sticky left-0 bg-gray-100 px-2 py-2 border-r border-gray-200 z-20 w-8"></th>
                    {row1Groups.map((g, gi) => (
                      <th key={gi} colSpan={g.span} className={`text-center px-2 py-1.5 border-r-2 border-b border-gray-300 font-semibold ${colorFor(g.label).dark}`}>{g.label}</th>
                    ))}
                    <th rowSpan={headerRowSpan} className="sticky right-0 bg-gray-100 px-2 py-2 border-l border-gray-200 z-20 w-20"></th>
                  </tr>
                  {hasGroup2 && (
                    <tr className="text-xs uppercase">
                      {(() => {
                        // Tra đúng group1 của mỗi ô hàng 2 (dựa theo cột đầu tiên trong span đó) để lấy màu nhạt tương ứng;
                        // nếu group2 có màu riêng (VNĐ/Tệ/Lần 1/Lần 2) thì ưu tiên dùng màu đó để tách rõ 2 nhóm phụ.
                        const out = [];
                        let idx = 0;
                        row2Groups.forEach((g, gi) => {
                          const col = cols[idx];
                          const cls = GROUP2_COLORS[g.label] || colorFor(col.group1 || '').light;
                          out.push(
                            <th key={gi} colSpan={g.span} className={`text-center px-2 py-1 border-r-2 border-b border-gray-300 font-medium ${cls}`}>{g.label}</th>
                          );
                          idx += g.span;
                        });
                        return out;
                      })()}
                    </tr>
                  )}
                </>
              );
            })()}
            <tr className="bg-gray-50 text-gray-500 text-xs uppercase">
              {cols.map((col, i) => (
                <th key={col.key} style={{ minWidth: col.w, whiteSpace: "nowrap", position: "relative" }}
                  className={`text-left align-bottom px-2 py-2 border-r border-gray-100 font-medium leading-snug ${col.fromDntt ? 'text-amber-700 bg-amber-50/60' : ''} ${col.type === 'computed' ? 'text-emerald-700 bg-emerald-50' : ''}`}>
                  <div>{col.label}</div>
                  <div className="normal-case font-mono opacity-70">{excelColLetter(i)}{col.formula ? ` = ${col.formula}` : ''}</div>
                  {/* Tay kéo ở mép phải: rê để đổi độ rộng cột, nhấp đúp trả về mặc định */}
                  <span
                    onMouseDown={(e) => startColResize(col.key, col.w, e)}
                    onDoubleClick={() => resetColW(col.key)}
                    title="Kéo để chỉnh độ rộng • Nhấp đúp để trả về mặc định"
                    className="group"
                    style={{ position: "absolute", top: 0, right: 0, height: "100%", width: 8, cursor: "col-resize", display: "flex", alignItems: "center", justifyContent: "center", marginRight: -4, zIndex: 5 }}
                  >
                    <span className="group-hover:bg-blue-500" style={{ height: "50%", width: 1, background: "#cbd5e1", transition: "background 0.15s" }} />
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pagedItems.map(d => d.kind === 'group'
              ? (
                <Fragment key={`group-${d.groupKey}`}>
                  {renderGroupRoot(d.groupKey, d.keyField, d.label, d.items)}
                  {!collapsedBatches.has(d.groupKey) && d.items.map(({ row, isFirstInGroup, groupSize, groupIds }) => renderRow(row, false, isFirstInGroup, groupSize, groupIds, true, getCommonKeys(d.items, d.keyField)))}
                </Fragment>
              )
              : renderRow(d.item.row, false, d.item.isFirstInGroup, d.item.groupSize, d.item.groupIds)
            )}
          </tbody>
        </table>
      </div>

      <Pagination page={safePage} maxPage={totalPages} onChange={setPage} />
    </div>
  );
};

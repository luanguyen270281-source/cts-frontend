// File: src/pages/ContractViewer.jsx
import { useState } from 'react';
import { Badge } from '../components/Badge';
import { SaleSearchDropdown } from '../components/SaleSearchDropdown';
import { HDNTPreview } from '../previews/HDNTPreview';
import { DDHPreview } from '../previews/DDHPreview';
import { BBBGPreview } from '../previews/BBBGPreview';
import { HDNTVCPreview } from '../previews/HDNTVCPreview';
import { DDHVCPreview } from '../previews/DDHVCPreview';
import { BBBGVCPreview } from '../previews/BBBGVCPreview';
import { HDNTUTPreview } from '../previews/HDNTUTPreview';
import { DDHUTPreview } from '../previews/DDHUTPreview';
import { BBBGUTPreview } from '../previews/BBBGUTPreview';
import { TYPE_COLOR } from '../helpers';

const HTML2PDF_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';
const HTMLDOCX_SRC = 'https://unpkg.com/html-docx-js/dist/html-docx.js';

const loadScriptOnce = (src) => new Promise((resolve, reject) => {
  if (document.querySelector(`script[src="${src}"]`)) return resolve();
  const script = document.createElement('script');
  script.src = src;
  script.onload = () => resolve();
  script.onerror = () => reject(new Error('Không tải được thư viện. Kiểm tra kết nối mạng.'));
  document.head.appendChild(script);
});

const safeFilename = (name, ext) =>
  ((name || 'hop-dong').replace(/[\/\\?%*:|"<>]/g, '-')) + ext;

const PRINT_STYLE = `
  @page {
    size: A4 portrait;
    /* Chuẩn thể thức văn bản hành chính: lề trên 2cm, phải 2cm, dưới 2cm, trái 3cm */
    margin: 20mm 20mm 20mm 30mm; /* top right bottom left — áp dụng cho MỌI trang khi in */
  }
  body {
    font-family: 'Times New Roman', serif;
    font-size: 13pt;
    line-height: 1.5;
    background: #fff;
    color: #000;
    margin: 0;
    padding: 0;
    box-sizing: border-box;
  }
  /* Ép đúng cỡ chữ chuẩn khi in — ghi đè các lớp cỡ chữ của giao diện web (vốn tính bằng px, nhỏ hơn chuẩn) */
  .contract-paper { font-size: 13pt; line-height: 1.5; }
  .contract-paper .text-sm { font-size: 13pt !important; }
  .contract-paper .text-base { font-size: 14pt !important; }
  .contract-paper .text-xs { font-size: 11pt !important; }
  .contract-paper table .text-xs, .contract-paper table { line-height: 1.3; }
  table { border-collapse: collapse; width: 100%; }
  td, th { border: 1px solid #555; padding: 4px 8px; }
  tr { page-break-inside: avoid !important; break-inside: avoid !important; }
  td { page-break-inside: avoid !important; break-inside: avoid !important; }
  thead { display: table-header-group; }
  .no-print { display: none !important; }
`;

export const ContractViewer = ({ contract, sellers, customers, saleMap = {}, saleProfiles = [], isAdmin = false, onAssign, onClose, onDelete, onEdit, onUpdatePaymentTerms }) => {
  const [pdfLoading, setPdfLoading] = useState(false);
  const [wordLoading, setWordLoading] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [assignTarget, setAssignTarget] = useState(contract._maSale || '');
  const [assignError, setAssignError] = useState('');
  const [assignDone, setAssignDone] = useState(false);
  // Ưu tiên dùng bản "chụp" thông tin tại thời điểm tạo hợp đồng (customerSnapshot/sellerSnapshot)
  // — để hợp đồng cũ không bị đổi nội dung khi khách hàng/bên bán sau này được sửa hoặc xóa.
  // Hợp đồng tạo trước khi có tính năng này (chưa có snapshot) thì vẫn tra cứu sống như cũ.
  const customer = contract.customerSnapshot || customers[contract.customerId] || {};
  const seller = contract.sellerSnapshot || sellers[contract.sellerId] || {};
  const PreviewComp = {
    HDNT: HDNTPreview, DDH: DDHPreview, BBBG: BBBGPreview,
    HDNT_VC: HDNTVCPreview, DDH_VC: DDHVCPreview, BBBG_VC: BBBGVCPreview,
    HDNT_UT: HDNTUTPreview, DDH_UT: DDHUTPreview, BBBG_UT: BBBGUTPreview,
  }[contract.type] || HDNTPreview;

  const getFullHtml = (innerHTML) => {
    const styleLinks = Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
      .map(el => `<link rel="stylesheet" href="${el.href}">`).join('\n');
    const styleTags = Array.from(document.querySelectorAll('style'))
      .map(el => el.outerHTML).join('\n');
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"/>
      ${styleLinks}${styleTags}
      <style>${PRINT_STYLE}</style>
    </head><body>${innerHTML}</body></html>`;
  };

  const doPrint = () => {
    const content = document.getElementById('contract-print-zone').innerHTML;
    const w = window.open('', '_blank');
    if (!w) {
      alert('Trình duyệt đang chặn cửa sổ bật lên (popup). Vui lòng cho phép popup cho trang này (thường có biểu tượng 🚫 trên thanh địa chỉ) rồi bấm lại.');
      return;
    }
    w.document.write(getFullHtml(content));
    w.document.close();
    w.onload = () => { w.focus(); w.print(); w.close(); };
    setTimeout(() => { if (!w.closed) { w.focus(); w.print(); w.close(); } }, 800);
  };

  const doDownloadPDF = async () => {
    setPdfLoading(true);
    try {
      await loadScriptOnce(HTML2PDF_SRC);
      const element = document.getElementById('contract-print-zone');
      await window.html2pdf().set({
        margin: [20, 30, 20, 20], // [top, left, bottom, right] mm — chuẩn thể thức: trên 2, trái 3, dưới 2, phải 2 cm
        filename: safeFilename(contract.contractId, '.pdf'),
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak: { mode: ['css', 'legacy'] },
      }).from(element).save();
    } catch (err) {
      alert(err.message || 'Có lỗi khi tạo file PDF.');
    } finally {
      setPdfLoading(false);
    }
  };

  const doDownloadWord = async () => {
    setWordLoading(true);
    try {
      await loadScriptOnce(HTMLDOCX_SRC);
      const element = document.getElementById('contract-print-zone');
      const html = getFullHtml(element.innerHTML);
      const blob = window.htmlDocx.asBlob(html, {
        orientation: 'portrait',
        margins: { top: 1134, right: 1134, bottom: 1134, left: 1701 }, // twip: trên 2 / phải 2 / dưới 2 / trái 3 cm
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = safeFilename(contract.contractId, '.docx');
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(err.message || 'Có lỗi khi tạo file Word.');
    } finally {
      setWordLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 overflow-auto flex items-start justify-center p-4 pt-8">
      <div className="bg-white w-full max-w-3xl rounded-xl shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b no-print flex-wrap gap-2">
          <div>
            <span className="font-mono font-bold text-blue-700 text-lg">{contract.contractId}</span>
            <Badge color={TYPE_COLOR[contract.type] || 'gray'}>{contract.type}</Badge>
          </div>
          <div className="flex gap-2 flex-wrap">
            <button onClick={doPrint}
              className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-green-700 flex items-center gap-1.5">
              🖨️ In / PDF
            </button>
            <button onClick={doDownloadPDF} disabled={pdfLoading}
              className="bg-emerald-50 text-emerald-700 border border-emerald-200 px-4 py-2 rounded-lg text-sm hover:bg-emerald-100 disabled:opacity-60 flex items-center gap-1.5">
              {pdfLoading ? '⏳ Đang tạo...' : '📥 Tải PDF'}
            </button>
            <button onClick={doDownloadWord} disabled={wordLoading}
              className="bg-blue-50 text-blue-700 border border-blue-200 px-4 py-2 rounded-lg text-sm hover:bg-blue-100 disabled:opacity-60 flex items-center gap-1.5">
              {wordLoading ? '⏳ Đang tạo...' : '📄 Tải Word'}
            </button>
            <button onClick={() => { onEdit(contract); onClose(); }}
              className="bg-amber-50 text-amber-600 border border-amber-200 px-4 py-2 rounded-lg text-sm hover:bg-amber-100">
              ✏️ Sửa
            </button>
            <button onClick={() => onDelete(contract)}
              className="bg-red-50 text-red-600 border border-red-200 px-4 py-2 rounded-lg text-sm hover:bg-red-100">
              🗑️ Xóa
            </button>
            <button onClick={onClose}
              className="bg-gray-100 px-4 py-2 rounded-lg text-sm hover:bg-gray-200">
              ✕ Đóng
            </button>
          </div>
        </div>

        {/* Giao hợp đồng cho sale — chỉ admin thấy */}
        {isAdmin && (
          <div className="px-6 py-3 border-b bg-gray-50 no-print flex items-center gap-3 flex-wrap">
            <span className="text-xs font-medium text-gray-500">👤 Sale phụ trách:</span>
            <span className="text-sm text-gray-700">
              {saleMap[contract._maSale]?.name || contract._maSale || <span className="text-gray-400 italic">Chưa gán</span>}
            </span>
            <SaleSearchDropdown
              saleProfiles={saleProfiles}
              value={assignTarget}
              onChange={v => { setAssignTarget(v); setAssignDone(false); }}
              placeholder="Giao cho sale..."
            />
            <button
              disabled={assigning || !assignTarget || assignTarget === contract._maSale}
              onClick={async () => {
                setAssigning(true); setAssignError(''); setAssignDone(false);
                try {
                  await onAssign(contract, assignTarget);
                  setAssignDone(true);
                } catch (err) { setAssignError(err.message); }
                finally { setAssigning(false); }
              }}
              className="bg-blue-600 text-white px-3 py-1 rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50">
              {assigning ? '...' : '✓ Giao'}
            </button>
            {assignDone && <span className="text-xs text-green-600 font-medium">✓ Đã giao thành công</span>}
            {assignError && <span className="text-xs text-red-600">{assignError}</span>}
          </div>
        )}
        <div className="p-10" id="contract-print-zone">
          <PreviewComp c={contract} seller={seller} customer={customer}
            onChangePaymentTerms={onUpdatePaymentTerms ? (text) => onUpdatePaymentTerms(contract, text) : undefined} />
        </div>
      </div>
    </div>
  );
};

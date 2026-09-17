// File: src/previews/DDHPreview.jsx
import { SignatureBlock } from './SignatureBlock';
import { fmtDate, calcTotals, numberToWords } from '../helpers';
import { GoodsTablePrint } from './GoodsTablePrint';
import { EditableClause } from './EditableClause';

export const DEFAULT_PAYMENT_TERMS_DDH =
`– Chuyển khoản hoặc tiền mặt 100% theo thông báo giao hàng hoặc theo biên bản bàn giao, nghiệm thu và quyết toán giá trị thực tế vào tài khoản của bên B.
– Chứng từ thanh toán: Đơn đặt hàng / biên bản bàn giao, nghiệm thu và quyết toán giá trị thực tế.
– Thời gian thanh toán: Thanh toán 100% sau khi đặt hàng.`;

export const DDHPreview = ({ c, seller, customer, onChangePaymentTerms }) => {
  // BÊN A = Bên đặt hàng (Khách hàng) | BÊN B = Bên nhận đơn / bán (CTS)
  const ben_A = customer || {}, ben_B = seller || {};
  // Giá trị lúc đặt hàng là TẠM TÍNH, CHƯA gồm thuế (VAT tính sau ở Biên Bản Bàn Giao khi quyết toán
  // thực tế) — nên dùng subtotal (chưa thuế), không dùng total (đã cộng VAT) như bên BBBG.
  const { subtotal } = calcTotals(c.goods);
  return (
    <div className="contract-paper">
      <div className="text-center mb-5">
        <div className="font-bold text-sm">CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM</div>
        <div className="font-bold text-sm">Độc lập – Tự do – Hạnh phúc</div>
        <div className="my-1">───────────────</div>
        <div className="text-base font-bold mt-3 uppercase">Đơn Đặt Hàng</div>
        <div className="text-sm">Số: <strong>{c.contractId}</strong></div>
        <div className="text-sm italic text-gray-600">{fmtDate(c.date)}</div>
      </div>

      <div className="mb-3 text-sm">
        <div className="font-bold">BÊN MUA (BÊN A): <strong>{ben_A.companyName}</strong></div>
        <div>Địa chỉ: {ben_A.address}</div>
        <div>Mã số thuế: {ben_A.taxCode} &nbsp;|&nbsp; Điện thoại: {ben_A.phone}</div>
        <div>Email: {ben_A.email}</div>
        <div>Số tài khoản: {ben_A.bankAccount}{ben_A.bankName ? ` tại ${ben_A.bankName}` : ''}</div>
        <div>Người đại diện: <strong>{ben_A.representative}</strong> &nbsp;–&nbsp; Chức vụ: {ben_A.position}</div>
      </div>

      <div className="mb-3 text-sm">
        <div className="font-bold">BÊN BÁN (BÊN B): <strong>{ben_B.companyName}</strong></div>
        <div>Địa chỉ: {ben_B.address}</div>
        <div>Mã số thuế: {ben_B.taxCode} &nbsp;|&nbsp; Điện thoại: {ben_B.phone}</div>
        <div>Email: {ben_B.email}</div>
        <div>Số tài khoản: {ben_B.bankAccount}{ben_B.bankName ? ` tại ${ben_B.bankName}` : ''}</div>
        <div>Người đại diện: <strong>{ben_B.representative}</strong> &nbsp;–&nbsp; Chức vụ: {ben_B.position}</div>
      </div>

      <p className="mb-4 text-sm" style={{ textAlign: 'justify' }}>
        Căn cứ vào hợp đồng nguyên tắc số: <strong>{c.relatedContracts?.hdnt || '………………'}</strong> ký giữa Quý công ty (bên B) và chúng tôi (bên A). Chúng tôi xin gửi Quý công ty đơn đặt hàng với điều khoản sau:
      </p>

      <div className="mb-3 text-sm">
        <div className="font-bold uppercase">Điều 1: Đối tượng hàng hóa</div>
        <div className="mb-2">Bên B cung cấp cho Bên A các loại hàng hóa chi tiết với những thông tin như sau:</div>
        <GoodsTablePrint goods={c.goods} finalLabel="Cộng tiền hàng" hideVat />
        <div className="mb-2"><strong>Bằng chữ:</strong> {numberToWords(subtotal)}</div>
        <div style={{ textAlign: 'justify' }}>Giá trên là giá trị tạm tính chưa bao gồm thuế, tiền thuế theo quy định thuế hiện hành. Trong quá trình triển khai đơn đặt hàng, nếu có phát sinh tăng hay giảm giá trị theo đơn đặt hàng thì hai bên ký biên bản bàn giao, nghiệm thu và quyết toán giá trị thực tế. Bên B lập hóa đơn GTGT theo giá trị quyết toán thực tế.</div>
      </div>

      <div className="mb-3 text-sm">
        <div className="font-bold uppercase">Điều 2: Địa điểm và thời hạn giao hàng</div>
        <div>– Địa điểm giao hàng: Tại kho của bên B.</div>
        <div>– Thời gian: Trong vòng 30 ngày kể từ ngày nhận đơn đặt hàng của bên A, trừ khi xảy ra sự kiện bất khả kháng.</div>
      </div>

      <div className="mb-3 text-sm">
        <EditableClause
          heading="Điều 3: Thời hạn và phương thức thanh toán"
          value={c.paymentTerms || DEFAULT_PAYMENT_TERMS_DDH}
          onSave={onChangePaymentTerms}
          style={{ textAlign: 'justify' }}
        />
      </div>

      <div className="mb-3 text-sm">
        <div className="font-bold uppercase">Điều 4: Hiệu lực</div>
        <div style={{ textAlign: 'justify' }}>Đơn đặt hàng này là một phần không tách rời Hợp đồng nguyên tắc hai bên đã ký. Các điều khoản của đơn đặt hàng này được áp dụng theo điều khoản trong hợp đồng nguyên tắc, có hiệu lực từ ngày ký. Đơn đặt hàng được tự động thanh lý khi các bên đã hoàn thành toàn bộ nghĩa vụ theo đơn đặt hàng này.</div>
      </div>

      <SignatureBlock marginTop="32px" leftTitle="Đại diện Bên A" leftSub="(Bên Mua)" rightTitle="Đại diện Bên B" rightSub="(Bên Bán)" />
    </div>
  );
};

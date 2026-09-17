// File: src/previews/DDHVCPreview.jsx
import { SignatureBlock } from './SignatureBlock';
import { fmtDate } from '../helpers';
import { ServiceFeeTable } from './ServiceFeeTable';
import { EditableClause } from './EditableClause';

export const DEFAULT_PAYMENT_TERMS_DDH_VC =
`– Chuyển khoản 100% giá trị dịch vụ thực tế vào tài khoản của bên B dựa theo thông báo thanh toán được bên B gửi cho bên A theo hình thức tin nhắn/email/điện thoại.
– Chứng từ thanh toán: Đơn đặt dịch vụ / biên bản bàn giao, nghiệm thu và quyết toán giá trị thực tế.`;

export const DDHVCPreview = ({ c, seller, customer, onChangePaymentTerms }) => {
  // BÊN A = Bên đặt dịch vụ (Khách hàng) | BÊN B = Bên nhận dịch vụ (CTS)
  const ben_A = customer || {}, ben_B = seller || {};
  return (
    <div className="contract-paper">
      <div className="text-center mb-5">
        <div className="font-bold text-sm">CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM</div>
        <div className="font-bold text-sm">Độc lập – Tự do – Hạnh phúc</div>
        <div className="my-1">───────────────</div>
        <div className="text-base font-bold mt-3 uppercase">Đơn Đặt Dịch Vụ Logistics</div>
        <div className="text-sm">Số: <strong>{c.contractId}</strong></div>
        <div className="text-sm italic text-gray-600">{fmtDate(c.date)}</div>
      </div>

      <div className="mb-3 text-sm">
        <div className="font-bold">BÊN THUÊ DỊCH VỤ (BÊN A): <strong>{ben_A.companyName}</strong></div>
        <div>Địa chỉ: {ben_A.address}</div>
        <div>Mã số thuế: {ben_A.taxCode} &nbsp;|&nbsp; Điện thoại: {ben_A.phone}</div>
        <div>Email nhận hồ sơ: {ben_A.email}</div>
        <div>Số tài khoản: {ben_A.bankAccount}{ben_A.bankName ? ` tại ${ben_A.bankName}` : ''}</div>
        <div>Người đại diện: <strong>{ben_A.representative}</strong> &nbsp;–&nbsp; Chức vụ: {ben_A.position}</div>
      </div>

      <div className="mb-3 text-sm">
        <div className="font-bold">BÊN NHẬN DỊCH VỤ (BÊN B): <strong>{ben_B.companyName}</strong></div>
        <div>Địa chỉ: {ben_B.address}</div>
        <div>Mã số thuế: {ben_B.taxCode} &nbsp;|&nbsp; Điện thoại: {ben_B.phone}</div>
        <div>Email nhận hồ sơ: {ben_B.email}</div>
        <div>Số tài khoản: {ben_B.bankAccount}{ben_B.bankName ? ` tại ${ben_B.bankName}` : ''}</div>
        <div>Người đại diện: <strong>{ben_B.representative}</strong> &nbsp;–&nbsp; Chức vụ: {ben_B.position}</div>
      </div>

      <p className="mb-4 text-sm" style={{ textAlign: 'justify' }}>
        Căn cứ vào hợp đồng nguyên tắc dịch vụ số: <strong>{c.relatedContracts?.hdnt_vc || '………………'}</strong> ký giữa Quý công ty (bên B) và chúng tôi (bên A). Chúng tôi xin gửi Quý công ty đơn đặt dịch vụ với điều khoản sau:
      </p>

      <div className="mb-3 text-sm">
        <div className="font-bold uppercase">Điều 1: Đối tượng dịch vụ</div>
        <div className="mb-2" style={{ textAlign: 'justify' }}>Bên B cung cấp dịch vụ Logistics trọn gói cho Bên A bao gồm: Khai báo hải quan, nâng hạ, kho bãi, vận chuyển, giao hàng và các chi phí khác (nếu có), không bao gồm phí lưu kho, lưu xe do lỗi của Bên A trong việc nhận hàng hoặc chi phí kiểm hoá (nếu có).</div>
        <ServiceFeeTable goods={c.goods} feeLabel="Phí dịch vụ Logistics trọn gói tạm tính (Vnd)" totalLabel="Tổng cộng giá trị sau thuế (Vnd)" />
        <div style={{ textAlign: 'justify' }}>Giá trên là giá trị tạm tính. Trong quá trình triển khai nếu có phát sinh tăng hay giảm giá trị theo đơn đặt dịch vụ này thì Bên B thông báo cho Bên A qua email, tin nhắn, điện thoại. Sau khi nhận được thông báo, Bên A được xem đã đồng ý với nội dung điều chỉnh của Bên B trừ khi có phản hồi bằng văn bản và/hoặc (email, zalo) trong 02 ngày làm việc. Tại thời điểm giao hàng, hai bên ký biên bản bàn giao, nghiệm thu và quyết toán giá trị thực tế. Bên B lập hóa đơn GTGT theo giá trị quyết toán thực tế.</div>
      </div>

      <div className="mb-3 text-sm">
        <div className="font-bold uppercase">Điều 2: Địa điểm và thời hạn giao hàng</div>
        <div>– Địa điểm giao hàng: Tại kho của bên B.</div>
        <div>– Thời gian: Trong vòng 15 ngày kể từ ngày hàng hóa được thông quan và bàn giao cho đơn vị vận chuyển do Bên B chỉ định, trừ trường hợp bất khả kháng.</div>
      </div>

      <div className="mb-3 text-sm">
        <EditableClause
          heading="Điều 3: Thời hạn và phương thức thanh toán"
          value={c.paymentTerms || DEFAULT_PAYMENT_TERMS_DDH_VC}
          onSave={onChangePaymentTerms}
          style={{ textAlign: 'justify' }}
        />
      </div>

      <div className="mb-3 text-sm">
        <div className="font-bold uppercase">Điều 4: Hiệu lực</div>
        <div style={{ textAlign: 'justify' }}>Đơn đặt dịch vụ này là một phần không tách rời Hợp đồng nguyên tắc hai bên đã ký. Các điều khoản của đơn đặt dịch vụ này được áp dụng theo điều khoản trong hợp đồng nguyên tắc, có hiệu lực từ ngày ký. Đơn đặt dịch vụ được tự động thanh lý khi các bên đã hoàn thành toàn bộ nghĩa vụ theo đơn đặt dịch vụ này.</div>
      </div>

      <SignatureBlock marginTop="32px" leftTitle="Đại diện Bên A" leftSub="(Bên Thuê Dịch Vụ)" rightTitle="Đại diện Bên B" rightSub="(Bên Nhận Dịch Vụ)" />
    </div>
  );
};

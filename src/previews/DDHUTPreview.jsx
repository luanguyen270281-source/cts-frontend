// File: src/previews/DDHUTPreview.jsx
import { SignatureBlock } from './SignatureBlock';
import { fmtDate } from '../helpers';
import { GoodsTableUSDPrint } from './GoodsTableUSDPrint';
import { ServiceFeeTable } from './ServiceFeeTable';
import { EditableClause } from './EditableClause';

export const DEFAULT_PAYMENT_TERMS_DDH_UT =
`– Lần 1 – Giá trị tiền hàng: Sau khi Bên A gửi đơn đặt dịch vụ ủy thác nhập khẩu cho Bên B, Bên A có trách nhiệm thanh toán 100% giá trị tiền hàng bằng đồng Việt Nam theo tỷ giá thỏa thuận. Bên B sẽ thanh toán tiền cho bên bán hàng của Bên A (bên xuất khẩu).
– Lần 2 – Bên A thanh toán 100% các loại thuế, phí dịch vụ cho Bên B, bao gồm các loại thuế và nghĩa vụ của doanh nghiệp đối với lô hàng nhập khẩu mà Bên B đã thanh toán trước để thông quan theo số tiền thực tế.
– Giá trị dịch vụ dựa theo biên bản bàn giao, nghiệm thu và quyết toán giá trị thực tế. Bên B xuất hóa đơn cho Bên A khi bàn giao hàng hóa và dịch vụ.
    + Hóa đơn giá trị tiền hàng tại điểm 1.1 quy đổi theo giá trị tiền Việt Nam Đồng trên tờ khai hải quan và các loại thuế, phí thực nộp thay cho Bên A theo tờ khai hải quan nhập khẩu.
    + Hóa đơn phí dịch vụ ủy thác trọn gói: Quy định tại điểm 1.2 theo giá trị nghiệm thu và quyết toán thực tế đã bao gồm thuế GTGT.
– Chứng từ thanh toán: Đơn đặt dịch vụ / biên bản bàn giao, nghiệm thu và quyết toán giá trị thực tế.`;

export const DDHUTPreview = ({ c, seller, customer, onChangePaymentTerms }) => {
  // BÊN A = Bên ủy thác (Khách hàng) | BÊN B = Bên nhận ủy thác (CTS)
  const ben_A = customer || {}, ben_B = seller || {};
  return (
    <div className="contract-paper">
      <div className="text-center mb-5">
        <div className="font-bold text-sm">CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM</div>
        <div className="font-bold text-sm">Độc lập – Tự do – Hạnh phúc</div>
        <div className="my-1">───────────────</div>
        <div className="text-base font-bold mt-3 uppercase">Đơn Đặt Dịch Vụ Ủy Thác Nhập Khẩu</div>
        <div className="text-sm">Số: <strong>{c.contractId}</strong></div>
        <div className="text-sm italic text-gray-600">{fmtDate(c.date)}</div>
      </div>

      <div className="mb-3 text-sm">
        <div className="font-bold">BÊN ỦY THÁC (BÊN A): <strong>{ben_A.companyName}</strong></div>
        <div>Địa chỉ: {ben_A.address}</div>
        <div>Mã số thuế: {ben_A.taxCode} &nbsp;|&nbsp; Điện thoại: {ben_A.phone}</div>
        <div>Email nhận hồ sơ: {ben_A.email}</div>
        <div>Số tài khoản: {ben_A.bankAccount}{ben_A.bankName ? ` tại ${ben_A.bankName}` : ''}</div>
        <div>Người đại diện: <strong>{ben_A.representative}</strong> &nbsp;–&nbsp; Chức vụ: {ben_A.position}</div>
      </div>

      <div className="mb-3 text-sm">
        <div className="font-bold">BÊN NHẬN ỦY THÁC (BÊN B): <strong>{ben_B.companyName}</strong></div>
        <div>Địa chỉ: {ben_B.address}</div>
        <div>Mã số thuế: {ben_B.taxCode} &nbsp;|&nbsp; Điện thoại: {ben_B.phone}</div>
        <div>Email nhận hồ sơ: {ben_B.email}</div>
        <div>Số tài khoản: {ben_B.bankAccount}{ben_B.bankName ? ` tại ${ben_B.bankName}` : ''}</div>
        <div>Người đại diện: <strong>{ben_B.representative}</strong> &nbsp;–&nbsp; Chức vụ: {ben_B.position}</div>
      </div>

      <p className="mb-4 text-sm" style={{ textAlign: 'justify' }}>
        Căn cứ vào hợp đồng nguyên tắc ủy thác nhập khẩu số: <strong>{c.relatedContracts?.hdnt_ut || '………………'}</strong> ký giữa Quý công ty (bên B) và chúng tôi (bên A). Chúng tôi xin gửi Quý công ty đơn đặt dịch vụ ủy thác nhập khẩu với điều khoản sau:
      </p>

      <div className="mb-3 text-sm">
        <div className="font-bold uppercase">Điều 1: Giá trị hàng hóa nhập khẩu, dịch vụ, thanh toán</div>
        <div className="mb-2" style={{ textAlign: 'justify' }}>Bên A thuê Bên B làm dịch vụ ủy thác nhập khẩu và giao nhận trọn gói hàng hóa theo chi tiết sau:</div>

        <div className="font-semibold mb-1">1.1. Giá trị tiền hàng nhập khẩu</div>
        <GoodsTableUSDPrint goods={c.goodsUSD} exchangeRate={c.exchangeRate} />
        <div className="mb-3" style={{ textAlign: 'justify' }}>Các chi phí thuế và nghĩa vụ của doanh nghiệp đối với lô hàng nhập khẩu: thuế nhập khẩu, thuế tiêu thụ đặc biệt, thuế giá trị gia tăng và các thuế phí khác theo chứng từ kèm tờ khai nhập khẩu hàng hóa sẽ được Bên B thanh toán trước để thông quan và thông báo để thu lại của Bên A theo số tiền thực tế trước khi giao hàng.</div>

        <div className="font-semibold mb-1">1.2. Phí dịch vụ trọn gói</div>
        <ServiceFeeTable goods={c.goods} feeLabel="Phí dịch vụ ủy thác trọn gói tạm tính (Vnd)" totalLabel="Tổng cộng giá trị sau thuế (Vnd)" />
        <div style={{ textAlign: 'justify' }}>Bao gồm: ký hợp đồng ngoại thương, khai báo hải quan, nộp thuế, nâng hạ, kho bãi, vận chuyển, giao hàng, thanh toán quốc tế và các chi phí khác (nếu có), không bao gồm phí lưu kho, lưu xe do lỗi của Bên A trong việc nhận hàng. Trong quá trình triển khai đơn đặt dịch vụ, nếu có phát sinh tăng hay giảm giá trị theo đơn đặt dịch vụ thì hai bên ký biên bản bàn giao, nghiệm thu và quyết toán giá trị thực tế. Bên B lập hóa đơn GTGT theo giá trị quyết toán thực tế.</div>
      </div>

      <div className="mb-3 text-sm">
        <div className="font-bold uppercase">Điều 2: Địa điểm và thời hạn giao hàng</div>
        <div>– Địa điểm giao hàng: Tại kho của bên B.</div>
        <div>– Thời gian: Trong vòng 15 ngày kể từ ngày hàng hóa được thông quan và bàn giao cho đơn vị vận chuyển do Bên B chỉ định, trừ trường hợp bất khả kháng.</div>
      </div>

      <div className="mb-3 text-sm">
        <EditableClause
          heading="Điều 3: Thời hạn và phương thức thanh toán"
          value={c.paymentTerms || DEFAULT_PAYMENT_TERMS_DDH_UT}
          onSave={onChangePaymentTerms}
          style={{ textAlign: 'justify' }}
        />
      </div>

      <div className="mb-3 text-sm">
        <div className="font-bold uppercase">Điều 4: Hiệu lực</div>
        <div style={{ textAlign: 'justify' }}>Đơn đặt dịch vụ này là một phần không tách rời Hợp đồng nguyên tắc hai bên đã ký. Các điều khoản của đơn đặt dịch vụ này được áp dụng theo điều khoản trong hợp đồng nguyên tắc, có hiệu lực từ ngày ký. Đơn đặt dịch vụ được tự động thanh lý khi các bên đã hoàn thành toàn bộ nghĩa vụ theo đơn đặt dịch vụ này.</div>
      </div>

      <SignatureBlock marginTop="32px" leftTitle="Đại diện Bên A" leftSub="(Bên Ủy Thác)" rightTitle="Đại diện Bên B" rightSub="(Bên Nhận Ủy Thác)" />
    </div>
  );
};

// File: src/previews/SalesContractPreview.jsx
import { fmtNum, amountToWordsEN } from '../helpers';

// Định dạng USD (dấu phẩy nghìn, 2 số thập phân) — tự viết, không phụ thuộc locale máy
const fmtUSD = (n) => {
  const num = Number(n) || 0;
  const fixed = Math.abs(num).toFixed(2);
  const [intPart, decPart] = fixed.split('.');
  const withCommas = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (num < 0 ? '-' : '') + withCommas + '.' + decPart;
};
const fmtDMY = (d) => {
  if (!d) return '';
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${y}`;
};

const cellLabel = { border: '1px solid #000', padding: '6px 10px', fontWeight: 'bold', fontSize: '12.5px', whiteSpace: 'nowrap', verticalAlign: 'top' };
const cellValue = { border: '1px solid #000', padding: '6px 10px', fontSize: '12.5px', verticalAlign: 'top' };
const cellValueBold = { ...cellValue, fontWeight: 'bold' };

const PartyTable = ({ heading, p }) => (
  <>
    <p className="font-bold text-xs mb-1">{heading}</p>
    <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '16px' }}>
      <tbody>
        <tr>
          <td style={{ ...cellLabel, width: '8%' }}>Reg:</td>
          <td style={{ ...cellValueBold, width: '47%' }}>{p.name}</td>
          <td style={{ ...cellLabel, width: '18%' }}>Representative by:</td>
          <td style={{ ...cellValue, width: '27%' }}>{p.rep}</td>
        </tr>
        <tr>
          <td style={cellLabel}>Add:</td>
          <td style={cellValue}>{p.address}</td>
          <td style={cellLabel}>Position:</td>
          <td style={cellValue}>{p.position}</td>
        </tr>
      </tbody>
    </table>
  </>
);

// c = sales contract record (data phần jsonb)
export const SalesContractPreview = ({ c }) => {
  const items = c.items || [];
  const total = items.reduce((sum, it) => sum + (Number(it.qty) || 0) * (Number(it.unitPrice) || 0), 0);
  const seller = c.seller || {};
  const buyer = c.buyer || {};

  return (
    <div className="contract-paper">
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '24px' }}>
        <tbody>
          <tr>
            <td style={{ border: '1.5px solid #000', padding: '14px 18px', width: '62%', verticalAlign: 'middle' }}>
              <div style={{ fontSize: '22px', fontWeight: 'bold', letterSpacing: '0.5px' }}>SALES CONTRACT</div>
            </td>
            <td style={{ border: '1.5px solid #000', padding: 0, width: '38%', verticalAlign: 'top' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <tbody>
                  <tr>
                    <td style={{ padding: '8px 14px', fontWeight: 'bold', border: 'none', fontSize: '13px' }}>No:</td>
                    <td style={{ padding: '8px 14px', fontWeight: 'bold', textAlign: 'right', border: 'none', fontSize: '13px' }}>{c.contractNo || '________'}</td>
                  </tr>
                  <tr>
                    <td style={{ padding: '8px 14px', fontWeight: 'bold', border: 'none', borderTop: '1px solid #000', fontSize: '13px' }}>Date:</td>
                    <td style={{ padding: '8px 14px', fontWeight: 'bold', textAlign: 'right', border: 'none', borderTop: '1px solid #000', fontSize: '13px' }}>{fmtDMY(c.date)}</td>
                  </tr>
                </tbody>
              </table>
            </td>
          </tr>
        </tbody>
      </table>

      <p className="mb-4 text-xs">This agreement is drawn between the following parties:</p>

      <PartyTable heading="The Seller (Party A):" p={seller} />
      <PartyTable heading="The Buyer (Party B):" p={buyer} />

      <p className="text-xs mb-4 italic">
        In accordance with the seller's quotation, we are mutually agreed between two parties to sign this sales contract on the terms and conditions as following:
      </p>

      <p className="font-bold text-xs mb-1">1. Commodity - Specification - Quantity - Price:</p>
      <p className="text-xs mb-2">The seller undertakes to supply to the buyer equipments with specification and quantity as bellow:</p>
      <table className="w-full text-xs mb-2 border-collapse">
        <thead>
          <tr className="border-b border-t" style={{ borderColor: '#333' }}>
            <th className="py-1.5 text-left font-semibold">Item No.</th>
            <th className="py-1.5 text-left font-semibold">Description of commodity</th>
            <th className="py-1.5 text-left font-semibold">Origin</th>
            <th className="py-1.5 text-right font-semibold">Quantity</th>
            <th className="py-1.5 text-left font-semibold pl-2">Unit</th>
            <th className="py-1.5 text-right font-semibold">Unit price (USD)</th>
            <th className="py-1.5 text-right font-semibold">Amount (USD)</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it, i) => (
            <tr key={it.id || i} className="border-b" style={{ borderColor: '#ccc' }}>
              <td className="py-1.5">{i + 1}</td>
              <td className="py-1.5">{it.descriptionEN}</td>
              <td className="py-1.5">{it.origin}</td>
              <td className="py-1.5 text-right">{fmtNum(it.qty)}</td>
              <td className="py-1.5 pl-2">{it.unit}</td>
              <td className="py-1.5 text-right">{fmtUSD(it.unitPrice)}</td>
              <td className="py-1.5 text-right">{fmtUSD((Number(it.qty) || 0) * (Number(it.unitPrice) || 0))}</td>
            </tr>
          ))}
          <tr>
            <td colSpan={6} className="py-1.5 text-right font-semibold">
              Total amount ({c.incotermsRef || 'Incoterms 2000'}) in currency: USD
            </td>
            <td className="py-1.5 text-right font-semibold">{fmtUSD(total)}</td>
          </tr>
        </tbody>
      </table>
      <p className="text-xs mb-2">Say: {amountToWordsEN(total)}</p>
      <p className="text-xs mb-2">Manufacture's name in physical product must be in compliance with the contract.</p>

      <p className="text-xs mb-4">Quality: {c.quality}</p>

      <div className="grid grid-cols-2 gap-6 mb-4 avoid-break">
        <div>
          <p className="font-bold text-xs mb-1">2. Shipping terms: {c.incotermsRef || 'Incoterms 2000'} to be referred</p>
          <p className="text-xs mb-0.5">Shipping method: {c.shippingMethod}</p>
          <p className="text-xs mb-0.5">Latest shipment date: {c.latestShipment}</p>
          <p className="text-xs mb-0.5">Shipping terms: {c.incoterms}</p>
          <p className="text-xs mb-0.5">Port of loading: {c.portLoading}</p>
          <p className="text-xs mb-0.5">Port of discharge: {c.portDischarge}</p>
          <p className="text-xs mb-0.5">Partial shipment: {c.partialShipment || 'Allowed'}</p>
          <p className="text-xs mb-0.5">Early shipment: {c.earlyShipment || 'Allowed'}</p>
          <p className="text-xs mb-1.5">Notice of shipment: {c.noticeShipment}</p>
          <p className="text-xs">
            {c.defectiveGoodsNote || "Wrong or defective goods will be returned to the seller for replacement or refunds. All charges associated with return of the defective or wrong goods to be delivered the new one to buyer. All charges shall be at seller's account."}
          </p>
        </div>
        <div>
          <p className="font-bold text-xs mb-1">3. Packing: {c.packingStandard || 'Manufactures standard packing.'}</p>
          <p className="text-xs">{c.packing}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6 mb-4 avoid-break">
        <div>
          <p className="font-bold text-xs mb-1">4. Payments:</p>
          <p className="text-xs mb-1">{c.paymentTerm}</p>
          <p className="text-xs mb-0.5">Telegraphic transfer: {c.telegraphicTransfer || 'T/T'}</p>
          <p className="text-xs mb-0.5">Bank: {c.bankName}</p>
          <p className="text-xs mb-0.5">Bank address: {c.bankAddress}</p>
          <p className="text-xs mb-0.5">Swift code: {c.swiftCode}</p>
          <p className="text-xs mb-0.5">Account number: {c.accountNumber}</p>
          <p className="text-xs mb-0.5">Beneficiary: {c.beneficiary}</p>
          <p className="text-xs">{c.feesNote}</p>
        </div>
        <div>
          <p className="font-bold text-xs mb-1">5. Required Documents:</p>
          <p className="text-xs mb-0.5">Commercial invoice and Packing list: 02 original sets</p>
          <p className="text-xs">Certificate of origin: 01 original set (issued by China Chamber of Commerce)</p>
        </div>
      </div>

      <p className="font-bold text-xs mb-1">6. Penalty - Arbitration:</p>
      <p className="text-xs mb-1">
        {c.artworkCommitment || 'The Seller will commit to make mass production completely 100% similar to the artwork that is approved by the Buyer.'}
      </p>
      <p className="text-xs mb-1">
        {c.artworkFailureNote || "If the seller fails to make products according to the buyer's sample or artwork, seller must bear all arising costs such as remake or correct products."}
      </p>
      <p className="text-xs mb-2">
        {c.penalty} Any dispute arising out of this contract shall be first amicably settled by parties. If agreeable result
        cannot be reached it shall be finally settled by the Vietnam International Arbitration Center at the Chamber of
        Commerce and Industry of Vietnam (VCCI). Decision reached by this arbitration shall be final and promptly accepted
        by all parties. The jurisdiction fees will be of the failing party.
      </p>

      <table style={{ width: '100%', marginTop: '30px', borderCollapse: 'collapse' }}>
        <tbody>
          <tr>
            <td style={{ width: '50%', textAlign: 'center', verticalAlign: 'top', border: 'none', padding: '0 20px' }} className="text-sm">
              <div className="font-bold uppercase">SELLER/PARTY A</div>
              <div style={{ height: '96px' }}></div>
            </td>
            <td style={{ width: '50%', textAlign: 'center', verticalAlign: 'top', border: 'none', padding: '0 20px' }} className="text-sm">
              <div className="font-bold uppercase">BUYER/PARTY B</div>
              <div style={{ height: '96px' }}></div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
};

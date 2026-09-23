// File: src/App.jsx
import { useState, useEffect, lazy, Suspense } from 'react';
import { supabase } from './lib/supabase';
import { api } from './lib/api';
import { Sidebar } from './components/Sidebar';
import ErrorBoundary from './components/ErrorBoundary';
import ErrorCard from './components/ErrorCard';

// Mỗi trang được tải riêng (dynamic import) thay vì gộp chung 1 file JS —
// trước đây toàn bộ ~30 trang (kể cả các trang rất nặng như CashFlowPage,
// PaymentRequestPrint, SalesContractPage...) bị gộp vào 1 bundle ~1.2MB,
// khiến người dùng phải tải hết dù chỉ đứng ở màn Đăng nhập. Nay trình duyệt
// chỉ tải trang nào người dùng thực sự bấm vào.
const lazyNamed = (loader, name) => lazy(() => loader().then(m => ({ default: m[name] })));

const Dashboard = lazyNamed(() => import('./pages/Dashboard'), 'Dashboard');
const SellersPage = lazyNamed(() => import('./pages/SellersPage'), 'SellersPage');
const ForeignSellersPage = lazyNamed(() => import('./pages/ForeignSellersPage'), 'ForeignSellersPage');
const CustomersPage = lazyNamed(() => import('./pages/CustomersPage'), 'CustomersPage');
const InvoiceGoodsPage = lazyNamed(() => import('./pages/InvoiceGoodsPage'), 'InvoiceGoodsPage');
const CashFlowSummary = lazyNamed(() => import('./pages/CashFlowSummary'), 'CashFlowSummary');
const CashFlowPage = lazyNamed(() => import('./pages/CashFlowPage'), 'CashFlowPage');
const DailyPaymentRequestsPage = lazyNamed(() => import('./pages/DailyPaymentRequestsPage'), 'DailyPaymentRequestsPage');
const FxContractSummary = lazyNamed(() => import('./pages/FxContractSummary'), 'FxContractSummary');
const SalesContractPage = lazyNamed(() => import('./pages/SalesContractPage'), 'SalesContractPage');
const CnyFundPage = lazyNamed(() => import('./pages/CnyFundPage'), 'CnyFundPage');
const PaymentRequestPrint = lazyNamed(() => import('./pages/PaymentRequestPrint'), 'PaymentRequestPrint');
const ApiKeyManager = lazyNamed(() => import('./pages/ApiKeyManager'), 'ApiKeyManager');
const DepartmentsManager = lazyNamed(() => import('./pages/DepartmentsManager'), 'DepartmentsManager');
const ContractListPage = lazyNamed(() => import('./pages/ContractListPage'), 'ContractListPage');
const ContractViewer = lazyNamed(() => import('./pages/ContractViewer'), 'ContractViewer');
const CreateHDNT = lazyNamed(() => import('./pages/CreateHDNT'), 'CreateHDNT');
const CreateDDH = lazyNamed(() => import('./pages/CreateDDH'), 'CreateDDH');
const CreateBBBG = lazyNamed(() => import('./pages/CreateBBBG'), 'CreateBBBG');
const CreateHDNTVC = lazyNamed(() => import('./pages/CreateHDNTVC'), 'CreateHDNTVC');
const CreateDDHVC = lazyNamed(() => import('./pages/CreateDDHVC'), 'CreateDDHVC');
const CreateBBBGVC = lazyNamed(() => import('./pages/CreateBBBGVC'), 'CreateBBBGVC');
const CreateHDNTUT = lazyNamed(() => import('./pages/CreateHDNTUT'), 'CreateHDNTUT');
const CreateDDHUT = lazyNamed(() => import('./pages/CreateDDHUT'), 'CreateDDHUT');
const CreateBBBGUT = lazyNamed(() => import('./pages/CreateBBBGUT'), 'CreateBBBGUT');
const LoginPage = lazyNamed(() => import('./pages/LoginPage'), 'LoginPage');
const ResetPasswordPage = lazyNamed(() => import('./pages/ResetPasswordPage'), 'ResetPasswordPage');
const AdminUsersPage = lazyNamed(() => import('./pages/AdminUsersPage'), 'AdminUsersPage');
const CompleteProfilePage = lazyNamed(() => import('./pages/CompleteProfilePage'), 'CompleteProfilePage');

const PageLoadingFallback = () => (
  <div className="flex items-center justify-center min-h-screen text-gray-400">
    <div className="text-center"><div className="text-4xl mb-3">📋</div><div>Đang tải...</div></div>
  </div>
);

// renderPage() dựng JSX của trang hiện tại bằng 1 lệnh gọi hàm thường. Nếu gọi thẳng
// renderPage() ngay trong JSX của App, lệnh gọi đó chạy trong lúc App tự render (trước khi
// ErrorBoundary/Suspense bên dưới thậm chí được React tạo ra) — lỗi ném ra ở đó sẽ vượt qua
// ErrorBoundary riêng của từng trang và làm sập luôn cả app. Bọc trong 1 component con để
// renderPage() chỉ chạy trong lúc React render component NÀY, tức là đã ở trong ErrorBoundary.
const PageContent = ({ renderPage }) => renderPage();

const DOC_TYPE_MAP = {
  HDNT: 'hd_nguyen_tac', DDH: 'don_dat_hang', BBBG: 'bbbg',
  HDNT_VC: 'hd_nguyen_tac_vc', DDH_VC: 'don_dat_dich_vu', BBBG_VC: 'bbbg_vc',
  HDNT_UT: 'hd_nguyen_tac_ut', DDH_UT: 'don_dat_dich_vu_ut', BBBG_UT: 'bbbg_ut',
};
const CATEGORY_MAP = {
  HDNT: 'mua_ban', DDH: 'mua_ban', BBBG: 'mua_ban',
  HDNT_VC: 'van_chuyen', DDH_VC: 'van_chuyen', BBBG_VC: 'van_chuyen',
  HDNT_UT: 'uy_thac', DDH_UT: 'uy_thac', BBBG_UT: 'uy_thac',
};
// Khi sửa mã hợp đồng (contractId) của HDNT/DDH (và các biến thể VC/UT), cần dò các hợp đồng
// con đang tham chiếu tới mã CŨ trong relatedContracts để cập nhật theo mã MỚI luôn.
// Key bên phải là tên field trong relatedContracts mà hợp đồng con dùng để trỏ tới loại này.
const REFERENCED_AS = {
  HDNT: 'hdnt', HDNT_VC: 'hdnt_vc', HDNT_UT: 'hdnt_ut',
  DDH: 'ddh', DDH_VC: 'ddh_vc', DDH_UT: 'ddh_ut',
};

export default function App() {
  const [session, setSession] = useState(undefined); // undefined = loading
  const [page, setPage] = useState('dashboard');
  const [sellers, setSellers] = useState({});
  const [foreignSellers, setForeignSellers] = useState({});
  const [departments, setDepartments] = useState({});
  const [customers, setCustomers] = useState({});
  // Tăng lên sau mỗi lần Xóa/Sửa/Giao sale hợp đồng (kể cả từ ContractViewer, không chỉ từ trong danh
  // sách) — ContractListPage tự theo dõi số này để tải lại đúng trang đang xem, không cần F5.
  const [contractsVersion, setContractsVersion] = useState(0);
  // Số đếm theo loại (Sidebar + Dashboard) + 8 hợp đồng gần nhất — 1 lần gọi nhẹ (contracts_dashboard_stats),
  // KHÔNG phụ thuộc vào state contracts đầy đủ ở trên nữa.
  const [dashboardStats, setDashboardStats] = useState(null);
  const [viewContract, setViewContract] = useState(null);
  const [editContractData, setEditContractData] = useState(null);
  const [paymentRequestCustomerId, setPaymentRequestCustomerId] = useState('');
  const [paymentRequestReqNo, setPaymentRequestReqNo] = useState(null);
  const [paymentRequestBatchIds, setPaymentRequestBatchIds] = useState(null);
  const [dataReady, setDataReady] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [profile, setProfile] = useState(null);
  const [saleMap, setSaleMap] = useState({}); // { [uuid|ma_sale]: { name, deptName } } — dùng để hiện tên sale + phòng ban ở danh sách HĐ
  const [saleProfiles, setSaleProfiles] = useState([]); // [{ uuid, name, ma_sale, deptName }] — dùng cho dropdown giao sale
  const [cashFlowBatches, setCashFlowBatches] = useState([]);
  const [cashFlowLoaded, setCashFlowLoaded] = useState(false);
  const [fxContractBatches, setFxContractBatches] = useState([]);
  const [fxContractLoaded, setFxContractLoaded] = useState(false);
  const [fxPaymentRequestCustomerId, setFxPaymentRequestCustomerId] = useState('');
  const [fxPaymentRequestReqNo, setFxPaymentRequestReqNo] = useState(null);
  const [fxPaymentRequestBatchIds, setFxPaymentRequestBatchIds] = useState(null);
  const [cnyFundTransactions, setCnyFundTransactions] = useState([]);
  const [cnyFundLoaded, setCnyFundLoaded] = useState(false);
  const [salesContracts, setSalesContracts] = useState([]);
  const [salesContractsLoaded, setSalesContractsLoaded] = useState(false);

  // Supabase auth
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      // Khi người dùng bấm link "đặt lại mật khẩu" trong email, Supabase tạo 1 session tạm và bắn
      // event này — bắt lại để hiện trang đặt mật khẩu mới thay vì cho vào thẳng app.
      if (event === 'PASSWORD_RECOVERY') setIsPasswordRecovery(true);
    });
    return () => subscription.unsubscribe();
  }, []);

  // Load data once logged in
  useEffect(() => {
    if (!session) return;
    setLoadError(null);
    (async () => {
      try {
      const [sl, dp, fsl, custRows, prof] = await Promise.all([
        api.get('sellers'),
        api.get('departments'),
        api.get('foreign_sellers'),
        api.listCustomers(),
        api.getMyProfile(),
      ]);
      if (dp) setDepartments(dp);
      setForeignSellers(fsl || {});
      let sellersData = sl || {};
      // Migrate old single-seller format
      if (!sl) {
        const legacy = await api.get('seller_info');
        if (legacy?.companyName) {
          sellersData = { SELLER001: { sellerId: 'SELLER001', ...legacy } };
          await api.set('sellers', sellersData);
        }
      }
      setSellers(sellersData);
      setProfile(prof);

      const customersMap = {};
      const branchMigrations = []; // các khách hàng có nhánh cũ chưa có "id" — cần lưu lại 1 lần để đồng bộ
      custRows.forEach(r => {
        const data = { ...r.data };
        if (Array.isArray(data.branches) && data.branches.some(b => !b.id)) {
          data.branches = data.branches.map(b => ({ ...b, id: b.id || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `b_${Date.now()}_${Math.random().toString(36).slice(2)}`) }));
          branchMigrations.push({ id: r.customer_id, dbId: r.id, maSale: r.ma_sale, data });
        }
        customersMap[r.customer_id] = { ...data, _dbId: r.id, _maSale: r.ma_sale, _createdBy: r.created_by };
      });
      setCustomers(customersMap);

      // Vá xong "id" cho các nhánh cũ (chỉ trong bộ nhớ) thì phải lưu lại ngay xuống Supabase —
      // nếu không, các màn khác (Theo dõi dòng tiền, Đề Nghị Thanh Toán) tải lại dữ liệu gốc sẽ vẫn thiếu "id",
      // dẫn đến nhận diện nhầm nhánh (nhất là khi nhiều nhánh cùng để trống Mã số thuế).
      if (branchMigrations.length > 0) {
        (async () => {
          for (const m of branchMigrations) {
            try { await api.upsertCustomer({ _dbId: m.dbId, customerId: m.id, data: m.data, maSale: m.maSale }); }
            catch (e) { console.error('Không tự vá được id nhánh cho khách hàng', m.id, e.message); }
          }
        })();
      }

      // Build saleMap + saleProfiles để hiện tên + phòng ban và dropdown giao sale (admin dùng)
      if (prof?.role === 'admin') {
        try {
          const allProfiles = await api.adminListProfiles();
          const map = {};
          const list = [];
          allProfiles.forEach(p => {
            const info = {
              name: p.full_name || p.email || p.ma_sale || p.id,
              deptName: dp?.[p.department_id]?.name || '',
            };
            map[p.id] = info;           // tra theo uuid (luôn có)
            if (p.ma_sale) map[p.ma_sale] = info; // tra theo mã sale (nếu có)
            list.push({ uuid: p.id, name: info.name, ma_sale: p.ma_sale || '', deptName: info.deptName, phone: p.phone || '' });
          });
          setSaleMap(map);
          setSaleProfiles(list);
        } catch { /* bỏ qua nếu lỗi */ }
      }

      setDataReady(true);
      } catch (e) {
        // Lỗi có thể xảy ra nếu database chậm/timeout (đã gặp thật lúc kiểm thử: "canceling statement
        // due to statement timeout") — trước đây không bắt lỗi này, màn hình sẽ đứng yên ở "Đang tải dữ
        // liệu..." mãi mãi vì dataReady không bao giờ được set true. Nay báo lỗi rõ + cho thử lại.
        console.error('Không tải được dữ liệu ban đầu:', e.message);
        setLoadError(e.message || 'Có lỗi không xác định.');
      }
    })();
  }, [session]);

  // Số đếm Sidebar/Dashboard + 8 hợp đồng gần nhất — tải lại mỗi khi có thay đổi hợp đồng (contractsVersion)
  useEffect(() => {
    if (!session) return;
    api.contractsDashboardStats()
      .then(setDashboardStats)
      .catch(e => console.error('Không tải được số đếm hợp đồng:', e.message));
  }, [session, contractsVersion]);

  const handleLogout = () => supabase.auth.signOut();

  // Chỉ tải "Theo dõi dòng tiền" khi thực sự cần (vào trang đó) — dữ liệu này riêng biệt,
  // không cần tải ngay lúc mở app.
  const CASH_FLOW_PAGES = ['cash_flow', 'payment_request', 'cny_fund', 'daily_payment_requests'];
  useEffect(() => {
    if (!session || cashFlowLoaded || !CASH_FLOW_PAGES.includes(page)) return;
    (async () => {
      try {
        const rows = await api.listCashFlowBatches();
        setCashFlowBatches(rows || []);
        setCashFlowLoaded(true);
      } catch (e) {
        console.error('Không tải được dữ liệu dòng tiền:', e.message);
      }
    })();
  }, [session, page, cashFlowLoaded]);

  // Hợp đồng ngoại thương — dữ liệu HOÀN TOÀN riêng, không liên quan gì tới Theo dõi dòng tiền/Tổng hợp công nợ
  const FX_CONTRACT_PAGES = ['fx_contract', 'fx_contract_payment_request', 'fx_daily_payment_requests'];
  useEffect(() => {
    if (!session || fxContractLoaded || !FX_CONTRACT_PAGES.includes(page)) return;
    (async () => {
      try {
        const rows = await api.listFxContractBatches();
        setFxContractBatches(rows || []);
        setFxContractLoaded(true);
      } catch (e) {
        console.error('Không tải được dữ liệu hợp đồng ngoại thương:', e.message);
      }
    })();
  }, [session, page, fxContractLoaded]);

  // Sales Contract — dữ liệu HOÀN TOÀN riêng, không liên quan gì tới các phân hệ khác
  useEffect(() => {
    if (!session || salesContractsLoaded || page !== 'sales_contract') return;
    (async () => {
      try {
        const rows = await api.listSalesContracts();
        setSalesContracts(rows || []);
        setSalesContractsLoaded(true);
      } catch (e) {
        console.error('Không tải được dữ liệu Sales Contract:', e.message);
      }
    })();
  }, [session, page, salesContractsLoaded]);

  // Chỉ tải Sổ quỹ ngoại tệ khi vào đúng trang đó
  useEffect(() => {
    if (!session || cnyFundLoaded || page !== 'cny_fund') return;
    (async () => {
      try {
        const rows = await api.listCnyFundTransactions();
        setCnyFundTransactions(rows || []);
        setCnyFundLoaded(true);
      } catch (e) {
        console.error('Không tải được dữ liệu quỹ ngoại tệ:', e.message);
      }
    })();
  }, [session, page, cnyFundLoaded]);

  const saveCashFlowBatch = async (id, fields) => {
    const row = await api.upsertCashFlowBatch(id, fields);
    setCashFlowBatches(prev => {
      const exists = prev.some(r => r.id === row.id);
      return exists ? prev.map(r => (r.id === row.id ? row : r)) : [row, ...prev];
    });
    return row;
  };

  const deleteCashFlowBatchRow = async (id, opts = {}) => {
    if (!opts.skipConfirm && !confirm('Xóa lô hàng này khỏi bảng theo dõi dòng tiền? Thao tác không thể hoàn tác.')) return;
    await api.deleteCashFlowBatch(id);
    setCashFlowBatches(prev => prev.filter(r => r.id !== id));
  };

  const saveFxContractBatch = async (id, fields) => {
    const row = await api.upsertFxContractBatch(id, fields);
    setFxContractBatches(prev => {
      const exists = prev.some(r => r.id === row.id);
      return exists ? prev.map(r => (r.id === row.id ? row : r)) : [row, ...prev];
    });
    return row;
  };

  const deleteFxContractBatchRow = async (id, opts = {}) => {
    if (!opts.skipConfirm && !confirm('Xóa lô hàng này khỏi Hợp đồng ngoại thương? Thao tác không thể hoàn tác.')) return;
    await api.deleteFxContractBatch(id);
    setFxContractBatches(prev => prev.filter(r => r.id !== id));
  };

  const saveCnyFundTransaction = async (id, fields) => {
    const row = await api.upsertCnyFundTransaction(id, fields);
    setCnyFundTransactions(prev => {
      const exists = prev.some(r => r.id === row.id);
      return exists ? prev.map(r => (r.id === row.id ? row : r)) : [row, ...prev];
    });
    return row;
  };

  const deleteCnyFundTransactionRow = async (id) => {
    if (!confirm('Xóa giao dịch này khỏi sổ quỹ ngoại tệ? Thao tác không thể hoàn tác.')) return;
    await api.deleteCnyFundTransaction(id);
    setCnyFundTransactions(prev => prev.filter(r => r.id !== id));
  };

  const saveSalesContract = async (id, fields) => {
    const row = await api.upsertSalesContract(id, fields);
    setSalesContracts(prev => {
      const exists = prev.some(r => r.id === row.id);
      return exists ? prev.map(r => (r.id === row.id ? row : r)) : [row, ...prev];
    });
    return row;
  };

  const deleteSalesContractRow = async (id) => {
    await api.deleteSalesContract(id);
    setSalesContracts(prev => prev.filter(r => r.id !== id));
  };

  // --- Invoice Goods (hàng hóa theo số hóa đơn, nhập từ Excel để chọn nhanh khi tạo ĐĐH/BBBG) ---
  // Không còn giữ mảng đầy đủ trong state App nữa (đã lên hàng chục nghìn dòng) — InvoiceGoodsPage
  // tự quản lý dữ liệu của nó qua RPC phân trang, InvoiceGoodsPicker tự tìm kiếm qua RPC riêng.
  const bulkImportInvoiceGoods = async (invoices, onProgress) => {
    let success = 0, failed = 0;
    const errors = [];
    const BATCH_SIZE = 300; // chia nhỏ để tránh timeout/quá tải khi file lớn (hàng nghìn hóa đơn)

    for (let i = 0; i < invoices.length; i += BATCH_SIZE) {
      const chunk = invoices.slice(i, i + BATCH_SIZE);
      const rows = chunk.map(inv => ({
        invoice_no: inv.invoiceNo,
        group_key: inv.groupKey,
        invoice_date: inv.invoiceDate || null,
        customer_code: inv.customerCode || null,
        customer_name: inv.customerName || null,
        seller_name: inv.sellerName || null,
        seller_tax_code: inv.sellerTaxCode || null,
        ...(inv.note ? { note: inv.note } : {}),
        goods: inv.goods,
        total: inv.total || 0,
      }));
      try {
        const saved = await api.upsertInvoiceGoodsBatch(rows);
        success += saved.length;
      } catch (e) {
        failed += chunk.length;
        errors.push(`Đợt ${Math.floor(i / BATCH_SIZE) + 1}: ${e.message}`);
      }
      onProgress?.(Math.min(i + BATCH_SIZE, invoices.length), invoices.length);
    }

    return { success, failed, errors };
  };

  const deleteInvoiceGoodsRow = async (id) => {
    if (!confirm('Xóa hóa đơn này khỏi danh sách hàng hóa?')) return false;
    await api.deleteInvoiceGoods(id);
    return true;
  };

  const bulkDeleteInvoiceGoods = async (ids) => {
    if (!confirm(`Xóa ${ids.length} hóa đơn đã chọn khỏi danh sách hàng hóa? Thao tác không thể hoàn tác.`)) return false;
    await api.deleteInvoiceGoodsMany(ids);
    return true;
  };

  // --- Sellers ---
  const saveSeller = async (id, data) => {
    const updated = { ...sellers, [id]: data };
    setSellers(updated); await api.set('sellers', updated);
  };
  const deleteSeller = async (id) => {
    if (!confirm(`Xóa công ty bên bán ${id}? Thao tác không thể hoàn tác.`)) return;
    const updated = { ...sellers }; delete updated[id];
    setSellers(updated); await api.set('sellers', updated);
  };

  // --- Bên bán nước ngoài (nhà máy Trung Quốc...) — dữ liệu RIÊNG, chỉ dùng cho Sales Contract ---
  const saveForeignSeller = async (id, data) => {
    const updated = { ...foreignSellers, [id]: data };
    setForeignSellers(updated); await api.set('foreign_sellers', updated);
  };
  const deleteForeignSeller = async (id) => {
    const updated = { ...foreignSellers }; delete updated[id];
    setForeignSellers(updated); await api.set('foreign_sellers', updated);
  };

  // --- Departments ---
  const saveDepartment = async (id, data) => {
    const updated = { ...departments, [id]: data };
    setDepartments(updated); await api.set('departments', updated);
  };
  const deleteDepartment = async (id) => {
    if (!confirm(`Xóa phòng ban ${departments[id]?.name || id}?`)) return;
    const updated = { ...departments }; delete updated[id];
    setDepartments(updated); await api.set('departments', updated);
  };

  // --- Customers ---
  const saveCustomer = async (id, data) => {
    const { _dbId, _maSale, _createdBy, ...cleanData } = data;
    // Ưu tiên mã Sale được gán trong form (ô "Mã Sale"); nếu để trống thì mặc định là người đang thao tác
    const maSale = cleanData.assignedSale?.code?.trim() || profile?.ma_sale;
    const row = await api.upsertCustomer({
      _dbId,
      customerId: id,
      data: cleanData,
      maSale,
    });
    const updated = { ...customers, [id]: { ...cleanData, _dbId: row.id, _maSale: row.ma_sale, _createdBy: row.created_by } };
    setCustomers(updated);
  };
  const deleteCustomer = async (id) => {
    if (!confirm(`Xóa khách hàng ${id}? Thao tác không thể hoàn tác.`)) return;
    const target = customers[id];
    if (target?._dbId) await api.deleteCustomerRow(target._dbId);
    const updated = { ...customers }; delete updated[id];
    setCustomers(updated);
  };

  // Nhập hàng loạt khách hàng từ file Excel
  const bulkImportCustomers = async (rows) => {
    let success = 0, failed = 0;
    const errors = [];
    const updated = { ...customers };
    for (const { customerId, data } of rows) {
      try {
        const existing = updated[customerId];
        const maSale = data.assignedSale?.code?.trim() || profile?.ma_sale;
        const row = await api.upsertCustomer({
          _dbId: existing?._dbId,
          customerId,
          data,
          maSale,
        });
        updated[customerId] = { ...data, _dbId: row.id, _maSale: row.ma_sale, _createdBy: row.created_by };
        success++;
      } catch (e) {
        failed++;
        errors.push(`${customerId}: ${e.message}`);
      }
    }
    setCustomers(updated);
    return { success, failed, errors };
  };

  // --- Contracts ---
  const saveContract = async (contract, oldId = null, assignedSaleUuid = null) => {
    const { _dbId, _maSale, _createdBy, ...cleanContract } = contract;
    // Admin gán cho sale cụ thể → dùng UUID đó; không thì dùng mã sale của người đang đăng nhập
    const maSale = assignedSaleUuid || profile?.ma_sale;
    await api.upsertContract({
      _dbId,
      category: CATEGORY_MAP[contract.type] || 'mua_ban',
      docType: DOC_TYPE_MAP[contract.type],
      contract: cleanContract,
      maSale,
    });
    // Mã hợp đồng bị đổi (VD: sửa lại số HĐNT) → tự cập nhật các hợp đồng con đang tham chiếu
    // tới mã CŨ (ĐĐH/BBBG có relatedContracts.hdnt/ddh/...) sang mã MỚI, tránh lệch thông tin.
    const refKey = REFERENCED_AS[contract.type];
    if (oldId && oldId !== contract.contractId && refKey) {
      const children = await api.findContractsReferencing(refKey, oldId);
      for (const childRow of children) {
        const newChildData = { ...childRow.data, relatedContracts: { ...childRow.data.relatedContracts, [refKey]: contract.contractId } };
        await api.upsertContract({
          _dbId: childRow.id,
          category: childRow.category,
          docType: childRow.doc_type,
          contract: newChildData,
          maSale: profile?.ma_sale,
        });
      }
    }

    setContractsVersion(v => v + 1); // báo cho ContractListPage đang mở (nếu có) tự tải lại
  };
  // contract: object đầy đủ (có _dbId) — lấy từ dòng trong ContractListPage/ContractViewer, không tra cứu qua map riêng nữa.
  const deleteContract = async (contract) => {
    if (!confirm(`Bạn có chắc muốn xóa hợp đồng ${contract.contractId}? Hành động này không thể hoàn tác.`)) return;
    if (contract._dbId) await api.deleteContractRow(contract._dbId);
    setViewContract(null);
    setContractsVersion(v => v + 1);
  };
  const deleteContracts = async (selectedContracts) => {
    if (!selectedContracts || selectedContracts.length === 0) return false;
    if (!confirm(`Bạn có chắc muốn xóa ${selectedContracts.length} hợp đồng đã chọn? Hành động này không thể hoàn tác.`)) return false;
    let successCount = 0;
    try {
      for (const c of selectedContracts) {
        if (c._dbId) await api.deleteContractRow(c._dbId);
        successCount++;
      }
    } catch (err) {
      alert(`Đã xóa được ${successCount}/${selectedContracts.length} hợp đồng, sau đó gặp lỗi: ${err.message}`);
    } finally {
      setViewContract(null);
      setContractsVersion(v => v + 1);
    }
    return true;
  };
  // Load đủ dữ liệu (kể cả goods) trước khi vào form Sửa — danh sách chỉ giữ bản nhẹ (không có goods)
  // từ sau khi list_contracts_slim bỏ goods ra khỏi payload để giảm dung lượng lúc đăng nhập.
  const handleEditContract = async (contract) => {
    let full = contract;
    if (contract._dbId) {
      try {
        const res = await api.getContractFull(contract._dbId);
        full = { ...res.data, _dbId: res.id, _maSale: res.ma_sale, _createdBy: res.created_by };
      } catch { /* dùng tạm bản nhẹ nếu lỗi */ }
    }
    setEditContractData(full);
    setViewContract(null);
    setPage('edit-' + contract.type.toLowerCase());
  };

  // Load full contract (kể cả vatInvoiceImage) khi bấm Xem — danh sách chỉ load bản nhẹ
  const handleViewContract = async (contract) => {
    if (contract._dbId) {
      try {
        const full = await api.getContractFull(contract._dbId);
        setViewContract({ ...full.data, _dbId: full.id, _maSale: full.ma_sale, _createdBy: full.created_by });
      } catch {
        setViewContract(contract); // fallback nếu lỗi
      }
    } else {
      setViewContract(contract);
    }
  };

  // Sửa nhanh 1 field nhẹ (VD: điều khoản thanh toán) ngay ở màn Xem, không cần mở form Sửa đầy đủ.
  const updateContractPaymentTerms = async (contract, paymentTerms) => {
    if (!contract._dbId) return;
    await api.patchContractData(contract._dbId, { paymentTerms });
    setViewContract(v => (v && v._dbId === contract._dbId) ? { ...v, paymentTerms } : v);
    setContractsVersion(v => v + 1);
  };

  // Admin giao hợp đồng cho sale khác — chỉ cập nhật ma_sale, giữ nguyên người tạo.
  // contract: object đầy đủ (có _dbId), lấy từ dòng trong ContractListPage/ContractViewer.
  const assignContract = async (contract, newMaSale) => {
    if (!contract?._dbId) return;
    await api.assignContractSale(contract._dbId, newMaSale);
    // Cập nhật viewContract nếu đang xem hợp đồng này
    if (viewContract?.contractId === contract.contractId) {
      setViewContract({ ...viewContract, _maSale: newMaSale });
    }
    setContractsVersion(v => v + 1);
  };

  // --- Loading / Auth states ---
  if (session === undefined) {
    return (
      <div className="flex items-center justify-center min-h-screen text-gray-400">
        <div className="text-center"><div className="text-4xl mb-3">📋</div><div>Đang tải...</div></div>
      </div>
    );
  }

  if (!session) return <ErrorBoundary><Suspense fallback={<PageLoadingFallback />}><LoginPage /></Suspense></ErrorBoundary>;

  // Dù đã có session (do Supabase tạo tạm khi bấm link email), vẫn phải đặt mật khẩu mới xong
  // mới cho vào app — tránh trường hợp ai nhặt được link email cũ cũng vào thẳng được tài khoản.
  if (isPasswordRecovery) return (
    <ErrorBoundary>
      <Suspense fallback={<PageLoadingFallback />}>
        <ResetPasswordPage onDone={() => setIsPasswordRecovery(false)} />
      </Suspense>
    </ErrorBoundary>
  );

  if (loadError) {
    return (
      <div className="flex items-center justify-center min-h-screen text-gray-400">
        <ErrorCard
          title="Không tải được dữ liệu"
          message={loadError}
          onReload={() => window.location.reload()}
        />
      </div>
    );
  }

  if (!dataReady) {
    return (
      <div className="flex items-center justify-center min-h-screen text-gray-400">
        <div className="text-center"><div className="text-4xl mb-3">📋</div><div>Đang tải dữ liệu...</div></div>
      </div>
    );
  }

  // Sale chưa chọn phòng ban → yêu cầu chọn trước khi vào app
  // Chưa điền đủ thông tin (tên + phòng ban + mã sale) → yêu cầu tự điền trước khi vào app
  const isAdmin = profile?.role === 'admin';
  const isHR = profile?.role === 'hr';
  const canManageUsers = isAdmin || isHR;
  const needsMaSale = !isAdmin && !isHR;
  if (profile && !isAdmin && (!profile.full_name || !profile.department_id || (needsMaSale && !profile.ma_sale))) {
    return <ErrorBoundary><Suspense fallback={<PageLoadingFallback />}>
      <CompleteProfilePage profile={profile} departments={departments} needsMaSale={needsMaSale}
        onDone={(updated) => setProfile(updated)} />
    </Suspense></ErrorBoundary>;
  }

  const counts = dashboardStats
    ? { HDNT: dashboardStats.hdnt, DDH: dashboardStats.ddh, BBBG: dashboardStats.bbbg,
        HDNT_VC: dashboardStats.hdnt_vc, DDH_VC: dashboardStats.ddh_vc, BBBG_VC: dashboardStats.bbbg_vc,
        HDNT_UT: dashboardStats.hdnt_ut, DDH_UT: dashboardStats.ddh_ut, BBBG_UT: dashboardStats.bbbg_ut }
    : { HDNT: 0, DDH: 0, BBBG: 0, HDNT_VC: 0, DDH_VC: 0, BBBG_VC: 0, HDNT_UT: 0, DDH_UT: 0, BBBG_UT: 0 };
  const noSellers = Object.keys(sellers).length === 0;

  const renderPage = () => {
    switch (page) {
      case 'dashboard': return <Dashboard customers={customers} stats={dashboardStats} setPage={setPage} />;
      case 'settings':  return isAdmin ? (
        <div className="space-y-6">
          <SellersPage sellers={sellers} onSave={saveSeller} onDelete={deleteSeller} />
          <ApiKeyManager />
          <DepartmentsManager departments={departments} onSave={saveDepartment} onDelete={deleteDepartment} />
        </div>
      ) : <Dashboard customers={customers} stats={dashboardStats} setPage={setPage} />;
      case 'customers':    return <CustomersPage customers={customers} departments={departments} onSave={saveCustomer} onDelete={deleteCustomer} onBulkImport={bulkImportCustomers} saleProfiles={saleProfiles} isAdmin={isAdmin} profile={profile} />;
      case 'invoice_goods': return <InvoiceGoodsPage onBulkImport={bulkImportInvoiceGoods} onDelete={deleteInvoiceGoodsRow} onDeleteMany={bulkDeleteInvoiceGoods} isAdmin={isAdmin} isHR={isHR} customers={customers} sellers={sellers} saleProfiles={saleProfiles} />;
      case 'cash_flow': return <CashFlowSummary batches={cashFlowBatches} customers={customers} sellers={sellers} isAdmin={isAdmin} saleProfiles={saleProfiles} onSave={saveCashFlowBatch} onDelete={deleteCashFlowBatchRow}
          onOpenPaymentRequest={(customerId, reqNo, batchIds) => { setPaymentRequestCustomerId(customerId); setPaymentRequestReqNo(reqNo ?? null); setPaymentRequestBatchIds(batchIds || null); setPage('payment_request'); }} />;
      case 'payment_request': return <PaymentRequestPrint
          customerId={paymentRequestCustomerId} customer={customers[paymentRequestCustomerId]}
          requestNo={paymentRequestReqNo} batchIds={paymentRequestBatchIds} docLabel="Thanh Toán Hộ"
          batches={cashFlowBatches} customers={customers} sellers={sellers}
          myName={profile?.full_name || ''} myPhone={profile?.phone || ''}
          onSave={saveCashFlowBatch} onDelete={deleteCashFlowBatchRow} onSelectCustomer={setPaymentRequestCustomerId}
          onClose={() => setPage('cash_flow')} />;
      // Hợp đồng ngoại thương — HOÀN TOÀN độc lập với "Tổng hợp công nợ" / "Theo dõi dòng tiền" (Thanh toán hộ) ở trên,
      // dùng lại y hệt 2 màn CashFlowSummary + PaymentRequestPrint nhưng trỏ vào bảng dữ liệu riêng (fxContractBatches).
      case 'fx_contract': return <FxContractSummary batches={fxContractBatches} customers={customers} sellers={sellers} isAdmin={isAdmin} onSave={saveFxContractBatch} onDelete={deleteFxContractBatchRow}
          onOpenPaymentRequest={(customerId, reqNo, batchIds) => { setFxPaymentRequestCustomerId(customerId); setFxPaymentRequestReqNo(reqNo ?? null); setFxPaymentRequestBatchIds(batchIds || null); setPage('fx_contract_payment_request'); }} />;
      case 'fx_contract_payment_request': return <PaymentRequestPrint
          customerId={fxPaymentRequestCustomerId} customer={customers[fxPaymentRequestCustomerId]}
          requestNo={fxPaymentRequestReqNo} batchIds={fxPaymentRequestBatchIds} docLabel="Hợp Đồng Ngoại Thương"
          batches={fxContractBatches} customers={customers} sellers={sellers}
          myName={profile?.full_name || ''} myPhone={profile?.phone || ''}
          onSave={saveFxContractBatch} onDelete={deleteFxContractBatchRow} onSelectCustomer={setFxPaymentRequestCustomerId}
          onClose={() => setPage('fx_contract')} />;
      case 'fx_daily_payment_requests': return <CashFlowPage
          isFxContract
          batches={fxContractBatches} customers={customers} sellers={sellers} isAdmin={isAdmin} saleProfiles={saleProfiles}
          onSave={saveFxContractBatch} onDelete={deleteFxContractBatchRow}
          initialCustomerFilter="" onBack={() => setPage('fx_contract')}
          onOpenPaymentRequest={(customerId, reqNo, batchIds) => { setFxPaymentRequestCustomerId(customerId); setFxPaymentRequestReqNo(reqNo ?? null); setFxPaymentRequestBatchIds(batchIds || null); setPage('fx_contract_payment_request'); }} />;
      case 'cny_fund': return <CnyFundPage
          transactions={cnyFundTransactions} batches={cashFlowBatches} customers={customers} sellers={sellers}
          onSave={saveCnyFundTransaction} onDelete={deleteCnyFundTransactionRow} />;
      case 'daily_payment_requests': return <CashFlowPage
          batches={cashFlowBatches} customers={customers} sellers={sellers} isAdmin={isAdmin} saleProfiles={saleProfiles}
          onSave={saveCashFlowBatch} onDelete={deleteCashFlowBatchRow}
          initialCustomerFilter="" onBack={() => setPage('cash_flow')}
          onOpenPaymentRequest={(customerId, reqNo, batchIds) => { setPaymentRequestCustomerId(customerId); setPaymentRequestReqNo(reqNo ?? null); setPaymentRequestBatchIds(batchIds || null); setPage('payment_request'); }} />;
      case 'hdnt':         return <ContractListPage type="HDNT" refreshVersion={contractsVersion} customers={customers} sellers={sellers} saleMap={saleMap} saleProfiles={saleProfiles} onAssign={assignContract} setPage={setPage} setViewContract={handleViewContract} onDelete={deleteContract} onDeleteMany={deleteContracts} onEdit={handleEditContract} />;
      case 'ddh':          return <ContractListPage type="DDH"  refreshVersion={contractsVersion} customers={customers} sellers={sellers} saleMap={saleMap} saleProfiles={saleProfiles} onAssign={assignContract} setPage={setPage} setViewContract={handleViewContract} onDelete={deleteContract} onDeleteMany={deleteContracts} onEdit={handleEditContract} />;
      case 'bbbg':         return <ContractListPage type="BBBG" refreshVersion={contractsVersion} customers={customers} sellers={sellers} saleMap={saleMap} saleProfiles={saleProfiles} onAssign={assignContract} setPage={setPage} setViewContract={handleViewContract} onDelete={deleteContract} onDeleteMany={deleteContracts} onEdit={handleEditContract} />;
      case 'hdnt_vc':      return <ContractListPage type="HDNT_VC" refreshVersion={contractsVersion} customers={customers} sellers={sellers} saleMap={saleMap} saleProfiles={saleProfiles} onAssign={assignContract} setPage={setPage} setViewContract={handleViewContract} onDelete={deleteContract} onDeleteMany={deleteContracts} onEdit={handleEditContract} />;
      case 'ddh_vc':       return <ContractListPage type="DDH_VC"  refreshVersion={contractsVersion} customers={customers} sellers={sellers} saleMap={saleMap} saleProfiles={saleProfiles} onAssign={assignContract} setPage={setPage} setViewContract={handleViewContract} onDelete={deleteContract} onDeleteMany={deleteContracts} onEdit={handleEditContract} />;
      case 'bbbg_vc':      return <ContractListPage type="BBBG_VC" refreshVersion={contractsVersion} customers={customers} sellers={sellers} saleMap={saleMap} saleProfiles={saleProfiles} onAssign={assignContract} setPage={setPage} setViewContract={handleViewContract} onDelete={deleteContract} onDeleteMany={deleteContracts} onEdit={handleEditContract} />;
      case 'hdnt_ut':      return <ContractListPage type="HDNT_UT" refreshVersion={contractsVersion} customers={customers} sellers={sellers} saleMap={saleMap} saleProfiles={saleProfiles} onAssign={assignContract} setPage={setPage} setViewContract={handleViewContract} onDelete={deleteContract} onDeleteMany={deleteContracts} onEdit={handleEditContract} />;
      case 'ddh_ut':       return <ContractListPage type="DDH_UT"  refreshVersion={contractsVersion} customers={customers} sellers={sellers} saleMap={saleMap} saleProfiles={saleProfiles} onAssign={assignContract} setPage={setPage} setViewContract={handleViewContract} onDelete={deleteContract} onDeleteMany={deleteContracts} onEdit={handleEditContract} />;
      case 'bbbg_ut':      return <ContractListPage type="BBBG_UT" refreshVersion={contractsVersion} customers={customers} sellers={sellers} saleMap={saleMap} saleProfiles={saleProfiles} onAssign={assignContract} setPage={setPage} setViewContract={handleViewContract} onDelete={deleteContract} onDeleteMany={deleteContracts} onEdit={handleEditContract} />;
      case 'foreign_sellers': return <ForeignSellersPage foreignSellers={foreignSellers} onSave={saveForeignSeller} onDelete={deleteForeignSeller} />;
      case 'sales_contract': return <SalesContractPage salesContracts={salesContracts} customers={customers} foreignSellers={foreignSellers} onSaveForeignSeller={saveForeignSeller} onSave={saveSalesContract} onDelete={deleteSalesContractRow} isAdmin={isAdmin} />;
      case 'create-hdnt':  return <CreateHDNT sellers={sellers} customers={customers} onSave={saveContract} setPage={setPage} isAdmin={isAdmin} profile={profile} saleProfiles={saleProfiles} />;
      case 'create-ddh':   return <CreateDDH  sellers={sellers} customers={customers} onSave={saveContract} setPage={setPage} isAdmin={isAdmin} profile={profile} saleProfiles={saleProfiles} onCreateCustomer={saveCustomer} onUpdateSeller={saveSeller} />;
      case 'create-bbbg':  return <CreateBBBG sellers={sellers} customers={customers} onSave={saveContract} setPage={setPage} isAdmin={isAdmin} profile={profile} saleProfiles={saleProfiles} onCreateCustomer={saveCustomer} onUpdateSeller={saveSeller} />;
      case 'create-hdnt_vc': return <CreateHDNTVC sellers={sellers} customers={customers} onSave={saveContract} setPage={setPage} isAdmin={isAdmin} saleProfiles={saleProfiles} />;
      case 'create-ddh_vc':  return <CreateDDHVC  sellers={sellers} customers={customers} onSave={saveContract} setPage={setPage} isAdmin={isAdmin} saleProfiles={saleProfiles} />;
      case 'create-bbbg_vc': return <CreateBBBGVC sellers={sellers} customers={customers} onSave={saveContract} setPage={setPage} isAdmin={isAdmin} saleProfiles={saleProfiles} />;
      case 'create-hdnt_ut': return <CreateHDNTUT sellers={sellers} customers={customers} onSave={saveContract} setPage={setPage} isAdmin={isAdmin} saleProfiles={saleProfiles} />;
      case 'create-ddh_ut':  return <CreateDDHUT  sellers={sellers} customers={customers} onSave={saveContract} setPage={setPage} isAdmin={isAdmin} saleProfiles={saleProfiles} />;
      case 'create-bbbg_ut': return <CreateBBBGUT sellers={sellers} customers={customers} onSave={saveContract} setPage={setPage} isAdmin={isAdmin} saleProfiles={saleProfiles} />;
      case 'edit-hdnt':    return <CreateHDNT sellers={sellers} customers={customers} onSave={saveContract} setPage={setPage} isAdmin={isAdmin} profile={profile} saleProfiles={saleProfiles} editData={editContractData} />;
      case 'edit-ddh':     return <CreateDDH  sellers={sellers} customers={customers} onSave={saveContract} setPage={setPage} isAdmin={isAdmin} profile={profile} saleProfiles={saleProfiles} onCreateCustomer={saveCustomer} onUpdateSeller={saveSeller} editData={editContractData} />;
      case 'edit-bbbg':    return <CreateBBBG sellers={sellers} customers={customers} onSave={saveContract} setPage={setPage} isAdmin={isAdmin} profile={profile} saleProfiles={saleProfiles} onCreateCustomer={saveCustomer} onUpdateSeller={saveSeller} editData={editContractData} />;
      case 'edit-hdnt_vc': return <CreateHDNTVC sellers={sellers} customers={customers} onSave={saveContract} setPage={setPage} isAdmin={isAdmin} saleProfiles={saleProfiles} editData={editContractData} />;
      case 'edit-ddh_vc':  return <CreateDDHVC  sellers={sellers} customers={customers} onSave={saveContract} setPage={setPage} isAdmin={isAdmin} saleProfiles={saleProfiles} editData={editContractData} />;
      case 'edit-bbbg_vc': return <CreateBBBGVC sellers={sellers} customers={customers} onSave={saveContract} setPage={setPage} isAdmin={isAdmin} saleProfiles={saleProfiles} editData={editContractData} />;
      case 'edit-hdnt_ut': return <CreateHDNTUT sellers={sellers} customers={customers} onSave={saveContract} setPage={setPage} isAdmin={isAdmin} saleProfiles={saleProfiles} editData={editContractData} />;
      case 'edit-ddh_ut':  return <CreateDDHUT  sellers={sellers} customers={customers} onSave={saveContract} setPage={setPage} isAdmin={isAdmin} saleProfiles={saleProfiles} editData={editContractData} />;
      case 'edit-bbbg_ut': return <CreateBBBGUT sellers={sellers} customers={customers} onSave={saveContract} setPage={setPage} isAdmin={isAdmin} saleProfiles={saleProfiles} editData={editContractData} />;
      case 'my-profile': return <CompleteProfilePage profile={profile} departments={departments} needsMaSale={needsMaSale}
          onDone={(updated) => setProfile(updated)} isEdit={true} />;
      case 'admin-users':  return canManageUsers ? <AdminUsersPage departments={departments} isAdmin={isAdmin} /> : <Dashboard customers={customers} stats={dashboardStats} setPage={setPage} />;
      default:             return <Dashboard customers={customers} stats={dashboardStats} setPage={setPage} />;
    }
  };

  const closeContractViewer = () => setViewContract(null);

  return (
    <div className="flex" style={{ minHeight: '100vh' }}>
      <ErrorBoundary
        fallback={() => (
          <aside className="w-64 bg-blue-950 text-blue-200 flex items-center justify-center p-4 text-center text-sm no-print" style={{ minHeight: '100vh' }}>
            ⚠️ Menu bị lỗi.<br />Vui lòng tải lại trang.
          </aside>
        )}
      >
        <Sidebar page={page} setPage={(p) => {
          if (p === 'payment_request') { setPaymentRequestCustomerId(''); setPaymentRequestReqNo(null); setPaymentRequestBatchIds(null); }
          if (p === 'fx_contract_payment_request') { setFxPaymentRequestCustomerId(''); setFxPaymentRequestReqNo(null); setFxPaymentRequestBatchIds(null); }
          setPage(p);
        }} counts={counts} onLogout={handleLogout} isAdmin={isAdmin} canManageUsers={canManageUsers} />
      </ErrorBoundary>
      <main className="flex-1 p-6 overflow-auto bg-gray-50" style={{ minHeight: '100vh' }}>
        {noSellers && page !== 'settings' && (
          <div className="mb-4 bg-amber-50 border border-amber-300 rounded-lg px-4 py-3 text-sm text-amber-800 flex items-center justify-between">
            <span>⚠️ Chưa có công ty bên bán nào. Vui lòng thêm ít nhất 1 công ty trước khi tạo hợp đồng.</span>
            {isAdmin && <button onClick={() => setPage('settings')} className="ml-4 underline font-medium hover:text-amber-900">Thêm ngay →</button>}
          </div>
        )}
        {/* key={page}: đổi trang tự remount ErrorBoundary (React lo state ban đầu), khỏi cần tự viết lại logic reset */}
        <ErrorBoundary key={page}>
          <Suspense fallback={<PageLoadingFallback />}>
            <PageContent renderPage={renderPage} />
          </Suspense>
        </ErrorBoundary>
      </main>
      {viewContract && (
        <ErrorBoundary
          key={viewContract?._dbId}
          fallback={(_error, retry) => (
            <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
              <div className="bg-white rounded-lg shadow-lg py-8">
                <ErrorCard
                  title="Không hiển thị được hợp đồng này"
                  message="Đã có lỗi xảy ra."
                  onRetry={retry}
                  onReload={() => window.location.reload()}
                  extraActions={
                    <button onClick={closeContractViewer} className="bg-gray-100 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-200 text-sm font-medium">Đóng</button>
                  }
                />
              </div>
            </div>
          )}
        >
          <Suspense fallback={<PageLoadingFallback />}>
          <ContractViewer
            contract={viewContract}
            sellers={sellers}
            customers={customers}
            saleMap={saleMap}
            saleProfiles={saleProfiles}
            isAdmin={isAdmin}
            onAssign={assignContract}
            onClose={closeContractViewer}
            onDelete={deleteContract}
            onEdit={handleEditContract}
            onUpdatePaymentTerms={updateContractPaymentTerms}
          />
          </Suspense>
        </ErrorBoundary>
      )}
    </div>
  );
}

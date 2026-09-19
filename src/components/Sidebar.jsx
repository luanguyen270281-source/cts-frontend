// File: src/components/Sidebar.jsx
const CATEGORY_STYLE = {
  mua_ban: 'border-pink-400',
  van_chuyen: 'border-sky-400',
  uy_thac: 'border-amber-400',
  thanh_toan: 'border-emerald-400',
  sales_contract: 'border-rose-400',
};

const NavBtn = ({ item, page, setPage, indent }) => {
  const active = page === item.id || page.startsWith(item.id + '-');
  return (
    <button onClick={() => setPage(item.id)}
      className={`sidebar-btn w-full text-left ${indent ? 'pl-4' : 'px-3'} pr-2 py-2 rounded-lg flex items-center justify-between text-sm ${active ? 'bg-blue-600 shadow-md' : 'hover:bg-blue-700/50'}`}>
      <span className="flex items-center gap-1.5 truncate">
        <span className="text-[13px]">{item.icon}</span>{item.label}
      </span>
      {item.count !== undefined && (
        <span className={`text-[11px] px-1.5 py-0.5 rounded-full font-semibold shrink-0 ${item.count > 0 ? `${item.color} text-white` : 'bg-blue-950/40 text-blue-400'}`}>
          {item.count}
        </span>
      )}
    </button>
  );
};

export const Sidebar = ({ page, setPage, counts, onLogout, isAdmin, canManageUsers }) => {
  const top = [
    { id: 'dashboard', icon: '📊', label: 'Dashboard' },
    ...(isAdmin ? [{ id: 'settings', icon: '⚙️', label: 'Cài đặt' }] : []),
    { id: 'foreign_sellers', icon: '🏭', label: 'Bên bán nước ngoài' },
    { id: 'customers', icon: '👥', label: 'Khách hàng' },
    { id: 'invoice_goods', icon: '📦', label: 'Hàng hóa theo hóa đơn' },
    { id: 'my-profile', icon: '👤', label: 'Hồ sơ của tôi' },
  ];

  const groups = [
    {
      key: 'thanh_toan_ho', header: '💰 Thanh Toán Hộ',
      items: [
        { id: 'payment_request', icon: '🧾', label: 'ĐNTT — Thanh Toán Hộ' },
        { id: 'cash_flow', icon: '📊', label: 'Theo dõi từng khách' },
        ...(isAdmin ? [{ id: 'daily_payment_requests', icon: '📅', label: 'Tổng hợp chung' }] : []),
      ],
    },
    {
      key: 'ngoai_thuong', header: '🏦 Hợp Đồng Ngoại Thương',
      items: [
        { id: 'fx_contract', icon: '🏦', label: 'Theo dõi tiền HĐNT' },
        { id: 'fx_contract_payment_request', icon: '🧾', label: 'Đề nghị TT - HĐNT' },
        ...(isAdmin ? [{ id: 'fx_daily_payment_requests', icon: '📅', label: 'Tổng hợp chung' }] : []),
        { id: 'sales_contract', icon: '📄', label: 'Sales Contract' },
      ],
    },
    {
      key: 'mua_ban', header: '🛍️ Hợp đồng mua bán',
      items: [
        { id: 'hdnt', icon: '📋', label: 'HĐ Nguyên Tắc', count: counts.HDNT, color: 'bg-green-500' },
        { id: 'ddh', icon: '📦', label: 'Đơn Đặt Hàng', count: counts.DDH, color: 'bg-yellow-500' },
        { id: 'bbbg', icon: '✅', label: 'Biên Bản BG', count: counts.BBBG, color: 'bg-purple-500' },
      ],
    },
    {
      key: 'van_chuyen', header: '🚚 Hợp đồng vận chuyển',
      items: [
        { id: 'hdnt_vc', icon: '📋', label: 'HĐ Nguyên Tắc', count: counts.HDNT_VC, color: 'bg-green-500' },
        { id: 'ddh_vc', icon: '📦', label: 'Đơn Đặt Dịch Vụ', count: counts.DDH_VC, color: 'bg-yellow-500' },
        { id: 'bbbg_vc', icon: '✅', label: 'Biên Bản BG', count: counts.BBBG_VC, color: 'bg-purple-500' },
      ],
    },
    {
      key: 'uy_thac', header: '🤝 Hợp đồng ủy thác',
      items: [
        { id: 'hdnt_ut', icon: '📋', label: 'HĐ Nguyên Tắc', count: counts.HDNT_UT, color: 'bg-green-500' },
        { id: 'ddh_ut', icon: '📦', label: 'Đơn Đặt Dịch Vụ', count: counts.DDH_UT, color: 'bg-yellow-500' },
        { id: 'bbbg_ut', icon: '✅', label: 'Biên Bản BG', count: counts.BBBG_UT, color: 'bg-purple-500' },
      ],
    },
  ];

  return (
    <aside className="w-64 bg-gradient-to-b from-blue-900 to-blue-800 text-white flex flex-col no-print" style={{ minHeight: '100vh' }}>
      <div className="p-5 border-b border-blue-700">
        <div className="text-lg font-bold tracking-wide">CTS Contracts</div>
        <div className="text-blue-300 text-xs mt-0.5">CTS Logistics Vietnam</div>
      </div>

      <nav className="flex-1 p-3 overflow-y-auto">
        <div className="space-y-0.5 mb-3">
          {top.map(item => <NavBtn key={item.id} item={item} page={page} setPage={setPage} />)}
        </div>

        <div className="border-t border-blue-700/70 mb-3" />

        {groups.map(g => (
          <div key={g.key} className={`mb-3 rounded-lg bg-white/5 border-l-[3px] ${CATEGORY_STYLE[g.key]} pl-2 pr-1.5 py-2`}>
            <div className="px-1 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-blue-200/90">
              {g.header}
            </div>
            <div className="space-y-0.5">
              {g.items.map(item => <NavBtn key={item.id} item={item} page={page} setPage={setPage} indent />)}
            </div>
          </div>
        ))}

        {canManageUsers && (
          <>
            <div className="border-t border-blue-700/70 mb-3" />
            <NavBtn item={{ id: 'admin-users', icon: '👤', label: 'Quản lý tài khoản' }} page={page} setPage={setPage} />
          </>
        )}
      </nav>

      <div className="p-3 border-t border-blue-700">
        <button onClick={onLogout} className="w-full text-left px-3 py-2 rounded-lg text-sm text-blue-300 hover:bg-blue-700/60 hover:text-white">
          🚪 Đăng xuất
        </button>
        <div className="text-blue-400 text-xs mt-2 px-3">CTS01-Ly • v2.1</div>
      </div>
    </aside>
  );
};

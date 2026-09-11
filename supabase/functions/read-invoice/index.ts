// supabase/functions/read-invoice/index.ts
// Edge Function: đọc hóa đơn VAT / đơn hàng USD bằng AI.
// API Key (ANTHROPIC_API_KEY) chỉ nằm ở đây (server), KHÔNG bao giờ gửi về trình duyệt người dùng.
// Không phụ thuộc thư viện ngoài (jsr:@supabase/supabase-js) — tự gọi thẳng Supabase Auth REST API
// để kiểm tra đăng nhập, giảm điểm có thể lỗi khi khởi động function.
// Deploy: Supabase Dashboard → Edge Functions → function "clever-handler" → tab Code → dán nguyên file này → Deploy updates.
// Cấu hình: Edge Functions → Secrets → ANTHROPIC_API_KEY = <API key thật>.

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// tongCongInHoaDon: tổng cộng/thành tiền sau cùng IN SẴN trên hóa đơn gốc (nếu đọc được) —
// dùng để đối chiếu lại với tổng do AI tự cộng từ các dòng hàng, phát hiện sai sót khi ảnh mờ/nghiêng.
const PROMPTS: Record<string, string> = {
  vat:
    'Đây là hóa đơn VAT. Trích xuất danh sách hàng hóa và trả về JSON đúng định dạng:\n' +
    '{"goods":[{"stt":1,"tenHang":"...","dvt":"...","soLuong":0,"donGia":0,"thanhTien":0,"vatRate":8}],"tongCongInHoaDon":0}\n' +
    'tongCongInHoaDon là số tiền tổng cộng/thanh toán sau cùng được IN SẴN trên hóa đơn (đã gồm thuế, nếu có) — để null nếu không thấy rõ trên hóa đơn. ' +
    'Chỉ trả JSON, không thêm chữ nào khác.',
  goods_usd:
    'Đây là đơn hàng / invoice từ nhà cung cấp nước ngoài, đơn giá tính bằng USD. Trích xuất danh sách hàng hóa và trả về JSON đúng định dạng:\n' +
    '{"goods":[{"stt":1,"tenHang":"...","dvt":"...","soLuong":0,"donGia":0,"thanhTien":0}],"tongCongInHoaDon":0}\n' +
    'donGia và thanhTien là số USD (có thể có phần thập phân). tongCongInHoaDon là tổng cộng USD IN SẴN trên đơn hàng/invoice (nếu có) — để null nếu không thấy rõ. ' +
    'Chỉ trả JSON, không thêm chữ nào khác.',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

// ───────── Dịch text (translate_en / translate_address_en): chuỗi free trước, Claude sau ─────────
// Lý do: 2 mode này tốn AI nhiều nhất (translate_en tự bắn khi blur ô mỗi dòng hàng). Câu mô tả
// "đơn giản" (có mã hàng/model rõ ràng để định danh sản phẩm) thì model free rẻ/miễn phí đã đủ
// chính xác — đã kiểm chứng bằng toàn bộ dữ liệu Sales Contract thật. Câu "phức tạp" (không có mã,
// hoặc nhiều mã cùng lúc dễ bị gộp sai) vẫn đi thẳng Claude như cũ để đảm bảo chất lượng.

async function callGroqModel(model: string, prompt: string, apiKey: string): Promise<string> {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, max_tokens: 300, messages: [{ role: 'user', content: prompt }] }),
  });
  if (!res.ok) throw new Error(`Groq ${model} HTTP ${res.status}`);
  const data = await res.json();
  const text = (data.choices?.[0]?.message?.content ?? '').trim().replace(/^"|"$/g, '');
  if (!text) throw new Error(`Groq ${model} trả về rỗng`);
  return text;
}

async function callGeminiModel(model: string, prompt: string, apiKey: string, withThinkingConfig: boolean): Promise<string> {
  const generationConfig: Record<string, unknown> = { maxOutputTokens: 1024 };
  if (withThinkingConfig) generationConfig.thinkingConfig = { thinkingBudget: 0 };
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig }),
  });
  if (!res.ok) throw new Error(`Gemini ${model} HTTP ${res.status}`);
  const data = await res.json();
  const text = (data.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || '').join('') || '')
    .trim().replace(/^"|"$/g, '');
  if (!text) throw new Error(`Gemini ${model} trả về rỗng`);
  return text;
}

async function callAnthropicText(prompt: string, apiKey: string): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 300, messages: [{ role: 'user', content: prompt }] }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error('Lỗi gọi AI (' + res.status + '): ' + errText.slice(0, 300));
  }
  const data = await res.json();
  return (data.content?.[0]?.text || '').trim().replace(/^"|"$/g, '');
}

// Phân loại độ khó mô tả tiếng Việt — thuần regex, KHÔNG gọi AI (miễn phí, tức thì).
// "Đơn giản" = tìm được đúng 1-2 mã hàng/model/ký hiệu/mã vải rõ ràng để định danh sản phẩm.
// "Phức tạp" = không có mã nào (bắt buộc tự mô tả đúng đặc điểm kỹ thuật), hoặc có từ 3 mã trở lên
// cùng lúc (rủi ro model free gộp nhầm mã, vd biến 8 mã rời rạc thành 1 dải mã liên tục sai).
function classifyComplexity(text: string): 'simple' | 'complex' {
  const markerRe = /(mã\s*hàng|mã\s*vải|mã\s*số|model|ký\s*hiệu|kí\s*hiệu|sku|code|mã)\s*:?\s*/i;
  const m = markerRe.exec(text);
  if (!m) return 'complex';

  let rest = text.slice(m.index + m[0].length);
  // Bỏ ký hiệu dung sai "+/-10%" trước — dấu "/" trong đó dễ bị hiểu nhầm là dấu tách nhiều mã
  // (xuất hiện ở hầu hết mô tả thật, vd "(+/-10%)").
  rest = rest.replace(/\+\/?-\s*\d+([.,]\d+)?%/g, '');
  const stopRe = /,?\s*(NSX|nsx|mới\s*100%|size|chất\s*liệu|màu|KT\s*:|dung\s*tích|kích\s*thước|dạng)/i;
  const stopMatch = stopRe.exec(rest);
  const codeSegment = stopMatch ? rest.slice(0, stopMatch.index) : rest;

  // Mã hàng thật thường ngắn, không dấu tiếng Việt — lọc bỏ token trông như văn xuôi để tránh nhận
  // nhầm câu kiểu "không có mã hàng nào cả" thành có mã.
  const looksLikeCode = (s: string) =>
    s.length > 0 && s.length <= 25 &&
    !/[àáảãạăằắẳẵặâầấẩẫậđèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵ]/i.test(s);

  const codes = codeSegment.split(',').map((s) => s.trim()).filter(looksLikeCode);
  if (codes.length === 0) return 'complex';
  if (codes.length >= 3) return 'complex';
  return 'simple';
}

// ───────── Đọc hóa đơn ảnh/PDF (vat / goods_usd): thử Gemini (free) trước, đối chiếu tổng, Claude sau ─────────
// Khác với dịch text (chấp nhận rủi ro nhỏ để tiết kiệm), đọc hóa đơn ảnh hưởng trực tiếp số tiền/kế toán
// nên ưu tiên chất lượng. Đã test thực tế 17 model Gemini trên 7 hóa đơn VAT thật (đối chiếu từng dòng
// hàng, không chỉ đối chiếu tổng): 7 model trong GEMINI_RELIABLE_MODELS bên dưới đều đúng 100% mọi lần
// chạy được, còn model "mạnh hơn" (gemini-3.7/3.8-flash, *-pro-*) hầu hết bị lỗi 429 hết quota hoặc
// timeout — chọn model "mạnh" trên lý thuyết lại kém tin cậy hơn hẳn trên thực tế của free tier.
// Groq vision model (Llama 4 Scout) không thử — vẫn ở Preview, không khuyến nghị cho số liệu tài chính.
// CHỈ nhận kết quả khi tổng AI tự cộng từ các dòng hàng khớp với tongCongInHoaDon in sẵn trên hóa đơn gốc
// (đúng công thức/độ dung sai đang dùng ở frontend — xem calcTotals/calcUSDTotal trong src/helpers.js).
// Không có tổng in sẵn để đối chiếu, hoặc lệch tổng, hoặc JSON hỏng → coi như không đủ tin cậy, dùng Claude.
// GEMINI_RELIABLE_MODELS: xếp theo tốc độ đo được (nhanh trước, chậm sau) — dùng chung cho CẢ đọc hóa
// đơn (callGeminiVision) LẪN dịch text (translateWithFallback bên dưới), vì cùng 1 lý do: free tier của
// mỗi model là 1 quota RIÊNG, nhiều người dùng app cùng lúc dễ làm 1 model hết quota (429) hoặc quá tải
// (503) như đã thấy với gemini-3.8-flash lúc test — xoay qua model kế tiếp trong lúc model trước gặp
// lỗi giúp tăng hẳn khả năng vẫn đọc/dịch được bằng free thay vì rơi xuống Claude ngay. Không đưa
// gemini-3.7-flash/3.8-flash/*-pro-* vào đây vì lúc test đều timeout hoặc hết quota gần như toàn bộ —
// không đáng tin cho chuỗi này.
const GEMINI_RELIABLE_MODELS = [
  'gemini-3.5-flash-lite',
  'gemini-flash-lite-latest',
  'gemini-3.1-flash-lite',
  'gemini-3.1-flash-lite-preview',
  'gemini-3-flash-preview',
  'gemini-3.6-flash',
  'gemini-3.5-flash',
];

async function callGeminiVision(model: string, prompt: string, apiKey: string, mimeType: string, base64Data: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000); // 1 model treo lâu không được kéo chậm cả chuỗi
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ inlineData: { mimeType, data: base64Data } }, { text: prompt }] }],
        generationConfig: { maxOutputTokens: 4000 },
      }),
    });
    if (!res.ok) throw new Error(`Gemini ${model} (vision) HTTP ${res.status}`);
    const data = await res.json();
    const text = (data.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || '').join('') || '').trim();
    if (!text) throw new Error(`Gemini ${model} (vision) trả về rỗng`);
    return text;
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw new Error(`Gemini ${model} (vision) timeout 20s`);
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

type GoodsItem = { tenHang?: unknown; soLuong?: unknown; donGia?: unknown; thanhTien?: unknown; vatRate?: unknown };
type InvoiceExtraction = { goods?: GoodsItem[]; tongCongInHoaDon?: number | string | null };

// Đối chiếu y hệt công thức + dung sai đang dùng ở CreateDDH.jsx (vat, dung sai 1) và
// CreateDDHUT.jsx (goods_usd, dung sai 0.5) để 1 kết quả "đạt" ở đây cũng sẽ không bị cảnh báo
// aiMismatch trên giao diện.
function isValidInvoiceExtraction(mode: string, parsed: InvoiceExtraction): boolean {
  const goods = parsed.goods;
  if (!Array.isArray(goods) || goods.length === 0) return false;
  for (const g of goods) {
    if (typeof g.tenHang !== 'string' || !g.tenHang.trim()) return false;
    if (![g.soLuong, g.donGia, g.thanhTien].every((v) => Number.isFinite(Number(v)))) return false;
  }
  const printed = parsed.tongCongInHoaDon;
  if (printed === null || printed === undefined || printed === '') return false;

  let aiTotal: number;
  if (mode === 'vat') {
    let subtotal = 0, vat = 0;
    for (const g of goods) {
      const pre = Number(g.thanhTien) || 0;
      const rate = g.vatRate !== undefined ? Number(g.vatRate) : 8;
      subtotal += pre;
      vat += Math.round(pre * rate / 100);
    }
    aiTotal = subtotal + vat;
  } else {
    aiTotal = goods.reduce((sum: number, g) => sum + (Number(g.thanhTien) || 0), 0);
  }
  const tolerance = mode === 'vat' ? 1 : 0.5;
  return Math.abs(aiTotal - Number(printed)) <= tolerance;
}

// GEMINI_TEXT_MODELS: đã test riêng chất lượng dịch (khác hẳn OCR) trên 6 ca dịch tên hàng (có mã hàng,
// không trùng 10 ví dụ mẫu trong prompt) + 9 địa chỉ thật — chỉ 4 model "flash-lite" trong danh sách
// GEMINI_RELIABLE_MODELS đúng 100% cả 2 loại (giữ đúng mã, sạch dấu tiếng Việt, đúng thứ tự địa chỉ).
// 3 model "flash" đầy đủ còn lại KHÔNG đưa vào đây dù OCR dùng tốt: gemini-3.6-flash lỗi 400 "invalid
// argument" toàn bộ (không tương thích cách gọi text-only kèm thinkingConfig), gemini-3.5-flash dịch
// sót dấu tiếng Việt 1 lần ("Lac Long Quân" thay vì "Lac Long Quan"), và gemini-3-flash-preview/3.5-flash
// đều dễ hết quota khi gọi nhiều — tác vụ dịch bắn nhiều hơn hẳn OCR (mỗi lần blur ô mô tả) nên cần
// model ổn định hơn là "mạnh" hơn.
const GEMINI_TEXT_MODELS = GEMINI_RELIABLE_MODELS.slice(0, 4);

// Chuỗi fallback: câu "đơn giản" thử lần lượt các model free trước (dừng ngay khi có 1 cái chạy được),
// hết quota/lỗi cả Groq + 4 model Gemini (GEMINI_TEXT_MODELS) mới rơi xuống Claude. Câu "phức tạp"
// đi thẳng Claude, bỏ qua tầng free.
// forceSimple: bỏ qua bước phân loại theo mã hàng — dùng cho translate_address_en vì địa chỉ không có mã hàng.
async function translateWithFallback(
  prompt: string,
  sourceText: string,
  keys: { groq?: string; gemini?: string; anthropic: string },
  forceSimple = false,
): Promise<string> {
  const complexity = forceSimple ? 'simple' : classifyComplexity(sourceText);

  if (complexity === 'simple') {
    const attempts: Array<[string, () => Promise<string>]> = [];
    if (keys.groq) attempts.push(['Groq qwen3.8-27b', () => callGroqModel('qwen/qwen3.8-27b', prompt, keys.groq!)]);
    if (keys.gemini) {
      for (const model of GEMINI_TEXT_MODELS) {
        attempts.push([`Gemini ${model}`, () => callGeminiModel(model, prompt, keys.gemini!, false)]);
      }
    }
    for (const [name, attempt] of attempts) {
      try {
        return await attempt();
      } catch (err) {
        console.error(`[translateWithFallback] ${name} lỗi, thử tầng tiếp theo:`, (err as Error).message);
      }
    }
  }

  // Mô tả phức tạp, hoặc mọi tầng free đều thất bại → Claude (như hành vi cũ).
  return await callAnthropicText(prompt, keys.anthropic);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  try {
    // 1. Chỉ cho phép user đã đăng nhập hợp lệ của app gọi vào — không cho gọi ẩn danh từ ngoài.
    //    Gọi trực tiếp Supabase Auth REST API (không qua thư viện ngoài) để kiểm tra token.
    const authHeader = req.headers.get('Authorization') || '';
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { Authorization: authHeader, apikey: supabaseAnonKey! },
    });
    if (!userRes.ok) {
      return json({ error: 'Chưa đăng nhập hoặc phiên đã hết hạn. Vui lòng tải lại trang và đăng nhập lại.' }, 401);
    }
    const user = await userRes.json();
    if (!user?.id) {
      return json({ error: 'Chưa đăng nhập hoặc phiên đã hết hạn. Vui lòng tải lại trang và đăng nhập lại.' }, 401);
    }

    // 2. Đọc dữ liệu gửi lên từ trình duyệt — có 2 dạng: ảnh/PDF (đọc hóa đơn) hoặc text thuần (dịch mô tả).
    const { imageBase64, mediaType, mode, text } = await req.json();

    // 3. API Key chỉ đọc từ biến môi trường (Secret) của Supabase — không lưu, không trả về client.
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) {
      return json({ error: 'Server chưa cấu hình ANTHROPIC_API_KEY. Vào Supabase Dashboard → Edge Functions → Secrets để thêm.' }, 500);
    }

    // 3a. Chế độ dịch mô tả sản phẩm tiếng Việt → tiếng Anh (Sales Contract) — không cần ảnh, chỉ cần text.
    if (mode === 'translate_en') {
      if (!text || !text.trim()) return json({ error: 'Thiếu nội dung cần dịch.' }, 400);
      const prompt =
        'Bạn là nhân viên xuất nhập khẩu lâu năm. Dựa vào mô tả tiếng Việt chi tiết (dùng để khai hải quan) sau đây, ' +
        'viết TÊN SẢN PHẨM NGẮN GỌN bằng tiếng Anh dùng cho Sales Contract — KHÔNG dịch nguyên văn toàn bộ câu.\n\n' +
        'QUY TẮC:\n' +
        '- BỎ: nhãn hiệu (nhãn hiệu/brand), tên nhà sản xuất (NSX), chất liệu chi tiết, thành phần vải, các đặc điểm phủ định ' +
        '(không có nắp, không dùng pin/điện, không phải loại đúc...), "mới 100%", "không hiệu".\n' +
        '- GIỮ: loại sản phẩm chính (kèm tiền tố phân loại nếu mô tả gốc có, vd "Đồ chơi trẻ em:" → "Children\'s toys:"), ' +
        'dung tích/kích thước khi đó là đặc điểm nhận diện chính.\n' +
        '- LUÔN GIỮ mã model / mã hàng / ký hiệu khi mô tả gốc có, đặt SAU tên sản phẩm ' +
        '("model: ..." → "model: ...", "mã hàng: ..." → "item code: ...", "ký hiệu: ..." → "item code: ...").\n' +
        '- Tên phải ngắn, thường dưới 10 từ.\n\n' +
        'HỌC THEO ĐÚNG 10 VÍ DỤ MẪU SAU (mô tả tiếng Việt → tên tiếng Anh):\n' +
        '1. "Đồ chơi trẻ em: Mô hình ô tô 250 chi tiết, chất liệu nhựa, không dùng (pin, điện), KT hộp: (20x13x8) cm (+/-10%), model: 3F029, NSX: Shantou Chenghai District Lele Brother Toys Co., Ltd., mới 100%" → "Children\'s toys: Car model, model: 3F029"\n' +
        '2. "Cốc thuỷ tinh thường, loại không có nắp, không có chân (không phải pha lê chì, gốm thủy tinh), dung tích 150ml, dùng uống nước, mã hàng: 1505, NSX: Wenxi Kaili Trading Co., Ltd, mới 100%" → "Glass drinking cup 150ml, item code: 1505"\n' +
        '3. "Dép cao gót nữ (không phải loại quai hậu), không phải loại đúc, đế ngoài bằng nhựa, mũ dép bằng da tổng hợp, size: (36-39), ký hiệu: H10, NSX: Quanzhou Shenyun Trading Co., Ltd, mới 100%" → "Women\'s high heel slippers, item code: H10"\n' +
        '4. "Thân khoá cửa, sử dụng cho khoá cửa chính, cửa phòng, chất liệu bằng thép không gỉ, KT: (330x22x47.5) mm (+/-10%), nhãn hiệu: DOSICO, NSX: Ruian Xingguangli Hardware Products Co., Ltd, mới 100%" → "Door lock body, size: (330x22x47.5) mm"\n' +
        '5. "Quần lót cho trẻ em bé gái (xi líp), dệt kim từ vải nhân tạo: 17% sợi tre và 83% polyester, freesize, không hiệu, mã hàng: 5418, NSX: Tongqizi Garment Store, mới 100%" → "Girls\' underwear, item code: 5418"\n' +
        '6. "Đồ trang trí: Hình chong chóng, chất liệu bằng nhựa, kết hợp sắt, KT: đường kính 20 cm (+/-10%), model: BT8841-10, NSX: Shandong Dingxing Arts & Crafts Co., Ltd, mới 100%" → "Pinwheel-shaped decoration, model: BT8841-10"\n' +
        '7. "Gối tựa đầu, mặt ngoài bằng vải sợi tổng hợp, ruột nhồi đệm mút xốp, dùng cho ghế ngồi trong văn phòng, KT: (18x26) cm (+/-10%), nhãn hiệu: awesome, mới 100%" → "Headrest pillow"\n' +
        '8. "Khẩu trang chống bụi (không phải khẩu trang y tế, không có bộ lọc bụi), bằng vải sợi tổng hợp, KT: (23x25) cm (+/-10%), ký hiệu: 6039, NSX: Ruiya Clothing Co., Ltd, mới 100%" → "Face mask, item code: 6039"\n' +
        '9. "Giá đỡ hỗ trợ chụp ảnh cho máy ảnh, loại 3 chân đế, chất liệu thép hợp kim kết hợp nhựa, độ mở rộng chân 65 cm, chiều cao tối đa 200 cm, nặng 600g/cái, NSX: Fuang Hua Trading Co., Ltd, mới 100%" → "Camera tripod stand"\n' +
        '10. "Bình giữ nhiệt, không dùng điện, chất liệu lõi và thân bằng inox, có lớp cách nhiệt chân không ở giữa, nắp bằng nhựa PP, dung tích 2500ml, nhãn hiệu: DKADI, mới 100%" → "Vacuum bottle 2500ml"\n\n' +
        'Chỉ trả về đúng 1 dòng tiếng Anh, không thêm giải thích, không thêm dấu ngoặc kép.\n\n' +
        'Mô tả tiếng Việt: ' + text;
      try {
        const en = await translateWithFallback(prompt, text, {
          groq: Deno.env.get('GROQ_API_KEY') || undefined,
          gemini: Deno.env.get('GEMINI_API_KEY') || undefined,
          anthropic: apiKey,
        });
        return json({ en });
      } catch (err) {
        return json({ error: (err as Error).message || 'Lỗi gọi AI.' }, 502);
      }
    }

    // 3a-2. Chế độ dịch địa chỉ tiếng Việt → tiếng Anh (Sales Contract) — giữ format địa chỉ chuẩn quốc tế.
    if (mode === 'translate_address_en') {
      if (!text || !text.trim()) return json({ error: 'Thiếu nội dung cần dịch.' }, 400);
      const prompt =
        'Bạn là nhân viên xuất nhập khẩu lâu năm. Chuyển địa chỉ công ty tiếng Việt sau đây sang tiếng Anh, đúng thứ tự và văn phong dùng ' +
        'trên Sales Contract quốc tế (số nhà/ngõ → đường/phố → phường/xã → thành phố/tỉnh → "Vietnam"). Giữ nguyên tên riêng (đường, phường, ' +
        'quận, tỉnh...) chỉ chuyển sang dạng không dấu hoặc phiên âm quen thuộc, KHÔNG dịch nghĩa tên riêng. Ví dụ:\n' +
        '- "Số 18, Ngõ 117, Phố Thái Hà, Phường Đống Đa, Thành phố Hà Nội, Việt Nam" → "No. 18, Lane 117, Thai Ha Street, Dong Da Ward, Hanoi City, Vietnam"\n' +
        'Chỉ trả về đúng 1 dòng địa chỉ tiếng Anh, không thêm giải thích, không thêm dấu ngoặc kép.\n\n' +
        'Địa chỉ tiếng Việt: ' + text;
      try {
        const en = await translateWithFallback(prompt, text, {
          groq: Deno.env.get('GROQ_API_KEY') || undefined,
          gemini: Deno.env.get('GEMINI_API_KEY') || undefined,
          anthropic: apiKey,
        }, true);
        return json({ en });
      } catch (err) {
        return json({ error: (err as Error).message || 'Lỗi gọi AI.' }, 502);
      }
    }

    // 3b. Chế độ đọc hóa đơn/đơn hàng từ ảnh hoặc PDF (như cũ).
    if (!imageBase64 || !mediaType) {
      return json({ error: 'Thiếu dữ liệu ảnh/file gửi lên.' }, 400);
    }
    const prompt = PROMPTS[mode] || PROMPTS.vat;

    // Xoay lần lượt qua GEMINI_RELIABLE_MODELS (free) — chỉ nhận kết quả khi đối chiếu tổng khớp; model
    // lỗi (hết quota/quá tải/timeout) hoặc đọc sai thì thử model kế tiếp; hết cả 7 mới rơi xuống Claude.
    const geminiKey = Deno.env.get('GEMINI_API_KEY');
    if (geminiKey) {
      for (const model of GEMINI_RELIABLE_MODELS) {
        try {
          const rawText = await callGeminiVision(model, prompt, geminiKey, mediaType, imageBase64);
          const gm = rawText.match(/\{[\s\S]*\}/);
          const parsedGemini = gm ? JSON.parse(gm[0]) : null;
          if (parsedGemini && isValidInvoiceExtraction(mode, parsedGemini)) {
            return json(parsedGemini);
          }
          console.error(`[readInvoice] ${model} đọc được nhưng không qua đối chiếu tổng (hoặc JSON hỏng) — thử model free tiếp theo.`);
        } catch (err) {
          console.error(`[readInvoice] ${model} lỗi, thử model free tiếp theo:`, (err as Error).message);
        }
      }
      console.error('[readInvoice] Mọi model Gemini free đều thất bại/không qua đối chiếu — dùng Claude.');
    }

    const isPdf = mediaType === 'application/pdf';
    const fileBlock = isPdf
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: imageBase64 } }
      : { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } };

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 4000, // tăng từ 1500 → 4000 để đỡ bị cắt giữa với hóa đơn nhiều dòng hàng
        messages: [{ role: 'user', content: [fileBlock, { type: 'text', text: prompt }] }],
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      return json({ error: 'Lỗi gọi AI (' + aiRes.status + '): ' + errText.slice(0, 300) }, 502);
    }

    const aiData = await aiRes.json();
    const txt = aiData.content?.[0]?.text || '';
    const m = txt.match(/\{[\s\S]*\}/);
    if (!m) {
      return json({ error: 'Không đọc được phản hồi AI.' }, 502);
    }

    let parsed;
    try {
      parsed = JSON.parse(m[0]);
    } catch {
      return json({ error: 'Phản hồi AI không đúng định dạng JSON (có thể do hóa đơn quá nhiều dòng bị cắt giữa). Vui lòng thử lại hoặc nhập tay.' }, 502);
    }

    return json(parsed);
  } catch (err) {
    return json({ error: (err as Error).message || 'Lỗi không xác định.' }, 500);
  }
});

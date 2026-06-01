/* =====================================================================
 * app.js — 前端邏輯(升級版:預言機 + 工廠多台股)
 * ---------------------------------------------------------------------
 * 有 deployed.json(已部署)→ 從鏈上 PriceOracle 讀「真實台股價」,並可對
 *   工廠部署的多檔台股做 mint/redeem(真實交易)。
 * 無 deployed.json → 模擬模式,確保 Demo 仍可操作。
 * ===================================================================== */

const $   = (id) => document.getElementById(id);
const fmt = (n) => Math.round(n).toLocaleString("en-US");
const STORAGE_KEY = "ttsmc_state_v3";

let DEPLOY = null;            // deployed.json 內容(或 null)
let ro = null;               // 唯讀 provider(public RPC)
let signer = null, account = null, chainOk = false;
let STOCKS = [];             // 由目錄 + deployed.json 組成
const live = {};             // code -> {price, prev, pct, real}
let pie = null;

const canTx = () => !!(signer && chainOk && DEPLOY);
const tokenInfo = (code) => DEPLOY?.stocks?.find((x) => x.code === code) || null;

/* 品牌 logo:Clearbit → Google favicon → 字母色塊(三層退回,確保有東西顯示) */
function tintFor(code) { let h = 0; for (const c of code) h = (h * 31 + c.charCodeAt(0)) >>> 0; return LOGO_TINT[h % LOGO_TINT.length]; }
function logoImg(code) {
  const dom = LOGO_DOMAIN[code]; if (!dom) return "";
  const gf = `https://www.google.com/s2/favicons?sz=64&domain=${dom}`;
  return `<img loading="lazy" src="https://logo.clearbit.com/${dom}?size=80" ` +
    `onerror="if(!this.dataset.f){this.dataset.f=1;this.src='${gf}'}else{this.remove()}">`;
}
function logoHtml(code, name, size = 40) {
  return `<div class="logo" style="width:${size}px;height:${size}px;background:linear-gradient(135deg,${tintFor(code)})"><span>${(name || code).slice(0, 2)}</span>${logoImg(code)}</div>`;
}
function setSwapLogo(stock) {
  const el = $("swapLogo"); if (!el) return;
  el.style.background = `linear-gradient(135deg,${tintFor(stock.code)})`;
  el.innerHTML = `<span>${(stock.name || stock.code).slice(0, 2)}</span>` + logoImg(stock.code);
}

/* ===== 走勢資料 / sparkline ===== */
const HIST = {};
function seedHist(s) { const a = []; let p = s.fallback || 100; for (let i = 0; i < 26; i++) { p = Math.max(1, p * (1 + (Math.random() - 0.5) * 0.012)); a.push(p); } return a; }
function pushHist() { STOCKS.forEach((s) => { const a = HIST[s.code] || (HIST[s.code] = []); a.push(live[s.code].price); if (a.length > 40) a.shift(); }); }
function sparklineSVG(code, w = 130, h = 34) {
  const a = HIST[code]; if (!a || a.length < 2) return "";
  const mn = Math.min(...a), mx = Math.max(...a), rng = (mx - mn) || 1;
  const xy = a.map((v, i) => [(i / (a.length - 1)) * w, (h - 3) - ((v - mn) / rng) * (h - 7)]);
  const line = xy.map((p) => p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" ");
  const col = a[a.length - 1] >= a[0] ? "var(--up)" : "var(--down)";
  return `<svg width="100%" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">` +
    `<polyline points="0,${h} ${line} ${w},${h}" fill="${col}" opacity=".10"/>` +
    `<polyline points="${line}" fill="none" stroke="${col}" stroke-width="1.6"/></svg>`;
}
function updateSparks() { document.querySelectorAll("[data-spark]").forEach((el) => (el.innerHTML = sparklineSVG(el.dataset.spark))); }

/* ===== 行情跑馬燈 ===== */
function tickerItem(s) {
  return `<span class="tk">${logoHtml(s.code, s.name, 30)}` +
    `<span class="text-sm text-gray-200 font-medium">${s.name}</span>` +
    `<span class="num text-sm" data-price="${s.code}">NT$ ${fmt(live[s.code].price)}</span>` +
    `<span class="num text-xs" data-pct="${s.code}"></span></span>`;
}
function renderTicker() { const row = STOCKS.map(tickerItem).join(""); $("ticker").innerHTML = row + row; }

/* ===== 旗艦即時走勢圖 ===== */
let hero = null;
const FLAG = () => (DEPLOY?.stocks?.[0]?.code) || "2330";
function initHero() {
  const ctx = $("heroChart"); if (!ctx) return;
  const a = HIST[FLAG()] || [];
  const g = ctx.getContext("2d").createLinearGradient(0, 0, 0, 120);
  g.addColorStop(0, "rgba(245,181,68,.35)"); g.addColorStop(1, "rgba(245,181,68,0)");
  hero = new Chart(ctx, {
    type: "line",
    data: { labels: a.map((_, i) => i), datasets: [{ data: a, borderColor: "#F5B544", backgroundColor: g, fill: true, tension: .35, pointRadius: 0, borderWidth: 2 }] },
    options: { animation: false, plugins: { legend: { display: false }, tooltip: { enabled: false } }, scales: { x: { display: false }, y: { display: false } } },
  });
  updateHero();
}
function updateHero() {
  const f = STOCKS.find((s) => s.code === FLAG());
  if (f) { const el = $("heroLogo"); if (el) { el.style.background = `linear-gradient(135deg,${tintFor(f.code)})`; el.innerHTML = `<span>${(f.name || f.code).slice(0, 2)}</span>` + logoImg(f.code); } }
  if (!hero) return;
  const a = HIST[FLAG()] || [];
  hero.data.labels = a.map((_, i) => i); hero.data.datasets[0].data = a; hero.update("none");
}

/* ---------------- 狀態(模擬模式用)---------------- */
let state = loadState();
function loadState() {
  try { const s = JSON.parse(localStorage.getItem(STORAGE_KEY)); if (s && s.holdings) return s; } catch (_) {}
  return { twd: 0, holdings: {}, txs: [] };
}
function saveState() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }

/* ---------------- 初始化 ---------------- */
async function init() {
  await loadDeployed();
  ro = DEPLOY ? new ethers.JsonRpcProvider(PUBLIC_RPC) : null;

  STOCKS = TW_CATALOG.map((s) => {
    const t = tokenInfo(s.code);
    return { ...s, sym: ethers.encodeBytes32String(s.code),
             tradable: !!t, token: t?.token || null, tokenSymbol: t?.tokenSymbol || ("t" + s.code) };
  });
  STOCKS.forEach((s) => (live[s.code] = { price: s.fallback, prev: s.fallback, pct: 0, real: false }));
  STOCKS.forEach((s) => (HIST[s.code] = seedHist(s)));

  setModeBadge();
  buildSwapOptions();
  renderTicker();
  renderMarket();
  renderPortfolio();
  renderTxs();
  updateSwapInfo();
  initHero();
  updateSparks();

  await refreshPrices();
  setInterval(refreshPrices, 30000);   // 每 30 秒重讀預言機(反映 feeder 更新)

  $("connectBtn").onclick = connectWallet;
  $("faucetBtn").onclick   = () => faucet(Number($("faucetAmt").value));
  document.querySelectorAll(".quick-twd").forEach((b) => (b.onclick = () => ($("faucetAmt").value = b.dataset.v)));
  $("buyBtn").onclick    = buy;
  $("redeemBtn").onclick = redeem;
  $("swapStock").onchange = () => { updateSwapInfo(); refreshReserve($("swapStock").value); };
  $("swapShares").oninput = updateSwapInfo;
  $("search").oninput     = () => renderMarket($("search").value);
  if (window.ethereum) {
    window.ethereum.on?.("accountsChanged", () => location.reload());
    window.ethereum.on?.("chainChanged", () => location.reload());
  }
}

async function loadDeployed() {
  try {
    const r = await fetch("deployed.json", { cache: "no-store" });
    if (r.ok) { DEPLOY = await r.json(); }
  } catch (_) { DEPLOY = null; }
}

function setModeBadge() {
  if (DEPLOY) {
    const n = DEPLOY.stocks?.length || 0;
    $("oracleName").textContent = "鏈上 PriceOracle(真實餵價)";
    $("oracleSrc").textContent  = `可交易 ${n} 檔 · 全市場由 TWSE 餵價`;
  } else {
    $("oracleName").textContent = "模擬模式(尚未部署合約)";
    $("oracleSrc").textContent  = "部署後改讀鏈上真實股價";
  }
}

/* ---------------- 價格(預言機 / 模擬)---------------- */
async function refreshPrices() {
  if (DEPLOY && ro) {
    try {
      const oracle = new ethers.Contract(DEPLOY.oracle, ORACLE_ABI, ro);
      await Promise.all(STOCKS.map(async (s) => {
        try {
          const r = await oracle.latestPrice(s.sym);
          const price = Number(r[0]) / 10 ** Number(r[1]);
          const L = live[s.code]; L.prev = L.price; L.price = price; L.pct = L.prev ? (price / L.prev - 1) * 100 : 0; L.real = true;
        } catch (_) { live[s.code].real = false; }   // 該檔無預言機價 → 保留示意價
      }));
    } catch (e) { console.warn("讀取預言機失敗:", e?.message); }
  } else {
    STOCKS.forEach((s) => { const L = live[s.code]; const d = (Math.random() - 0.5) * 0.01;
      L.prev = L.price; L.price = Math.max(1, L.price * (1 + d)); L.pct = (L.price / s.fallback - 1) * 100; });
  }
  $("oracleTime").textContent = new Date().toLocaleTimeString("zh-Hant", { hour12: false });
  pushHist();
  paintPrices(); updateSparks(); updateHero(); renderPortfolio(); updateSwapInfo();
}
function paintPrices() {
  document.querySelectorAll("[data-price]").forEach((el) => {
    const L = live[el.dataset.price];
    const txt = "NT$ " + fmt(L.price);
    if (el.textContent !== txt) {
      el.textContent = txt;
      const cls = L.price >= L.prev ? "flash-up" : "flash-down";
      el.classList.remove("flash-up", "flash-down"); void el.offsetWidth; el.classList.add(cls);
    }
  });
  document.querySelectorAll("[data-pct]").forEach((el) => {
    const p = live[el.dataset.pct].pct;
    el.textContent = (p >= 0 ? "▲ " : "▼ ") + Math.abs(p).toFixed(2) + "%";
    el.className = "text-xs num " + (p >= 0 ? "up" : "down");
  });
}

/* ---------------- 市場列表 + 搜尋 ---------------- */
function renderMarket(filter = "") {
  const q = filter.trim().toLowerCase();
  const list = STOCKS.filter((s) => !q || s.code.includes(q) || s.name.toLowerCase().includes(q) || s.tokenSymbol.toLowerCase().includes(q));
  $("noResult").classList.toggle("hidden", list.length > 0);
  $("market").innerHTML = list.map((s) => `
    <div class="glass lift rounded-2xl p-4">
      <div class="flex items-start gap-3">
        ${logoHtml(s.code, s.name, 38)}
        <div class="min-w-0 flex-1">
          <div class="font-bold truncate">${s.name} <span class="text-gray-500 text-xs num">${s.code}</span></div>
          <div class="text-[11px] num" ${s.tradable ? 'style="color:var(--brand)"' : 'class="text-gray-500"'}>${s.tokenSymbol}${s.tradable ? " · 可交易" : " · 僅報價"}</div>
        </div>
        <span data-pct="${s.code}" class="text-xs num"></span>
      </div>
      <div data-price="${s.code}" class="num text-2xl font-bold mt-3">NT$ ${fmt(live[s.code].price)}</div>
      <div data-spark="${s.code}" class="mt-1.5" style="height:34px"></div>
      <button data-buy="${s.code}" class="mt-2 w-full ${s.tradable ? "btn-brand" : "btn-ghost text-gray-300"} font-bold py-2 rounded-xl text-sm">
        ${s.tradable ? "交易 " + s.tokenSymbol : "查看"}
      </button>
    </div>`).join("");
  document.querySelectorAll("[data-buy]").forEach((b) => (b.onclick = () => {
    $("swapStock").value = b.dataset.buy; updateSwapInfo(); refreshReserve(b.dataset.buy);
    $("swapStock").scrollIntoView({ behavior: "smooth", block: "center" });
  }));
  paintPrices(); updateSparks();
}

/* ---------------- 換股下拉 + 報價 ---------------- */
function buildSwapOptions() {
  $("swapStock").innerHTML = STOCKS.map(
    (s) => `<option value="${s.code}">${s.name} ${s.code}(${s.tokenSymbol})${s.tradable ? " ★鏈上" : ""}</option>`
  ).join("");
}
function currentSwap() {
  const code = $("swapStock").value || STOCKS[0].code;
  const stock = STOCKS.find((s) => s.code === code);
  const shares = Math.max(0, Number($("swapShares").value) || 0);
  const price = live[code].price;
  const gross = shares * price;
  const fee = stock.tradable ? 0 : gross * FEES.mint;   // 鏈上不收手續費
  return { code, stock, shares, price, gross, fee, total: gross + fee };
}
function updateSwapInfo() {
  const s = currentSwap();
  setSwapLogo(s.stock);
  $("swapPrice").textContent = "NT$ " + fmt(s.price) + (s.stock.tradable ? "(預言機)" : "(示意)");
  $("swapFee").textContent   = s.stock.tradable ? "鏈上免手續費" : "NT$ " + fmt(s.fee);
  $("swapTotal").textContent = "NT$ " + fmt(s.total);
}

/* ---------------- 投組 / 圓餅圖 ---------------- */
function portfolioValue() {
  let v = 0; for (const [code, sh] of Object.entries(state.holdings)) v += sh * (live[code]?.price || 0); return v;
}
function renderPortfolio() {
  $("twdBal").textContent = fmt(state.twd);
  $("totalValue").textContent = "NT$ " + fmt(state.twd + portfolioValue());
  const rows = Object.entries(state.holdings).filter(([, sh]) => sh > 0);
  $("holdingsList").innerHTML = rows.length
    ? rows.map(([code, sh]) => {
        const st = STOCKS.find((s) => s.code === code) || { tokenSymbol: code, name: code };
        return `<div class="flex items-center justify-between border-b border-line/60 pb-2">
          <div><span class="font-bold">${st.tokenSymbol}</span>
            <span class="text-gray-500 text-xs">${st.name} ${code}${st.tradable ? " · 鏈上" : ""}</span></div>
          <div class="text-right"><div class="tabular-nums">${fmt(sh)} 股</div>
            <div class="text-xs text-gray-400 tabular-nums">NT$ ${fmt(sh * (live[code]?.price || 0))}</div></div></div>`;
      }).join("")
    : `<div class="text-gray-500 text-sm">尚無持倉,先領 TWD 再買入台股代幣。</div>`;
  drawPie(rows);
}
function drawPie(rows) {
  const labels = ["TWD 現金", ...rows.map(([c]) => (STOCKS.find((s) => s.code === c)?.tokenSymbol || c))];
  const data   = [state.twd, ...rows.map(([c, sh]) => sh * (live[c]?.price || 0))];
  const colors = ["#3a3d45", "#F5B544", "#ff8a5a", "#5ad1c4", "#7aa6ff", "#c98aff", "#ff6f91", "#9ad15a"];
  const cfg = { type: "doughnut",
    data: { labels, datasets: [{ data, backgroundColor: colors, borderColor: "#131722", borderWidth: 2 }] },
    options: { responsive: false, plugins: { legend: { display: false },
      tooltip: { callbacks: { label: (c) => c.label } } }, cutout: "66%" } };
  if (pie) { pie.data = cfg.data; pie.update(); } else pie = new Chart($("pie"), cfg);
}

/* ---------------- 儲備證明 ---------------- */
async function refreshReserve(code) {
  const s = STOCKS.find((x) => x.code === code);
  if (!(DEPLOY && ro && s && s.tradable)) {
    $("ratioBadge").textContent = DEPLOY ? "選擇可交易標的" : "未連線";
    $("rvSupply").textContent = "—"; $("rvReserve").textContent = "—"; $("rvRatio").textContent = "—";
    return;
  }
  try {
    const t = new ethers.Contract(s.token, STOCK_ABI, ro);
    const rs = await t.getReserveStatus();
    const ratio = Number(await t.getCollateralRatio());
    $("rvSupply").textContent  = fmt(Number(ethers.formatUnits(rs[1], DEC.TOKEN))) + " " + s.tokenSymbol;
    $("rvReserve").textContent = "NT$ " + fmt(Number(ethers.formatUnits(rs[0], DEC.TWD)));
    $("rvRatio").textContent   = ratio + " %";
    const badge = $("ratioBadge");
    badge.textContent = ratio >= 100 ? "✅ 足額擔保 " + ratio + "%" : "⚠ " + ratio + "%";
    badge.className = "text-xs px-2 py-1 rounded-full border " + (ratio >= 100 ? "border-brand text-brand" : "border-line text-gray-400");
  } catch (e) { console.warn("讀取儲備失敗:", e?.message); }
}

/* ---------------- 交易紀錄 ---------------- */
function addTx(action, token, shares, twdAmt, real, hash) {
  state.txs.unshift({ t: new Date().toLocaleString("zh-Hant", { hour12: false }), action, token, shares, twdAmt, real: !!real, hash: hash || null });
  state.txs = state.txs.slice(0, 30); saveState(); renderTxs();
}
function renderTxs() {
  if (!state.txs.length) { $("txBody").innerHTML = `<tr><td colspan="5" class="p-4 text-center text-gray-500">尚無交易</td></tr>`; return; }
  $("txBody").innerHTML = state.txs.map((x) => {
    const cert = x.real && x.hash
      ? `<a href="${CHAIN.explorer}/tx/${x.hash}" target="_blank" class="text-brand underline">鏈上 ↗</a>`
      : `<span class="text-gray-600">模擬</span>`;
    const color = x.action.includes("買") ? "up" : x.action.includes("贖") ? "down" : "text-gray-300";
    return `<tr class="border-t border-line/60">
      <td class="p-3 text-gray-400 text-xs tabular-nums">${x.t}</td>
      <td class="p-3 font-bold ${color}">${x.action} ${x.token || ""}</td>
      <td class="p-3 text-right tabular-nums">${x.shares ? fmt(x.shares) + " 股" : "—"}</td>
      <td class="p-3 text-right tabular-nums hidden sm:table-cell">${x.twdAmt ? fmt(x.twdAmt) : "—"}</td>
      <td class="p-3 text-right">${cert}</td></tr>`;
  }).join("");
}

/* ---------------- 領 TWD ---------------- */
async function faucet(amt) {
  amt = Math.floor(amt);
  if (!amt || amt <= 0) return toast("請輸入正確金額");
  if (canTx()) {
    try {
      const twd = new ethers.Contract(DEPLOY.twd, TWD_ABI, signer);
      const tx = await twd.mintTWD(BigInt(amt));
      toast("交易送出,等待確認…"); await tx.wait();
      addTx("領取 TWD", "TWD", null, amt, true, tx.hash);
      await refreshBalances();
      return toast(`已上鏈領取 ${fmt(amt)} TWD`);
    } catch (e) { return toast("交易取消/失敗:" + (e?.shortMessage || e?.message || "")); }
  }
  state.twd += amt; saveState(); addTx("領取 TWD", "TWD", null, amt, false, null); renderPortfolio();
  toast(`已(模擬)領取 ${fmt(amt)} TWD`);
}

/* ---------------- 買入(換股,依預言機價)---------------- */
async function buy() {
  const s = currentSwap();
  if (s.shares <= 0) return toast("請輸入股數");
  if (canTx() && s.stock.tradable) {
    try {
      const t = new ethers.Contract(s.stock.token, STOCK_ABI, signer);
      const pps = await t.pricePerShare();                  // 6 位 TWD/股
      const twdRaw = pps * BigInt(s.shares);
      const twd = new ethers.Contract(DEPLOY.twd, TWD_ABI, signer);
      toast("步驟 1/2:授權 TWD(approve)…");
      await (await twd.approve(s.stock.token, twdRaw)).wait();
      toast("步驟 2/2:鑄造 " + s.stock.tokenSymbol + "(mint)…");
      const tx = await t.mint(twdRaw); await tx.wait();
      addTx("買入", s.stock.tokenSymbol, s.shares, Number(ethers.formatUnits(twdRaw, DEC.TWD)), true, tx.hash);
      await refreshBalances(); await refreshReserve(s.code);
      return toast(`已上鏈買入 ${fmt(s.shares)} 股 ${s.stock.tokenSymbol}`);
    } catch (e) { return toast("交易取消/失敗:" + (e?.shortMessage || e?.message || "")); }
  }
  if (s.total > state.twd) return toast("TWD 餘額不足,請先領取");
  state.twd -= s.total; state.holdings[s.code] = (state.holdings[s.code] || 0) + s.shares;
  saveState(); addTx("買入", s.stock.tokenSymbol, s.shares, s.total, false, null); renderPortfolio();
  toast(`已(模擬)買入 ${fmt(s.shares)} 股 ${s.stock.tokenSymbol}`);
}

/* ---------------- 贖回 ---------------- */
async function redeem() {
  const s = currentSwap();
  const held = state.holdings[s.code] || 0;
  if (s.shares <= 0) return toast("請輸入股數");
  if (s.shares > held) return toast(`持倉不足(僅 ${fmt(held)} 股)`);
  if (canTx() && s.stock.tradable) {
    try {
      const t = new ethers.Contract(s.stock.token, STOCK_ABI, signer);
      const tx = await t.redeem(ethers.parseUnits(String(s.shares), DEC.TOKEN));
      toast("贖回交易送出,等待確認…"); await tx.wait();
      addTx("贖回", s.stock.tokenSymbol, s.shares, Math.round(s.gross), true, tx.hash);
      await refreshBalances(); await refreshReserve(s.code);
      return toast(`已上鏈贖回 ${fmt(s.shares)} 股`);
    } catch (e) { return toast("交易取消/失敗:" + (e?.shortMessage || e?.message || "")); }
  }
  const payout = s.gross * (1 - (s.stock.tradable ? 0 : FEES.redeem));
  state.holdings[s.code] = held - s.shares; state.twd += payout;
  saveState(); addTx("贖回", s.stock.tokenSymbol, s.shares, payout, false, null); renderPortfolio();
  toast(`已(模擬)贖回 ${fmt(s.shares)} 股,入帳 ${fmt(payout)} TWD`);
}

/* ---------------- 從鏈上同步餘額 ---------------- */
async function refreshBalances() {
  if (!(DEPLOY && account && ro)) return;
  try {
    const twd = new ethers.Contract(DEPLOY.twd, TWD_ABI, ro);
    state.twd = Number(ethers.formatUnits(await twd.balanceOf(account), DEC.TWD));
    await Promise.all(STOCKS.filter((s) => s.tradable).map(async (s) => {
      const t = new ethers.Contract(s.token, STOCK_ABI, ro);
      state.holdings[s.code] = Number(ethers.formatUnits(await t.balanceOf(account), DEC.TOKEN));
    }));
    saveState(); renderPortfolio();
  } catch (e) { console.warn("讀取餘額失敗:", e?.message); }
}

/* ---------------- 連接錢包 ---------------- */
function setConnecting(on) {
  $("connectSpin").classList.toggle("hidden", !on);
  $("connectIco").classList.toggle("hidden", on);
  $("connectBtn").disabled = on;
  $("connectBtn").style.opacity = on ? ".85" : "1";
  if (on) $("connectLabel").textContent = "連線中…";
}
function showConnected(addr) {
  setConnecting(false);
  $("connectIco").classList.add("hidden");
  $("connectLabel").textContent = addr.slice(0, 6) + "…" + addr.slice(-4);
  const badge = $("netBadge"); badge.classList.remove("hidden");
  badge.textContent = chainOk ? "● Sepolia" : "⚠ 請切換 Sepolia";
  badge.style.color = chainOk ? "var(--cyan)" : "#ffb84d";
  requestAnimationFrame(() => (badge.style.opacity = "1"));
}
async function connectWallet() {
  if (!window.ethereum) return toast("請先安裝 MetaMask(未連錢包也能用模擬模式)");
  setConnecting(true);
  try {
    const bp = new ethers.BrowserProvider(window.ethereum);
    await bp.send("eth_requestAccounts", []);
    signer = await bp.getSigner();
    account = await signer.getAddress();
    let net = await bp.getNetwork();
    chainOk = Number(net.chainId) === CHAIN.id;
    if (!chainOk) {
      try { await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CHAIN.hex }] }); chainOk = true; }
      catch (_) {}
    }
    showConnected(account);
    if (canTx()) { await refreshBalances(); await refreshReserve($("swapStock").value); toast("已連接 Sepolia,餘額已同步"); }
    else if (chainOk && !DEPLOY) toast("已連接(尚未部署合約 → 模擬模式)");
    else toast("已連接,請切到 Sepolia 才能上鏈");
  } catch (e) { setConnecting(false); $("connectLabel").textContent = "連接錢包"; toast("連接取消"); }
}

/* ---------------- 提示 ---------------- */
let toastTimer = null;
function toast(msg) {
  let el = $("toast");
  if (!el) { el = document.createElement("div"); el.id = "toast";
    el.className = "fixed bottom-5 left-1/2 -translate-x-1/2 bg-panel border border-brand/60 text-sm px-4 py-2 rounded-xl shadow-lg z-50 transition-opacity max-w-[90vw] text-center";
    document.body.appendChild(el); }
  el.textContent = msg; el.style.opacity = "1";
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (el.style.opacity = "0"), 3000);
}

document.addEventListener("DOMContentLoaded", init);

/* =====================================================================
 * app.js — 前端邏輯(已接真實合約)
 * ---------------------------------------------------------------------
 * 連接 MetaMask + Sepolia 後:
 *   領 TWD → TWD.mintTWD(顆)          (真實交易)
 *   換 dTSMC → TWD.approve + dTSMC.mint (真實交易,兩次確認)
 *   贖回   → dTSMC.redeem               (真實交易)
 *   並從鏈上同步餘額與儲備率。
 * 未連錢包時 → 全部以前端模擬執行,確保 Demo 一定能跑。
 * 旗艦 dTSMC 為真實合約(固定價 1100);其餘台股為模擬示意。
 * ===================================================================== */

const $   = (id) => document.getElementById(id);
const fmt = (n) => Math.round(n).toLocaleString("en-US");
const STORAGE_KEY = "ttsmc_state_v2";
const FLAGSHIP = "2330";   // 對應 dTSMC 合約

/* ---------------- 狀態 ---------------- */
let state = loadState();
function loadState() {
  try { const s = JSON.parse(localStorage.getItem(STORAGE_KEY)); if (s && s.holdings) return s; } catch (_) {}
  return { twd: 0, holdings: {}, txs: [] };
}
function saveState() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }

/* 顯示用即時價:deployed 標的固定價、其餘模擬漂動 */
const live = {};
TW_STOCKS.forEach((s) => { live[s.code] = { price: s.price, base: s.price, pct: 0 }; });

/* 錢包 */
let provider = null, signer = null, account = null, chainOk = false;
const onchain = () => !!(signer && chainOk);
let pie = null;

/* ---------------- 初始化 ---------------- */
function init() {
  buildSwapOptions();
  renderMarket();
  renderPortfolio();
  renderTxs();
  updateSwapInfo();
  startOracle();

  $("connectBtn").onclick = connectWallet;
  $("faucetBtn").onclick   = () => faucet(Number($("faucetAmt").value));
  document.querySelectorAll(".quick-twd").forEach((b) => (b.onclick = () => ($("faucetAmt").value = b.dataset.v)));
  $("buyBtn").onclick    = buy;
  $("redeemBtn").onclick = redeem;
  $("swapStock").onchange = updateSwapInfo;
  $("swapShares").oninput = updateSwapInfo;
  $("search").oninput     = () => renderMarket($("search").value);

  if (window.ethereum) {
    window.ethereum.on?.("accountsChanged", () => location.reload());
    window.ethereum.on?.("chainChanged", () => location.reload());
  }
}

/* ---------------- 預言機(顯示用)---------------- */
function startOracle() {
  const tick = () => {
    TW_STOCKS.forEach((s) => {
      if (s.deployed) return;               // 真實標的固定價,不漂動
      const L = live[s.code];
      const drift = (Math.random() - 0.5) * 0.01;
      L.price = Math.max(1, L.price * (1 + drift) + (L.base - L.price) * 0.02);
      L.pct = (L.price / L.base - 1) * 100;
    });
    $("oracleTime").textContent = new Date().toLocaleTimeString("zh-Hant", { hour12: false });
    refreshPrices();
  };
  tick();
  setInterval(tick, 5000);
}
function refreshPrices() {
  document.querySelectorAll("[data-price]").forEach((el) => (el.textContent = "NT$ " + fmt(live[el.dataset.price].price)));
  document.querySelectorAll("[data-pct]").forEach((el) => {
    const p = live[el.dataset.pct].pct;
    el.textContent = (p >= 0 ? "▲ " : "▼ ") + Math.abs(p).toFixed(2) + "%";
    el.className = "text-xs tabular-nums " + (p >= 0 ? "up" : "down");
  });
  renderPortfolio();
  updateSwapInfo();
}

/* ---------------- 市場列表 + 搜尋 ---------------- */
function renderMarket(filter = "") {
  const q = filter.trim().toLowerCase();
  const list = TW_STOCKS.filter(
    (s) => !q || s.code.includes(q) || s.name.toLowerCase().includes(q) || s.token.toLowerCase().includes(q)
  );
  $("noResult").classList.toggle("hidden", list.length > 0);
  $("market").innerHTML = list.map((s) => `
    <div class="card rounded-2xl p-4">
      <div class="flex items-start justify-between">
        <div>
          <div class="font-bold">${s.name} <span class="text-gray-500 text-xs">${s.code}</span></div>
          <div class="text-[11px] ${s.deployed ? "text-brand" : "text-gray-500"} font-mono">${s.token}${s.deployed ? " · 已上鏈" : " · 示意"}</div>
        </div>
        <span data-pct="${s.code}" class="text-xs tabular-nums"></span>
      </div>
      <div data-price="${s.code}" class="text-2xl font-black mt-2 tabular-nums">NT$ ${fmt(live[s.code].price)}</div>
      <button data-buy="${s.code}" class="mt-3 w-full bg-brand/90 hover:bg-brand text-ink font-bold py-2 rounded-lg text-sm">交易 ${s.token}</button>
    </div>`).join("");
  document.querySelectorAll("[data-buy]").forEach((b) => (b.onclick = () => {
    $("swapStock").value = b.dataset.buy; updateSwapInfo();
    $("swapStock").scrollIntoView({ behavior: "smooth", block: "center" });
  }));
  refreshPrices();
}

/* ---------------- 換股下拉 + 報價 ---------------- */
function buildSwapOptions() {
  $("swapStock").innerHTML = TW_STOCKS.map(
    (s) => `<option value="${s.code}">${s.name} ${s.code}(${s.token})${s.deployed ? " ★鏈上" : ""}</option>`
  ).join("");
}
function currentSwap() {
  const code = $("swapStock").value;
  const stock = TW_STOCKS.find((s) => s.code === code);
  const shares = Math.max(0, Number($("swapShares").value) || 0);
  const price = stock.deployed ? ONCHAIN_PRICE : live[code].price;
  const gross = shares * price;
  const fee = stock.deployed ? 0 : gross * FEES.mint;   // 真實合約不收手續費
  return { code, stock, shares, price, gross, fee, total: gross + fee };
}
function updateSwapInfo() {
  const s = currentSwap();
  $("swapPrice").textContent = "NT$ " + fmt(s.price) + (s.stock.deployed ? "(鏈上固定)" : "");
  $("swapFee").textContent   = s.stock.deployed ? "鏈上免手續費" : "NT$ " + fmt(s.fee);
  $("swapTotal").textContent = "NT$ " + fmt(s.total);
}

/* ---------------- 投組 / 圓餅圖 ---------------- */
function portfolioValue() {
  let v = 0;
  for (const [code, sh] of Object.entries(state.holdings)) v += sh * (live[code]?.price || 0);
  return v;
}
function renderPortfolio() {
  $("twdBal").textContent = fmt(state.twd);
  $("totalValue").textContent = "NT$ " + fmt(state.twd + portfolioValue());
  const rows = Object.entries(state.holdings).filter(([, sh]) => sh > 0);
  $("holdingsList").innerHTML = rows.length
    ? rows.map(([code, sh]) => {
        const st = TW_STOCKS.find((s) => s.code === code);
        return `<div class="flex items-center justify-between border-b border-line/60 pb-2">
          <div><span class="font-bold">${st.token}</span>
            <span class="text-gray-500 text-xs">${st.name} ${code}${st.deployed ? " · 鏈上" : ""}</span></div>
          <div class="text-right"><div class="tabular-nums">${fmt(sh)} 股</div>
            <div class="text-xs text-gray-400 tabular-nums">NT$ ${fmt(sh * live[code].price)}</div></div></div>`;
      }).join("")
    : `<div class="text-gray-500 text-sm">尚無持倉,先領 TWD 再買入台股代幣。</div>`;
  drawPie(rows);
}
function drawPie(rows) {
  const labels = ["TWD 現金", ...rows.map(([c]) => TW_STOCKS.find((s) => s.code === c).token)];
  const data   = [state.twd, ...rows.map(([c, sh]) => sh * live[c].price)];
  const colors = ["#3a3d45", "#F5B544", "#ff8a5a", "#5ad1c4", "#7aa6ff", "#c98aff", "#ff6f91", "#9ad15a"];
  const cfg = { type: "doughnut",
    data: { labels, datasets: [{ data, backgroundColor: colors, borderColor: "#16181d", borderWidth: 2 }] },
    options: { plugins: { legend: { labels: { color: "#cbd0d8", font: { size: 11 } }, position: "bottom" } }, cutout: "62%" } };
  if (pie) { pie.data = cfg.data; pie.update(); } else pie = new Chart($("pie"), cfg);
}

/* ---------------- 儲備證明面板 ---------------- */
function renderReserve(reserve, supply, ratio) {
  $("rvSupply").textContent  = fmt(supply) + " dTSMC";
  $("rvReserve").textContent = "NT$ " + fmt(reserve);
  $("rvRatio").textContent   = ratio + " %";
  const badge = $("ratioBadge");
  badge.textContent = ratio >= 100 ? "✅ 足額擔保 " + ratio + "%" : "⚠ " + ratio + "%";
  badge.className = "text-xs px-2 py-1 rounded-full border " + (ratio >= 100 ? "border-brand text-brand" : "border-line text-gray-400");
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
      ? `<a href="${CONTRACTS.explorer}/tx/${x.hash}" target="_blank" class="text-brand underline">鏈上 ↗</a>`
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

/* ---------------- 從鏈上同步餘額與儲備 ---------------- */
async function refreshChainBalances() {
  if (!onchain()) return;
  try {
    const twd = new ethers.Contract(CONTRACTS.TWD, TWD_ABI, provider);
    const dt  = new ethers.Contract(CONTRACTS.DTSMC, DTSMC_ABI, provider);
    const [tb, db] = await Promise.all([twd.balanceOf(account), dt.balanceOf(account)]);
    state.twd = Number(ethers.formatUnits(tb, CONTRACTS.decimals.TWD));
    state.holdings[FLAGSHIP] = Number(ethers.formatUnits(db, CONTRACTS.decimals.DTSMC));
    saveState();
    try {
      const [reserve, supply] = await dt.getReserveStatus();
      const ratio = await dt.getCollateralRatio();
      renderReserve(Number(ethers.formatUnits(reserve, CONTRACTS.decimals.TWD)),
                    Number(ethers.formatUnits(supply, CONTRACTS.decimals.DTSMC)), Number(ratio));
    } catch (e) { console.warn("讀取儲備失敗:", e?.message); }
    renderPortfolio();
  } catch (e) { console.warn("讀取餘額失敗:", e?.message); }
}

/* ---------------- 動作:領 TWD ---------------- */
async function faucet(amt) {
  amt = Math.floor(amt);
  if (!amt || amt <= 0) return toast("請輸入正確金額");
  if (onchain()) {
    try {
      const twd = new ethers.Contract(CONTRACTS.TWD, TWD_ABI, signer);
      const tx = await twd.mintTWD(BigInt(amt));    // 傳「顆」,合約內部 ×1e6
      toast("交易送出,等待確認…");
      await tx.wait();
      addTx("領取 TWD", "TWD", null, amt, true, tx.hash);
      await refreshChainBalances();
      return toast(`已上鏈領取 ${fmt(amt)} TWD`);
    } catch (e) { return toast("交易取消/失敗:" + (e?.shortMessage || e?.message || "")); }
  }
  state.twd += amt; saveState(); addTx("領取 TWD", "TWD", null, amt, false, null); renderPortfolio();
  toast(`已(模擬)領取 ${fmt(amt)} TWD`);
}

/* ---------------- 動作:買入(換 dTSMC)---------------- */
async function buy() {
  const s = currentSwap();
  if (s.shares <= 0) return toast("請輸入股數");

  // 真實上鏈(僅 dTSMC 旗艦標的)
  if (onchain() && s.stock.deployed) {
    try {
      const twdRaw = ethers.parseUnits(String(s.shares * ONCHAIN_PRICE), CONTRACTS.decimals.TWD);
      const twd = new ethers.Contract(CONTRACTS.TWD, TWD_ABI, signer);
      toast("步驟 1/2:授權 TWD(approve)…");
      await (await twd.approve(CONTRACTS.DTSMC, twdRaw)).wait();
      toast("步驟 2/2:鑄造 dTSMC(mint)…");
      const dt = new ethers.Contract(CONTRACTS.DTSMC, DTSMC_ABI, signer);
      const tx = await dt.mint(twdRaw);
      await tx.wait();
      addTx("買入", "dTSMC", s.shares, s.shares * ONCHAIN_PRICE, true, tx.hash);
      await refreshChainBalances();
      return toast(`已上鏈買入 ${fmt(s.shares)} 股 dTSMC`);
    } catch (e) { return toast("交易取消/失敗:" + (e?.shortMessage || e?.message || "")); }
  }

  // 模擬模式
  if (s.total > state.twd) return toast("TWD 餘額不足,請先領取");
  state.twd -= s.total;
  state.holdings[s.code] = (state.holdings[s.code] || 0) + s.shares;
  saveState(); addTx("買入", s.stock.token, s.shares, s.total, false, null); renderPortfolio();
  toast(`已(模擬)買入 ${fmt(s.shares)} 股 ${s.stock.token}`);
}

/* ---------------- 動作:贖回 ---------------- */
async function redeem() {
  const s = currentSwap();
  const held = state.holdings[s.code] || 0;
  if (s.shares <= 0) return toast("請輸入股數");
  if (s.shares > held) return toast(`持倉不足(僅 ${fmt(held)} 股)`);

  if (onchain() && s.stock.deployed) {
    try {
      const dt = new ethers.Contract(CONTRACTS.DTSMC, DTSMC_ABI, signer);
      const tx = await dt.redeem(ethers.parseUnits(String(s.shares), CONTRACTS.decimals.DTSMC));
      toast("贖回交易送出,等待確認…");
      await tx.wait();
      addTx("贖回", "dTSMC", s.shares, s.shares * ONCHAIN_PRICE, true, tx.hash);
      await refreshChainBalances();
      return toast(`已上鏈贖回 ${fmt(s.shares)} 股`);
    } catch (e) { return toast("交易取消/失敗:" + (e?.shortMessage || e?.message || "")); }
  }

  const payout = s.gross * (1 - (s.stock.deployed ? 0 : FEES.redeem));
  state.holdings[s.code] = held - s.shares;
  state.twd += payout;
  saveState(); addTx("贖回", s.stock.token, s.shares, payout, false, null); renderPortfolio();
  toast(`已(模擬)贖回 ${fmt(s.shares)} 股,入帳 ${fmt(payout)} TWD`);
}

/* ---------------- 連接錢包 ---------------- */
async function connectWallet() {
  if (!window.ethereum) return toast("請先安裝 MetaMask(未連錢包也能用模擬模式)");
  try {
    provider = new ethers.BrowserProvider(window.ethereum);
    await provider.send("eth_requestAccounts", []);
    signer = await provider.getSigner();
    account = await signer.getAddress();
    let net = await provider.getNetwork();
    chainOk = Number(net.chainId) === CONTRACTS.chainId;
    if (!chainOk) {
      try {
        await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CONTRACTS.chainHex }] });
        chainOk = true;
      } catch (_) {}
    }
    $("connectBtn").textContent = account.slice(0, 6) + "…" + account.slice(-4);
    const badge = $("netBadge");
    badge.classList.remove("hidden");
    badge.textContent = chainOk ? "● Sepolia(可上鏈)" : "⚠ 請切換 Sepolia";
    badge.classList.toggle("text-brand", chainOk);
    if (chainOk) { await refreshChainBalances(); toast("已連接 Sepolia,餘額已同步"); }
    else toast("已連接,但請切到 Sepolia 才能上鏈");
  } catch (e) { toast("連接取消"); }
}

/* ---------------- 提示 ---------------- */
let toastTimer = null;
function toast(msg) {
  let el = $("toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    el.className = "fixed bottom-5 left-1/2 -translate-x-1/2 bg-panel border border-brand/60 text-sm px-4 py-2 rounded-xl shadow-lg z-50 transition-opacity max-w-[90vw] text-center";
    document.body.appendChild(el);
  }
  el.textContent = msg; el.style.opacity = "1";
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (el.style.opacity = "0"), 3000);
}

document.addEventListener("DOMContentLoaded", init);

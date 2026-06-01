/* =====================================================================
 * app.js — 前端邏輯
 * 設計原則:模擬優先(保證 Demo 一定能跑),連上 MetaMask + Sepolia 後
 *           「盡力」疊加真實合約呼叫(漸進增強);任何鏈上錯誤都退回模擬。
 * ===================================================================== */

const $  = (id) => document.getElementById(id);
const fmt = (n) => Math.round(n).toLocaleString("en-US");
const STORAGE_KEY = "ttsmc_state_v1";

/* ---------------- 狀態 ---------------- */
let state = loadState();
function loadState() {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (s && s.holdings) return s;
  } catch (_) {}
  return { twd: 0, holdings: {}, txs: [] };  // holdings: { code: 股數 }
}
function saveState() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }

/* 即時(模擬)股價:code -> {price, base, pct} */
const live = {};
TW_STOCKS.forEach((s) => { live[s.code] = { price: s.price, base: s.price, pct: 0 }; });

/* 錢包 */
let provider = null, signer = null, account = null, chainOk = false;
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
  document.querySelectorAll(".quick-twd").forEach((b) =>
    (b.onclick = () => { $("faucetAmt").value = b.dataset.v; }));
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

/* ---------------- 預言機(模擬餵價) ---------------- */
function startOracle() {
  const tick = () => {
    TW_STOCKS.forEach((s) => {
      const L = live[s.code];
      // 隨機漫步 ±0.5%,並輕微回歸基準
      const drift = (Math.random() - 0.5) * 0.01;
      L.price = Math.max(1, L.price * (1 + drift) + (L.base - L.price) * 0.02);
      L.pct = (L.price / L.base - 1) * 100;
    });
    const t = new Date().toLocaleTimeString("zh-Hant", { hour12: false });
    $("oracleTime").textContent = t;
    refreshPrices();
  };
  tick();
  setInterval(tick, 5000);  // 每 5 秒「餵價」一次
}

/* 僅更新畫面上的價格/估值,不重建 DOM */
function refreshPrices() {
  document.querySelectorAll("[data-price]").forEach((el) => {
    const c = el.dataset.price; el.textContent = "NT$ " + fmt(live[c].price);
  });
  document.querySelectorAll("[data-pct]").forEach((el) => {
    const c = el.dataset.pct, p = live[c].pct;
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
          <div class="text-[11px] text-brand font-mono">${s.token}${s.deployed ? " · 已上鏈" : ""}</div>
        </div>
        <span data-pct="${s.code}" class="text-xs tabular-nums"></span>
      </div>
      <div data-price="${s.code}" class="text-2xl font-black mt-2 tabular-nums">NT$ ${fmt(live[s.code].price)}</div>
      <button data-buy="${s.code}" class="mt-3 w-full bg-brand/90 hover:bg-brand text-ink font-bold py-2 rounded-lg text-sm">
        交易 ${s.token}
      </button>
    </div>`).join("");
  document.querySelectorAll("[data-buy]").forEach((b) => b.onclick = () => {
    $("swapStock").value = b.dataset.buy;
    updateSwapInfo();
    $("swapStock").scrollIntoView({ behavior: "smooth", block: "center" });
  });
  refreshPrices();
}

/* ---------------- 換股下拉 + 報價 ---------------- */
function buildSwapOptions() {
  $("swapStock").innerHTML = TW_STOCKS.map(
    (s) => `<option value="${s.code}">${s.name} ${s.code}(${s.token})</option>`
  ).join("");
}
function currentSwap() {
  const code = $("swapStock").value;
  const stock = TW_STOCKS.find((s) => s.code === code);
  const shares = Math.max(0, Number($("swapShares").value) || 0);
  const price = live[code].price;
  const gross = shares * price;
  const fee = gross * FEES.mint;
  return { code, stock, shares, price, gross, fee, total: gross + fee };
}
function updateSwapInfo() {
  const s = currentSwap();
  $("swapPrice").textContent = "NT$ " + fmt(s.price);
  $("swapFee").textContent   = "NT$ " + fmt(s.fee);
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
        const val = sh * live[code].price;
        return `<div class="flex items-center justify-between border-b border-line/60 pb-2">
          <div><span class="font-bold">${st.token}</span>
            <span class="text-gray-500 text-xs">${st.name} ${code}</span></div>
          <div class="text-right"><div class="tabular-nums">${fmt(sh)} 股</div>
            <div class="text-xs text-gray-400 tabular-nums">NT$ ${fmt(val)}</div></div></div>`;
      }).join("")
    : `<div class="text-gray-500 text-sm">尚無持倉,先領 TWD 再買入台股代幣。</div>`;

  drawPie(rows);
}
function drawPie(rows) {
  const labels = ["TWD 現金", ...rows.map(([c]) => TW_STOCKS.find((s) => s.code === c).token)];
  const data   = [state.twd, ...rows.map(([c, sh]) => sh * live[c].price)];
  const colors = ["#3a3d45", "#F5B544", "#ff8a5a", "#5ad1c4", "#7aa6ff", "#c98aff", "#ff6f91", "#9ad15a"];
  const cfg = {
    type: "doughnut",
    data: { labels, datasets: [{ data, backgroundColor: colors, borderColor: "#16181d", borderWidth: 2 }] },
    options: { plugins: { legend: { labels: { color: "#cbd0d8", font: { size: 11 } }, position: "bottom" } },
               cutout: "62%" },
  };
  if (pie) { pie.data = cfg.data; pie.update(); }
  else pie = new Chart($("pie"), cfg);
}

/* ---------------- 交易紀錄 ---------------- */
function addTx(action, token, shares, twdAmt, real, hash) {
  state.txs.unshift({
    t: new Date().toLocaleString("zh-Hant", { hour12: false }),
    action, token, shares, twdAmt, real: !!real, hash: hash || null,
  });
  state.txs = state.txs.slice(0, 30);
  saveState(); renderTxs();
}
function renderTxs() {
  if (!state.txs.length) {
    $("txBody").innerHTML = `<tr><td colspan="5" class="p-4 text-center text-gray-500">尚無交易</td></tr>`;
    return;
  }
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

/* ---------------- 動作:領 TWD ---------------- */
async function faucet(amt) {
  if (!amt || amt <= 0) return toast("請輸入正確金額");
  let real = false, hash = null;
  if (signer && chainOk) {
    try {
      const c = new ethers.Contract(CONTRACTS.TWD, TWD_ABI, signer);
      const tx = await c.mintTWD(ethers.parseUnits(String(amt), 18));
      hash = tx.hash; await tx.wait(); real = true;
    } catch (e) { console.warn("mintTWD 失敗,改用模擬:", e?.message); }
  }
  state.twd += amt; saveState();
  addTx("領取 TWD", "TWD", null, amt, real, hash);
  renderPortfolio();
  toast(`已${real ? "(鏈上)" : ""}領取 ${fmt(amt)} TWD`);
}

/* ---------------- 動作:買入(鑄造) ---------------- */
async function buy() {
  const s = currentSwap();
  if (s.shares <= 0) return toast("請輸入股數");
  if (s.total > state.twd) return toast("TWD 餘額不足,請先領取");
  let real = false, hash = null;
  if (signer && chainOk && s.stock.deployed) {
    try {
      const twd = new ethers.Contract(CONTRACTS.TWD, TWD_ABI, signer);
      await (await twd.approve(CONTRACTS.TSMC, ethers.parseUnits(String(Math.ceil(s.total)), 18))).wait();
      const tsmc = new ethers.Contract(CONTRACTS.TSMC, TSMC_ABI, signer);
      const tx = await tsmc.mint(ethers.parseUnits(String(s.shares), 18));
      hash = tx.hash; await tx.wait(); real = true;
    } catch (e) { console.warn("mint 失敗,改用模擬:", e?.message); }
  }
  state.twd -= s.total;
  state.holdings[s.code] = (state.holdings[s.code] || 0) + s.shares;
  saveState();
  addTx("買入", s.stock.token, s.shares, s.total, real, hash);
  renderPortfolio();
  toast(`已${real ? "(鏈上)" : ""}買入 ${fmt(s.shares)} 股 ${s.stock.token}`);
}

/* ---------------- 動作:贖回(賣出) ---------------- */
async function redeem() {
  const s = currentSwap();
  const held = state.holdings[s.code] || 0;
  if (s.shares <= 0) return toast("請輸入股數");
  if (s.shares > held) return toast(`持倉不足(僅 ${fmt(held)} 股)`);
  const payout = s.gross * (1 - FEES.redeem);
  let real = false, hash = null;
  if (signer && chainOk && s.stock.deployed) {
    try {
      const tsmc = new ethers.Contract(CONTRACTS.TSMC, TSMC_ABI, signer);
      const tx = await tsmc.redeem(ethers.parseUnits(String(s.shares), 18));
      hash = tx.hash; await tx.wait(); real = true;
    } catch (e) { console.warn("redeem 失敗,改用模擬:", e?.message); }
  }
  state.holdings[s.code] = held - s.shares;
  state.twd += payout;
  saveState();
  addTx("贖回", s.stock.token, s.shares, payout, real, hash);
  renderPortfolio();
  toast(`已${real ? "(鏈上)" : ""}贖回 ${fmt(s.shares)} 股,入帳 ${fmt(payout)} TWD`);
}

/* ---------------- 連接錢包 ---------------- */
async function connectWallet() {
  if (!window.ethereum) return toast("請先安裝 MetaMask(未連錢包也能用模擬模式)");
  try {
    provider = new ethers.BrowserProvider(window.ethereum);
    await provider.send("eth_requestAccounts", []);
    signer = await provider.getSigner();
    account = await signer.getAddress();
    const net = await provider.getNetwork();
    chainOk = Number(net.chainId) === CONTRACTS.chainId;
    if (!chainOk) {
      try {
        await window.ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: CONTRACTS.chainHex }],
        });
        chainOk = true;
      } catch (_) {}
    }
    $("connectBtn").textContent = account.slice(0, 6) + "…" + account.slice(-4);
    const badge = $("netBadge");
    badge.classList.remove("hidden");
    badge.textContent = chainOk ? "● Sepolia" : "⚠ 非 Sepolia";
    badge.classList.toggle("text-brand", chainOk);
    toast(chainOk ? "已連接 Sepolia" : "已連接,但請切換到 Sepolia 才能上鏈");
  } catch (e) { toast("連接取消"); }
}

/* ---------------- 簡易提示 ---------------- */
let toastTimer = null;
function toast(msg) {
  let el = $("toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    el.className =
      "fixed bottom-5 left-1/2 -translate-x-1/2 bg-panel border border-brand/60 text-sm " +
      "px-4 py-2 rounded-xl shadow-lg z-50 transition-opacity";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.opacity = "1";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.style.opacity = "0"), 2600);
}

document.addEventListener("DOMContentLoaded", init);

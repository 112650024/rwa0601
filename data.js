/* =====================================================================
 * data.js — 資料層(台股清單、模擬股價、合約設定)
 * ---------------------------------------------------------------------
 * 注意:本檔案的股價為「模擬資料」,用來假裝預言機(Oracle)已連上。
 * 真實串接(Chainlink Functions 抓台積電股價)列為未來升級,不在本次範圍。
 * ===================================================================== */

/* ---- 已部署於 Sepolia 測試網的合約位址(來自簡報 Demo 頁) ---- */
const CONTRACTS = {
  // 旗艦標的:台積電代幣 tTSMC
  TSMC: "0x70ca9f7173DB7a57984D2A78996A0548DDfb967a",
  // 平台計價穩定幣 TWD(類穩定幣,1 TWD ≈ 新台幣 1 元)
  TWD:  "0x176DCdd62Aa233132DE2E7b670BE47D70417d1ae",
  chainId: 11155111,            // Sepolia
  chainHex: "0xaa36a7",
  explorer: "https://sepolia.etherscan.io",
};

/* ---- 精簡 ABI(僅取前端會用到的函式;真實呼叫時會 try/catch 容錯) ---- */
const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transfer(address to, uint256 amount) returns (bool)",
];
// TWD 水龍頭與 TSMC 鑄造/贖回(函式名沿用 Remix Demo 的命名,實際以合約為準)
const TWD_ABI  = ERC20_ABI.concat(["function mintTWD(uint256 amount)"]);
const TSMC_ABI = ERC20_ABI.concat([
  "function mint(uint256 amount)",
  "function redeem(uint256 amount)",
]);

/* ---- 台股清單(模擬資料)---------------------------------------------
 * price：以新台幣計價的「每股」模擬價
 * 旗艦 2330 有真實合約(tTSMC);其餘為示意,前端以模擬代幣呈現概念
 * ------------------------------------------------------------------- */
const TW_STOCKS = [
  { code: "2330", name: "台積電",     token: "tTSMC", price: 1015, deployed: true  },
  { code: "2317", name: "鴻海",       token: "tHHPG", price:  205, deployed: false },
  { code: "2454", name: "聯發科",     token: "tMTK",  price: 1280, deployed: false },
  { code: "0050", name: "元大台灣50", token: "t0050", price:  190, deployed: false },
  { code: "2412", name: "中華電",     token: "tCHT",  price:  126, deployed: false },
  { code: "2308", name: "台達電",     token: "tDLT",  price:  402, deployed: false },
  { code: "2303", name: "聯電",       token: "tUMC",  price:   54, deployed: false },
  { code: "2882", name: "國泰金",     token: "tCAT",  price:   66, deployed: false },
  { code: "2881", name: "富邦金",     token: "tFBN",  price:   92, deployed: false },
  { code: "3008", name: "大立光",     token: "tLAR",  price: 2520, deployed: false },
  { code: "2603", name: "長榮",       token: "tEVG",  price:  195, deployed: false },
  { code: "1301", name: "台塑",       token: "tFPC",  price:   72, deployed: false },
  { code: "2002", name: "中鋼",       token: "tCSC",  price:   28, deployed: false },
  { code: "3037", name: "欣興",       token: "tUNI",  price:  165, deployed: false },
  { code: "2891", name: "中信金",     token: "tCTBC", price:   39, deployed: false },
];

/* ---- 平台費率(對應簡報「商業模式 / 獲利」)---- */
const FEES = {
  mint:   0.003,   // 鑄造手續費 0.3%
  redeem: 0.003,   // 贖回手續費 0.3%
};

/* 提供查詢工具 */
function findStock(query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return null;
  return TW_STOCKS.find(
    (s) => s.code === q || s.name.includes(q) || s.token.toLowerCase().includes(q)
  );
}

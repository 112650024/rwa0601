/* =====================================================================
 * data.js — 資料層(合約設定、台股清單)
 * ---------------------------------------------------------------------
 * 旗艦標的 dTSMC 為「真實合約」(已部署 Sepolia),連錢包後真正上鏈;
 * 其餘台股無合約,為模擬示意。價格:dTSMC 為合約固定價 1100 TWD/股,
 * 其餘為模擬漂動。
 * ===================================================================== */

/* ---- 已部署於 Sepolia 測試網的合約位址 ---- */
const CONTRACTS = {
  DTSMC: "0x70ca9f7173DB7a57984D2A78996A0548DDfb967a", // dTSMC_RWA(Digitized TSMC)
  TWD:   "0x176DCdd62Aa233132DE2E7b670BE47D70417d1ae", // MockTWD
  chainId: 11155111,            // Sepolia
  chainHex: "0xaa36a7",
  explorer: "https://sepolia.etherscan.io",
  decimals: { TWD: 6, DTSMC: 18 },   // ← 與合約一致(TWD 6 位、dTSMC 18 位)
};

/* dTSMC 合約寫死的價格:1100 TWD = 1 股(TSMC_PRICE = 1100) */
const ONCHAIN_PRICE = 1100;

/* ---- 真實 ABI(對應使用者 Solidity)---- */
const TWD_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function mint(uint256)",
  "function mintTWD(uint256 twdWhole)",   // 傳整數(顆),合約內部 ×1e6
];
const DTSMC_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function mint(uint256 twdRaw)",        // 需先 approve;twdRaw 為 6 位原始量
  "function redeem(uint256 dtsmcRaw)",    // dtsmcRaw 為 18 位原始量
  "function previewMint(uint256) view returns (uint256)",
  "function previewRedeem(uint256) view returns (uint256)",
  "function getReserveStatus() view returns (uint256,uint256,uint256)",
  "function getCollateralRatio() view returns (uint256)",
  "function getTsmcPrice() view returns (uint256)",
];

/* ---- 台股清單 ----
 * 2330 為真實上鏈標的(token=dTSMC、deployed=true、固定價 1100);其餘示意。
 */
const TW_STOCKS = [
  { code: "2330", name: "台積電",     token: "dTSMC", price: ONCHAIN_PRICE, deployed: true  },
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

/* 平台費率(僅模擬模式呈現;真實合約目前未收手續費) */
const FEES = { mint: 0.003, redeem: 0.003 };

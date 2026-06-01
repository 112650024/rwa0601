/* =====================================================================
 * data.js — 資料層(升級版:預言機 + 工廠多台股)
 * ---------------------------------------------------------------------
 * 價格來源:部署後由 deployed.json 提供合約位址,前端從「鏈上 PriceOracle」
 *           讀真實台股價;尚未部署(無 deployed.json)時退回模擬,確保可展示。
 * ===================================================================== */

const PUBLIC_RPC = "https://ethereum-sepolia-rpc.publicnode.com";
const CHAIN = { id: 11155111, hex: "0xaa36a7", explorer: "https://sepolia.etherscan.io" };
const DEC = { TWD: 6, TOKEN: 18, PRICE: 2 };   // 與合約一致

/* ---- 精簡 ABI ---- */
const ORACLE_ABI = [
  "function latestPrice(bytes32) view returns (int256,uint8,uint64)",
  "function hasPrice(bytes32) view returns (bool)",
];
const TWD_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function mintTWD(uint256)",
];
const STOCK_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function mint(uint256)",
  "function redeem(uint256)",
  "function previewMint(uint256) view returns (uint256)",
  "function pricePerShare() view returns (uint256)",
  "function getReserveStatus() view returns (uint256,uint256,uint256)",
  "function getCollateralRatio() view returns (uint256)",
];

/* ---- 台股名稱目錄(顯示 / 搜尋用;fallback 為無預言機價時的示意價)----
 * 旗艦與精選會在 deployed.json 標為「可交易」;其餘為示意。 */
const TW_CATALOG = [
  { code: "2330", name: "台積電",     fallback: 2355 },
  { code: "2317", name: "鴻海",       fallback: 205  },
  { code: "2454", name: "聯發科",     fallback: 1280 },
  { code: "2308", name: "台達電",     fallback: 402  },
  { code: "2303", name: "聯電",       fallback: 54   },
  { code: "2412", name: "中華電",     fallback: 126  },
  { code: "2882", name: "國泰金",     fallback: 66   },
  { code: "2881", name: "富邦金",     fallback: 92   },
  { code: "2603", name: "長榮",       fallback: 195  },
  { code: "3008", name: "大立光",     fallback: 2520 },
  { code: "0050", name: "元大台灣50", fallback: 190  },
  { code: "2891", name: "中信金",     fallback: 39   },
  { code: "2002", name: "中鋼",       fallback: 28   },
  { code: "3037", name: "欣興",       fallback: 165  },
  { code: "2357", name: "華碩",       fallback: 620  },
  { code: "2382", name: "廣達",       fallback: 300  },
  { code: "3231", name: "緯創",       fallback: 130  },
  { code: "2379", name: "瑞昱",       fallback: 600  },
  { code: "1303", name: "南亞",       fallback: 48   },
  { code: "1301", name: "台塑",       fallback: 72   },
  { code: "2886", name: "兆豐金",     fallback: 40   },
  { code: "2884", name: "玉山金",     fallback: 28   },
  { code: "2609", name: "陽明",       fallback: 75   },
  { code: "2615", name: "萬海",       fallback: 95   },
  { code: "2207", name: "和泰車",     fallback: 620  },
  { code: "2912", name: "統一超",     fallback: 280  },
];

/* 平台費率(僅模擬模式呈現;真實合約目前不收手續費) */
const FEES = { mint: 0.003, redeem: 0.003 };

/* 公司官網網域 → 用來抓品牌 logo(Clearbit);抓不到時前端自動退回字母色塊 */
const LOGO_DOMAIN = {
  "2330": "tsmc.com",        "2317": "honhai.com",      "2454": "mediatek.com",
  "2308": "deltaww.com",     "2303": "umc.com",         "2412": "cht.com.tw",
  "2882": "cathayholdings.com","2881": "fubon.com",      "2603": "evergreen-marine.com",
  "3008": "largan.com.tw",   "2891": "ctbcbank.com",    "2002": "csc.com.tw",
  "3037": "unimicron.com",   "2357": "asus.com",        "2382": "quantatw.com",
  "3231": "wistron.com",     "2379": "realtek.com",     "1303": "npc.com.tw",
  "1301": "fpc.com.tw",      "2886": "megaholdings.com.tw","2884": "esunbank.com.tw",
  "2609": "yangming.com",    "2615": "wanhai.com",      "2207": "hotaimotor.com.tw",
  "2912": "7-11.com.tw",
};
/* 每檔的色塊漸層(logo 抓不到時的底色),用代號雜湊挑色 */
const LOGO_TINT = ["#2f6bff,#1b3a8f","#F5B544,#b8761a","#37d6c4,#1f7a70","#ff7a45,#a83c14",
  "#a77bff,#5b3aa8","#ff6f91,#a83a55","#46e08a,#1f8a52","#7aa6ff,#3a5bb0"];

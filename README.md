# tTSMC — RWA 台股代幣化平台(前端 Demo)

把台股變成可 24/7、可碎片化的鏈上資產:用平台穩定幣 **TWD** 兌換台積電代幣 **tTSMC**,預言機即時估值。

## 功能
- 連接 MetaMask(自動提示切換 Sepolia)
- 💧 領取 TWD 穩定幣(水龍頭)
- 🔁 用 TWD 換台股代幣(買入鑄造 / 贖回賣出),顯示手續費
- 🔍 搜尋欄:查詢其他台股(代號 / 名稱),一鍵帶入交易
- 📊 資產儀表板:持倉市值、投組總值、配置圓餅圖
- 🧾 交易紀錄(連上 Sepolia 後附 Etherscan 連結)

> 說明:股價為「預言機模擬資料」(假裝已串接 Chainlink)。未連錢包時為前端模擬;
> 連上 Sepolia 且合約可用時,會「盡力」呼叫真實合約(`mintTWD` / `mint` / `redeem`),失敗自動退回模擬,確保 Demo 一定能跑。

## 本機預覽
```bash
npx serve .
# 或
python -m http.server 8000
```
開啟 http://localhost:3000 (或 8000)。

## 部署到 Vercel
```bash
npm i -g vercel      # 第一次
vercel login         # 登入(或用 GitHub 連動 import)
vercel               # 在本資料夾執行,依提示部署
vercel --prod        # 正式環境
```
本專案為純靜態網站,Vercel 零設定即可部署。

## 檔案
- `index.html` — 介面結構與樣式(Tailwind / ethers / Chart.js 皆走 CDN)
- `data.js` — 台股清單、模擬股價、合約位址與 ABI、費率
- `app.js` — 邏輯(錢包、餵價模擬、買賣、搜尋、投組、交易紀錄)

## 已部署合約(Sepolia 測試網)
- tTSMC: `0x70ca9f7173DB7a57984D2A78996A0548DDfb967a`
- TWD:   `0x176DCdd62Aa233132DE2E7b670BE47D70417d1ae`

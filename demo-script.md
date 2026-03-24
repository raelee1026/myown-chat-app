# 3 分鐘 Demo 錄影腳本

## 0:00 - 0:20 開場
大家好，這是我的 HW01：**My Own ChatGPT**。  
我做的是一個 OpenAI-compatible 的聊天網頁，可以切換不同 endpoint 與模型。

---

## 0:20 - 0:45 展示需求對照
左側這邊可以看到：

- 可以選 provider
- 可以輸入 model
- 可以改 system prompt
- 可以調整 API 參數
- 可以開啟 streaming
- 可以設定短期記憶保留幾輪

所以老師要求的五項功能都有完成。

---

## 0:45 - 1:10 切換模型
這裡我可以切換：

- OpenAI
- NYCU Club

OpenAI 這邊可以輸入像 `gpt-4o-mini`。  
Club 這邊我有預設 `qwen35-397b`、`qwen35-4b`。

---

## 1:10 - 1:35 修改 system prompt / 參數
我可以把 system prompt 改成例如：

> 你是一個資工助教，回答要簡潔而且有條理。

然後下面也可以改：

- Temperature
- Top P
- Max Tokens
- Presence / Frequency penalty

---

## 1:35 - 2:00 展示 Streaming
我現在問一題，例如：

> 幫我用 Python 寫 merge sort

送出後可以看到回覆是**逐步串流顯示**，不是等全部完成才一次出現。

---

## 2:00 - 2:25 展示短期記憶
接著我再追問：

> 幫我加上註解，並分析時間複雜度

模型會記得上一輪的內容，代表短期記憶有效。

---

## 2:25 - 2:45 安全設計
API key 沒有寫在前端，而是放在後端 `.env`。  
前端只會呼叫我自己的 `/api/chat`，所以不會把金鑰直接暴露在瀏覽器裡。  
`.gitignore` 也有忽略 `.env`，符合安全要求。

---

## 2:45 - 3:00 結尾
我的專案也支援：

- 匯出對話
- 清空對話
- 自動保存設定到 localStorage

以上就是我的 HW01，謝謝。

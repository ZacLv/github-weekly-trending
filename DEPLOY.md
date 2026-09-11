# GitHub 周榜 → 飞书机器人（部署教程）

项目地址：https://github.com/ZacLv/github-weekly-trending

每周一自动抓取 [GitHub 周榜](https://github.com/trending?since=weekly)，推送到飞书群（含简介、适用场景、优缺点）。

原理：

```text
GitHub Actions 定时跑脚本 → 抓榜 → AI 简评 → 飞书 Webhook
```

---

## 一、飞书：加机器人

1. 打开目标飞书群 → **设置** → **群机器人** → **添加机器人**
2. 选 **自定义机器人**，起个名字（如「GitHub 周榜」）
3. 复制 **Webhook 地址**（先别泄露）

可选自测：

```bash
curl -X POST '你的Webhook' \
  -H 'Content-Type: application/json' \
  -d '{"msg_type":"text","content":{"text":"测试成功"}}'
```

> Webhook 不要写进代码。放进 GitHub Secret 是安全的。

---

## 二、GitHub：配 Secret

仓库 → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**

**推荐免费：[Google AI Studio / Gemini](https://aistudio.google.com/apikey)**

| Name | Value |
|------|--------|
| `FEISHU_WEBHOOK_URL` | 飞书 Webhook |
| `LLM_API_KEY` | Gemini API Key |

代码已默认 Gemini，**不用配 Variables**。  
以前配的 OpenAI / Groq Variables 可删掉。

不配 `LLM_API_KEY` 也能发榜，但没有优缺点分析。

若 Gemini 也申请不了，可改用 [硅基流动](https://cloud.siliconflow.cn/)（国内好注册），需改 workflow 里的 `LLM_BASE_URL` / `LLM_MODEL`。

---

## 三、验证：手动跑一次

1. **Actions** → **Weekly GitHub Trending** → **Run workflow**
2. 等变绿，去飞书群确认

消息示例字段：简介 / 场景 / 优点 / 缺点 + 仓库链接。

---

## 四、定时发送

**每周一北京时间约 10:30** 自动发送。

点 **Run workflow** 也会立刻发一条（测试用，属正常）。

---

## 五、本地调试（可选）

```bash
export FEISHU_WEBHOOK_URL='你的Webhook'
export LLM_API_KEY='你的Key'

npm run dry-run   # 只打印
npm run notify    # 真发飞书
```

---

## 常见问题

**没有优缺点 / 报余额不足？**  
换免费 [Groq](https://console.groq.com/) Key；或充值 DeepSeek。分析失败时榜单仍会推送（需已 push 最新代码）。

**周一没收到？**  
定时可能晚几分钟；确认 workflow 未被 Disable。

**飞书没消息？**  
用上面的 curl 测 Webhook。

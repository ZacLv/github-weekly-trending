# github-weekly-trending

每周一自动抓取 [GitHub Trending（周榜）](https://github.com/trending?since=weekly)，推送到飞书（含 AI 场景/优缺点简评）。

**部署教程：** [DEPLOY.md](./DEPLOY.md)

## 快速开始

```bash
npm run dry-run
```

配置 Secret 后，Actions 里 **Run workflow** 验证。

必配 Secret：

- `FEISHU_WEBHOOK_URL` — 飞书 Webhook
- `LLM_API_KEY` — 大模型 Key（可选；推荐免费 [Groq](https://console.groq.com/)）

定时：每周一北京时间约 10:30。

## 环境变量

| 变量 | 说明 | 默认 |
|------|------|------|
| `FEISHU_WEBHOOK_URL` | 飞书 Webhook | 必填 |
| `LLM_API_KEY` | OpenAI 兼容 API Key | 无则跳过分析 |
| `LLM_BASE_URL` | API 地址 | Groq 免费 |
| `LLM_MODEL` | 模型名 | `llama-3.3-70b-versatile` |
| `ANALYZE` | `0` 关闭分析 | 有 Key 则开启 |
| `TOP_N` | 条数 | `10` |
| `LANGUAGE` | 语言过滤 | 空 |
| `TRANSLATE` | `0` 关闭免费翻译兜底 | 开 |
| `DRY_RUN` | `1` 只打印 | 关 |

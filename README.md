# github-weekly-trending

每周一自动抓取 [GitHub Trending（周榜）](https://github.com/trending?since=weekly)，通过飞书自定义机器人推送到群聊。

## 快速开始

### 1. 本地验证抓取（不发飞书）

本项目零依赖，只需 Node.js 20+：

```bash
npm run dry-run
```

### 2. 配置飞书 Webhook

1. 飞书群 → 设置 → 群机器人 → 添加「自定义机器人」
2. 复制 Webhook 地址

本地推送测试：

```bash
export FEISHU_WEBHOOK_URL='https://open.feishu.cn/open-apis/bot/v2/hook/xxxx'
npm run notify
```

### 3. 配置 GitHub Actions Secret

仓库 → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**

- Name: `FEISHU_WEBHOOK_URL`
- Value: 飞书 Webhook 完整地址

### 4. 手动跑一次 Actions

仓库 → **Actions** → **Weekly GitHub Trending** → **Run workflow**

定时：每周一北京时间约 09:00 自动执行。

## 可选环境变量

| 变量 | 说明 | 默认 |
|------|------|------|
| `FEISHU_WEBHOOK_URL` | 飞书 Webhook | 必填（dry-run 除外） |
| `TOP_N` | 推送条数 | `10` |
| `LANGUAGE` | 语言过滤，如 `typescript` | 空（全部） |
| `TRANSLATE` | 设为 `0` 关闭简介中文翻译 | 默认开启 |
| `DRY_RUN` | `1` 时只打印不发送 | 关闭 |

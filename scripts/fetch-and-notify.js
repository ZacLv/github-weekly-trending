import * as cheerio from 'cheerio'

const WEBHOOK = process.env.FEISHU_WEBHOOK_URL
const DRY_RUN = process.env.DRY_RUN === '1' || process.argv.includes('--dry-run')
const TOP_N = Number(process.env.TOP_N || 10)
const LANGUAGE = (process.env.LANGUAGE || '').trim() // 例如 typescript；空表示全部
const TRENDING_URL = LANGUAGE
  ? `https://github.com/trending/${encodeURIComponent(LANGUAGE)}?since=weekly`
  : 'https://github.com/trending?since=weekly'

if (!DRY_RUN && !WEBHOOK) {
  console.error('缺少 FEISHU_WEBHOOK_URL（本地可先 npm run dry-run 验证抓取）')
  process.exit(1)
}

async function fetchTrending() {
  const res = await fetch(TRENDING_URL, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  })

  if (!res.ok) {
    throw new Error(`抓取失败: HTTP ${res.status}`)
  }

  const html = await res.text()
  const $ = cheerio.load(html)
  const list = []

  $('article.Box-row').each((_, el) => {
    if (list.length >= TOP_N) return false

    const $el = $(el)
    const $link = $el.find('h2 a').first()
    const href = ($link.attr('href') || '').trim()
    const fullName = href.replace(/^\//, '') || $link.text().replace(/\s+/g, '')
    if (!fullName) return

    const desc = $el.find('p').first().text().replace(/\s+/g, ' ').trim()
    const language =
      $el.find('[itemprop="programmingLanguage"]').first().text().trim() || 'N/A'
    const starsThisWeek = $el
      .find('.float-sm-right')
      .first()
      .text()
      .replace(/\s+/g, ' ')
      .trim()

    list.push({
      fullName,
      url: `https://github.com/${fullName}`,
      desc,
      language,
      starsThisWeek,
    })
  })

  if (!list.length) {
    throw new Error('未解析到榜单，GitHub 页面结构可能已变化')
  }

  return list
}

function formatText(list) {
  const titleLang = LANGUAGE ? ` / ${LANGUAGE}` : ''
  const lines = list.map((item, i) => {
    const stars = item.starsThisWeek || 'stars this week: N/A'
    const desc = item.desc ? `\n   ${item.desc}` : ''
    return `${i + 1}. ${item.fullName}  [${item.language}]\n   ${stars}\n   ${item.url}${desc}`
  })

  return `🚀 GitHub 本周冲榜 Top ${list.length}${titleLang}\n\n${lines.join('\n\n')}`
}

async function sendFeishu(text) {
  const res = await fetch(WEBHOOK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      msg_type: 'text',
      content: { text },
    }),
  })

  const data = await res.json().catch(() => ({}))
  // 飞书成功一般是 { code: 0, msg: "success" }
  if (!res.ok || (typeof data.code === 'number' && data.code !== 0)) {
    throw new Error(`飞书发送失败: HTTP ${res.status} ${JSON.stringify(data)}`)
  }
}

const list = await fetchTrending()
const text = formatText(list)

if (DRY_RUN) {
  console.log(text)
  console.log(`\n[dry-run] 已解析 ${list.length} 条，未发送飞书`)
} else {
  await sendFeishu(text)
  console.log(`已推送 ${list.length} 条到飞书`)
}

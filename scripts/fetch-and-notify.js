const WEBHOOK = process.env.FEISHU_WEBHOOK_URL
const DRY_RUN = process.env.DRY_RUN === '1' || process.argv.includes('--dry-run')
const TOP_N = Number(process.env.TOP_N || 10)
const LANGUAGE = (process.env.LANGUAGE || '').trim()
const TRANSLATE = process.env.TRANSLATE !== '0' // 默认开启；TRANSLATE=0 可关闭
const TRENDING_URL = LANGUAGE
  ? `https://github.com/trending/${encodeURIComponent(LANGUAGE)}?since=weekly`
  : 'https://github.com/trending?since=weekly'

if (!DRY_RUN && !WEBHOOK) {
  console.error('缺少 FEISHU_WEBHOOK_URL（本地可先 npm run dry-run 验证抓取）')
  process.exit(1)
}

function decodeHtml(text) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
}

function stripTags(html) {
  return decodeHtml(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
}

function hasChinese(text) {
  return /[\u4e00-\u9fff]/.test(text)
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 免费翻译（MyMemory），失败时回退原文 */
async function translateToZh(text) {
  const source = (text || '').trim()
  if (!source) return ''
  if (hasChinese(source)) return source

  const url =
    'https://api.mymemory.translated.net/get?' +
    new URLSearchParams({
      q: source.slice(0, 450), // 接口有长度限制
      langpair: 'en|zh-CN',
    })

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'github-weekly-trending/1.0' },
    })
    if (!res.ok) return source
    const data = await res.json()
    const translated = data?.responseData?.translatedText?.trim()
    if (!translated || /MYMEMORY WARNING/i.test(translated)) return source
    return translated
  } catch {
    return source
  }
}

function formatStarsZh(starsThisWeek) {
  const match = (starsThisWeek || '').match(/([\d,]+)/)
  if (!match) return '本周涨星：暂无'
  return `本周新增 ${match[1]} ⭐`
}

function parseTrending(html) {
  const articles = html.match(/<article class="Box-row"[\s\S]*?<\/article>/g) || []
  const list = []

  for (const article of articles) {
    if (list.length >= TOP_N) break

    const hrefMatch = article.match(
      /<h2[^>]*>[\s\S]*?<a[^>]*href="(\/[^"]+)"[^>]*>/
    )
    if (!hrefMatch) continue

    const href = hrefMatch[1].trim()
    const fullName = href.replace(/^\//, '')
    if (!fullName || !fullName.includes('/')) continue

    const descMatch = article.match(/<p(?:\s[^>]*)?>([\s\S]*?)<\/p>/)
    let desc = descMatch ? stripTags(descMatch[1]) : ''
    desc = desc
      .replace(/^Sponsor\s+/i, '')
      .replace(/^Star\s+[\w.-]+\s*\/\s*[\w.-]+\s+/i, '')
      .trim()

    const langMatch = article.match(
      /itemprop="programmingLanguage"[^>]*>([^<]+)</
    )
    const language = langMatch ? stripTags(langMatch[1]) : '未知'

    const starsMatch = article.match(
      /float-sm-right[\s\S]*?<\/svg>([\s\S]*?)(?:<\/span>|<\/div>)/
    )
    let starsThisWeek = starsMatch ? stripTags(starsMatch[1]) : ''
    if (!starsThisWeek.includes('star')) {
      const fallback = article.match(/([\d,]+)\s+stars this week/i)
      starsThisWeek = fallback ? fallback[0] : ''
    }

    list.push({
      fullName,
      url: `https://github.com/${fullName}`,
      desc,
      language,
      starsThisWeek,
    })
  }

  return list
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

  const list = parseTrending(await res.text())
  if (!list.length) {
    throw new Error('未解析到榜单，GitHub 页面结构可能已变化')
  }
  return list
}

async function enrichWithTranslation(list) {
  if (!TRANSLATE) return list

  const result = []
  for (const item of list) {
    const descZh = item.desc ? await translateToZh(item.desc) : ''
    result.push({ ...item, descZh })
    // 轻微免费接口限流
    await sleep(200)
  }
  return result
}

function formatText(list) {
  const titleLang = LANGUAGE ? ` / ${LANGUAGE}` : ''
  const lines = list.map((item, i) => {
    const stars = formatStarsZh(item.starsThisWeek)
    const descZh = (item.descZh || item.desc || '').trim()
    const descLine = descZh ? `\n   ${descZh}` : ''
    return `${i + 1}. ${item.fullName}  [${item.language}]\n   ${stars}\n   ${item.url}${descLine}`
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
  if (!res.ok || (typeof data.code === 'number' && data.code !== 0)) {
    throw new Error(`飞书发送失败: HTTP ${res.status} ${JSON.stringify(data)}`)
  }
}

const list = await enrichWithTranslation(await fetchTrending())
const text = formatText(list)

if (DRY_RUN) {
  console.log(text)
  console.log(`\n[dry-run] 已解析 ${list.length} 条，未发送飞书`)
} else {
  await sendFeishu(text)
  console.log(`已推送 ${list.length} 条到飞书`)
}

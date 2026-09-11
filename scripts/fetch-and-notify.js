const WEBHOOK = process.env.FEISHU_WEBHOOK_URL
const DRY_RUN = process.env.DRY_RUN === '1' || process.argv.includes('--dry-run')
const TOP_N = Number(process.env.TOP_N || 10)
const LANGUAGE = (process.env.LANGUAGE || '').trim()
const TRANSLATE = process.env.TRANSLATE !== '0'
const LLM_API_KEY = (process.env.LLM_API_KEY || '').trim()
const LLM_BASE_URL = (process.env.LLM_BASE_URL || 'https://api.deepseek.com/v1').replace(
  /\/$/,
  ''
)
const LLM_MODEL = process.env.LLM_MODEL || 'deepseek-chat'
// 有 API Key 时默认开启分析；ANALYZE=0 可关闭
const ANALYZE = process.env.ANALYZE === '1' || (process.env.ANALYZE !== '0' && !!LLM_API_KEY)

const TRENDING_URL = LANGUAGE
  ? `https://github.com/trending/${encodeURIComponent(LANGUAGE)}?since=weekly`
  : 'https://github.com/trending?since=weekly'

const FEISHU_TEXT_LIMIT = 3500

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
      q: source.slice(0, 450),
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

/** 拉取 README 前一段，供模型分析 */
async function fetchReadmeSnippet(fullName) {
  const headers = {
    Accept: 'application/vnd.github.raw',
    'User-Agent': 'github-weekly-trending/1.0',
  }
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`
  }

  try {
    const res = await fetch(`https://api.github.com/repos/${fullName}/readme`, {
      headers,
    })
    if (!res.ok) return ''
    const text = await res.text()
    return text.replace(/\r/g, '').slice(0, 1800)
  } catch {
    return ''
  }
}

async function attachReadmeSnippets(list) {
  const result = []
  for (const item of list) {
    const readme = await fetchReadmeSnippet(item.fullName)
    result.push({ ...item, readme })
    await sleep(120)
  }
  return result
}

function extractJson(text) {
  const raw = (text || '').trim()
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced ? fenced[1].trim() : raw
  const start = candidate.indexOf('[')
  const end = candidate.lastIndexOf(']')
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('模型未返回 JSON 数组')
  }
  return JSON.parse(candidate.slice(start, end + 1))
}

async function analyzeWithLlm(list) {
  if (!ANALYZE) {
    console.log('[analyze] 已跳过（未开启或缺少 LLM_API_KEY）')
    return list
  }
  if (!LLM_API_KEY) {
    console.warn('[analyze] 缺少 LLM_API_KEY，跳过优缺点分析')
    return list
  }

  const payload = list.map((item, i) => ({
    rank: i + 1,
    fullName: item.fullName,
    language: item.language,
    description: item.desc || '',
    readme: item.readme || '',
  }))

  const system = `你是资深开源技术分析助手。根据仓库简介和 README 片段，用简体中文输出每个项目的简评。
要求：
1. 只返回 JSON 数组，不要 markdown，不要其它说明
2. 每个元素字段：fullName, summary, scene, pros, cons
3. summary：一句话介绍（≤40字）
4. scene：适用场景（≤40字）
5. pros：优点，用顿号分隔，最多3点（≤50字）
6. cons：局限/缺点，用顿号分隔，最多2点（≤40字）
7. 信息不足时如实写「信息不足」，不要编造`

  const user = `请分析以下 GitHub 周榜项目：\n${JSON.stringify(payload)}`

  const res = await fetch(`${LLM_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${LLM_API_KEY}`,
    },
    body: JSON.stringify({
      model: LLM_MODEL,
      temperature: 0.3,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(
      `LLM 调用失败: HTTP ${res.status} ${JSON.stringify(data).slice(0, 500)}`
    )
  }

  const content = data?.choices?.[0]?.message?.content || ''
  const analyzed = extractJson(content)
  const byName = new Map(
    analyzed.map((row) => [String(row.fullName || '').toLowerCase(), row])
  )

  return list.map((item) => {
    const row = byName.get(item.fullName.toLowerCase())
    if (!row) return item
    return {
      ...item,
      summary: String(row.summary || '').trim(),
      scene: String(row.scene || '').trim(),
      pros: String(row.pros || '').trim(),
      cons: String(row.cons || '').trim(),
    }
  })
}

async function enrichWithTranslation(list) {
  // 已有模型中文 summary 时，不再单独翻译简介
  if (!TRANSLATE) return list

  const result = []
  for (const item of list) {
    if (item.summary) {
      result.push({ ...item, descZh: item.summary })
      continue
    }
    const descZh = item.desc ? await translateToZh(item.desc) : ''
    result.push({ ...item, descZh })
    await sleep(200)
  }
  return result
}

function formatItem(item, index) {
  const stars = formatStarsZh(item.starsThisWeek)
  const descZh = (item.descZh || item.summary || item.desc || '').trim()
  const lines = [
    `${index}. ${item.fullName}  [${item.language}]`,
    `   ${stars}`,
    `   ${item.url}`,
  ]
  if (descZh) lines.push(`   简介：${descZh}`)
  if (item.scene) lines.push(`   场景：${item.scene}`)
  if (item.pros) lines.push(`   优点：${item.pros}`)
  if (item.cons) lines.push(`   缺点：${item.cons}`)
  return lines.join('\n')
}

function formatMessages(list) {
  const titleLang = LANGUAGE ? ` / ${LANGUAGE}` : ''
  const header = `🚀 GitHub 本周冲榜 Top ${list.length}${titleLang}`
  const blocks = list.map((item, i) => formatItem(item, i + 1))

  const messages = []
  let current = header

  for (const block of blocks) {
    const next = `${current}\n\n${block}`
    if (next.length > FEISHU_TEXT_LIMIT && current !== header) {
      messages.push(current)
      current = `${header}（续）\n\n${block}`
    } else {
      current = next
    }
  }
  messages.push(current)
  return messages
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

async function sendAll(messages) {
  for (let i = 0; i < messages.length; i++) {
    await sendFeishu(messages[i])
    if (i < messages.length - 1) await sleep(400)
  }
}

let list = await fetchTrending()
list = await attachReadmeSnippets(list)
list = await analyzeWithLlm(list)
list = await enrichWithTranslation(list)
const messages = formatMessages(list)

if (DRY_RUN) {
  console.log(messages.join('\n\n----------\n\n'))
  console.log(
    `\n[dry-run] 已解析 ${list.length} 条，分析=${ANALYZE && !!LLM_API_KEY ? '开' : '关'}，未发送飞书`
  )
} else {
  await sendAll(messages)
  console.log(`已推送 ${list.length} 条到飞书（${messages.length} 条消息）`)
}

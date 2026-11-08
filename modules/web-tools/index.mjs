// 联网搜索 —— 用户模块（Aurabot 扩展接口 v1）
//
// 给她一个 web_search 工具：遇到事实性问题先查再答。
// 走 Bing 的网页搜索（HTML），不依赖 API key；失败就返回空，让她说查不到。

/** @type {import('../aurabot').AurabotModule} */
export default {
  id: 'web-tools',
  name: '联网搜索',
  version: '1.0.0',
  api: 1,
  description: '给她一个 web_search 工具，遇到问题先上网查再回答',

  setup(api) {
    let lastAt = 0

    function decode(s) {
      return String(s)
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    }

    async function search(query) {
      const q = String(query || '').trim().slice(0, 120)
      if (!q) return []
      const now = Date.now()
      if (now - lastAt < 1500) await new Promise((r) => setTimeout(r, 1500 - (now - lastAt)))
      lastAt = Date.now()
      const url = 'https://www.bing.com/search?q=' + encodeURIComponent(q) + '&setlang=zh-Hans&count=8'
      const r = await fetch(url, {
        headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        signal: AbortSignal.timeout(15000),
      })
      if (!r.ok) throw new Error('搜索返回 ' + r.status)
      const html = await r.text()
      const out = []
      const blocks = html.split('class="b_algo"').slice(1, 6)
      for (const b of blocks) {
        const t = b.match(/<h2[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/)
        const p = b.match(/<p[^>]*>([\s\S]*?)<\/p>/)
        if (!t) continue
        out.push({ title: decode(t[2]), url: t[1], snippet: p ? decode(p[1]).slice(0, 160) : '' })
      }
      return out
    }

    api.tool((where) => api.defineTool({
      name: 'web_search',
      description: '上网搜索。遇到需要事实、新闻、价格、天气、人物、攻略这类问题时，先用它查一下再回答；不要凭记忆编。',
      properties: { query: { type: 'string', description: '搜索关键词，越具体越好' } },
      required: ['query'],
      execute: async ({ query }) => {
        try {
          const list = await search(query)
          if (!list.length) return { ok: true, message: '没搜到结果，直接说不知道就行' }
          const text = list.map((x, i) => `${i + 1}. ${x.title}\n${x.snippet}\n${x.url}`).join('\n')
          return { ok: true, message: text }
        } catch (error) {
          return { ok: false, message: '搜索失败：' + String(error.message || error).slice(0, 100) }
        }
      },
    }))

    api.route('/search', async (req) => {
      const q = String(api.core.http.query(req).q || '')
      try { return { ok: true, query: q, list: await search(q) } } catch (error) { return { ok: false, message: String(error.message || error) } }
    })

    api.command({
      name: '搜',
      desc: '让她搜一下：/搜 关键词',
      run: async (arg) => {
        const list = await search(arg)
        return list.length ? list.map((x, i) => `${i + 1}. ${x.title} — ${x.snippet}`).join('\n') : '没搜到'
      },
    })

    api.log.info('联网搜索已挂上（web_search 工具）')
    return { search }
  },
}

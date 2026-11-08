// 低 token 看视频 —— 用户模块（Aurabot 扩展接口 v1）
//
// B站：优先读字幕；没字幕就下载音频、本地 faster-whisper 转文字，再让模型压成一段短摘要。
// 抖音：交给已有的「刷抖音」专用浏览器（需要先在面板扫码登录），只取页面上的标题/摘要/热评。
//
// 省钱的关键：整段字幕/转写只留在本地，进上下文的只有一段 ≤350 字的摘要；
// 同一条视频有缓存，重复看不再花 token。

import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { promisify } from 'node:util'

const run = promisify(execFile)
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', Referer: 'https://www.bilibili.com/' }

function clip(text, n) {
  const s = String(text || '').replace(/\s+/g, ' ').trim()
  return s.length > n ? s.slice(0, n) + '…' : s
}

function durationText(sec) {
  const s = Math.max(0, Number(sec) || 0)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = Math.floor(s % 60)
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${m}:${String(ss).padStart(2, '0')}`
}

/** @type {import('../aurabot').AurabotModule} */
export default {
  id: 'video-watch',
  name: '看视频',
  version: '1.0.0',
  api: 1,
  description: '低 token 看 B站/抖音视频：字幕优先，没字幕本地 ASR 转写，只把短摘要交给模型',

  defaults: {
    enabled: true,
    mode: 'auto', // fast=只看字幕/页面；auto=字幕优先、没字幕再 ASR；full=总是 ASR
    maxAudioMinutes: 8,
    maxTranscriptChars: 3000,
    maxSummaryChars: 350,
    maxComments: 3,
    maxPerHour: 3,
    asrModel: 'small',
    asrLang: 'zh',
    cacheDays: 7,
    pythonPath: 'python',
    ffmpegPath: 'ffmpeg',
  },

  settings: [
    { key: 'enabled', label: '开启看视频', type: 'switch' },
    { key: 'mode', label: '默认模式', type: 'select', options: [
      { value: 'fast', label: '快：只看字幕/页面，不转写' },
      { value: 'auto', label: '自动：字幕优先，没字幕再本地转写' },
      { value: 'full', label: '完整：总是听音频转写' },
    ] },
    { key: 'maxAudioMinutes', label: '最多听几分钟音频', type: 'number', min: 1, max: 30, step: 1 },
    { key: 'maxTranscriptChars', label: '摘要时最多读多少字转写', type: 'number', min: 500, max: 8000, step: 100 },
    { key: 'maxSummaryChars', label: '摘要最长字数', type: 'number', min: 120, max: 800, step: 20 },
    { key: 'maxComments', label: '带几条热评', type: 'number', min: 0, max: 8, step: 1 },
    { key: 'maxPerHour', label: '每小时最多看几个新视频', type: 'number', min: 1, max: 20, step: 1 },
    { key: 'asrModel', label: '本地 ASR 模型', type: 'select', options: ['tiny', 'base', 'small', 'medium'] },
    { key: 'asrLang', label: 'ASR 语言', type: 'select', options: [
      { value: 'zh', label: '中文（默认）' },
      { value: 'en', label: '英文' },
      { value: 'ja', label: '日文' },
      { value: 'auto', label: '自动检测' },
    ] },
    { key: 'cacheDays', label: '缓存几天', type: 'number', min: 1, max: 60, step: 1 },
    { key: 'pythonPath', label: '带 faster-whisper 的 Python', type: 'text' },
    { key: 'ffmpegPath', label: 'ffmpeg 路径', type: 'text' },
  ],

  setup(api) {
    const dir = api.dataDir()
    mkdirSync(dir, { recursive: true })
    const cacheDir = join(dir, 'cache')
    const tmpDir = join(dir, 'tmp')
    mkdirSync(cacheDir, { recursive: true })
    mkdirSync(tmpDir, { recursive: true })

    const cacheFile = (bvid) => join(cacheDir, String(bvid) + '.json')
    const stateFile = () => join(dir, 'state.json')
    let state = { version: 1, hour: '', count: 0 }
    try { state = { ...state, ...(JSON.parse(readFileSync(stateFile(), 'utf8')) || {}) } } catch (error) {}
    const saveState = () => {
      try { writeFileSync(stateFile(), JSON.stringify(state)) } catch (error) {}
    }
    const hourKey = () => `${new Date().getFullYear()}-${new Date().getMonth() + 1}-${new Date().getDate()}-${new Date().getHours()}`

    async function fetchJson(url, extra = {}) {
      const r = await fetch(url, { headers: { ...UA, ...extra }, signal: AbortSignal.timeout(15000) })
      if (!r.ok) throw new Error('HTTP ' + r.status)
      const j = await r.json()
      if (j && j.code !== 0) throw new Error(j.message || ('B站错误 ' + j.code))
      return j.data
    }

    async function resolveBvid(link) {
      const s = String(link || '').trim()
      const hit = s.match(/BV[0-9A-Za-z]{10,12}/)
      if (hit) return hit[0]
      if (!/b23\.tv|bilibili\.com/i.test(s)) return ''
      const r = await fetch(s, { headers: UA, redirect: 'follow', signal: AbortSignal.timeout(15000) })
      const m = String(r.url || '').match(/BV[0-9A-Za-z]{10,12}/)
      return m ? m[0] : ''
    }

    async function subtitlesOf(aid, cid, bvid) {
      try {
        const data = await fetchJson(`https://api.bilibili.com/x/player/v2?aid=${aid}&cid=${cid}`, { Referer: `https://www.bilibili.com/video/${bvid}` })
        const subs = (data && data.subtitle && data.subtitle.subtitles) || []
        if (!subs.length) return ''
        const url = String(subs[0].subtitle_url || '')
        if (!url) return ''
        const full = url.startsWith('//') ? 'https:' + url : url
        const sub = await fetchJson(full, { Referer: `https://www.bilibili.com/video/${bvid}` })
        return (sub.body || []).map((x) => String(x.content || '')).join('').trim()
      } catch (error) {
        api.log.debug('读字幕失败：' + error.message)
        return ''
      }
    }

    async function commentsOf(aid, limit) {
      if (!limit) return []
      try {
        const data = await fetchJson(`https://api.bilibili.com/x/v2/reply?type=1&oid=${aid}&sort=2&ps=${limit}`, { Referer: 'https://www.bilibili.com/' })
        return (data.replies || []).slice(0, limit).map((x) => ({ name: x?.member?.uname || '?', text: clip(x?.content?.message, 80) }))
      } catch (error) {
        return []
      }
    }

    async function audioUrlOf(view) {
      const data = await fetchJson(`https://api.bilibili.com/x/player/playurl?bvid=${view.bvid}&cid=${view.cid}&fnval=16&qn=16`, { Referer: `https://www.bilibili.com/video/${view.bvid}` })
      const audio = (data.dash && data.dash.audio) || []
      if (audio.length) {
        audio.sort((a, b) => (Number(a.bandwidth) || 0) - (Number(b.bandwidth) || 0))
        return String(audio[0].baseUrl || audio[0].base_url || '')
      }
      if (data.durl && data.durl[0]) return String(data.durl[0].url || '')
      return ''
    }

    async function download(url, dest) {
      const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(60000) })
      if (!r.ok) throw new Error('下载音频 HTTP ' + r.status)
      const buf = Buffer.from(await r.arrayBuffer())
      if (!buf.length) throw new Error('音频是空的')
      writeFileSync(dest, buf)
    }

    async function transcribeAudio(view, maxMinutes) {
      const tmp = join(tmpDir, randomUUID())
      mkdirSync(tmp, { recursive: true })
      try {
        const audioUrl = await audioUrlOf(view)
        if (!audioUrl) throw new Error('拿不到音频流')
        const src = join(tmp, 'audio.m4s')
        const wav = join(tmp, 'audio.wav')
        await download(audioUrl, src)
        await run(api.settings().ffmpegPath, ['-y', '-i', src, '-t', String(Math.max(1, maxMinutes) * 60), '-ar', '16000', '-ac', '1', wav], { timeout: 120000, windowsHide: true })
        const { stdout } = await run(api.settings().pythonPath, [join(api.dir, 'asr.py'), wav, String(api.settings().asrModel || 'small'), String(api.settings().asrLang || 'zh')], {
          timeout: 600000,
          maxBuffer: 20 * 1024 * 1024,
          windowsHide: true,
          env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
        })
        return String(stdout || '').replace(/\s+/g, ' ').trim()
      } finally {
        try { rmSync(tmp, { recursive: true, force: true }) } catch (error) {}
      }
    }

    async function summarize(title, desc, transcript, maxChars) {
      const cfg = api.settings()
      const text = `标题：${title}\n简介：${clip(desc, 200)}\n字幕/转写：${clip(transcript, Math.max(500, Number(cfg.maxTranscriptChars) || 3000))}`
      try {
        const out = await api.ask({
          system: `你是「大肥鱼」。用第一人称、口语，概括这个视频讲了什么，只写你真正听到或看到的内容，不编、不分析、不写列表，不超过 ${Math.max(120, maxChars)} 个字。`,
          text,
          maxTokens: 600,
        })
        return clip(out, maxChars)
      } catch (error) {
        api.log.warn('视频摘要失败：' + error.message)
        return clip(transcript, maxChars)
      }
    }

    function digestOf(meta, summary, comments, source, truncated) {
      const lines = [
        `《${meta.title}》`,
        `UP主：${meta.author || '?'}  时长：${durationText(meta.duration)}  播放：${meta.play || 0}${meta.tname ? '  分区：' + meta.tname : ''}`,
        meta.desc ? `简介：${clip(meta.desc, 120)}` : '',
        summary ? `内容：${summary}` : '内容：（只看到标题和简介，没有字幕或音频内容）',
        truncated ? `（只听了前 ${api.settings().maxAudioMinutes} 分钟）` : '',
        comments.length ? '热评：' + comments.map((c) => `${c.name}：${c.text}`).join('；') : '',
        `来源：${source}`,
      ].filter(Boolean)
      return lines.join('\n')
    }

    function cached(bvid) {
      try {
        const f = cacheFile(bvid)
        if (!existsSync(f)) return null
        const row = JSON.parse(readFileSync(f, 'utf8'))
        const days = Math.max(1, Number(api.settings().cacheDays) || 7)
        if (Date.now() - (Number(row.at) || 0) > days * 86400_000) return null
        if (!row.digest) return null
        return row
      } catch (error) { return null }
    }

    function remember(meta, bvid, summary, digest) {
      try {
        api.use('memory')?.addEvent?.({ text: `看了B站视频《${meta.title}》${summary ? '：' + clip(summary, 120) : ''}`, tags: ['看视频', 'B站'], importance: 0.45 })
      } catch (error) {}
      try {
        api.emit('memory-archive/ingest', { channel: 'video', kind: 'out', chatId: 'video:' + bvid, nickname: '她', at: Date.now(), text: digest })
      } catch (error) {}
    }

    async function watchBili(link, mode) {
      const bvid = await resolveBvid(link)
      if (!bvid) return { ok: false, message: '没认出 B 站视频链接（支持 BV 号、b23.tv 短链、完整视频链接）' }
      const hit = cached(bvid)
      if (hit) return { ok: true, message: hit.digest, bvid, title: hit.title, cached: true, source: 'cache' }

      const hour = hourKey()
      if (state.hour !== hour) { state.hour = hour; state.count = 0 }
      const max = Math.max(1, Number(api.settings().maxPerHour) || 3)
      if (state.count >= max) return { ok: false, message: `这小时已经看了 ${state.count} 个新视频，先歇会儿，等下一个小时再看。` }

      let view = null
      try {
        view = await fetchJson(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`, { Referer: `https://www.bilibili.com/video/${bvid}` })
      } catch (error) {
        return { ok: false, message: '打不开这个 B 站视频：' + error.message }
      }
      const cid = (view.pages && view.pages[0] && view.pages[0].cid) || view.cid
      const meta = {
        bvid,
        aid: view.aid,
        cid,
        title: String(view.title || ''),
        author: view.owner?.name || '',
        duration: Number(view.duration) || 0,
        desc: String(view.desc || ''),
        play: Number(view.stat?.view) || 0,
        tname: view.tname || '',
      }
      const modeUse = String(mode || api.settings().mode || 'auto')
      let transcript = ''
      let source = 'metadata'
      let truncated = false
      const subtitle = await subtitlesOf(meta.aid, meta.cid, bvid)
      if (subtitle && modeUse !== 'full') {
        transcript = subtitle
        source = 'subtitle'
      }
      if ((!transcript || modeUse === 'full') && modeUse !== 'fast') {
        try {
          const maxMinutes = Math.max(1, Number(api.settings().maxAudioMinutes) || 8)
          truncated = meta.duration > maxMinutes * 60
          transcript = await transcribeAudio(meta, maxMinutes)
          source = 'asr'
        } catch (error) {
          api.log.warn('本地转写失败：' + error.message)
        }
      }
      const comments = await commentsOf(meta.aid, Number(api.settings().maxComments) || 3)
      const maxChars = Math.max(120, Number(api.settings().maxSummaryChars) || 350)
      const summary = transcript ? await summarize(meta.title, meta.desc, transcript, maxChars) : ''
      const digest = digestOf(meta, summary, comments, source, truncated)
      try {
        writeFileSync(cacheFile(bvid), JSON.stringify({ at: Date.now(), bvid, title: meta.title, summary, digest, transcript: clip(transcript, 12000), source }))
      } catch (error) { api.log.warn('写视频缓存失败：' + error.message) }
      state.count++
      saveState()
      remember(meta, bvid, summary, digest)
      return { ok: true, message: digest, bvid, title: meta.title, summary, cached: false, source }
    }

    async function watch(link, opts = {}) {
      const s = String(link || '').trim()
      if (!s) return { ok: false, message: '要给我一个视频链接' }
      if (!api.settings().enabled) return { ok: false, message: '看视频功能没开' }
      if (/douyin\.com|iesdouyin/i.test(s)) {
        const dy = api.use('douyin')
        if (!dy || typeof dy.watch !== 'function') {
          return { ok: false, message: '抖音模块没开。要在面板「刷抖音」打开，并在专用浏览器里扫码登录，之后我才能看抖音。' }
        }
        try {
          const r = await dy.watch(s)
          if (r && r.ok) return { ok: true, message: r.message, title: r.title || '', source: 'douyin' }
          return { ok: false, message: (r && r.message) || '抖音视频没打开' }
        } catch (error) {
          return { ok: false, message: '抖音视频没打开：' + error.message }
        }
      }
      if (!/bilibili\.com|b23\.tv|BV[0-9A-Za-z]{10,12}/i.test(s)) {
        return { ok: false, message: '目前支持 B站 / 抖音链接；别的平台还没接。' }
      }
      return watchBili(s, opts.mode)
    }

    api.tool((where) => {
      if (!api.settings().enabled || !where.chat || where.chat.kind === 'system') return []
      return api.defineTool({
        name: 'watch_video',
        description: '低 token 看一个视频：B站优先读字幕，没字幕就本地转写再摘要；抖音走专用浏览器。别人发来 B站/抖音链接时用。不要抽帧，也不要把整段字幕塞进聊天。',
        properties: {
          link: { type: 'string', description: 'B站链接/BV号/b23短链，或抖音链接' },
          mode: { type: 'string', description: '可选：fast（只看字幕/页面）、auto（默认）、full（总是听音频）' },
        },
        required: ['link'],
        execute: async ({ link, mode }) => watch(String(link || ''), { mode: String(mode || '') }),
      })
    })

    api.command({
      name: '看视频',
      desc: '低 token 看一个 B站/抖音视频：/看视频 链接',
      run: async (arg) => {
        const r = await watch(String(arg || '').trim())
        return r.message || '没看成'
      },
    })

    api.route('/watch', async (req) => {
      const q = api.core.http.query(req)
      return watch(String(q.url || q.link || ''), { mode: String(q.mode || '') })
    })
    api.route('/state', async () => ({
      ok: true,
      settings: api.settings(),
      hour: state.hour,
      count: state.count,
      cached: (() => { try { return readdirSync(cacheDir).length } catch (error) { return 0 } })(),
    }))

    api.rule(() => '别人发来 B站/抖音视频链接时，用 watch_video 低 token 看：优先字幕，没字幕再本地转写；看完只说重点，不要抽帧，也不要把整段字幕念出来。')

    api.log.info('看视频模块已挂上（B站字幕/ASR + 抖音浏览器；摘要 ≤' + (Number(api.settings().maxSummaryChars) || 350) + ' 字）')
    return { watch }
  },
}

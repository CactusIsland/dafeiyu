// 宠物截图 —— 用户模块（Aurabot 扩展接口 v1）
//
// 从现有 pet 动画包（default-animation 的 106 段 WebM）里抽一帧，存成 PNG，
// 再通过 api.sendImage 发到当前聊天 / 群。
// 不截图桌面窗口，直接取动画帧：稳定、可指定动作、不依赖桌宠是否在跑。

import { execFile } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

function hourKey() {
  const d = new Date()
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}-${d.getHours()}`
}

/** @type {import('../aurabot').AurabotModule} */
export default {
  id: 'pet-shot',
  name: '宠物截图',
  version: '1.0.0',
  api: 1,
  description: '从大肥鱼桌宠动画里抽一帧发到群里；/宠物截图 [动作名或 anim-编号]',

  defaults: {
    enabled: true,
    defaultAnim: '待机呼吸休闲',
    atSec: 0.6,
    width: 512,
    maxPerHour: 6,
    gifWidth: 320,
    gifFps: 12,
    gifSeconds: 5,
    gifBg: 'F2F8FF',
    gifKeyBlack: true,
    maxGifPerHour: 3,
    ffmpegPath: 'ffmpeg',
  },

  settings: [
    { key: 'enabled', label: '开启宠物截图', type: 'switch' },
    { key: 'defaultAnim', label: '默认动作', type: 'text', hint: '填动作名，比如「待机呼吸休闲」「吃白饭」「写代码」' },
    { key: 'atSec', label: '抽第几秒的帧', type: 'number', min: 0, max: 5, step: 0.1 },
    { key: 'width', label: '图片宽度', type: 'number', min: 128, max: 1024, step: 32 },
    { key: 'maxPerHour', label: '每小时最多发几张', type: 'number', min: 1, max: 30, step: 1 },
    { key: 'gifWidth', label: 'GIF 宽度', type: 'number', min: 128, max: 512, step: 32 },
    { key: 'gifFps', label: 'GIF 帧率', type: 'number', min: 6, max: 20, step: 1 },
    { key: 'gifSeconds', label: 'GIF 最长几秒', type: 'number', min: 1, max: 10, step: 1 },
    { key: 'gifBg', label: '截图/动图背景色', type: 'text', hint: '十六进制，不带 #；默认 F2F8FF 浅蓝白。填 FFFFFF 就是纯白' },
    { key: 'gifKeyBlack', label: '把黑底抠掉', type: 'switch', hint: '动画素材是黑底；打开后用 colorkey 抠黑再合成背景（截图和 GIF 都生效）' },
    { key: 'maxGifPerHour', label: '每小时最多发几个 GIF', type: 'number', min: 1, max: 12, step: 1 },
    { key: 'ffmpegPath', label: 'ffmpeg 路径', type: 'text' },
  ],

  setup(api) {
    const dir = api.dataDir()
    mkdirSync(dir, { recursive: true })
    const shotsDir = join(dir, 'shots')
    mkdirSync(shotsDir, { recursive: true })
    const packDir = join(dir, '..', 'pet', 'packs', 'default-animation')
    const manifestFile = join(dir, '..', 'pet', 'packs', 'default-manifest.json')
    const configFile = join(dir, '..', 'pet', 'packs', 'default-config.json')
    const stateFile = join(dir, 'state.json')

    let state = { version: 1, hour: '', count: 0, gifHour: '', gifCount: 0 }
    try { state = { ...state, ...(JSON.parse(readFileSync(stateFile(), 'utf8')) || {}) } } catch (error) {}
    const save = () => {
      try { writeFileSync(stateFile(), JSON.stringify(state)) } catch (error) {}
    }

    const readJson = (file, fallback) => {
      try { return JSON.parse(readFileSync(file, 'utf8')) || fallback } catch (error) { return fallback }
    }
    const manifest = () => readJson(manifestFile, {})
    const config = () => readJson(configFile, {})

    function names() {
      const m = manifest()
      return Object.keys(m)
    }

    function resolveAnim(input) {
      const arg = String(input || '').trim()
      const m = manifest()
      if (/^anim-\d{3}$/i.test(arg) && existsSync(join(packDir, arg.toLowerCase() + '.webm'))) return arg.toLowerCase()
      if (m[arg]) return m[arg]
      const def = String(api.settings().defaultAnim || '待机呼吸休闲').trim()
      if (m[def]) return m[def]
      // 没配到就退回第一个待机动作
      const idle = (config().animations?.idle || [])[0]
      if (idle) return idle
      return 'anim-058'
    }

    async function extract(anim, atSec) {
      const src = join(packDir, anim + '.webm')
      if (!existsSync(src)) throw new Error('这个动作没有素材：' + anim)
      const at = Math.max(0, Number(atSec) || 0.6)
      const width = Math.max(128, Math.min(1024, Number(api.settings().width) || 512))
      const size = await probeSize(anim, width)
      const bg = (String(api.settings().gifBg || 'F2F8FF').replace(/[^0-9a-f]/gi, '').slice(0, 6) || 'F2F8FF').toUpperCase()
      const key = api.settings().gifKeyBlack === false ? '' : 'colorkey=0x000000:similarity=0.10:blend=0.05,'
      const out = join(shotsDir, `${anim}-${Date.now()}.png`)
      const color = `color=c=0x${bg}:s=${size.width}x${size.height}:r=30:d=1`
      const filter = `[0:v]scale=${width}:-1:flags=lanczos,${key}format=rgba[fg];[1:v][fg]overlay=shortest=1,format=rgb24`
      try {
        await run(api.settings().ffmpegPath, ['-y', '-ss', String(at), '-i', src, '-f', 'lavfi', '-i', color, '-filter_complex', filter, '-frames:v', '1', out], { timeout: 60000, windowsHide: true })
      } catch (error) {
        const retry = ['-y', '-ss', String(at), '-i', src, '-frames:v', '1', '-vf', `scale=${width}:-1:flags=lanczos`, '-pix_fmt', 'rgba', out]
        await run(api.settings().ffmpegPath, retry, { timeout: 60000, windowsHide: true })
      }
      if (!existsSync(out)) throw new Error('抽帧失败：' + anim)
      return out
    }

    async function sendShot(chatId, input, atSec) {
      if (!api.settings().enabled) return { ok: false, message: '宠物截图没开' }
      const chat = String(chatId || '')
      if (!chat) return { ok: false, message: '没有聊天 id' }
      const hour = hourKey()
      if (state.hour !== hour) { state.hour = hour; state.count = 0 }
      const max = Math.max(1, Number(api.settings().maxPerHour) || 6)
      if (state.count >= max) return { ok: false, message: `这小时已经发了 ${state.count} 张，先歇会儿。` }

      let png = ''
      try {
        const anim = resolveAnim(input)
        png = await extract(anim, atSec)
        // 优先直接发；有些发送路径要求文件在 QQ 工作区，失败就复制过去再试
        try {
          await api.sendImage(chat, png)
        } catch (error) {
          const workspace = String(api.config().workspaceDir || 'D:\\<项目路径>\\Aurabot\\qq-chats')
          mkdirSync(workspace, { recursive: true })
          const temp = join(workspace, `pet-shot-${Date.now()}.png`)
          copyFileSync(png, temp)
          try { await api.sendImage(chat, temp) } finally { try { rmSync(temp, { force: true }) } catch (e) {} }
        }
        state.count++
        save()
        api.log.info(`宠物截图已发到 ${chat}：${png}`)
        return { ok: true, message: `发了 ${input || api.settings().defaultAnim || '待机'} 的截图`, file: png }
      } catch (error) {
        return { ok: false, message: '截图没发出去：' + error.message, file: png }
      }
    }

    async function probeSize(anim, width) {
      const src = join(packDir, anim + '.webm')
      const probe = join(shotsDir, `probe-${Date.now()}.png`)
      try {
        await run(api.settings().ffmpegPath, ['-y', '-i', src, '-ss', '0.1', '-vframes', '1', '-vf', `scale=${width}:-1:flags=lanczos`, '-pix_fmt', 'rgba', probe], { timeout: 60000, windowsHide: true })
        const b = readFileSync(probe)
        const w = b.readUInt32BE(16)
        const h = b.readUInt32BE(20)
        if (w > 0 && h > 0) return { width: w, height: h }
      } catch (error) {
        // 探不到就按 16:9 兜底
      } finally {
        try { rmSync(probe, { force: true }) } catch (e) {}
      }
      return { width, height: Math.round(width * 9 / 16) }
    }

    async function extractGif(anim, opts = {}) {
      const src = join(packDir, anim + '.webm')
      if (!existsSync(src)) throw new Error('这个动作没有素材：' + anim)
      const width = Math.max(128, Math.min(512, Number(opts.width) || Number(api.settings().gifWidth) || 320))
      const fps = Math.max(6, Math.min(20, Number(opts.fps) || Number(api.settings().gifFps) || 12))
      const seconds = Math.max(1, Math.min(10, Number(opts.seconds) || Number(api.settings().gifSeconds) || 5))
      const size = await probeSize(anim, width)
      const bg = (String(api.settings().gifBg || 'F2F8FF').replace(/[^0-9a-f]/gi, '').slice(0, 6) || 'F2F8FF').toUpperCase()
      const out = join(shotsDir, `${anim}-${Date.now()}.gif`)
      // 先把透明 WebM 合成到纯色背景上，再转 GIF；否则 QQ 会把透明区域显示成黑底
      const color = `color=c=0x${bg}:s=${size.width}x${size.height}:r=${fps}:d=${seconds}`
      // 动画素材本身是黑底（yuv420p，不是透明通道）：先 colorkey 抠黑，再合成浅色背景
      const key = api.settings().gifKeyBlack === false ? '' : 'colorkey=0x000000:similarity=0.10:blend=0.05,'
      const filter = `[0:v]scale=${width}:-1:flags=lanczos,${key}format=rgba[fg];[1:v][fg]overlay=shortest=1,format=rgb24,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer`
      const args = ['-y', '-i', src, '-f', 'lavfi', '-i', color, '-filter_complex', filter, '-t', String(seconds), '-loop', '0', out]
      try {
        await run(api.settings().ffmpegPath, args, { timeout: 120000, windowsHide: true })
      } catch (error) {
        const fallback = `[0:v]scale=${width}:-1:flags=lanczos,${key}format=rgba[fg];[1:v][fg]overlay=shortest=1,format=rgb24,split[s0][s1];[s0]palettegen=max_colors=64[p];[s1][p]paletteuse=dither=bayer`
        await run(api.settings().ffmpegPath, ['-y', '-i', src, '-f', 'lavfi', '-i', color, '-filter_complex', fallback, '-t', String(seconds), '-loop', '0', out], { timeout: 120000, windowsHide: true })
      }
      if (!existsSync(out)) throw new Error('GIF 转换失败：' + anim)
      return out
    }

    async function sendGif(chatId, input, opts = {}) {
      if (!api.settings().enabled) return { ok: false, message: '宠物截图没开' }
      const chat = String(chatId || '')
      if (!chat) return { ok: false, message: '没有聊天 id' }
      const hour = hourKey()
      if (state.gifHour !== hour) { state.gifHour = hour; state.gifCount = 0 }
      const max = Math.max(1, Number(api.settings().maxGifPerHour) || 3)
      if (state.gifCount >= max) return { ok: false, message: `这小时已经发了 ${state.gifCount} 个 GIF，先歇会儿。` }

      let gif = ''
      try {
        const anim = resolveAnim(input)
        gif = await extractGif(anim, opts)
        try {
          await api.sendImage(chat, gif)
        } catch (error) {
          const workspace = String(api.config().workspaceDir || 'D:\\<项目路径>\\Aurabot\\qq-chats')
          mkdirSync(workspace, { recursive: true })
          const temp = join(workspace, `pet-gif-${Date.now()}.gif`)
          copyFileSync(gif, temp)
          try { await api.sendImage(chat, temp) } finally { try { rmSync(temp, { force: true }) } catch (e) {} }
        }
        state.gifCount++
        save()
        api.log.info(`宠物 GIF 已发到 ${chat}：${gif}`)
        return { ok: true, message: `发了 ${input || api.settings().defaultAnim || '待机'} 的动图`, file: gif }
      } catch (error) {
        return { ok: false, message: 'GIF 没发出去：' + error.message, file: gif }
      }
    }

    api.command({
      name: '宠物截图',
      desc: '发一张大肥鱼桌宠动画截图到当前聊天；/宠物截图 吃白饭，或 /宠物截图 anim-035',
      run: async (arg, msg) => {
        const a = String(arg || '').trim()
        if (/^(列表|list)$/i.test(a)) {
          const list = names()
          return '可用动作（示例）：' + list.filter((x) => ['待机呼吸休闲', '吃白饭', '写代码', '可爱宅舞', '鲸鱼吐泡泡特效', '工作状态-雀跃庆祝', '点击回应-元气挥手'].includes(x)).join('、') + `；共 ${list.length} 个，也可以填 anim-035`
        }
        const r = await sendShot(msg?.chatId, a)
        return r.message
      },
    })

    api.command({
      name: '宠物动图',
      desc: '发一个大肥鱼桌宠 GIF 到当前聊天；/宠物动图 可爱宅舞，或 /宠物动图 anim-026',
      run: async (arg, msg) => {
        const a = String(arg || '').trim()
        if (/^(列表|list)$/i.test(a)) {
          const list = names()
          return '可用动作（示例）：' + list.filter((x) => ['待机呼吸休闲', '吃白饭', '写代码', '可爱宅舞', '鲸鱼吐泡泡特效', '工作状态-雀跃庆祝', '点击回应-元气挥手'].includes(x)).join('、') + `；共 ${list.length} 个，也可以填 anim-026`
        }
        const r = await sendGif(msg?.chatId, a)
        return r.message
      },
    })

    api.route('/shot', async (req) => {
      const q = api.core.http.query(req)
      const chat = String(q.chat || `private:${api.config().ownerQQ || ''}`)
      return sendShot(chat, String(q.anim || ''), Number(q.at) || undefined)
    })
    api.route('/gif', async (req) => {
      const q = api.core.http.query(req)
      const chat = String(q.chat || `private:${api.config().ownerQQ || ''}`)
      return sendGif(chat, String(q.anim || ''), {
        width: Number(q.width) || undefined,
        fps: Number(q.fps) || undefined,
        seconds: Number(q.seconds) || undefined,
      })
    })
    api.route('/list', async () => ({ ok: true, names: names(), groups: config().menu || [] }))
    api.route('/state', async () => ({ ok: true, settings: api.settings(), hour: state.hour, count: state.count, gifHour: state.gifHour, gifCount: state.gifCount }))

    api.log.info('宠物截图已挂上（从 106 段动画抽帧/GIF，可发当前聊天/群）')
    return { sendShot, sendGif, names, resolveAnim }
  },
}

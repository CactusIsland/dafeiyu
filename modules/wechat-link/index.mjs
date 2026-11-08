// 微信联动 —— 用户模块（Aurabot 扩展接口 v1）
//
// 微信和 QQ 共用同一个「主人」：
//  - 微信发来的话写进 Aurabot 的聊天流水（private:主人QQ），每天整理时会和 QQ 的话一起进长期记忆；
//  - 同时直接往记忆库补一条（source=auto，会参与压缩/遗忘），所以 QQ 里马上就能想起来；
//  - 回复走和 /think 一样的系统回合，但提示词按「微信聊天」写，语气和 QQ 一致。

/** @type {import('../aurabot').AurabotModule} */
export default {
  id: 'wechat-link',
  name: '微信联动',
  version: '1.1.1',
  api: 1,
  description: '微信私聊写进 QQ 主人的聊天流水与记忆，两边互相看得见',

  setup(api) {
    const owner = () => String(api.config().ownerQQ || '')
    const ownerChat = () => `private:${owner()}`

    api.route('/say', async (req) => {
      const b = await api.core.http.body(req)
      const text = String(b?.text || b?.prompt || '').trim()
      if (!text) return { ok: false, message: '内容空' }

      const hub = api.core.hub
      const memory = api.use('memory')
      const chatId = ownerChat()

      // 1) 写进聊天流水：整理时和 QQ 的话一起进长期记忆
      try { hub.logChat(chatId, '主人', text, owner()) } catch (error) { api.log.debug('logChat 失败：' + error.message) }
      // 1.1) 同时写进全量存档，微信原话也不丢
      try {
        api.emit('memory-archive/ingest', {
          channel: 'wechat',
          kind: 'in',
          chatId,
          userId: owner(),
          nickname: '主人',
          owner: true,
          direct: true,
          at: Date.now(),
          text,
        })
      } catch (error) { api.log.debug('微信存档失败：' + error.message) }

      // 2) 直接补一条记忆（auto 来源，会被压缩/遗忘管），QQ 那边马上能想起
      try {
        memory?.add?.({
          text: `主人在微信上说：${text.slice(0, 160)}`,
          aboutName: '主人',
          importance: 0.5,
          source: 'auto',
          chatId,
        })
      } catch (error) { api.log.debug('memory.add 失败：' + error.message) }

      // 3) 让她用微信聊天的口气回
      const prompt = [
        '【微信】主人在微信上给你发了一条消息：' + text,
        '你在微信上跟主人聊天（不是 QQ，也不是系统通知），主人和 QQ 上的主人是同一个人。',
        '直接用你平时的口气回：短、口语、别解释；不要提系统、接口、提醒；不要说“收到”“好的”这种客服话。',
      ].join('\n')

      let reply = ''
      try {
        reply = String(await hub.runSystemTurn('wechat', '微信', prompt, { timeoutMs: 120000 }) || '').trim()
      } catch (error) {
        api.log.warn('微信回合失败：' + error.message)
        return { ok: false, message: error.message }
      }

      // 4) 回复也记一笔，QQ 里聊到时能对上
      try { hub.logChat(chatId, '她', reply, '') } catch (error) {}
      try {
        api.emit('memory-archive/ingest', {
          channel: 'wechat',
          kind: 'out',
          chatId,
          nickname: '她',
          at: Date.now(),
          text: reply,
          userText: text,
        })
      } catch (error) { api.log.debug('微信回复存档失败：' + error.message) }
      return { ok: true, reply }
    })

    api.route('/state', async () => ({ ok: true, owner: owner(), chat: ownerChat() }))

    api.log.info('微信联动已挂上（微信消息写进主人聊天流水与记忆）')
    return {}
  },
}

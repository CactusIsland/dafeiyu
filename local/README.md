# 本地钩子（可选）

Aurabot 的 `local/` 目录里可以放两个自定义钩子：

- `tts.mjs`：把文字合成语音
- `image.mjs`：生图

本仓库**不包含**这两个文件，因为它们通常包含本机路径和第三方 API Key。

## 约定

### tts.mjs

```js
export default async function tts({ text, outDir, log }) {
  // 返回音频文件路径
}
```

建议用环境变量而不是硬编码：

```powershell
$env:AURABOT_PYTHON = "python"
$env:AURABOT_FFMPEG = "ffmpeg"
$env:AURABOT_TTS_DIR  = "D:\你的TTS目录"
```

### image.mjs

```js
export default async function image({ prompt, size }) {
  // 返回 Buffer
}
```

**API Key 绝对不要写死在文件里**，从环境变量读：

```js
const KEY = process.env.OPENLUX_API_KEY || ''
```

## 安全

- 不要把填好的 key 提交到 git
- 不要把 `local/out/`（合成音频、临时文件）提交
- 不要把参考音、模型、生成的图提交

核心模块不依赖这两个钩子；没有它们，机器人仍然能聊天、记忆、看视频、发桌宠截图。

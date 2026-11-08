# 大肥鱼核心 · Dafeiyu Core

这是一套跑在 **DeepSeek Harness（DSH） + Aurabot QQ 插件** 上的「大肥鱼」陪伴机器人核心模块。
它把「会聊天」升级成「有记忆、有作息、会看视频、会发自己桌宠截图」的长期陪伴系统。

> 本仓库只包含我们自己写的核心模块、通用人设和文档。
> **不包含**：Aurabot 插件源码、聊天记录、长期记忆库、模型、语音模型、桌宠动画素材、API Key、QQ/微信账号。

---

## About

**大肥鱼核心（Dafeiyu Core）** 是一套面向长期陪伴的分层记忆与生活系统：

- **记忆**：全量原文存档、热记忆、冷记忆、连续性纸条、人物关系图、初次相遇锚点
- **召回**：用户给线索才查旧事；多候选先反问；群聊/私聊作用域隔离
- **生活**：作息、精力、饥饿；会困、会饿、会睡，影响语气但不拦回话
- **能力**：低 token 看 B 站/抖音视频、桌宠截图/GIF、人格快捷切换
- **省钱**：真实 token 观测、会话轮转、请求前预算、视频摘要缓存

**Topics**：`deepseek-harness` `dsh` `aurabot` `qq-bot` `ai-companion` `memory` `cold-storage` `asr` `bilibili` `desktop-pet`

> GitHub 仓库的 About 描述建议：
> `大肥鱼陪伴机器人核心：分层记忆、热/冷归档、连续性、作息/精力/饥饿、低 token 看视频、桌宠截图/GIF。`

---

## 1. 它是什么

一套分层的陪伴系统：

```
L0 人格卡        personas/dafeiyu.md（静态人设）
L1 连续性纸条    continuity：跨天记住心情、没聊完的事、最近细节
L2 热记忆        memory + memory-map：人物档案、关系、约定、偏好、快忘记
L3 冷记忆        memory-cold：淡出的事先冷存，给线索才找回
L4 全量存档      memory-archive：每句话原文 append-only，永不删除
```

再叠加：

- **记忆作用域**：群聊只召回本群，别人私聊不串主人私聊；
- **线索召回**：只有对方说「还记得 / 上次 / 以前」才查旧事；多候选时先反问；
- **会话轮转**：上下文太大时先留连续性纸条，再重置 DSH 会话，省 token；
- **作息/精力/饥饿**：会困、会饿、会睡，影响语气但不拦回话；
- **看视频**：B 站字幕优先，没字幕本地 ASR 转写再压缩成短摘要；抖音走专用浏览器；
- **宠物截图/GIF**：从 106 段桌宠动画抽帧或转 GIF 发到聊天/群；
- **人格快捷切换**：`/人格`、`/人格 切换 <id>`。

---

## 2. 模块清单

| 模块 | 作用 |
|---|---|
| `allow-manager` | 自然语言白名单（“可以和 xx 聊天”） |
| `memory-compact` | 记忆压缩、淡化、遗忘曲线；压缩/遗忘前先写冷库 |
| `memory-archive` | 全量原文存档、搜索、旧 chatlog/会话导入 |
| `continuity` | 她给自己写的跨天连续性纸条（心情/没聊完/细节/下次） |
| `memory-map` | 人物关系图、约定/偏好/快忘记、永不遗忘保护、dashboard |
| `memory-scope` | 群聊/别人私聊只召回本聊天记忆 |
| `memory-cold` | 冷记忆库、结构化线索、多候选择优、容量告警 |
| `cue-recall` | 用户给线索才查冷库/存档；多候选先反问 |
| `first-meet` | 初次相遇、最初 30 天锚点（永不遗忘） |
| `proactive-gate` | 主动找话时“别硬翻旧事”；事实/猜想分开 |
| `budget-guard` | 请求前裁剪额外注入块，避免上下文虚胖 |
| `session-budget` | 真实 token 用量、手动/演练轮转、自动轮转开关 |
| `life-state` | 作息、精力、饥饿；`/身体` `/喂饭` `/睡觉` `/起床` |
| `video-watch` | B 站/抖音低 token 看视频；字幕/ASR + 摘要 + 缓存 |
| `pet-shot` | 桌宠截图/GIF 发到当前聊天/群 |
| `persona-switch` | 人格库快捷切换 |
| `shared-context` | 跨聊天近期摘要（按隐私范围过滤） |
| `self-inspect` | 她自己的后台：状态、余额、日志、上下文 |
| `wallet` | 生图账本 + DeepSeek 余额提醒 |
| `web-tools` | 联网搜索工具 |
| `wechat-link` | 微信消息写进统一记忆（可选） |
| `forward-reader` | 合并转发卡片识别 |

`local/` 只放说明；TTS/生图钩子因包含本机路径和密钥，未放入仓库，按 `local/README.md` 自己接。

---

## 3. 安装

### 3.1 前置

- Windows 10/11
- DSH（DeepSeek Harness）
- Aurabot QQ 插件 `dsh-aurabot-qq`
- SnowLuma（OneBot 11 网关，QQ 收发）
- Python 3.10+（可选：看视频本地 ASR 需要 `faster-whisper`）
- ffmpeg（可选：看视频/宠物 GIF）

### 3.2 放模块

把 `modules/` 下的每个文件夹复制到：

```
%USERPROFILE%\.dsh\plugins-data\aurabot\modules\
```

保存后 Aurabot 会热加载；在面板「扩展」页能看到每个模块是否在跑。

### 3.3 放人设

把 `personas/dafeiyu.md` 复制到：

```
%USERPROFILE%\.dsh\plugins-data\aurabot\personas\dafeiyu.md
```

仓库里的人设是通用版，没有真实 QQ/微信 ID；你需要按自己的情况改。

### 3.4 配置

参考 `config.example.json`，把需要的字段填进：

```
%USERPROFILE%\.dsh\plugins-data\aurabot\config.json
```

最少要填：

- `botQQ`：机器人 QQ
- `ownerQQ`：主人 QQ
- `ownerName`：主人称呼
- `snowluma`：SnowLuma 的 HTTP/WS 地址和 token
- `model`：DSH 模型
- `workspaceDir`：QQ 会话工作区

**不要把填好的 `config.json` 提交到任何仓库。**

### 3.5 可选：看视频 / 宠物 GIF

看视频需要：

```powershell
pip install faster-whisper numpy zstandard
```

并在模块设置里填：

- `pythonPath`：带 faster-whisper 的 Python
- `ffmpegPath`：ffmpeg 可执行文件

也可以在环境变量里给默认值：

```powershell
$env:AURABOT_PYTHON = "python"
$env:AURABOT_FFMPEG = "ffmpeg"
```

宠物截图/GIF 需要桌宠素材包：

```
%USERPROFILE%\.dsh\plugins-data\aurabot\modules-data\pet\packs\default-animation\
```

素材是 `dsh-pet` 的大肥鱼动画，许可是 **CC BY-NC-SA 4.0**，本仓库不附带。

### 3.6 启动

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/start.ps1 -BaseUrl http://127.0.0.1:13667
```

端口以 DSH 实际输出为准。

---

## 4. 常用命令

```text
/存档            看全量存档条数；/存档 导入 补旧 chatlog
/纸条            看当前聊天的连续性纸条
/图谱            看记忆统计；网页 dashboard 见下
/预算            看当前会话 token；/预算 轮转 先留纸条再重置
/身体            看精力/饥饿/作息
/喂饭            降饥饿、回精力，可能发吃白饭 GIF
/睡觉 /起床
/看视频 <链接>    低 token 看 B 站/抖音
/宠物截图 [动作]  发静态截图
/宠物动图 [动作]  发 GIF
/人格 /人格 切换 <id>
```

记忆可视化：

```
http://127.0.0.1:<DSH端口>/aurabot/api/ext/memory-map/dashboard
```

---

## 5. 数据与隐私

本仓库**不含**任何实际运行数据：

- `memories.json`、`chatlog/`、`modules-data/`、`logs/`
- 聊天原文、人物档案、关系、日记
- 语音参考音、模型、桌宠 WebM/GIF
- API Key、SnowLuma token、微信 wxid

代码里出现的 `<OWNER_QQ>`、`<BOT_QQ>`、`<项目路径>`、`<你的用户名>` 等占位符需要你自己替换。

---

## 6. 参考与致谢

- [Aurabot / dsh-aurabot-qq](https://github.com/aureth-labs/dsh-aurabot-qq)：QQ 插件宿主（MIT）
- [dsh-pet](https://github.com/PC2005-cloud/dsh-pet)：桌宠客户端与素材约定
- [SurfCore](https://github.com/Mieksido/surfcore)：衰减卡 + 全量卡、重要性评分、初次相遇
- [Companion-AI-Memory](https://github.com/ARCHEON999/Companion-AI-Memory-Context-Token-Optimization)：冷热分层、线索召回、固定预算
- [dsh-whale-food-expack](https://www.npmjs.com/package/dsh-whale-food-expack)、[dsh-dafeiyu-life](https://www.npmjs.com/package/dsh-dafeiyu-life)、[dsh-living-memory](https://www.npmjs.com/package/dsh-living-memory)、[dsh-bili-whale](https://github.com/Altersss/dsh-bili-whale)：饥饿/生活状态/记忆巡护/作息配额的设计参考

---

## 7. 许可

核心代码默认 MIT；第三方素材与参考项目许可见 `THIRD-PARTY-NOTICES.md`。

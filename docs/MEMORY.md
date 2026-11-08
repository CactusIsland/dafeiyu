# 记忆架构说明

这套记忆不是「把所有聊天记录一直塞进上下文」，而是分四层：

```
L0 人格卡         静态，永远不变：你是谁、怎么说话、底线
L1 连续性纸条     跨天：现在的心情、没聊完的事、最近 2~3 个细节、下次怎么接
L2 热记忆         当前会用的：人物档案、关系、约定、偏好、近期事件
L3 冷记忆         已经不常提、但没删：给线索才查
L4 全量存档       每句话原文，append-only，永不删除
```

## 1. 全量存档（memory-archive）

- 每条收到的消息、她发出的消息，都写进 `modules-data/memory-archive/YYYY-MM.jsonl`
- 永不修改、永不删除，按月分片
- 支持按关键词、聊天、时间范围回查
- 旧 chatlog / DSH 会话可以一次性导入
- 主人私聊里给她 `memory_archive_search` 工具

存储大小只占本地磁盘，不进上下文，所以不花 token。

## 2. 热记忆（内置 memory + memory-map）

- 内置 `memory` 用 BM25 + 人物 + 重要度 + 遗忘曲线召回
- `memory-map` 把记忆整理成：
  - 人物节点：记得谁、什么关系、多少条
  - 约定 / 第一次
  - 偏好
  - 最近的事
  - 快忘记
- 权重四档：
  - `never`：面板手写、导入、主人高重要度、第一次/约定、手动保护
  - `slow`：关于主人、吵架/和好、经历/日记
  - `normal`
  - `fast`
- `never` 条目会被抬到重要度 ≥ 0.6，挡住内置每日整理；`memory-compact` 和 `memory-cold` 也会跳过。

## 3. 连续性纸条（continuity）

每 15 分钟，让她自己看一遍最近聊天，写一张只有自己看得见的小纸条：

```
心情：...
没聊完：...
细节：...
下次：...
猜想：...（可选，单独存进 thoughts，不当事实）
```

只注入当前聊天的那一张，不串隐私；会话重置后还在。

## 4. 冷记忆（memory-cold）

- 淡出（清晰度 < 0.18）且超过 30 天的 `auto/tool` 记忆：先冷存，再从热库移走
- 冷存内容包含：原文、关于谁、来源、时间、历史
- 每 10 分钟对账一次：热库里少了谁，就从快照补写进冷库
- 内置每日整理直接删掉的，也会被对账兜住
- `memory-compact` 压缩/遗忘前，也会先写冷库

## 5. 线索召回（cue-recall）

默认不查旧事。只有对方明确说：

```
还记得 / 记不记得 / 上次 / 那次 / 以前 / 当年 / 小时候 / 你说过 / 约好 ...
```

才去冷库 + 全量存档找少量片段（最多 3 条 / 480 字）。

- 找不到：让她问一句“是哪件事”，不要编
- 多个候选分数接近：先反问“是 A 那次还是 B 那次”，不直接倒答案
- 隐私：群聊只查本群，别人私聊只查这个私聊；主人私聊才可以查全部

结构化线索会解析：人物、年份、月份、地点、物品/话题；冷库搜索叠了本地字组向量分。

## 6. 记忆作用域（memory-scope）

内置记忆的召回是全库 BM25，容易串隐私。`memory-scope` 在交给她的内容里把内置提示替换掉：

- 主人私聊：保留全库召回
- 群聊：只留本群记忆 + 她自己的公开经历
- 别人私聊：只留这个私聊的记忆

`shared-context` 也按同样原则过滤：群聊只看别的群，不带私聊内容。

## 7. 锚点（first-meet）

- 从全量存档找主人第一条**有意义**的消息（跳过 `[动画表情]` 之类占位）
- 写成 `source=panel` 的「初次相遇」永久记忆
- 再把最初 30 天收成一段「最初的日子」
- 两条都是 `never`，不会被压缩/遗忘

## 8. Token 控制

- `session-budget`：读 DSH 会话文件里的真实 token，超过阈值日志提醒；支持手动/演练轮转
- 轮转流程：先 force 写连续性纸条 → 8 秒后重置 DSH 会话 → 记忆/存档/冷库都不动
- `budget-guard`：每轮额外注入的记忆块超过设定字数时，按优先级裁掉：
  1. 跨聊天摘要
  2. 连续性纸条
  3. 线索召回
  4. 内置记忆（默认不丢）
- `video-watch`：整段字幕/转写只留本地，进上下文只有 ≤350 字摘要；同视频有缓存

## 9. 数据文件

| 模块 | 数据目录 |
|---|---|
| `memory-archive` | `modules-data/memory-archive/YYYY-MM.jsonl` |
| `memory-cold` | `modules-data/memory-cold/cold-memories.jsonl` + `cold-state.json` |
| `continuity` | `modules-data/continuity/state.json` |
| `memory-map` | `modules-data/memory-map/memory-map.json` + `overrides.json` |
| `first-meet` | `modules-data/first-meet/first-meet.json` |
| `session-budget` | `modules-data/session-budget/rotations.json` |
| `life-state` | `modules-data/life-state/state.json` |
| `video-watch` | `modules-data/video-watch/cache/*.json` |
| `pet-shot` | `modules-data/pet-shot/shots/*.png|gif` |

这些数据都不进仓库。

# 大肥鱼启动 / 体检（通用版）
# 用法：powershell -NoProfile -ExecutionPolicy Bypass -File start.ps1 -BaseUrl http://127.0.0.1:13667

param(
  [string]$BaseUrl = "http://127.0.0.1:13667",
  [int]$WaitSeconds = 20
)

$ErrorActionPreference = "Continue"
$BaseUrl = $BaseUrl.TrimEnd("/")
$Api = "$BaseUrl/aurabot/api"

function Try-Get($Path) {
  try {
    return Invoke-RestMethod -Uri "$Api$Path" -Method Get -TimeoutSec 10
  } catch {
    return $null
  }
}

function Post-Json($Path, $Obj) {
  $json = if ($null -eq $Obj) { "{}" } else { $Obj | ConvertTo-Json -Depth 8 -Compress }
  $bytes = [Text.Encoding]::UTF8.GetBytes($json)
  try {
    return Invoke-RestMethod -Uri "$Api$Path" -Method Post -Body $bytes -ContentType "application/json; charset=utf-8" -TimeoutSec 120
  } catch {
    return $null
  }
}

function Line($Text) { Write-Host $Text }

Line "== 大肥鱼启动 =="
Line "   DSH: $BaseUrl"

# 1) 等 DSH Web 起来
$state = $null
$deadline = (Get-Date).AddSeconds([Math]::Max(3, $WaitSeconds))
while ((Get-Date) -lt $deadline) {
  $state = Try-Get "/state"
  if ($state) { break }
  Start-Sleep -Milliseconds 800
}
if (-not $state) {
  Line ""
  Line "DSH 没开，或者端口不对。先启动 DSH，再确认 Web GUI 端口。"
  exit 2
}
Line "   Aurabot 插件: 已加载 v$($state.version)"

# 2) 打开总开关、关掉试运行
$save = Post-Json "/save" @{ enabled = $true; dryRun = $false }
if (-not $save) {
  Line "   设置保存失败（面板接口没响应）"
  exit 3
}
Line "   总开关: $($save.config.enabled)  试运行: $($save.config.dryRun)  机器人: $($save.config.botQQ)  主人: $($save.config.ownerQQ)"

# 3) 核对登录号
$test = Post-Json "/onebot/test" @{}
if ($test -and $test.ok) {
  Line "   QQ 网关: $($test.message)"
} else {
  Line "   QQ 网关没连上，尝试拉起 SnowLuma ..."
  $start = Post-Json "/snowluma/start" @{}
  if ($start) { Line "   SnowLuma: $($start.message)" }
  Start-Sleep -Seconds 5
  $attach = Post-Json "/snowluma/attach" @{}
  if ($attach) { Line "   接入机器人号: $($attach.message)" }
  Start-Sleep -Seconds 4
  $test = Post-Json "/onebot/test" @{}
  if ($test -and $test.ok) {
    Line "   QQ 网关: $($test.message)"
  } else {
    Line "   QQ 网关仍未连上：$($test.message)"
    Line "   检查：QQ 小号是否登录、面板「连接」页是否显示已注入。"
  }
}

# 4) 记忆状态
$mc = Try-Get "/ext/memory-compact/state"
if ($mc) {
  $last = if ($mc.lastRun) { ([DateTimeOffset]::FromUnixTimeMilliseconds([long]$mc.lastRun)).ToLocalTime().ToString("MM-dd HH:mm") } else { "还没跑过" }
  Line "   记忆: $($mc.liveCount) 条（上限 $($mc.cap) → 压到 $($mc.target)）  压缩带: $last 跑过 $($mc.runs) 轮"
} else {
  Line "   记忆压缩带: 模块没在跑（面板 → 扩展 里看报错）"
}

# 5) 全量存档
$ma = Try-Get "/ext/memory-archive/stats"
if ($ma) {
  Line "   全量存档: $($ma.totalRows) 条"
}

# 6) 身体状态
$life = Try-Get "/ext/life-state/state"
if ($life) {
  Line "   身体: 精力 $([math]::Round($life.energy))/100  饥饿 $([math]::Round($life.hunger))/100  睡着: $($life.asleep)"
}

Line ""
Line "完成。"
exit 0

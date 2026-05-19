# install_pipeline_scheduler.ps1
# ─────────────────────────────────────────────────────────────
# 注册 Windows Task Scheduler：每个工作日 16:30 跑 run_scheduled.bat
# 触发 backend/pipeline.py 全量更新（评分 + alerts + 推 frontend/src/data.js）
#
# 用法（管理员或普通 PowerShell 都行；普通用户走 LogonType S4U）:
#   .\backend\scripts\install_pipeline_scheduler.ps1
#
# 卸载:
#   Unregister-ScheduledTask -TaskName "QuantEdgePipelineDaily" -Confirm:$false
#
# 与 install_task_scheduler.ps1 区别:
#   - 那个跑 mining_alpha_daily.ps1（A 股 alpha 挖掘）
#   - 这个跑 run_scheduled.bat（主 pipeline 数据刷新，前端用得最多）
# ─────────────────────────────────────────────────────────────

$ErrorActionPreference = "Stop"

$TaskName = "QuantEdgePipelineDaily"
$BatPath = (Resolve-Path (Join-Path $PSScriptRoot "run_scheduled.bat")).Path

# Action: 跑 .bat（bat 内部 cd 到项目根 + 调 venv python + 输出 cron.log）
$Action = New-ScheduledTaskAction `
    -Execute "cmd.exe" `
    -Argument "/c `"$BatPath`""

# Trigger: 每周一到周五 16:30（美东收盘后；用户在国内可改为本地时间晚上）
$Trigger = New-ScheduledTaskTrigger `
    -Weekly -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday `
    -At "16:30"

# Settings: 笔记本电池下也跑 / 错过补跑 / 失败重试 3 次 / 上限 1 小时
$Settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -StartWhenAvailable -WakeToRun `
    -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 5) `
    -ExecutionTimeLimit (New-TimeSpan -Hours 1)

# Principal: 以当前用户身份跑，密码不暴露（S4U service-for-user）
$Principal = New-ScheduledTaskPrincipal `
    -UserId "$env:USERDOMAIN\$env:USERNAME" `
    -LogonType S4U

# 已存在则先删（让脚本可重复跑）
$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "[QuantEdge] 已有同名任务，先卸载..." -ForegroundColor Yellow
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $Action `
    -Trigger $Trigger `
    -Settings $Settings `
    -Principal $Principal `
    -Description "QuantEdge 主 pipeline 每个工作日 16:30 自动跑（评分 + alerts + 推 frontend data）" | Out-Null

Write-Host "[QuantEdge] 任务 '$TaskName' 已注册" -ForegroundColor Green
Write-Host "  下次触发: 每周一到周五 16:30"
Write-Host "  日志位置: backend\output\cron.log"
Write-Host ""
Write-Host "立刻测试（无需等到 16:30）:" -ForegroundColor Cyan
Write-Host "  Start-ScheduledTask -TaskName $TaskName"
Write-Host ""
Write-Host "查看状态:" -ForegroundColor Cyan
Write-Host "  Get-ScheduledTask -TaskName $TaskName | Get-ScheduledTaskInfo"
Write-Host ""
Write-Host "卸载:" -ForegroundColor Cyan
Write-Host "  Unregister-ScheduledTask -TaskName $TaskName -Confirm:`$false"

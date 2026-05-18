# install_task_scheduler.ps1
# 注册 Windows Task Scheduler：每个工作日 16:30 跑 mining_alpha_daily.ps1
#
# 用法（管理员 PowerShell）：
#   .\backend\scripts\install_task_scheduler.ps1
#
# 卸载：
#   Unregister-ScheduledTask -TaskName "MiningAlphaDaily" -Confirm:$false

$ErrorActionPreference = "Stop"

$TaskName = "MiningAlphaDaily"
$ScriptPath = (Resolve-Path (Join-Path $PSScriptRoot "mining_alpha_daily.ps1")).Path

# Action: 跑脚本
$Action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$ScriptPath`""

# Trigger: 每周一到周五 16:30
$Trigger = New-ScheduledTaskTrigger `
    -Weekly -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday `
    -At "16:30"

# Settings: 失败重试 + 唤醒电脑
$Settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -StartWhenAvailable -WakeToRun `
    -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 5) `
    -ExecutionTimeLimit (New-TimeSpan -Hours 2)

# Principal: 以当前用户运行
$Principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType S4U

# Register
Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $Action `
    -Trigger $Trigger `
    -Settings $Settings `
    -Principal $Principal `
    -Description "QuantEdge Mining Alpha 每日盘后流水线 (sync → factors → IC → alerts)" `
    -Force

Write-Host "✓ 已注册任务: $TaskName"
Write-Host "  下次运行: $(Get-ScheduledTask -TaskName $TaskName | Get-ScheduledTaskInfo | Select-Object -ExpandProperty NextRunTime)"
Write-Host ""
Write-Host "卸载: Unregister-ScheduledTask -TaskName '$TaskName' -Confirm:`$false"

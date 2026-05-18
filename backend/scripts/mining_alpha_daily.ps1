# mining_alpha_daily.ps1
# 每个交易日 16:30 收盘后跑：sync-data → compute-factors → ic-report → alerts
# 周末跑 train + backtest（重训 + 全回测）
#
# 安装：
#   Get-Help .\backend\scripts\install_task_scheduler.ps1 -Full
# 手动调试：
#   pwsh -File backend\scripts\mining_alpha_daily.ps1

param(
    [string]$BackendDir = (Join-Path $PSScriptRoot ".."),
    [string]$Universe = "CSI800",
    [string]$Start = "2020-01-01",
    [string]$RunId = ""
)

$ErrorActionPreference = "Stop"
$Today = Get-Date -Format "yyyy-MM-dd"
if (-not $RunId) { $RunId = (Get-Date -Format "yyyyMMdd_HHmmss") }

$PythonExe = Join-Path $BackendDir ".venv\Scripts\python.exe"
if (-not (Test-Path $PythonExe)) {
    Write-Host "Python venv 不存在: $PythonExe" -ForegroundColor Red
    exit 1
}

$LogDir = Join-Path $BackendDir "output\mining_alpha\schedule_logs"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$LogFile = Join-Path $LogDir "$Today.log"

function Run-Step {
    param([string]$Step, [string[]]$Args)
    $cmd = @("-m", "mining_alpha.run", $Step) + $Args
    Write-Host "[$(Get-Date -Format HH:mm:ss)] step=$Step args=$($Args -join ' ')" | Tee-Object -FilePath $LogFile -Append
    Push-Location $BackendDir
    & $PythonExe @cmd 2>&1 | Tee-Object -FilePath $LogFile -Append
    $code = $LASTEXITCODE
    Pop-Location
    if ($code -ne 0) {
        Write-Host "[ERROR] step=$Step exit=$code" | Tee-Object -FilePath $LogFile -Append
        return $false
    }
    return $true
}

# 1. 每日：同步 + 算因子 + IC + 告警
$ok = Run-Step "sync-data" @("--universe", $Universe, "--start", $Start, "--end", $Today)
if (-not $ok) { exit 1 }

$ok = Run-Step "compute-factors" @("--universe", $Universe, "--start", $Start, "--end", $Today, "--run-id", $RunId)
if (-not $ok) { exit 1 }

$ok = Run-Step "ic-report" @("--universe", $Universe, "--start", $Start, "--end", $Today,
                              "--run-id", $RunId, "--horizon", "5",
                              "--vol-scale-window", "20", "--filter-redundant")
if (-not $ok) { exit 1 }

# 2. 周末（周五收盘后）：重训 + 回测
$DayOfWeek = (Get-Date).DayOfWeek
if ($DayOfWeek -eq "Friday") {
    Run-Step "train" @("--universe", $Universe, "--start", $Start, "--end", $Today,
                       "--run-id", $RunId, "--ensemble") | Out-Null

    Run-Step "backtest" @("--universe", $Universe, "--start", "2022-07-01", "--end", $Today,
                          "--run-id", $RunId, "--top-n", "50",
                          "--use-tradeable-mask", "--multi-topn", "20,50,100,200") | Out-Null
}

# 3. 跑告警
Push-Location $BackendDir
& $PythonExe -m mining_alpha.alerts 2>&1 | Tee-Object -FilePath $LogFile -Append
Pop-Location

Write-Host "[$(Get-Date -Format HH:mm:ss)] mining_alpha_daily 完成 (run_id=$RunId)" | Tee-Object -FilePath $LogFile -Append

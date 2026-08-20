[CmdletBinding()]
param(
    [ValidateSet("Menu", "Start", "Stop", "Status", "Open")]
    [string]$Action = "Menu"
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$script:ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$script:BackendDirectory = Join-Path $script:ProjectRoot "backend"
$script:FrontendDirectory = Join-Path $script:ProjectRoot "frontend"
$script:RuntimeDirectory = Join-Path $script:ProjectRoot ".local-data\runtime"
$script:StateFile = Join-Path $script:RuntimeDirectory "local-control.json"
$script:PythonPath = "D:\Anaconda\envs\homebuild-log\python.exe"
$script:BackendUrl = "http://127.0.0.1:8000"
$script:FrontendUrl = "http://127.0.0.1:5173"

function Test-PortListening {
    param([Parameter(Mandatory)][int]$Port)

    $client = New-Object System.Net.Sockets.TcpClient
    try {
        # 某些 Windows 权限环境无法读取 Get-NetTCPConnection，直接探测本机端口更可靠。
        $result = $client.BeginConnect("127.0.0.1", $Port, $null, $null)
        if (-not $result.AsyncWaitHandle.WaitOne(500)) {
            return $false
        }
        $client.EndConnect($result)
        return $true
    }
    catch {
        return $false
    }
    finally {
        $client.Close()
    }
}

function Read-ControlState {
    if (-not (Test-Path -LiteralPath $script:StateFile -PathType Leaf)) {
        return $null
    }

    try {
        return Get-Content -LiteralPath $script:StateFile -Raw -Encoding UTF8 | ConvertFrom-Json
    }
    catch {
        Write-Warning "运行状态文件无法读取，将按未启动处理：$($_.Exception.Message)"
        return $null
    }
}

function Test-OwnedProcess {
    param([AllowNull()]$ProcessState)

    if ($null -eq $ProcessState -or $null -eq $ProcessState.pid -or $null -eq $ProcessState.started_at) {
        return $false
    }

    $process = Get-Process -Id ([int]$ProcessState.pid) -ErrorAction SilentlyContinue
    if ($null -eq $process) {
        return $false
    }

    try {
        # 同时核对启动时间，避免 PID 被系统复用后误关其他程序。
        return $process.StartTime.ToUniversalTime().ToString("o") -eq [string]$ProcessState.started_at
    }
    catch {
        return $false
    }
}

function Get-ServiceState {
    param(
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][int]$Port,
        [AllowNull()]$ProcessState
    )

    $owned = Test-OwnedProcess $ProcessState
    $listening = Test-PortListening $Port
    $label = if ($Name -eq "backend") { "后端" } else { "前端" }

    if ($owned -and $listening) {
        return [pscustomobject]@{ Name = $Name; Label = $label; Kind = "running"; Text = "正常运行" }
    }
    if ($owned) {
        return [pscustomobject]@{ Name = $Name; Label = $label; Kind = "starting"; Text = "进程已启动，端口尚未就绪" }
    }
    if ($listening) {
        return [pscustomobject]@{ Name = $Name; Label = $label; Kind = "occupied"; Text = "端口 $Port 已被其他程序占用" }
    }
    return [pscustomobject]@{ Name = $Name; Label = $label; Kind = "stopped"; Text = "未启动" }
}

function Show-ServiceStatus {
    $state = Read-ControlState
    $backend = Get-ServiceState "backend" 8000 $state.backend
    $frontend = Get-ServiceState "frontend" 5173 $state.frontend

    Write-Host ""
    Write-Host "当前状态" -ForegroundColor Cyan
    Write-Host ("  后端：{0}" -f $backend.Text)
    Write-Host ("  前端：{0}" -f $frontend.Text)
    return [pscustomobject]@{ Backend = $backend; Frontend = $frontend; Raw = $state }
}

function Assert-StartPrerequisites {
    if (-not (Test-Path -LiteralPath $script:PythonPath -PathType Leaf)) {
        throw "未找到项目 Python 环境：$script:PythonPath"
    }
    if (-not (Test-Path -LiteralPath (Join-Path $script:BackendDirectory "app\main.py") -PathType Leaf)) {
        throw "未找到后端入口 backend\app\main.py。"
    }
    if (-not (Test-Path -LiteralPath (Join-Path $script:FrontendDirectory "package.json") -PathType Leaf)) {
        throw "未找到前端 package.json。"
    }
    if (-not (Test-Path -LiteralPath (Join-Path $script:FrontendDirectory "node_modules") -PathType Container)) {
        throw "前端依赖尚未安装，请先在 frontend 目录执行 npm ci。"
    }

    $npm = Get-Command "npm.cmd" -ErrorAction SilentlyContinue
    if ($null -eq $npm) {
        throw "未找到 npm.cmd，请确认 Node.js 已安装并加入 PATH。"
    }
    return $npm.Source
}

function Start-LogWindow {
    param(
        [Parameter(Mandatory)][string]$Title,
        [Parameter(Mandatory)][string]$WorkingDirectory,
        [Parameter(Mandatory)][string]$Command
    )

    # 使用编码命令传递含中文、空格和加号的项目路径。
    $windowCommand = "`$Host.UI.RawUI.WindowTitle = '$($Title.Replace("'", "''"))'; $Command"
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($windowCommand))
    return Start-Process -FilePath "powershell.exe" `
        -ArgumentList @("-NoLogo", "-NoProfile", "-NoExit", "-ExecutionPolicy", "Bypass", "-EncodedCommand", $encoded) `
        -WorkingDirectory $WorkingDirectory `
        -PassThru
}

function Save-ControlState {
    param(
        [Parameter(Mandatory)]$BackendProcess,
        [Parameter(Mandatory)]$FrontendProcess
    )

    New-Item -ItemType Directory -Path $script:RuntimeDirectory -Force | Out-Null
    $state = [ordered]@{
        backend = [ordered]@{
            pid = $BackendProcess.Id
            started_at = $BackendProcess.StartTime.ToUniversalTime().ToString("o")
        }
        frontend = [ordered]@{
            pid = $FrontendProcess.Id
            started_at = $FrontendProcess.StartTime.ToUniversalTime().ToString("o")
        }
    }
    $state | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath $script:StateFile -Encoding UTF8
}

function Wait-ServiceReady {
    param(
        [Parameter(Mandatory)][string]$Url,
        [Parameter(Mandatory)][string]$Label,
        [int]$TimeoutSeconds = 30
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        try {
            $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
                return $true
            }
        }
        catch {
            Start-Sleep -Milliseconds 500
        }
    }
    Write-Warning "$Label 在 $TimeoutSeconds 秒内没有就绪，请查看对应日志窗口。"
    return $false
}

function Start-HomeBuildLog {
    $status = Show-ServiceStatus
    if ($status.Backend.Kind -eq "occupied" -or $status.Frontend.Kind -eq "occupied") {
        throw "启动已取消：所需端口被非本菜单管理的程序占用。"
    }
    if ($status.Backend.Kind -in @("running", "starting") -or $status.Frontend.Kind -in @("running", "starting")) {
        Write-Host "服务已由控制菜单启动，不会重复创建进程。" -ForegroundColor Yellow
        return
    }

    $npmPath = Assert-StartPrerequisites
    $escapedPython = $script:PythonPath.Replace("'", "''")
    $escapedNpm = $npmPath.Replace("'", "''")

    Write-Host "正在检查并升级数据库结构……" -ForegroundColor Cyan
    Push-Location $script:BackendDirectory
    try {
        # 数据库必须先到达当前 head；迁移失败时不允许启动任何应用进程。
        & $script:PythonPath -m alembic -c alembic.ini upgrade head
        if ($LASTEXITCODE -ne 0) {
            throw "数据库迁移失败（退出码 $LASTEXITCODE），后端和前端均未启动。"
        }
    }
    finally {
        Pop-Location
    }

    Write-Host "正在启动后端和前端……" -ForegroundColor Cyan
    $backendProcess = Start-LogWindow `
        -Title "HomeBuild Log - 后端" `
        -WorkingDirectory $script:BackendDirectory `
        -Command "& '$escapedPython' -m fastapi dev app/main.py --host 127.0.0.1 --port 8000"

    try {
        $frontendProcess = Start-LogWindow `
            -Title "HomeBuild Log - 前端" `
            -WorkingDirectory $script:FrontendDirectory `
            -Command "& '$escapedNpm' run dev"
    }
    catch {
        Stop-Process -Id $backendProcess.Id -Force -ErrorAction SilentlyContinue
        throw
    }

    Save-ControlState $backendProcess $frontendProcess
    $backendReady = Wait-ServiceReady "$script:BackendUrl/api/v1/health" "后端"
    $frontendReady = Wait-ServiceReady $script:FrontendUrl "前端"

    if ($backendReady -and $frontendReady) {
        Write-Host "服务启动成功，正在打开网页。" -ForegroundColor Green
        Start-Process $script:FrontendUrl
    }
    else {
        Write-Warning "服务未完全就绪，日志窗口已保留供排查。"
    }
}

function Stop-OwnedProcessTree {
    param(
        [AllowNull()]$ProcessState,
        [Parameter(Mandatory)][string]$Label
    )

    if (-not (Test-OwnedProcess $ProcessState)) {
        Write-Host "$Label：没有可停止的受管进程。"
        return $true
    }

    # taskkill /T 只处理已核对 PID 与启动时间的进程树。
    & taskkill.exe /PID ([int]$ProcessState.pid) /T /F | Out-Null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "$Label：已停止。" -ForegroundColor Green
        return $true
    }
    Write-Warning "$Label：停止命令返回错误，请检查日志窗口。"
    return $false
}

function Stop-HomeBuildLog {
    $state = Read-ControlState
    if ($null -eq $state) {
        Write-Host "没有发现由控制菜单启动的服务。" -ForegroundColor Yellow
        return
    }

    $frontendStopped = Stop-OwnedProcessTree $state.frontend "前端"
    $backendStopped = Stop-OwnedProcessTree $state.backend "后端"
    if ($frontendStopped -and $backendStopped) {
        Remove-Item -LiteralPath $script:StateFile -Force -ErrorAction SilentlyContinue
    }
    else {
        Write-Warning "仍有服务未停止，已保留 PID 状态以便重试。"
    }
}

function Open-HomeBuildLog {
    if (-not (Test-PortListening 5173)) {
        Write-Warning "前端尚未运行，请先启动服务。"
        return
    }
    Start-Process $script:FrontendUrl
}

function Invoke-Action {
    param([Parameter(Mandatory)][string]$SelectedAction)

    switch ($SelectedAction) {
        "Start" { Start-HomeBuildLog }
        "Stop" { Stop-HomeBuildLog }
        "Status" { Show-ServiceStatus | Out-Null }
        "Open" { Open-HomeBuildLog }
    }
}

if ($Action -ne "Menu") {
    Invoke-Action $Action
    exit 0
}

while ($true) {
    Clear-Host
    Write-Host "HomeBuild Log 本地控制菜单" -ForegroundColor Cyan
    Write-Host "==========================="
    Write-Host "1. 启动服务"
    Write-Host "2. 停止服务"
    Write-Host "3. 查看状态"
    Write-Host "4. 打开网页"
    Write-Host "0. 退出"
    Write-Host ""

    $choice = Read-Host "请选择"
    try {
        switch ($choice) {
            "1" { Invoke-Action "Start" }
            "2" { Invoke-Action "Stop" }
            "3" { Invoke-Action "Status" }
            "4" { Invoke-Action "Open" }
            "0" { exit 0 }
            default { Write-Warning "请输入 0 到 4。" }
        }
    }
    catch {
        Write-Host "操作失败：$($_.Exception.Message)" -ForegroundColor Red
    }

    Write-Host ""
    Read-Host "按回车键返回菜单" | Out-Null
}



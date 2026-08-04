[CmdletBinding()]
param(
    [string]$PythonPath = "D:\Anaconda\envs\homebuild-log\python.exe"
)

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$outputDirectory = Join-Path $projectRoot ".local-artifacts\data-exports"

foreach ($port in @(8000, 5173)) {
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $result = $client.BeginConnect("127.0.0.1", $port, $null, $null)
        if ($result.AsyncWaitHandle.WaitOne(500)) {
            $client.EndConnect($result)
            throw "检测到本机端口 $port 仍在监听。请先通过 HomeBuild-Log.cmd 停止服务，再导出真实数据。"
        }
    }
    catch [System.Management.Automation.RuntimeException] {
        throw
    }
    catch {
        # 连接失败表示端口没有服务监听，符合离线迁移要求。
    }
    finally {
        $client.Close()
    }
}

if (-not (Test-Path -LiteralPath $PythonPath -PathType Leaf)) {
    throw "未找到项目 Python：$PythonPath"
}

& $PythonPath (Join-Path $PSScriptRoot "create-data-export.py") `
    --project-root $projectRoot `
    --output-directory $outputDirectory
if ($LASTEXITCODE -ne 0) { throw "真实数据导出失败。" }

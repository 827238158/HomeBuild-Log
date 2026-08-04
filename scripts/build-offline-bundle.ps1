[CmdletBinding()]
param(
    [string]$ImageTag = "homebuild-log:4a-20260715",
    [string]$Platform = "linux/amd64"
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$versionName = ($ImageTag -replace '[^A-Za-z0-9_.-]', '-')
$artifactRoot = Join-Path $projectRoot ".local-artifacts"
$outputDirectory = Join-Path $artifactRoot "$versionName-linux-amd64"
$tarName = "$versionName-linux-amd64.tar"
$archiveName = "$tarName.gz"

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw "未找到 docker 命令，请先安装并启动 Docker Desktop。"
}
docker version | Out-Null
docker buildx version | Out-Null
if (-not (Get-Command tar.exe -ErrorAction SilentlyContinue)) {
    throw "未找到 Windows tar.exe，无法压缩离线镜像包。"
}

if (Test-Path -LiteralPath $outputDirectory) {
    $resolvedArtifactRoot = (Resolve-Path -LiteralPath $artifactRoot).Path
    $resolvedOutput = (Resolve-Path -LiteralPath $outputDirectory).Path
    if ((Split-Path -Parent $resolvedOutput) -ne $resolvedArtifactRoot) {
        throw "输出目录越出 .local-artifacts，拒绝清理：$resolvedOutput"
    }
    Remove-Item -LiteralPath $resolvedOutput -Recurse -Force
}
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null

Write-Host "正在构建 $Platform 镜像 $ImageTag……" -ForegroundColor Cyan
docker buildx build `
    --platform $Platform `
    --load `
    --tag $ImageTag `
    --build-arg "APP_VERSION=$versionName" `
    $projectRoot
if ($LASTEXITCODE -ne 0) { throw "Docker 镜像构建失败。" }

$inspectedPlatform = docker image inspect $ImageTag --format '{{.Os}}/{{.Architecture}}'
if ($inspectedPlatform.Trim() -ne $Platform) {
    throw "镜像平台不符：期望 $Platform，实际 $inspectedPlatform。"
}

$tarPath = Join-Path $outputDirectory $tarName
$archivePath = Join-Path $outputDirectory $archiveName
docker save --output $tarPath $ImageTag
if ($LASTEXITCODE -ne 0) { throw "Docker 镜像导出失败。" }

Push-Location $outputDirectory
try {
    & tar.exe -czf $archiveName $tarName
    if ($LASTEXITCODE -ne 0) { throw "镜像压缩失败。" }
}
finally {
    Pop-Location
}
Remove-Item -LiteralPath $tarPath -Force

# 复制部署材料，并生成不带 BOM 的 Linux 校验文件和环境配置。
Get-ChildItem -LiteralPath (Join-Path $projectRoot "deploy") -Force | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination $outputDirectory -Recurse -Force
}
$envText = @(
    "HOMEBUILD_IMAGE=$ImageTag"
    "HOMEBUILD_BIND_ADDRESS=127.0.0.1"
    "HOMEBUILD_PORT=8000"
    ""
    "DEEPSEEK_API_KEY="
    "MIMO_API_KEY="
) -join "`n"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText((Join-Path $outputDirectory ".env"), $envText + "`n", $utf8NoBom)

$hash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
[System.IO.File]::WriteAllText(
    (Join-Path $outputDirectory "SHA256SUMS"),
    "$hash  $archiveName`n",
    $utf8NoBom
)

$metadata = [ordered]@{
    image = $ImageTag
    platform = $Platform
    image_id = (docker image inspect $ImageTag --format '{{.Id}}').Trim()
    created_at = (Get-Date).ToUniversalTime().ToString("o")
    git_commit = (git -C $projectRoot rev-parse HEAD).Trim()
    git_dirty = [bool](git -C $projectRoot status --porcelain)
}
$metadataJson = $metadata | ConvertTo-Json
[System.IO.File]::WriteAllText(
    (Join-Path $outputDirectory "BUILD-METADATA.json"),
    $metadataJson + "`n",
    $utf8NoBom
)

Write-Host "离线部署包已生成：$outputDirectory" -ForegroundColor Green

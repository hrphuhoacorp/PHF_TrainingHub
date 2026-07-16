$ErrorActionPreference = "Stop"

$source = Split-Path -Parent $MyInvocation.MyCommand.Path
$target = Join-Path $source "PHF_TrainingHub_GoiChiaSe_AnToan"
$zipPath = Join-Path $source "PHF_TrainingHub_GoiChiaSe_AnToan.zip"

$excludedDirectories = @(
    ".git",
    "node_modules",
    "_backup_old",
    "PHF_TrainingHub_GoiChiaSe_AnToan"
)

$excludedFiles = @(
    ".env",
    ".bsb.lock",
    "PHF_TrainingHub_GoiChiaSe_AnToan.zip",
    "Tao_Goi_ChiaSe_AnToan.ps1"
)

if (Test-Path $target) {
    Remove-Item $target -Recurse -Force
}
if (Test-Path $zipPath) {
    Remove-Item $zipPath -Force
}

New-Item -ItemType Directory -Path $target | Out-Null

Get-ChildItem -Path $source -Force | ForEach-Object {
    if ($_.PSIsContainer) {
        if ($excludedDirectories -notcontains $_.Name) {
            Copy-Item $_.FullName -Destination (Join-Path $target $_.Name) -Recurse -Force
        }
    }
    elseif ($excludedFiles -notcontains $_.Name -and $_.Extension -notin @(".log", ".tmp", ".bak")) {
        Copy-Item $_.FullName -Destination (Join-Path $target $_.Name) -Force
    }
}

Compress-Archive -Path (Join-Path $target "*") -DestinationPath $zipPath -CompressionLevel Optimal
Write-Host "Đã tạo gói chia sẻ an toàn:" -ForegroundColor Green
Write-Host $zipPath
Write-Host "Gói không chứa .env, .git, node_modules và thư mục sao lưu." -ForegroundColor Yellow

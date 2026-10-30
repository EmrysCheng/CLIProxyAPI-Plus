# ==============================================================================
# CLIProxyAPI Plus - Cross-Platform Multi-Arch Packaging Script (PowerShell)
# Supported OS and Architectures:
#   - Windows (amd64, arm64) -> .zip
#   - Linux   (amd64, arm64) -> .tar.gz
#   - macOS   (amd64, arm64) -> .tar.gz
# ==============================================================================

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Split-Path -Parent $ScriptDir
Set-Location $RootDir

$DistDir = Join-Path $RootDir "dist"
$TmpBuildDir = Join-Path $DistDir ".tmp"

# Build version metadata
$Version = if ($env:VERSION) { $env:VERSION.TrimStart("v") } else { "8.0.47-plus" }
$Commit = if ($env:COMMIT) { $env:COMMIT } else { "release" }
$BuildDate = if ($env:BUILD_DATE) { $env:BUILD_DATE } else { (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ") }

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " CLIProxyAPI Plus - Multi-Platform Packaging (PowerShell)" -ForegroundColor Cyan
Write-Host " Version: $Version | Commit: $Commit | Date: $BuildDate" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# 1. Environment checks
if (-not (Get-Command "go" -ErrorAction SilentlyContinue)) {
    Write-Error "[Error] Go environment not found. Please install Go 1.22+"
}
if (-not (Get-Command "node" -ErrorAction SilentlyContinue)) {
    Write-Error "[Error] Node.js environment not found. Please install Node.js 18+"
}
if (-not (Get-Command "npm" -ErrorAction SilentlyContinue)) {
    Write-Error "[Error] npm environment not found."
}

# 2. Build frontend web panel
Write-Host "`n[Step 1/4] Building web management panel (web/ -> internal/webui/static)..." -ForegroundColor Yellow
Push-Location (Join-Path $RootDir "web")
try {
    if (-not (Test-Path "node_modules")) {
        Write-Host "Installing frontend dependencies (npm install)..."
        npm install
    }
    npm run build
} finally {
    Pop-Location
}

$IndexHtml = Join-Path $RootDir "internal\webui\static\index.html"
if (-not (Test-Path $IndexHtml)) {
    Write-Error "[Error] Static asset internal/webui/static/index.html missing. Frontend build failed!"
}
Write-Host "[Success] Frontend assets embedded into internal/webui/static/" -ForegroundColor Green

# 3. Initialize output directory
Write-Host "`n[Step 2/4] Initializing output directory: $DistDir..." -ForegroundColor Yellow
if (Test-Path $DistDir) {
    Remove-Item -Recurse -Force $DistDir
}
New-Item -ItemType Directory -Path $DistDir | Out-Null
New-Item -ItemType Directory -Path $TmpBuildDir | Out-Null

$LdFlags = "-s -w -X main.Version=$Version -X main.Commit=$Commit -X main.BuildDate=$BuildDate"

# Platform matrix
$Platforms = @(
    @{ OS = "windows"; Arch = "amd64"; Bin = "cliproxyapi-plus.exe"; Format = "zip";    Tag = "windows_amd64" },
    @{ OS = "windows"; Arch = "arm64"; Bin = "cliproxyapi-plus.exe"; Format = "zip";    Tag = "windows_arm64" },
    @{ OS = "linux";   Arch = "amd64"; Bin = "cliproxyapi-plus";     Format = "tar.gz"; Tag = "linux_amd64" },
    @{ OS = "linux";   Arch = "arm64"; Bin = "cliproxyapi-plus";     Format = "tar.gz"; Tag = "linux_arm64" },
    @{ OS = "darwin";  Arch = "amd64"; Bin = "cliproxyapi-plus";     Format = "tar.gz"; Tag = "darwin_amd64" },
    @{ OS = "darwin";  Arch = "arm64"; Bin = "cliproxyapi-plus";     Format = "tar.gz"; Tag = "darwin_arm64" }
)

# 4. Matrix cross-compilation
Write-Host "`n[Step 3/4] Cross-compiling across platform matrix..." -ForegroundColor Yellow

foreach ($item in $Platforms) {
    $os = $item.OS
    $arch = $item.Arch
    $bin = $item.Bin
    $format = $item.Format
    $tag = $item.Tag

    Write-Host "`n>>> Compiling: OS=$os ARCH=$arch ($tag)..." -ForegroundColor Magenta

    $pkgDir = Join-Path $TmpBuildDir $tag
    if (Test-Path $pkgDir) { Remove-Item -Recurse -Force $pkgDir }
    New-Item -ItemType Directory -Path $pkgDir | Out-Null

    $targetBinPath = Join-Path $pkgDir $bin

    $env:CGO_ENABLED = "0"
    $env:GOOS = $os
    $env:GOARCH = $arch

    go build -buildvcs=false -ldflags="$LdFlags" -o $targetBinPath ./cmd/server
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Compilation failed: OS=$os ARCH=$arch"
    }

    # Bundle ancillary files
    $configExample = Join-Path $RootDir "config.example.yaml"
    if (Test-Path $configExample) { Copy-Item $configExample -Destination $pkgDir }
    $license = Join-Path $RootDir "LICENSE"
    if (Test-Path $license) { Copy-Item $license -Destination $pkgDir }
    $readme = Join-Path $RootDir "README.md"
    if (Test-Path $readme) { Copy-Item $readme -Destination $pkgDir }

    $archiveName = "CLIProxyAPI_Plus_${Version}_${tag}.${format}"
    $destArchive = Join-Path $DistDir $archiveName

    if ($format -eq "zip") {
        Compress-Archive -Path (Join-Path $pkgDir "*") -DestinationPath $destArchive -CompressionLevel Optimal
    } else {
        Push-Location $pkgDir
        try {
            tar -czf $destArchive *
        } finally {
            Pop-Location
        }
    }

    $fileSizeMB = (Get-Item $destArchive).Length / 1MB
    Write-Host ("    Archive generated: {0} ({1:N2} MB)" -f $archiveName, $fileSizeMB) -ForegroundColor Green
}

# Reset environment variables
$env:GOOS = ""
$env:GOARCH = ""
$env:CGO_ENABLED = ""

Remove-Item -Recurse -Force $TmpBuildDir

# 5. Generate SHA-256 checksums
Write-Host "`n[Step 4/4] Calculating SHA-256 checksums..." -ForegroundColor Yellow
$checksumPath = Join-Path $DistDir "checksums.txt"
$archives = Get-ChildItem -Path $DistDir -Filter "CLIProxyAPI_Plus_*"

$checksumLines = @()
foreach ($file in $archives) {
    $hash = (Get-FileHash -Path $file.FullName -Algorithm SHA256).Hash.ToLower()
    $checksumLines += "$hash  $($file.Name)"
}
$checksumLines | Set-Content -Path $checksumPath -Encoding UTF8

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " Build & Packaging completed successfully! Output: $DistDir" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
Get-ChildItem -Path $DistDir | Select-Object Name, Length

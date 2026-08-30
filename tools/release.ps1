# 尘年往事 · 发布脚本
# 作用：把 app/ 的最新前端同步到 release/app/，并重新打包启动器 exe 到 release/。
# 用法：powershell -ExecutionPolicy Bypass -File tools\release.ps1
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

# 1. 同步前端（/E 不带 /PURGE：保留 release.lnk 等仅本地存在的文件）
robocopy "$root\app" "$root\release\app" /E /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy 同步 app/ -> release/app 失败（code $LASTEXITCODE）" }
Write-Host "前端已同步：app/ -> release/app/"

# 2. 重新打包启动器（framework-dependent 单文件 exe -> release\尘年往事.exe）
Push-Location "$root\launcher"
dotnet publish -c Release -o "$root\release" --nologo -v q
Pop-Location
if ($LASTEXITCODE -ne 0) { throw "dotnet publish 失败" }

Write-Host "发布完成：release\尘年往事.exe + release\app\（运行数据 release\data\ 不受影响）"

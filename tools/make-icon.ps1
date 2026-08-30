# 生成「尘年往事」书形图标：app.ico（exe 用）+ icon.png（favicon 用）
# 用 Windows PowerShell 5.1 的 System.Drawing 绘制，完全离线。
param(
    [string]$OutDir = "D:\dairy"
)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

function New-BookBitmap([int]$size) {
    $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.Clear([System.Drawing.Color]::Transparent)

    $s = $size / 256.0  # 缩放系数

    # 书本外框（含圆角封面）
    $coverRect = New-Object System.Drawing.RectangleF((12 * $s), (20 * $s), (232 * $s), (216 * $s))
    $r = 18 * $s
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddArc($coverRect.X, $coverRect.Y, 2 * $r, 2 * $r, 180, 90)
    $path.AddArc($coverRect.Right - 2 * $r, $coverRect.Y, 2 * $r, 2 * $r, 270, 90)
    $path.AddArc($coverRect.Right - 2 * $r, $coverRect.Bottom - 2 * $r, 2 * $r, 2 * $r, 0, 90)
    $path.AddArc($coverRect.X, $coverRect.Bottom - 2 * $r, 2 * $r, 2 * $r, 90, 90)
    $path.CloseFigure()

    # 封面皮革渐变
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        $coverRect,
        [System.Drawing.Color]::FromArgb(255, 122, 78, 44),
        [System.Drawing.Color]::FromArgb(255, 74, 42, 22),
        25)
    $g.FillPath($brush, $path)

    # 封面内框（金色细线）
    $penGold = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(200, 212, 175, 96), (1.6 * $s))
    $inner = New-Object System.Drawing.RectangleF(($coverRect.X + 10 * $s), ($coverRect.Y + 10 * $s), ($coverRect.Width - 20 * $s), ($coverRect.Height - 20 * $s))
    $g.DrawRectangle($penGold, $inner.X, $inner.Y, $inner.Width, $inner.Height)

    # 书脊（左侧深色条 + 金色竖线）
    $spineW = 26 * $s
    $spineRect = New-Object System.Drawing.RectangleF($coverRect.X, $coverRect.Y, $spineW, $coverRect.Height)
    $spineBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        $spineRect,
        [System.Drawing.Color]::FromArgb(255, 58, 32, 16),
        [System.Drawing.Color]::FromArgb(255, 94, 56, 30),
        0)
    $spinePath = New-Object System.Drawing.Drawing2D.GraphicsPath
    $spinePath.AddArc($coverRect.X, $coverRect.Y, 2 * $r, 2 * $r, 180, 90)
    $spinePath.AddLine($coverRect.X + $spineW, $coverRect.Y, $coverRect.X + $spineW, $coverRect.Bottom)
    $spinePath.AddArc($coverRect.X, $coverRect.Bottom - 2 * $r, 2 * $r, 2 * $r, 90, 90)
    $spinePath.CloseFigure()
    $g.FillPath($spineBrush, $spinePath)
    $penSpineGold = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(220, 212, 175, 96), (1.4 * $s))
    $g.DrawLine($penSpineGold, ($coverRect.X + $spineW - 8 * $s), ($coverRect.Y + 16 * $s), ($coverRect.X + $spineW - 8 * $s), ($coverRect.Bottom - 16 * $s))

    # 右侧书页（纸边）
    $pageW = 14 * $s
    $pageRect = New-Object System.Drawing.RectangleF(($coverRect.Right - $pageW), ($coverRect.Y + 4 * $s), $pageW, ($coverRect.Height - 8 * $s))
    $pageBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        $pageRect,
        [System.Drawing.Color]::FromArgb(255, 248, 240, 224),
        [System.Drawing.Color]::FromArgb(255, 214, 196, 164),
        0)
    $g.FillRectangle($pageBrush, $pageRect)
    $penLine = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(120, 150, 128, 96), (0.8 * $s))
    for ($i = 1; $i -lt 5; $i++) {
        $y = $pageRect.Y + ($pageRect.Height * $i / 5)
        $g.DrawLine($penLine, $pageRect.X + 1 * $s, $y, $pageRect.Right - 1 * $s, $y)
    }

    # 封面中央金色菱形饰纹（书徽）
    $cx = $coverRect.X + ($coverRect.Width + $spineW) / 2
    $cy = $coverRect.Y + $coverRect.Height / 2
    $orn = 26 * $s
    $d1 = [System.Drawing.PointF]::new($cx, $cy - $orn)
    $d2 = [System.Drawing.PointF]::new($cx + $orn * 0.7, $cy)
    $d3 = [System.Drawing.PointF]::new($cx, $cy + $orn)
    $d4 = [System.Drawing.PointF]::new($cx - $orn * 0.7, $cy)
    $diamond = New-Object System.Drawing.Drawing2D.GraphicsPath
    $diamond.AddPolygon([System.Drawing.PointF[]]@($d1, $d2, $d3, $d4))
    $diamond.CloseFigure()
    $g.DrawPath($penGold, $diamond)
    $penGold.Width = 2.2 * $s
    $g.DrawEllipse($penGold, ($cx - 4 * $s), ($cy - 4 * $s), (8 * $s), (8 * $s))

    # 顶部书签缎带
    $rx = $coverRect.X + $coverRect.Width * 0.62
    $ribbon = New-Object System.Drawing.Drawing2D.GraphicsPath
    $p1 = [System.Drawing.PointF]::new($rx, $coverRect.Y - 2 * $s)
    $p2 = [System.Drawing.PointF]::new($rx + 16 * $s, $coverRect.Y - 2 * $s)
    $p3 = [System.Drawing.PointF]::new($rx + 16 * $s, $coverRect.Y + 52 * $s)
    $p4 = [System.Drawing.PointF]::new($rx + 8 * $s, $coverRect.Y + 42 * $s)
    $p5 = [System.Drawing.PointF]::new($rx, $coverRect.Y + 52 * $s)
    $ribbon.AddPolygon([System.Drawing.PointF[]]@($p1, $p2, $p3, $p4, $p5))
    $ribbon.CloseFigure()
    $rb = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 176, 62, 46))
    $g.FillPath($rb, $ribbon)

    # 底部投影
    $shadow = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(60, 0, 0, 0))
    $ell = New-Object System.Drawing.RectangleF(($coverRect.X + 8 * $s), ($coverRect.Bottom - 2 * $s), ($coverRect.Width - 16 * $s), (12 * $s))
    $g.FillEllipse($shadow, $ell)

    $penGold.Dispose(); $penLine.Dispose(); $brush.Dispose(); $spineBrush.Dispose()
    $rb.Dispose(); $shadow.Dispose(); $path.Dispose(); $spinePath.Dispose(); $diamond.Dispose(); $ribbon.Dispose()
    $g.Dispose()
    return $bmp
}

$launcherDir = Join-Path $OutDir "launcher"
$assetDir = Join-Path $OutDir "app\assets"
New-Item -ItemType Directory -Force -Path $launcherDir | Out-Null
New-Item -ItemType Directory -Force -Path $assetDir | Out-Null

# favicon：256px PNG
$bmp256 = New-BookBitmap 256
$pngPath = Join-Path $assetDir "icon.png"
$bmp256.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp256.Dispose()

# exe 图标：32px ICO
$bmp32 = New-BookBitmap 32
$hIcon = $bmp32.GetHicon()
$icon = [System.Drawing.Icon]::FromHandle($hIcon)
$icoPath = Join-Path $launcherDir "app.ico"
$fs = [System.IO.File]::Create($icoPath)
$icon.Save($fs)
$fs.Close()
$icon.Dispose()
$bmp32.Dispose()

Write-Host "OK: $pngPath"
Write-Host "OK: $icoPath"

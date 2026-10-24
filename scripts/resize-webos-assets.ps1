Add-Type -AssemblyName System.Drawing

$webosDir = Resolve-Path "$PSScriptRoot\..\webos"
$srcIconPath = Resolve-Path "$PSScriptRoot\..\assets\images\icon.png"

# Full-bleed icon generator: crops the inner black box (102,102, 307,307)
# so the black background fills the ENTIRE icon without an outer transparent border
function Generate-TVIcon($src, $dest, $w, $h) {
    $srcImg = [System.Drawing.Bitmap]::FromFile($src)
    $bmp = New-Object System.Drawing.Bitmap($w, $h, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    
    # Fill entire tile with solid black
    $blackBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 0, 0, 0))
    $g.FillRectangle($blackBrush, 0, 0, $w, $h)
    $blackBrush.Dispose()

    # Crop the 307x307 inner graphic (X=102, Y=102, W=307, H=307) and scale to full tile
    $srcRect = New-Object System.Drawing.Rectangle(102, 102, 307, 307)
    $destRect = New-Object System.Drawing.Rectangle(0, 0, $w, $h)
    $g.DrawImage($srcImg, $destRect, $srcRect, [System.Drawing.GraphicsUnit]::Pixel)

    $g.Dispose()
    $srcImg.Dispose()
    
    $temp = "$dest.tmp"
    $bmp.Save($temp, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Move-Item -Path $temp -Destination $dest -Force
    Write-Host "Generated seamless full-bleed TV icon: $dest (${w}x${h})"
}

function Create-BlackImage($dest, $w, $h) {
    $bmp = New-Object System.Drawing.Bitmap($w, $h, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 0, 0, 0))
    $g.FillRectangle($brush, 0, 0, $w, $h)
    $brush.Dispose()
    $g.Dispose()
    
    $temp = "$dest.tmp"
    $bmp.Save($temp, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Move-Item -Path $temp -Destination $dest -Force
    Write-Host "Generated: $dest (${w}x${h}) solid black"
}

# 1. icon.png: 80x80 px seamless black
Generate-TVIcon $srcIconPath "$webosDir\icon.png" 80 80

# 2. largeIcon.png: 130x130 px seamless black
Generate-TVIcon $srcIconPath "$webosDir\largeIcon.png" 130 130

# 3. bgImage.png: 1920x1080 px solid black
Create-BlackImage "$webosDir\bgImage.png" 1920 1080

# 4. splashBackground.png: 1920x1080 px solid black
Create-BlackImage "$webosDir\splashBackground.png" 1920 1080

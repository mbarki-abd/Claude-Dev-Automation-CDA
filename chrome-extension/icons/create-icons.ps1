Add-Type -AssemblyName System.Drawing

function Create-Icon($size, $path) {
    $bitmap = New-Object System.Drawing.Bitmap $size, $size
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = 'AntiAlias'

    # Fill with purple
    $brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(124, 58, 237))
    $graphics.FillEllipse($brush, 0, 0, ($size-1), ($size-1))

    # Add C text
    $fontSize = [int]($size * 0.4)
    $font = New-Object System.Drawing.Font 'Arial', $fontSize, ([System.Drawing.FontStyle]::Bold)
    $whiteBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
    $sf = New-Object System.Drawing.StringFormat
    $sf.Alignment = 'Center'
    $sf.LineAlignment = 'Center'
    $rect = New-Object System.Drawing.RectangleF 0, 0, $size, $size
    $graphics.DrawString('C', $font, $whiteBrush, $rect, $sf)

    $bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    $graphics.Dispose()
    $bitmap.Dispose()
    Write-Host "Created $path"
}

Create-Icon 16 'icon16.png'
Create-Icon 48 'icon48.png'
Create-Icon 128 'icon128.png'

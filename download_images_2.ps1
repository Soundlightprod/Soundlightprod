# Complement photos boutique -- 25 produits manquants
# Usage : PowerShell dans le dossier ou tu veux les images :
#   powershell -ExecutionPolicy Bypass -File .\download_images_2.ps1

New-Item -ItemType Directory -Force -Path "." | Out-Null
$ok = 0
$fail = 0
$headers = @{
  "User-Agent" = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
  "Referer" = "https://www.aicpose.com/"
}

function Get-Image($url, $outfile) {
  if (Test-Path $outfile) { return $true }
  for ($attempt = 1; $attempt -le 3; $attempt++) {
    try {
      Invoke-WebRequest -Uri $url -OutFile $outfile -Headers $headers -UseBasicParsing -TimeoutSec 20
      return $true
    } catch {
      Start-Sleep -Milliseconds (800 * $attempt)
    }
  }
  return $false
}

Write-Host "Telechargement : new-1940w-bee-eye-moving-light-power-750w"
if (Get-Image "https://shopcdnalpha.grainajz.com/category/397951/3881/bc630e812b8fbcca09f33cb5cd8383f1/New_19%C3%9740W_Bee-eye_Moving_Light_Power_750W-1.jpg" "new-1940w-bee-eye-moving-light-power-750w.jpg") { $ok++ } else { Write-Host "  -> ECHEC new-1940w-bee-eye-moving-light-power-750w" -ForegroundColor Red; $fail++ }
Start-Sleep -Milliseconds 350
Write-Host "Telechargement : aicpose-ip65-1915w-zoom-par-light--outdoor-waterproof-rgbw-wash"
if (Get-Image "https://shopcdnalpha.grainajz.com/category/397951/3881/e1f7c98bdd0b34d224d58c662ae1bb55/IP65_19%C3%9715W_Zoom_Par_Light-1.jpg" "aicpose-ip65-1915w-zoom-par-light--outdoor-waterproof-rgbw-wash.jpg") { $ok++ } else { Write-Host "  -> ECHEC aicpose-ip65-1915w-zoom-par-light--outdoor-waterproof-rgbw-wash" -ForegroundColor Red; $fail++ }
Start-Sleep -Milliseconds 350
Write-Host "Telechargement : ip65-1940w-bee-eye-moving-light-"
if (Get-Image "https://shopcdnalpha.grainajz.com/category/397951/3881/df9f69b4d176e0ff8d983dba78192b12/IP65_1940W_Bee-Eye_Moving_Light-1.jpg" "ip65-1940w-bee-eye-moving-light-.jpg") { $ok++ } else { Write-Host "  -> ECHEC ip65-1940w-bee-eye-moving-light-" -ForegroundColor Red; $fail++ }
Start-Sleep -Milliseconds 350
Write-Host "Telechargement : stage-light-bars-1810w-led-tubo"
if (Get-Image "https://shopcdnalpha.grainajz.com/category/397951/3881/350edbe419709f4b8801b438573320a0/18%C3%9710W_LED_Tubo-1.jpg" "stage-light-bars-1810w-led-tubo.jpg") { $ok++ } else { Write-Host "  -> ECHEC stage-light-bars-1810w-led-tubo" -ForegroundColor Red; $fail++ }
Start-Sleep -Milliseconds 350
Write-Host "Telechargement : 300w-zoom-cob-spotlight"
if (Get-Image "https://shopcdnalpha.grainajz.com/category/397951/3881/98ec9d8791f5ea2744293688e5640369/300W%20Zoom%20COB%20spotlight-1.jpg" "300w-zoom-cob-spotlight.jpg") { $ok++ } else { Write-Host "  -> ECHEC 300w-zoom-cob-spotlight" -ForegroundColor Red; $fail++ }
Start-Sleep -Milliseconds 350
Write-Host "Telechargement : 418w-mini-battery-par-light"
if (Get-Image "https://shopcdnalpha.grainajz.com/category/397951/3881/943c5611d5423a126e5d9c3fdc075a3f/4%C3%9718W%20Mini%20Battery%20Par%20Light-1.jpg" "418w-mini-battery-par-light.jpg") { $ok++ } else { Write-Host "  -> ECHEC 418w-mini-battery-par-light" -ForegroundColor Red; $fail++ }
Start-Sleep -Milliseconds 350
Write-Host "Telechargement : aicpose-mini-1940w-big-bee-moving-light-with-ring-wash--beam--spot"
if (Get-Image "https://shopcdnalpha.grainajz.com/category/397951/3881/4e0d607d4e9cb2bb80c5393a222feeaa/Mini%201940W%20Big%20Bee%20Moving%20Light%20with%20Ring-1.jpg" "aicpose-mini-1940w-big-bee-moving-light-with-ring-wash--beam--spot.jpg") { $ok++ } else { Write-Host "  -> ECHEC aicpose-mini-1940w-big-bee-moving-light-with-ring-wash--beam--spot" -ForegroundColor Red; $fail++ }
Start-Sleep -Milliseconds 350
Write-Host "Telechargement : mini-230w-beam-moving-light"
if (Get-Image "https://shopcdnalpha.grainajz.com/category/397951/3881/97c65a85217d7b2bfb3044ff42f06bf4/Mini%20230W%20Beam%20Moving%20Light-1.jpg" "mini-230w-beam-moving-light.jpg") { $ok++ } else { Write-Host "  -> ECHEC mini-230w-beam-moving-light" -ForegroundColor Red; $fail++ }
Start-Sleep -Milliseconds 350
Write-Host "Telechargement : 1940w-big-bee-moving-light"
if (Get-Image "https://shopcdnalpha.grainajz.com/category/397951/3881/e63c37ab6b9210074d71646296169f1b/1940W%20Big%20Bee%20Moving%20Light-1.jpg" "1940w-big-bee-moving-light.jpg") { $ok++ } else { Write-Host "  -> ECHEC 1940w-big-bee-moving-light" -ForegroundColor Red; $fail++ }
Start-Sleep -Milliseconds 350
Write-Host "Telechargement : aicpose-500w-cmy-cto-bsw-3in1-moving-light"
if (Get-Image "https://shopcdnalpha.grainajz.com/category/397951/3881/6671f71434fe93888440d7d5e39eb364/500W%20CMY%20CTO%20BSW%203in1%20Moving%20light-1.jpg" "aicpose-500w-cmy-cto-bsw-3in1-moving-light.jpg") { $ok++ } else { Write-Host "  -> ECHEC aicpose-500w-cmy-cto-bsw-3in1-moving-light" -ForegroundColor Red; $fail++ }
Start-Sleep -Milliseconds 350
Write-Host "Telechargement : 1925w-bee-beam-wash-moving-light-k15"
if (Get-Image "https://shopcdnalpha.grainajz.com/category/397951/3881/4e6a78b91cac9cdda0a1a1d034a9510c/19%C3%9725W%20Bee%20Beam-Wash%20Moving%20Light%20K15-1.jpg" "1925w-bee-beam-wash-moving-light-k15.jpg") { $ok++ } else { Write-Host "  -> ECHEC 1925w-bee-beam-wash-moving-light-k15" -ForegroundColor Red; $fail++ }
Start-Sleep -Milliseconds 350
Write-Host "Telechargement : ip65-1218w-battery-par-light"
if (Get-Image "https://shopcdnalpha.grainajz.com/category/397951/3881/97fb5a0d4b4f4a190abb1a2d7873e5ed/12%C3%9718W%20Battery%20Par%20Light%20IP65-1.jpg" "ip65-1218w-battery-par-light.jpg") { $ok++ } else { Write-Host "  -> ECHEC ip65-1218w-battery-par-light" -ForegroundColor Red; $fail++ }
Start-Sleep -Milliseconds 350
Write-Host "Telechargement : 418w-battery-parlight"
if (Get-Image "https://shopcdnalpha.grainajz.com/category/397951/3881/31711972a755b5ad43bd52483747a620/4%C3%9718W%20battery%20Par-1.jpg" "418w-battery-parlight.jpg") { $ok++ } else { Write-Host "  -> ECHEC 418w-battery-parlight" -ForegroundColor Red; $fail++ }
Start-Sleep -Milliseconds 350
Write-Host "Telechargement : ip65-4410w-segments-control-flood-light"
if (Get-Image "https://shopcdnalpha.grainajz.com/category/397951/3881/122234a52fc722681df55e2269daa606/IP65%2044x10W.jpg" "ip65-4410w-segments-control-flood-light.jpg") { $ok++ } else { Write-Host "  -> ECHEC ip65-4410w-segments-control-flood-light" -ForegroundColor Red; $fail++ }
Start-Sleep -Milliseconds 350
Write-Host "Telechargement : ip65-1818w-led-big-par-light"
if (Get-Image "https://shopcdnalpha.grainajz.com/category/397951/3881/cb1034d9c23c304ed18a62efddcbc5d3/IP65%2018x18W%20LED%20Big%20Par%20light-1.jpg" "ip65-1818w-led-big-par-light.jpg") { $ok++ } else { Write-Host "  -> ECHEC ip65-1818w-led-big-par-light" -ForegroundColor Red; $fail++ }
Start-Sleep -Milliseconds 350
Write-Host "Telechargement : 1940w-big-bee-moving-light-with-ring"
if (Get-Image "https://shopcdnalpha.grainajz.com/category/397951/3881/e89f779c981afea7f1d49643b9daadaf/1940W%20Big%20Bee%20Moving%20Light%20with%20Ring-1.jpg" "1940w-big-bee-moving-light-with-ring.jpg") { $ok++ } else { Write-Host "  -> ECHEC 1940w-big-bee-moving-light-with-ring" -ForegroundColor Red; $fail++ }
Start-Sleep -Milliseconds 350
Write-Host "Telechargement : 8-way-dmx-splitter-booster-with-artnet"
if (Get-Image "https://shopcdnalpha.grainajz.com/category/397951/3881/4d18e2f30a5a9a9de125878dcd5ce238/8-way%20DMX%20Splitter%20Booster%20with%20Artnet-1.jpg" "8-way-dmx-splitter-booster-with-artnet.jpg") { $ok++ } else { Write-Host "  -> ECHEC 8-way-dmx-splitter-booster-with-artnet" -ForegroundColor Red; $fail++ }
Start-Sleep -Milliseconds 350
Write-Host "Telechargement : 1818w-rgbwauv-pixel-control-bar-light"
if (Get-Image "https://shopcdnalpha.grainajz.com/category/397951/3881/0b0b04d1a9df573104080cbedbafab5b/18x18W%20RGBWA%2BUV%20Pixel%20Control%20Bar%20Light-1.jpg" "1818w-rgbwauv-pixel-control-bar-light.jpg") { $ok++ } else { Write-Host "  -> ECHEC 1818w-rgbwauv-pixel-control-bar-light" -ForegroundColor Red; $fail++ }
Start-Sleep -Milliseconds 350
Write-Host "Telechargement : ip65-6010w-flood-light"
if (Get-Image "https://shopcdnalpha.grainajz.com/category/397951/3881/f276283d210e4b3e4ce9a323ad2e9168/IP65%2060x10W%20Flood%20Light-1.jpg" "ip65-6010w-flood-light.jpg") { $ok++ } else { Write-Host "  -> ECHEC ip65-6010w-flood-light" -ForegroundColor Red; $fail++ }
Start-Sleep -Milliseconds 350
Write-Host "Telechargement : ip65-4410w-flood-light"
if (Get-Image "https://shopcdnalpha.grainajz.com/category/397951/3881/6619b9b37f8bc7a4f2052c3205b6f75f/IP65%2044x10W%20Flood%20Light-1.jpg" "ip65-4410w-flood-light.jpg") { $ok++ } else { Write-Host "  -> ECHEC ip65-4410w-flood-light" -ForegroundColor Red; $fail++ }
Start-Sleep -Milliseconds 350
Write-Host "Telechargement : ip65-1818w-led-par-light-ultra"
if (Get-Image "https://shopcdnalpha.grainajz.com/category/397951/3881/bdb3ea48002ba5f98e016822c878fd7a/IP65%2018x18W%20LED%20Par%20light%20Ultra-2.jpg" "ip65-1818w-led-par-light-ultra.jpg") { $ok++ } else { Write-Host "  -> ECHEC ip65-1818w-led-par-light-ultra" -ForegroundColor Red; $fail++ }
Start-Sleep -Milliseconds 350
Write-Host "Telechargement : ip65-1818w-led-par-light"
if (Get-Image "https://shopcdnalpha.grainajz.com/category/397951/3881/585808fe1cb3b2cf527173381c72257f/IP65%2018x18W%20LED%20Par%20light-1.jpg" "ip65-1818w-led-par-light.jpg") { $ok++ } else { Write-Host "  -> ECHEC ip65-1818w-led-par-light" -ForegroundColor Red; $fail++ }
Start-Sleep -Milliseconds 350
Write-Host "Telechargement : ip65-618w-mini-battery-par-light"
if (Get-Image "https://shopcdnalpha.grainajz.com/category/397951/3881/e5a1d6c50b91685248bf4071d9dd3f8f/6x18W%20Mini%20Battery%20Par%20Light%20IP65-1.jpg" "ip65-618w-mini-battery-par-light.jpg") { $ok++ } else { Write-Host "  -> ECHEC ip65-618w-mini-battery-par-light" -ForegroundColor Red; $fail++ }
Start-Sleep -Milliseconds 350
Write-Host "Telechargement : ip65-618w-battery-par-light"
if (Get-Image "https://shopcdnalpha.grainajz.com/category/397951/3881/49f5c93c64b9f3d2cda0a6ab1dd1769d/6x18W%20Battery%20Par%20Light%20IP65-1.jpg" "ip65-618w-battery-par-light.jpg") { $ok++ } else { Write-Host "  -> ECHEC ip65-618w-battery-par-light" -ForegroundColor Red; $fail++ }
Start-Sleep -Milliseconds 350
Write-Host "Telechargement : 1818w-rgbwauv-led-par-light"
if (Get-Image "https://shopcdnalpha.grainajz.com/category/397951/3881/9aa9e62611537deea6ed1c67503f9a81/18x18W%20RGBWA%2BUV%20LED%20Par%20light-1.jpg" "1818w-rgbwauv-led-par-light.jpg") { $ok++ } else { Write-Host "  -> ECHEC 1818w-rgbwauv-led-par-light" -ForegroundColor Red; $fail++ }
Start-Sleep -Milliseconds 350

Write-Host ""
Write-Host "Termine : $ok ok, $fail echecs." -ForegroundColor Green
Read-Host "Appuie sur Entree pour fermer"

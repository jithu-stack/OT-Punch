# Local web server for web/ (no Node needed). Run start-local.bat, or:
#   powershell -ExecutionPolicy Bypass -File serve.ps1
param([string]$Root = (Join-Path $PSScriptRoot 'web'), [int]$Port = 8765)
$Root = [IO.Path]::GetFullPath($Root)
$l = [System.Net.HttpListener]::new()
$l.Prefixes.Add("http://localhost:$Port/")
$l.Start()
Write-Host "Serving $Root at http://localhost:$Port/  (Ctrl+C to stop)"
$types = @{ '.html'='text/html; charset=utf-8'; '.js'='text/javascript'; '.css'='text/css'; '.json'='application/json'; '.yaml'='text/yaml'; '.png'='image/png'; '.svg'='image/svg+xml'; '.ico'='image/x-icon' }
while ($l.IsListening) {
  $c = $l.GetContext()
  $p = [Uri]::UnescapeDataString($c.Request.Url.AbsolutePath.TrimStart('/'))
  if (-not $p) { $p = 'index.html' }
  $f = [IO.Path]::GetFullPath((Join-Path $Root $p))
  if ($f.StartsWith($Root) -and (Test-Path $f -PathType Leaf)) {
    $b = [IO.File]::ReadAllBytes($f)
    $ext = [IO.Path]::GetExtension($f)
    $c.Response.ContentType = $(if ($types[$ext]) { $types[$ext] } else { 'application/octet-stream' })
    $c.Response.Headers.Add('Cache-Control', 'no-store')
    $c.Response.OutputStream.Write($b, 0, $b.Length)
  } else { $c.Response.StatusCode = 404 }
  $c.Response.Close()
}

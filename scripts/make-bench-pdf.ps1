# Builds a minimal 6-page PDF for pause/resume benchmarking without
# requiring any third-party tooling. Uses only .NET BCL types.

$out = Join-Path $env:TEMP "printbit-bench\bench.pdf"
$dir = Split-Path $out -Parent
New-Item -ItemType Directory -Force -Path $dir | Out-Null

$pages = @()
for ($i = 1; $i -le 6; $i++) {
  $pages += "BT /F1 24 Tf 100 700 Td (Bench page $i of 6) Tj ET"
}

$objects = @()
$objects += "<< /Type /Catalog /Pages 2 0 R >>"
$objects += "<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R 6 0 R 7 0 R 8 0 R] /Count 6 >>"
$objects += "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 9 0 R /Resources << /Font << /F1 10 0 R >> >> >>"
$objects += "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 11 0 R /Resources << /Font << /F1 10 0 R >> >> >>"
$objects += "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 12 0 R /Resources << /Font << /F1 10 0 R >> >> >>"
$objects += "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 13 0 R /Resources << /Font << /F1 10 0 R >> >> >>"
$objects += "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 14 0 R /Resources << /Font << /F1 10 0 R >> >> >>"
$objects += "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 15 0 R /Resources << /Font << /F1 10 0 R >> >> >>"
$objects += "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
for ($i = 0; $i -lt 6; $i++) {
  $idx = 9 + ($i * 2)
  $objects += "<< /Length 50 >>`nstream`n$($pages[$i])`nendstream"
}

$pdf = "%PDF-1.4`n"
$offsets = @()
for ($i = 0; $i -lt $objects.Count; $i++) {
  $offsets += $pdf.Length
  $pdf += "$($i + 1) 0 obj`n$($objects[$i])`nendobj`n"
}
$xrefStart = $pdf.Length
$pdf += "xref`n0 $($objects.Count + 1)`n0000000000 65535 f `n"
foreach ($o in $offsets) {
  $pdf += ("{0:D10} 00000 n `n" -f $o)
}
$pdf += "trailer`n<< /Size $($objects.Count + 1) /Root 1 0 R >>`nstartxref`n$xrefStart`n%%EOF"

[System.IO.File]::WriteAllText($out, $pdf, [System.Text.Encoding]::ASCII)
Write-Host "Wrote $out ($([System.IO.File]::ReadAllBytes($out).Length) bytes)"
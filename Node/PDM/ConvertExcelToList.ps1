<#
.SYNOPSIS
    Converts an Excel file column to a text file (one item per line).

.DESCRIPTION
    Reads the first column of an Excel file and writes each value to a text file.
    Used to prepare input for the VBScript Pack & Go automation.

.PARAMETER ExcelPath
    Path to the Excel file.

.PARAMETER OutputPath
    Path for the output text file. Default: same name as Excel with .txt extension.

.PARAMETER Column
    Column letter or number to read. Default: A (first column).

.PARAMETER SkipHeader
    Skip the first row (header). Default: true.

.EXAMPLE
    .\ConvertExcelToList.ps1 -ExcelPath "H:\AssemFiles.xlsx"

.EXAMPLE
    .\ConvertExcelToList.ps1 -ExcelPath "H:\AssemFiles.xlsx" -OutputPath "H:\assemblies.txt" -Column "B"
#>

param(
    [Parameter(Mandatory=$true)]
    [string]$ExcelPath,

    [string]$OutputPath = "",

    [string]$Column = "A",

    [bool]$SkipHeader = $true
)

# Default output path
if (-not $OutputPath) {
    $OutputPath = [System.IO.Path]::ChangeExtension($ExcelPath, ".txt")
}

Write-Host "Converting Excel to text file..."
Write-Host "  Input:  $ExcelPath"
Write-Host "  Output: $OutputPath"
Write-Host "  Column: $Column"
Write-Host ""

# Open Excel
$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false

try {
    $workbook = $excel.Workbooks.Open($ExcelPath)
    $sheet = $workbook.Sheets.Item(1)

    $values = @()
    $row = if ($SkipHeader) { 2 } else { 1 }
    $emptyCount = 0

    # Read until we hit 10 consecutive empty rows
    while ($emptyCount -lt 10) {
        $cellValue = $sheet.Range("$Column$row").Text
        if ($cellValue -and $cellValue.Trim()) {
            $values += $cellValue.Trim()
            $emptyCount = 0
        } else {
            $emptyCount++
        }
        $row++
    }

    $workbook.Close($false)

    Write-Host "Found $($values.Count) items"

    # Write to text file
    $values | Out-File -FilePath $OutputPath -Encoding UTF8

    Write-Host "Saved to: $OutputPath"
    Write-Host ""
    Write-Host "Now run:"
    Write-Host "  cscript PDM-ExportAssembliesPNG.vbs `"$OutputPath`" `"C:\output`""
}
catch {
    Write-Host "ERROR: $_" -ForegroundColor Red
    exit 1
}
finally {
    $excel.Quit()
    [System.Runtime.Interopservices.Marshal]::ReleaseComObject($excel) | Out-Null
    [System.GC]::Collect()
}

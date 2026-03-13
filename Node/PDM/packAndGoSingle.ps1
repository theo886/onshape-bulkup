# Pack & Go a single SolidWorks assembly to a ZIP file
#
# Usage:
#   powershell -File packAndGoSingle.ps1 -AssemblyPath "C:\path\to\assembly.SLDASM" -OutputZip "C:\out\30093.zip"
#
# Exit codes:
#   0 = success
#   1 = failure

param(
    [Parameter(Mandatory=$true)]
    [string]$AssemblyPath,

    [Parameter(Mandatory=$true)]
    [string]$OutputZip
)

if (-not (Test-Path $AssemblyPath)) {
    Write-Error "Assembly file not found: $AssemblyPath"
    exit 1
}

# Ensure output directory exists
$outputDir = Split-Path -Parent $OutputZip
if ($outputDir -and -not (Test-Path $outputDir)) {
    New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
}

# Connect to running SolidWorks or start new instance
try {
    $swApp = [System.Runtime.InteropServices.Marshal]::GetActiveObject("SldWorks.Application")
    Write-Host "Connected to running SolidWorks instance"
} catch {
    Write-Host "Starting SolidWorks..."
    $swApp = New-Object -ComObject SldWorks.Application
    $swApp.Visible = $false
}

$swDocASSEMBLY = 2
$swOpenDocOptions_Silent = 1

try {
    # Open assembly
    Write-Host "Opening: $AssemblyPath"
    $errors = 0
    $warnings = 0
    $doc = $swApp.OpenDoc6($AssemblyPath, $swDocASSEMBLY, $swOpenDocOptions_Silent, "", [ref]$errors, [ref]$warnings)

    if ($doc -eq $null) {
        throw "Failed to open assembly. Error code: $errors"
    }

    # Get Pack & Go interface
    $packAndGo = $doc.Extension.GetPackAndGo()
    if ($packAndGo -eq $null) {
        throw "Failed to get Pack & Go interface"
    }

    # Configure: flatten to single folder, no drawings, no simulation
    $packAndGo.IncludeDrawings = $false
    $packAndGo.IncludeSimulationResults = $false
    $packAndGo.IncludeToolboxComponents = $true
    $packAndGo.FlattenToSingleFolder = $true

    # Set output to ZIP
    $packAndGo.SetSaveToName($true, $OutputZip)

    # Execute Pack & Go
    Write-Host "Saving Pack & Go to: $OutputZip"
    $result = $doc.Extension.SavePackAndGo($packAndGo)

    if (-not $result) {
        throw "SavePackAndGo returned false"
    }

    Write-Host "Pack & Go succeeded"

    # Close document without saving
    $swApp.CloseDoc($doc.GetTitle())
    exit 0
} catch {
    Write-Error "Pack & Go failed: $_"

    # Try to close any open document
    try {
        if ($doc) { $swApp.CloseDoc($doc.GetTitle()) }
    } catch {}

    exit 1
}

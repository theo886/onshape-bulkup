<#
.SYNOPSIS
    Exports SolidWorks assemblies using Pack & Go to zip files.

.DESCRIPTION
    Reads assembly paths from an Excel spreadsheet, opens each assembly in SolidWorks,
    and uses Pack & Go to export the assembly with all references (with correct configurations)
    to a zip file.

.PARAMETER ExcelPath
    Path to Excel file with assembly paths (one per row in column A).

.PARAMETER OutputFolder
    Destination folder for zip files. Default: C:\temp

.PARAMETER SkipHeader
    Skip the first row of Excel (header row). Default: $true

.PARAMETER IncludeDrawings
    Include associated drawings in Pack & Go. Default: $false

.PARAMETER VaultName
    Optional: PDM vault name to get latest version before Pack & Go.

.EXAMPLE
    .\PDM-ExportAssemblies.ps1 -ExcelPath "C:\input\assemblies.xlsx" -OutputFolder "C:\output"

.EXAMPLE
    .\PDM-ExportAssemblies.ps1 -ExcelPath "C:\input\assemblies.xlsx" -VaultName "Engineering" -IncludeDrawings
#>

param(
    [Parameter(Mandatory=$true)]
    [string]$ExcelPath,

    [string]$OutputFolder = "C:\temp",

    [bool]$SkipHeader = $true,

    [switch]$IncludeDrawings,

    [string]$VaultName = "",

    [switch]$GetLatestVersion
)

# Ensure output folder exists
if (-not (Test-Path $OutputFolder)) {
    New-Item -ItemType Directory -Path $OutputFolder -Force | Out-Null
}

# Create log file
$logFile = Join-Path $OutputFolder "PackAndGo_Export_$(Get-Date -Format 'yyyyMMdd_HHmmss').log"

function Write-Log {
    param([string]$Message, [string]$Level = "INFO")
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $logEntry = "[$timestamp] [$Level] $Message"
    Add-Content -Path $logFile -Value $logEntry

    switch ($Level) {
        "ERROR" { Write-Host $logEntry -ForegroundColor Red }
        "WARN"  { Write-Host $logEntry -ForegroundColor Yellow }
        "SUCCESS" { Write-Host $logEntry -ForegroundColor Green }
        default { Write-Host $logEntry }
    }
}

function Get-AssemblyPathsFromExcel {
    param([string]$ExcelPath, [bool]$SkipHeader)

    Write-Log "Reading Excel file: $ExcelPath"

    $excel = New-Object -ComObject Excel.Application
    $excel.Visible = $false
    $excel.DisplayAlerts = $false

    try {
        $workbook = $excel.Workbooks.Open($ExcelPath)
        $sheet = $workbook.Sheets.Item(1)

        $paths = @()
        $row = if ($SkipHeader) { 2 } else { 1 }

        while ($sheet.Cells.Item($row, 1).Text -ne "") {
            $path = $sheet.Cells.Item($row, 1).Text.Trim()
            if ($path) {
                $paths += $path
            }
            $row++
        }

        $workbook.Close($false)
        Write-Log "Found $($paths.Count) assembly paths in Excel"
        return $paths
    }
    finally {
        $excel.Quit()
        [System.Runtime.Interopservices.Marshal]::ReleaseComObject($excel) | Out-Null
        [System.GC]::Collect()
    }
}

function Connect-PDMVault {
    param([string]$VaultName)

    Write-Log "Connecting to PDM vault: $VaultName"

    try {
        $vault = New-Object -ComObject ConisioLib.EdmVault
        $vault.LoginAuto($VaultName, 0)

        if ($vault.IsLoggedIn) {
            Write-Log "Successfully logged into vault: $VaultName" "SUCCESS"
            return $vault
        } else {
            throw "Failed to log into vault"
        }
    }
    catch {
        Write-Log "Error connecting to vault: $_" "ERROR"
        return $null
    }
}

function Get-LatestFromPDM {
    param(
        $Vault,
        [string]$FilePath
    )

    try {
        $folderPath = [System.IO.Path]::GetDirectoryName($FilePath)
        $fileName = [System.IO.Path]::GetFileName($FilePath)

        $folder = $Vault.GetFolderFromPath($folderPath)
        if ($null -eq $folder) {
            Write-Log "  Folder not found in vault: $folderPath" "WARN"
            return
        }

        $file = $folder.GetFile($fileName)
        if ($null -eq $file) {
            Write-Log "  File not found in vault: $fileName" "WARN"
            return
        }

        # Get latest version - EdmGet_Simple = 1
        $file.GetFileCopy(0, 0, $folder.ID, 1)
        Write-Log "  Got latest from PDM: $fileName"
    }
    catch {
        Write-Log "  Could not get latest for $FilePath : $_" "WARN"
    }
}

function Export-WithPackAndGo {
    param(
        $SwApp,
        [string]$AssemblyPath,
        [string]$OutputZipPath,
        [bool]$IncludeDrawings
    )

    $errors = 0
    $warnings = 0
    $doc = $null

    # Error code lookup
    $errorCodes = @{
        0 = "Success"
        1 = "Generic error"
        2 = "File not found"
        3 = "File already open"
        4 = "Invalid file type"
        5 = "File too new"
        6 = "File too old"
        7 = "Not implemented"
        8 = "Sharing violation"
    }

    try {
        Write-Log "  Opening assembly in SolidWorks..."

        # Use OpenDoc (simpler, no ref params) or try multiple methods
        $doc = $null

        # Method 1: Try OpenDoc (simplest)
        try {
            $doc = $SwApp.OpenDoc($AssemblyPath, 2)  # 2 = swDocASSEMBLY
        }
        catch {
            Write-Log "  OpenDoc failed, trying alternative method..." "WARN"
        }

        # Method 2: Try using IDocumentSpecification (modern approach)
        if ($null -eq $doc) {
            try {
                $docSpec = $SwApp.GetOpenDocSpec($AssemblyPath)
                if ($null -ne $docSpec) {
                    $docSpec.DocumentType = 2  # swDocASSEMBLY
                    $docSpec.ReadOnly = $true
                    $docSpec.Silent = $true
                    $doc = $SwApp.OpenDoc7($docSpec)
                }
            }
            catch {
                Write-Log "  OpenDoc7 also failed: $_" "WARN"
            }
        }

        # Method 3: Activate if already open
        if ($null -eq $doc) {
            try {
                $fileName = [System.IO.Path]::GetFileName($AssemblyPath)
                $doc = $SwApp.ActivateDoc($fileName)
                if ($null -ne $doc) {
                    Write-Log "  Activated already-open document"
                }
            }
            catch {}
        }

        if ($null -eq $doc) {
            Write-Log "  Failed to open assembly - file may be missing or corrupted" "ERROR"
            return $false
        }

        Write-Log "  Assembly opened successfully"

        # Get Pack and Go object
        $packAndGo = $doc.Extension.GetPackAndGo()

        if ($null -eq $packAndGo) {
            Write-Log "  Failed to get Pack and Go object" "ERROR"
            return $false
        }

        # Configure Pack and Go options
        $packAndGo.FlattenToSingleFolder = $true
        $packAndGo.IncludeDrawings = $IncludeDrawings
        $packAndGo.IncludeSimulationResults = $false
        $packAndGo.IncludeToolboxComponents = $false
        $packAndGo.IncludeSuppressed = $true  # Include suppressed components

        # Get document count for logging
        $docCount = $packAndGo.GetDocumentNamesCount()
        Write-Log "  Pack and Go found $docCount documents"

        # Get the document names and statuses
        $docNames = $null
        $docStatuses = $null
        $packAndGo.GetDocumentNames([ref]$docNames)
        $packAndGo.GetDocumentSaveToNames([ref]$docNames, [ref]$docStatuses)

        # Set output to ZIP file
        $packAndGo.SetSaveToName($true, $OutputZipPath)

        Write-Log "  Running Pack and Go..."

        # Execute Pack and Go
        $statuses = $null
        $result = $doc.Extension.SavePackAndGo($packAndGo, [ref]$statuses)

        if ($result) {
            Write-Log "  Pack and Go completed successfully" "SUCCESS"

            # Check file size
            if (Test-Path $OutputZipPath) {
                $zipSize = (Get-Item $OutputZipPath).Length / 1MB
                Write-Log "  ZIP size: $([math]::Round($zipSize, 2)) MB"
            }

            return $true
        } else {
            Write-Log "  Pack and Go failed" "ERROR"

            # Log individual file statuses if available
            if ($null -ne $statuses) {
                for ($i = 0; $i -lt $statuses.Length; $i++) {
                    if ($statuses[$i] -ne 0) {
                        Write-Log "    File $i status: $($statuses[$i])" "WARN"
                    }
                }
            }

            return $false
        }
    }
    catch {
        Write-Log "  Error during Pack and Go: $_" "ERROR"
        return $false
    }
    finally {
        # Close the document
        if ($null -ne $doc) {
            try {
                $SwApp.CloseDoc($doc.GetTitle())
            } catch {}
        }
    }
}

# ============================================================================
# MAIN EXECUTION
# ============================================================================

Write-Log "=========================================="
Write-Log "SolidWorks Pack & Go Export Script"
Write-Log "=========================================="
Write-Log "Excel: $ExcelPath"
Write-Log "Output: $OutputFolder"
Write-Log "Include Drawings: $IncludeDrawings"
if ($VaultName) {
    Write-Log "PDM Vault: $VaultName"
    Write-Log "Get Latest: $GetLatestVersion"
}
Write-Log ""

$swApp = $null
$vault = $null

try {
    # Read assembly paths from Excel
    $assemblyPaths = Get-AssemblyPathsFromExcel -ExcelPath $ExcelPath -SkipHeader $SkipHeader

    if ($assemblyPaths.Count -eq 0) {
        Write-Log "No assembly paths found in Excel file" "ERROR"
        exit 1
    }

    # Connect to PDM vault if specified
    if ($VaultName -and $GetLatestVersion) {
        $vault = Connect-PDMVault -VaultName $VaultName
    }

    # Start SolidWorks
    Write-Log "Starting SolidWorks..."

    $swApp = $null

    # Try to get existing SolidWorks instance first
    try {
        $swApp = [System.Runtime.InteropServices.Marshal]::GetActiveObject("SldWorks.Application")
        Write-Log "Connected to existing SolidWorks instance" "SUCCESS"
    }
    catch {
        Write-Log "No existing SolidWorks instance found"
    }

    # If no existing instance, try to create new one
    if ($null -eq $swApp) {
        # Try different COM ProgIDs for different SW versions
        $progIds = @(
            "SldWorks.Application.32",  # SW 2024
            "SldWorks.Application.31",  # SW 2023
            "SldWorks.Application.30",  # SW 2022
            "SldWorks.Application"      # Generic
        )

        foreach ($progId in $progIds) {
            Write-Log "Trying COM ProgID: $progId"
            try {
                $swApp = New-Object -ComObject $progId
                Write-Log "Created SolidWorks using $progId" "SUCCESS"
                break
            }
            catch {
                Write-Log "  $progId not available"
            }
        }
    }

    if ($null -eq $swApp) {
        Write-Log "Failed to start SolidWorks. Please start SolidWorks manually first, then run this script." "ERROR"
        exit 1
    }

    # Try to make SolidWorks visible
    try {
        $swApp.Visible = $true
        Write-Log "SolidWorks set to visible"
    }
    catch {
        Write-Log "Could not set Visible property (this is OK)" "WARN"
    }

    # Wait for SolidWorks to fully initialize
    Write-Log "Waiting for SolidWorks to initialize..."
    Start-Sleep -Seconds 5

    # Verify SolidWorks is ready by trying to get version
    try {
        $swVersion = $swApp.RevisionNumber()
        if ($swVersion) {
            Write-Log "SolidWorks version: $swVersion" "SUCCESS"
        }
    }
    catch {
        Write-Log "Could not get SolidWorks version - waiting longer..." "WARN"
        Start-Sleep -Seconds 10
    }

    Write-Log "SolidWorks ready" "SUCCESS"

    # Process each assembly
    $successCount = 0
    $failCount = 0
    $totalCount = $assemblyPaths.Count
    $currentIndex = 0

    foreach ($assemblyPath in $assemblyPaths) {
        $currentIndex++
        Write-Log ""
        Write-Log "----------------------------------------"
        Write-Log "[$currentIndex/$totalCount] Processing: $assemblyPath"

        # Check if file exists
        if (-not (Test-Path $assemblyPath)) {
            Write-Log "  File not found: $assemblyPath" "ERROR"
            $failCount++
            continue
        }

        $assemblyName = [System.IO.Path]::GetFileNameWithoutExtension($assemblyPath)
        $zipPath = Join-Path $OutputFolder "$assemblyName.zip"

        # Skip if ZIP already exists
        if (Test-Path $zipPath) {
            Write-Log "  ZIP already exists, skipping: $zipPath" "WARN"
            $successCount++
            continue
        }

        try {
            # Get latest from PDM if requested
            if ($null -ne $vault -and $GetLatestVersion) {
                Write-Log "  Getting latest from PDM..."
                Get-LatestFromPDM -Vault $vault -FilePath $assemblyPath
            }

            # Run Pack and Go
            $result = Export-WithPackAndGo -SwApp $swApp -AssemblyPath $assemblyPath -OutputZipPath $zipPath -IncludeDrawings $IncludeDrawings

            if ($result) {
                $successCount++
            } else {
                $failCount++
            }
        }
        catch {
            Write-Log "  Error processing $assemblyPath : $_" "ERROR"
            $failCount++
        }

        # Clear SolidWorks memory periodically
        if ($currentIndex % 10 -eq 0) {
            Write-Log "  Clearing SolidWorks memory..."
            [System.GC]::Collect()
        }
    }

    Write-Log ""
    Write-Log "=========================================="
    Write-Log "COMPLETE: $successCount succeeded, $failCount failed"
    Write-Log "Output folder: $OutputFolder"
    Write-Log "Log file: $logFile"
    Write-Log "=========================================="
}
catch {
    Write-Log "Fatal error: $_" "ERROR"
    exit 1
}
finally {
    # Close SolidWorks
    if ($null -ne $swApp) {
        Write-Log "Closing SolidWorks..."
        try {
            $swApp.ExitApp()
            [System.Runtime.Interopservices.Marshal]::ReleaseComObject($swApp) | Out-Null
        } catch {}
    }

    [System.GC]::Collect()
}

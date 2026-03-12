' ============================================================================
' SolidWorks Pack & Go Export Script (VBScript)
'
' Usage: cscript PDM-ExportAssembliesPNG.vbs "C:\input\assemblies.txt" "C:\output"
'
' Input: Text file with one assembly path per line
' Output: ZIP files in output folder
'
' IMPORTANT: Start SolidWorks manually before running this script!
' ============================================================================

Option Explicit

Dim swApp
Dim fso
Dim inputFile
Dim outputFolder
Dim logFile
Dim successCount
Dim failCount

' Constants
Const swDocASSEMBLY = 2
Const swOpenDocOptions_Silent = 1
Const swOpenDocOptions_ReadOnly = 2

' Initialize
Set fso = CreateObject("Scripting.FileSystemObject")
successCount = 0
failCount = 0

' Parse command line arguments
If WScript.Arguments.Count < 2 Then
    WScript.Echo "Usage: cscript PDM-ExportAssembliesPNG.vbs <input_file> <output_folder>"
    WScript.Echo ""
    WScript.Echo "  input_file   - Text file with assembly paths (one per line)"
    WScript.Echo "  output_folder - Folder to save ZIP files"
    WScript.Quit 1
End If

inputFile = WScript.Arguments(0)
outputFolder = WScript.Arguments(1)

' Validate input file
If Not fso.FileExists(inputFile) Then
    WScript.Echo "ERROR: Input file not found: " & inputFile
    WScript.Quit 1
End If

' Create output folder if needed
If Not fso.FolderExists(outputFolder) Then
    fso.CreateFolder(outputFolder)
End If

' Create log file
Dim logPath
logPath = outputFolder & "\PackAndGo_" & GetTimestamp() & ".log"
Set logFile = fso.CreateTextFile(logPath, True)

WriteLog "=========================================="
WriteLog "SolidWorks Pack & Go Export Script"
WriteLog "=========================================="
WriteLog "Input: " & inputFile
WriteLog "Output: " & outputFolder
WriteLog ""

' Connect to SolidWorks
WriteLog "Connecting to SolidWorks..."
On Error Resume Next
Set swApp = GetObject(, "SldWorks.Application")
If Err.Number <> 0 Then
    WriteLog "ERROR: Could not connect to SolidWorks. Please start SolidWorks first!"
    WriteLog "Error: " & Err.Description
    WScript.Quit 1
End If
On Error GoTo 0

WriteLog "Connected to SolidWorks successfully"

' Make sure SW is visible
swApp.Visible = True

' Read assembly paths from file
Dim assemblyPaths
assemblyPaths = ReadLinesFromFile(inputFile)

WriteLog "Found " & UBound(assemblyPaths) + 1 & " assemblies to process"
WriteLog ""

' Process each assembly
Dim i, assemblyPath
For i = 0 To UBound(assemblyPaths)
    assemblyPath = Trim(assemblyPaths(i))

    ' Skip empty lines
    If Len(assemblyPath) > 0 Then
        WriteLog "----------------------------------------"
        WriteLog "[" & (i + 1) & "/" & (UBound(assemblyPaths) + 1) & "] Processing: " & assemblyPath

        If ProcessAssembly(assemblyPath, outputFolder) Then
            successCount = successCount + 1
        Else
            failCount = failCount + 1
        End If
    End If
Next

' Summary
WriteLog ""
WriteLog "=========================================="
WriteLog "COMPLETE: " & successCount & " succeeded, " & failCount & " failed"
WriteLog "Output folder: " & outputFolder
WriteLog "Log file: " & logPath
WriteLog "=========================================="

logFile.Close
WScript.Echo "Done! " & successCount & " succeeded, " & failCount & " failed"
WScript.Echo "Log: " & logPath

' ============================================================================
' Functions
' ============================================================================

Function ProcessAssembly(assemblyPath, outputFolder)
    ProcessAssembly = False

    ' Check if file exists
    If Not fso.FileExists(assemblyPath) Then
        WriteLog "  ERROR: File not found"
        Exit Function
    End If

    ' Get assembly name for ZIP file
    Dim assemblyName, zipPath
    assemblyName = fso.GetBaseName(assemblyPath)
    zipPath = outputFolder & "\" & assemblyName & ".zip"

    ' Skip if ZIP already exists
    If fso.FileExists(zipPath) Then
        WriteLog "  ZIP already exists, skipping"
        ProcessAssembly = True
        Exit Function
    End If

    ' Open assembly
    WriteLog "  Opening assembly..."
    Dim swDoc

    On Error Resume Next
    ' Use simple OpenDoc method (no error/warning parameters)
    Set swDoc = swApp.OpenDoc(assemblyPath, swDocASSEMBLY)
    If Err.Number <> 0 Then
        WriteLog "  ERROR opening assembly: " & Err.Description
        Err.Clear
        On Error GoTo 0
        Exit Function
    End If
    On Error GoTo 0

    If swDoc Is Nothing Then
        WriteLog "  ERROR: Could not open assembly"
        Exit Function
    End If

    WriteLog "  Assembly opened successfully"

    ' Get Pack and Go
    WriteLog "  Getting Pack and Go..."
    Dim swExtension, swPackAndGo

    ' First get the Extension object
    On Error Resume Next
    Set swExtension = swDoc.Extension
    If Err.Number <> 0 Then
        WriteLog "  ERROR getting Extension: " & Err.Description
        Err.Clear
        swApp.CloseDoc swDoc.GetTitle
        On Error GoTo 0
        Exit Function
    End If

    If swExtension Is Nothing Then
        WriteLog "  ERROR: Extension object is Nothing"
        swApp.CloseDoc swDoc.GetTitle
        On Error GoTo 0
        Exit Function
    End If

    WriteLog "  Got Extension object"

    ' Now get Pack and Go
    ' Try without parentheses first (VBScript style)
    Set swPackAndGo = swExtension.GetPackAndGo
    If Err.Number <> 0 Then
        WriteLog "  ERROR getting PackAndGo: " & Err.Description
        Err.Clear
        swApp.CloseDoc swDoc.GetTitle
        On Error GoTo 0
        Exit Function
    End If
    On Error GoTo 0

    If swPackAndGo Is Nothing Then
        WriteLog "  ERROR: PackAndGo object is Nothing"
        swApp.CloseDoc swDoc.GetTitle
        Exit Function
    End If

    WriteLog "  Got Pack and Go object"

    ' Configure Pack and Go
    swPackAndGo.FlattenToSingleFolder = True
    swPackAndGo.IncludeDrawings = False
    swPackAndGo.IncludeSimulationResults = False
    swPackAndGo.IncludeToolboxComponents = False

    ' Get document count
    Dim docCount
    docCount = swPackAndGo.GetDocumentNamesCount
    WriteLog "  Pack and Go found " & docCount & " documents"

    ' Set output path (ZIP)
    swPackAndGo.SetSaveToName True, zipPath

    ' Execute Pack and Go
    WriteLog "  Running Pack and Go..."
    Dim statuses
    Dim result

    On Error Resume Next
    result = swDoc.Extension.SavePackAndGo(swPackAndGo, statuses)
    If Err.Number <> 0 Then
        WriteLog "  ERROR during Pack and Go: " & Err.Description
        Err.Clear
        swApp.CloseDoc swDoc.GetTitle
        Exit Function
    End If
    On Error GoTo 0

    ' Close document
    swApp.CloseDoc swDoc.GetTitle

    If result Then
        WriteLog "  SUCCESS: Created " & zipPath

        ' Log file size
        If fso.FileExists(zipPath) Then
            Dim zipSize
            zipSize = Round(fso.GetFile(zipPath).Size / 1048576, 2)
            WriteLog "  ZIP size: " & zipSize & " MB"
        End If

        ProcessAssembly = True
    Else
        WriteLog "  ERROR: Pack and Go failed"
    End If
End Function

Function ReadLinesFromFile(filePath)
    Dim file, content, lines
    Set file = fso.OpenTextFile(filePath, 1)
    content = file.ReadAll
    file.Close

    ' Split by newlines (handle both Windows and Unix line endings)
    content = Replace(content, vbCrLf, vbLf)
    lines = Split(content, vbLf)

    ReadLinesFromFile = lines
End Function

Sub WriteLog(message)
    Dim logLine
    logLine = "[" & Now & "] " & message
    WScript.Echo logLine
    If Not logFile Is Nothing Then
        logFile.WriteLine logLine
    End If
End Sub

Function GetTimestamp()
    Dim d
    d = Now
    GetTimestamp = Year(d) & Right("0" & Month(d), 2) & Right("0" & Day(d), 2) & "_" & _
                   Right("0" & Hour(d), 2) & Right("0" & Minute(d), 2) & Right("0" & Second(d), 2)
End Function

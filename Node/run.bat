@echo off
setlocal EnableDelayedExpansion

REM ============================================================
REM Onshape Upload Tool - Windows Batch Runner
REM ============================================================
REM
REM SETUP: Edit the NODE_PATH below to point to your node.exe
REM
REM ============================================================

set "NODE_PATH=%~dp0node.exe"

REM ============================================================

if "%1"=="" goto help
if "%1"=="help" goto help
if "%1"=="test" goto test
if "%1"=="upload" goto upload
if "%1"=="upload-no-release" goto upload_norelease
if "%1"=="dry-run" goto dryrun
if "%1"=="slow-run" goto slowrun
if "%1"=="level" goto level
if "%1"=="levels" goto levels
if "%1"=="check" goto check
if "%1"=="assign" goto assign
if "%1"=="inspect" goto inspect
if "%1"=="clear" goto clear
if "%1"=="delete" goto delete
if "%1"=="edit" goto edit
if "%1"=="release" goto release
if "%1"=="version" goto version
if "%1"=="replace" goto replace
if "%1"=="add-pub-items" goto addpubitems
goto help

:help
echo.
echo  ============================================================
echo   Onshape Upload Tool
echo  ============================================================
echo.
echo   Usage: run [command] [options]
echo.
echo   Commands:
echo     test              Test API connection
echo     dry-run           Preview upload without executing
echo     slow-run          Upload with prompt after each file (y/n/f)
echo     upload            Run full upload (all levels)
echo     upload-no-release Upload and relink but skip release
echo     level N           Upload specific level only (0, 1, 2, etc.)
echo     levels            Show upload level distribution
echo     check             Check assembly dependencies
echo     assign            Assign upload levels to Excel
echo     inspect           Inspect Excel file for issues
echo     clear             Clear upload status cache
echo     delete            Delete elements from Excel list
echo     edit              Edit properties from Excel list
echo     release           Release documents from Excel list
echo     version           Create versions from Excel list (no release)
echo     replace           Replace files (keep same revision)
echo     help              Show this help
echo.
echo   Examples (just type the command, not 'run'):
echo     test
echo     dry-run
echo     slow-run
echo     level 0
echo     upload
echo.
echo  ============================================================
echo.
set /p COMMAND=Command:
if "%COMMAND%"=="exit" goto end
if "%COMMAND%"=="" goto help
call %0 %COMMAND%
goto help

:selectfile
REM Opens a file dialog and sets EXCEL_FILE variable
echo Opening file selector...
for /f "delims=" %%I in ('powershell -command "Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.OpenFileDialog; $f.Title = 'Select Excel File'; $f.Filter = 'Excel files (*.xlsx;*.xls)|*.xlsx;*.xls|All files (*.*)|*.*'; $f.InitialDirectory = '%~dp0Upload'; if ($f.ShowDialog() -eq 'OK') { $f.FileName }"') do set "EXCEL_FILE=%%I"
if "%EXCEL_FILE%"=="" (
    echo No file selected. Cancelled.
    pause
    goto end
)
echo Selected: %EXCEL_FILE%
echo.
goto :eof

:test
echo Testing API connection...
"%NODE_PATH%" apiTest.js
echo.
pause
goto end

:dryrun
call :selectfile
echo Running dry-run (preview only)...
"%NODE_PATH%" unifiedUpload.js -i "%EXCEL_FILE%" --dry-run
echo.
pause
goto end

:slowrun
call :selectfile
echo Running slow-run (prompts after each file)...
echo   y = continue to next file
echo   n = stop and save progress
echo   f = switch to fast mode (no more prompts)
echo.
"%NODE_PATH%" unifiedUpload.js -i "%EXCEL_FILE%" --slow-run
echo.
pause
goto end

:upload
call :selectfile
echo Running full upload...
"%NODE_PATH%" unifiedUpload.js -i "%EXCEL_FILE%" %2 %3 %4
echo.
pause
goto end

:upload_norelease
call :selectfile
echo Running upload (no release)...
"%NODE_PATH%" unifiedUpload.js -i "%EXCEL_FILE%" --skip-release %2 %3 %4
echo.
pause
goto end

:level
if "%2"=="" (
    set /p LEVEL_NUM=Enter level number:
) else (
    set LEVEL_NUM=%2
)
if "!LEVEL_NUM!"=="" (
    echo Error: Please specify a level number
    pause
    goto end
)
call :selectfile
echo Uploading level !LEVEL_NUM! only...
"%NODE_PATH%" unifiedUpload.js -i "%EXCEL_FILE%" --level !LEVEL_NUM! %3 %4 %5
echo.
pause
goto end

:levels
call :selectfile
echo Showing upload level distribution...
"%NODE_PATH%" inspectExcel.js -i "%EXCEL_FILE%"
echo.
pause
goto end

:check
call :selectfile
echo Checking assembly dependencies...
"%NODE_PATH%" checkAssemblyDependencies.js -i "%EXCEL_FILE%"
echo.
pause
goto end

:assign
call :selectfile
echo Assigning upload levels...
"%NODE_PATH%" assignLevels.js -i "%EXCEL_FILE%" -r "PDM\references.csv"
echo.
pause
goto end

:inspect
call :selectfile
echo Inspecting Excel file...
"%NODE_PATH%" inspectExcel.js -i "%EXCEL_FILE%"
echo.
pause
goto end

:clear
echo Clearing upload status cache...
if exist "Upload\upload_status.json" (
    del "Upload\upload_status.json"
    echo Deleted Upload\upload_status.json
) else (
    echo No cache file found.
)
echo.
pause
goto end

:delete
call :selectfile
set /p CONFIRM=Delete elements from %EXCEL_FILE%? (y/n):
if /i not "%CONFIRM%"=="y" (
    echo Cancelled.
    pause
    goto end
)
echo Deleting elements from Excel...
"%NODE_PATH%" deleteElementsFromExcel.js -i "%EXCEL_FILE%" %2 %3 %4
echo.
pause
goto end

:edit
call :selectfile
echo Editing properties from Excel...
"%NODE_PATH%" editPropertiesFromExcel.js -i "%EXCEL_FILE%"
echo.
pause
goto end

:release
call :selectfile
echo Releasing documents from Excel...
"%NODE_PATH%" releaseFromExcel.js -i "%EXCEL_FILE%"
echo.
pause
goto end

:version
call :selectfile
echo Creating versions from Excel...
"%NODE_PATH%" versionFromExcel.js -i "%EXCEL_FILE%"
echo.
pause
goto end

:replace
call :selectfile
echo Replacing files from Excel (keeping same revision)...
"%NODE_PATH%" replaceFromExcel.js -i "%EXCEL_FILE%"
echo.
pause
goto end

:addpubitems
call :selectfile
set /p PUB_ID=Enter publication ID:
if "%PUB_ID%"=="" (
    echo Error: Publication ID is required
    pause
    goto end
)
echo Adding items to publication %PUB_ID%...
"%NODE_PATH%" addToPublicationFromExcel.js -i "%EXCEL_FILE%" -p "%PUB_ID%" %2 %3 %4
echo.
pause
goto end

:end
endlocal

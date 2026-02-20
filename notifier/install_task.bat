@echo off
REM CarbuAlert - Installation de la tache planifiee Windows
REM Executez ce script en tant qu'administrateur

set SCRIPT_DIR=%~dp0
set PYTHON_PATH=python
set TASK_NAME=CarbuAlert_Notifier

echo === CarbuAlert - Installation de la tache planifiee ===
echo.

REM Installer les dependances Python
echo Installation des dependances Python...
%PYTHON_PATH% -m pip install -r "%SCRIPT_DIR%requirements.txt" --quiet
if %ERRORLEVEL% neq 0 (
    echo ERREUR: Impossible d'installer les dependances Python.
    echo Verifiez que Python est installe et dans le PATH.
    pause
    exit /b 1
)

REM Supprimer l'ancienne tache si elle existe
schtasks /delete /tn "%TASK_NAME%" /f >nul 2>&1

REM Creer la tache planifiee (toutes les 10 minutes)
schtasks /create ^
    /tn "%TASK_NAME%" ^
    /tr "\"%PYTHON_PATH%\" \"%SCRIPT_DIR%carbu_notifier.py\"" ^
    /sc MINUTE ^
    /mo 10 ^
    /f

if %ERRORLEVEL% equ 0 (
    echo.
    echo Tache planifiee "%TASK_NAME%" creee avec succes !
    echo Elle s'executera toutes les 10 minutes.
    echo.
    echo Pour la desinstaller: schtasks /delete /tn "%TASK_NAME%" /f
) else (
    echo.
    echo ERREUR: Impossible de creer la tache planifiee.
    echo Essayez d'executer ce script en tant qu'administrateur.
)

echo.
pause

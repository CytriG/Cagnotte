@echo off
rem Lance la Cagnotte virtuelle en local via WSL (env conda "cagnotte") puis ouvre le navigateur.
rem Arrêt : Ctrl+C dans cette fenêtre.
setlocal
set PORT=8000
set PYTHON=~/anaconda3/envs/cagnotte/bin/python
title Cagnotte virtuelle - http://localhost:%PORT%

rem "%~dp0." : dossier de ce fichier (le "." évite que le "\" final n'échappe le guillemet).
echo Verification des dependances...
wsl --cd "%~dp0." -e bash -c "%PYTHON% -m pip install -q -r requirements.txt"
if errorlevel 1 (
  echo Echec de l'installation des dependances.
  pause
  exit /b 1
)

rem Ouvre le navigateur après 3 s, le temps que le serveur démarre.
start "" /b cmd /c "timeout /t 3 /nobreak >nul & start http://localhost:%PORT%/impots.html"

echo Demarrage sur http://localhost:%PORT%  (Ctrl+C pour arreter)
wsl --cd "%~dp0." -e bash -c "%PYTHON% -m uvicorn app.main:app --reload --host 0.0.0.0 --port %PORT%"

pause

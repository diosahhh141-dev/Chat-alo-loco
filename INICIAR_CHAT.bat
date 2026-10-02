@echo off
title Entre Amigos - Chat
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo No encuentro Node.js en esta computadora.
  echo Instala la version LTS desde https://nodejs.org/ y vuelve a abrir este archivo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Preparando el chat por primera vez. Necesitas conexion a internet.
  call npm install
  if errorlevel 1 (
    echo No se pudieron descargar los componentes. Revisa tu conexion e intenta de nuevo.
    pause
    exit /b 1
  )
)

echo El chat estara en http://localhost:3000
start "" http://localhost:3000
call npm start
pause

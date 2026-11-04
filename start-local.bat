@echo off
rem Double-click to run Stemhub OT on this PC, then open http://localhost:8765/
start "" http://localhost:8765/
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1"

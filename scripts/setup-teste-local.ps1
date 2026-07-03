# Script PowerShell para configurar ProntoClinic Hub em Windows Server 2022
# Instala WSL2 + Ubuntu + Docker + Node.js + PostgreSQL + clona o repo

# Requer: Windows Server 2022 (com Hyper-V)
# Tempo: 30-40 min para install completo

# PARAMETROS
$SERVER_NAME = "prontoclinic-hub"
$REPO_URL = "https://github.com/luizjuniormedi-ship-it/prontoclinic-hub.git"
$DEST_DIR = "C:\ProntoClinic"
$WSL_DISTRO = "Ubuntu-22.04"

# ETAPA 1: Verificar prerrequisitos
Write-Host "=== Verificando prerrequisitos ===" -ForegroundColor Green
$os = (Get-CimInstance Win32_OperatingSystem).Caption
Write-Host "Sistema: $os"

# ETAPA 2: Instalar WSL2 (Windows Subsystem for Linux)
Write-Host "=== Instalando WSL2 ===" -ForegroundColor Green
wsl --install -d Ubuntu-22.04 --no-launch
wsl --set-default-version 2

# ETAPA 3: Instalar Docker Desktop para Windows
Write-Host "=== Instalando Docker Desktop ===" -ForegroundColor Green
$DOCKER_INSTALLER = "$env:TEMP\Docker Desktop Installer.exe"
Invoke-WebRequest -Uri "https://desktop.docker.com/win/main/amd64/Docker%20Desktop%20Installer.exe" -OutFile $DOCKER_INSTALLER
Start-Process $DOCKER_INSTALLER -ArgumentList "install", "--quiet", "--accept-license" -Wait
Start-Service com.docker.service

# ETAPA 4: Configurar PostgreSQL local (no Windows)
Write-Host "=== Instalando PostgreSQL 16 ===" -ForegroundColor Green
$PG_INSTALLER = "$env:TEMP\postgresql-16.3-1-windows-x64.exe"
Invoke-WebRequest -Uri "https://get.enterprisedb.com/postgresql/postgresql-16.3-1-windows-x64.exe" -OutFile $PG_INSTALLER
$pgArgs = "--mode unattended --superpassword ProntoClinic@2026 --port 5432 --locale Portuguese_Brasil"
Start-Process $PG_INSTALLER -ArgumentList $pgArgs -Wait

# ETAPA 5: Clonar o repositorio ProntoClinic Hub
Write-Host "=== Clonando repositorio ===" -ForegroundColor Green
if (-not (Test-Path $DEST_DIR)) {
    New-Item -ItemType Directory -Path $DEST_DIR -Force | Out-Null
    Set-Location $DEST_DIR
    git clone $REPO_URL .
    Write-Host "Repositorio clonado em: $DEST_DIR"
}

# ETAPA 6: Setup do banco de dados
Write-Host "=== Configurando banco de dados ===" -ForegroundColor Green
$env:PGPASSWORD = "ProntoClinic@2026"
& "C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres -c "CREATE DATABASE prontoclinic_hub;"
& "C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres -c "CREATE EXTENSION IF NOT EXISTS pgcrypto;"
& "C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres -c "CREATE EXTENSION IF NOT EXISTS pg_trgm;"
& "C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres -c "CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\";"

# ETAPA 7: Rodar migrations
Write-Host "=== Rodando migrations ===" -ForegroundColor Green
Set-Location $DEST_DIR
Get-ChildItem supabase\migrations\*.sql | Sort-Object Name | ForEach-Object {
    Write-Host "Aplicando: $($_.Name)"
    & "C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres -d prontoclinic_hub -f $_.FullName
}

# ETAPA 8: Build do frontend
Write-Host "=== Fazendo build do frontend ===" -ForegroundColor Green
cd $DEST_DIR
npm ci
npm run build

# ETAPA 9: Iniciar servico com PM2 (ou NSSM)
Write-Host "=== Instalando PM2 para gerenciar servico ===" -ForegroundColor Green
npm install -g pm2
pm2 start npm --name "prontoclinic-hub" -- run preview
pm2 save
pm2 startup

# ETAPA 10: Backup
Write-Host "=== Configurando backup diario ===" -ForegroundColor Green
$backupScript = @"
@echo off
set BACKUP_DIR=C:\Backups\ProntoClinic
if not exist "%BACKUP_DIR%" mkdir "%BACKUP_DIR%"
set TIMESTAMP=%date:~6,4%-%date:~3,2%-%date:~0,2%_%time:~0,2%-%time:~3,2%
"C:\Program Files\PostgreSQL\16\bin\pg_dump.exe" -U postgres -d prontoclinic_hub -F c -f "%BACKUP_DIR%\backup_%TIMESTAMP%.dump"
forfiles /p "%BACKUP_DIR%" /m *.dump /d -30 /c "cmd /c del @path" 2>nul
"@
$backupScript | Out-File -FilePath "C:\ProntoClinic\backup-diario.bat" -Encoding ASCII

# Agendar backup diario
$action = New-ScheduledTaskAction -Execute "C:\ProntoClinic\backup-diario.bat"
$trigger = New-ScheduledTaskTrigger -Daily -At 02:00
Register-ScheduledTask -TaskName "BackupProntoClinic" -Action $action -Trigger $trigger

# Relatorio final
Write-Host "=== SETUP CONCLUIDO ===" -ForegroundColor Green
Write-Host "Frontend: http://localhost:4173"
Write-Host "Banco: PostgreSQL 16 local (porta 5432)"
Write-Host "Backup diario as 02:00 em C:\Backups\ProntoClinic\"
Write-Host "SIGH: continua rodando na porta 47777 (sem interferencia)"
Write-Host ""
Write-Host "Proximo: migrar SIGH -> ProntoClinic (sabado 22h)"
Write-Host "Script: C:\ProntoClinic\scripts\migrate_sigh_to_postgres.py"
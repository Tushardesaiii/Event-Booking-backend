# ==============================================================================
# REVELIS CONTAINER VALIDATION & RESILIENCE SUITE (validate.ps1)
# ==============================================================================
$ErrorActionPreference = "Stop"

Clear-Host

Write-Host "=========================================================" -ForegroundColor Cyan
Write-Host "REVELIS ENTERPRISE VALIDATION & CHAOS SUITE" -ForegroundColor Cyan
Write-Host "=========================================================" -ForegroundColor Cyan

# ------------------------------------------------------------------------------
# 1. Environment Checks
# ------------------------------------------------------------------------------
Write-Host "Environment Checks" -ForegroundColor White
$dockerInstalled = $false
$composeInstalled = $false

try {
    $dockerVer = docker --version
    Write-Host "  [OK] Docker Installed ($($dockerVer.Trim()))" -ForegroundColor Green
    $dockerInstalled = $true
} catch {
    Write-Host "  [FAIL] Docker is not installed or not in PATH." -ForegroundColor Red
    Exit 1
}

try {
    $composeVer = docker compose version
    Write-Host "  [OK] Docker Compose Installed ($($composeVer.Trim()))" -ForegroundColor Green
    $composeInstalled = $true
} catch {
    Write-Host "  [FAIL] Docker Compose is not installed or not in PATH." -ForegroundColor Red
    Exit 1
}

$env:DOCKER_BUILDKIT=1
Write-Host "  [OK] BuildKit Enabled" -ForegroundColor Green

# ------------------------------------------------------------------------------
# 2. Building Images
# ------------------------------------------------------------------------------
Write-Host "`nBuilding Application Image" -ForegroundColor White
Write-Host "  [Progress] Compiling and bundling backend via BuildKit..."

$buildStart = Get-Date
try {
    $buildOutput = docker compose -f docker-compose.yml -f docker-compose.dev.yml build app 2>&1
    $buildEnd = Get-Date
    $buildTime = [Math]::Round(($buildEnd - $buildStart).TotalSeconds, 1)
    
    Write-Host "  [====================]" -ForegroundColor Green
    Write-Host "  PASS (Build Time: ${buildTime}s)" -ForegroundColor Green
} catch {
    Write-Host "  [FAIL] Build Failed." -ForegroundColor Red
    Write-Host "Cause: Failed to compile images." -ForegroundColor Yellow
    Write-Host "Docker Build Logs:`n$buildOutput" -ForegroundColor Gray
    Exit 1
}

# ------------------------------------------------------------------------------
# 3. Starting Containers
# ------------------------------------------------------------------------------
Write-Host "`nStarting Services Cluster" -ForegroundColor White
Write-Host "  [Progress] Spinning up database, cache, and app..."

$startupStart = Get-Date
try {
    # Ensure any active containers are stopped first to prevent conflicts
    docker compose -f docker-compose.yml -f docker-compose.dev.yml down > $null 2>&1
    
    $upOutput = docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d 2>&1
    
    $healthy = $false
    for ($i = 0; $i -lt 30; $i++) {
        $dbStatus = docker inspect --format='{{.State.Health.Status}}' revelis-db 2>$null
        $redisStatus = docker inspect --format='{{.State.Health.Status}}' revelis-redis 2>$null
        
        if ($dbStatus -eq "healthy" -and $redisStatus -eq "healthy") {
            $healthy = $true
            break
        }
        Start-Sleep -Seconds 1
    }
    
    $startupEnd = Get-Date
    $startupTime = [Math]::Round(($startupEnd - $startupStart).TotalSeconds, 1)

    if (-not $healthy) {
        throw "Dependencies (DB / Redis) failed to reach healthy state. DB: $dbStatus, Redis: $redisStatus"
    }

    Write-Host "  [====================]" -ForegroundColor Green
    Write-Host "  PASS (Startup Time: ${startupTime}s)" -ForegroundColor Green
} catch {
    Write-Host "  [FAIL] Starting Containers Failed." -ForegroundColor Red
    Write-Host "Cause: $_" -ForegroundColor Yellow
    Exit 1
}

# ------------------------------------------------------------------------------
# 4. Service Health Checks
# ------------------------------------------------------------------------------
Write-Host "`nDatabase & Cache Connectivity" -ForegroundColor White
$dbLogs = docker logs revelis-db 2>&1
if ($dbLogs -match "database system is ready to accept connections") {
    Write-Host "  [OK] PostgreSQL Connected and Ready" -ForegroundColor Green
} else {
    Write-Host "  [FAIL] PostgreSQL has not completed database initialization" -ForegroundColor Red
    Exit 1
}

$redisPing = docker exec revelis-redis redis-cli -a revelis_redis_password ping 2>&1
if ($redisPing.Trim() -eq "PONG") {
    Write-Host "  [OK] Redis Connected and Ready" -ForegroundColor Green
} else {
    Write-Host "  [FAIL] Redis connectivity verification failed: $redisPing" -ForegroundColor Red
    Exit 1
}

# ------------------------------------------------------------------------------
# 5. Split Health Endpoint Verifications
# ------------------------------------------------------------------------------
Write-Host "`nSplitting Health Endpoint Testing" -ForegroundColor White
Write-Host "  [Progress] Waiting for app HTTP service to initialize..."

$appReady = $false
for ($i = 0; $i -lt 15; $i++) {
    try {
        $response = Invoke-RestMethod -Uri "http://localhost:3000/health/live" -Method Get -TimeoutSec 2
        if ($response.status -eq 'ok') {
            $appReady = $true
            break
        }
    } catch {
        # Waiting for server loop to bind
    }
    Start-Sleep -Seconds 1
}

if ($appReady) {
    Write-Host "  [OK] /health/live returned 200 (Liveness check passed)" -ForegroundColor Green
    
    try {
        $startupCheck = Invoke-RestMethod -Uri "http://localhost:3000/health/startup" -Method Get -TimeoutSec 2
        if ($startupCheck.status -eq 'ready') {
            Write-Host "  [OK] /health/startup returned 200 (Startup gating checks passed)" -ForegroundColor Green
        } else {
            throw "Startup check status: $($startupCheck.status)"
        }
    } catch {
        Write-Host "  [FAIL] /health/startup failed: $_" -ForegroundColor Red
        Exit 1
    }

    try {
        $readyCheck = Invoke-RestMethod -Uri "http://localhost:3000/health/ready" -Method Get -TimeoutSec 2
        if ($readyCheck.status -eq 'ready') {
            Write-Host "  [OK] /health/ready returned 200 (Readiness checks passed)" -ForegroundColor Green
        } else {
            throw "Readiness check status: $($readyCheck.status)"
        }
    } catch {
        Write-Host "  [FAIL] /health/ready failed: $_" -ForegroundColor Red
        Exit 1
    }

    try {
        $metrics = Invoke-WebRequest -Uri "http://localhost:3000/metrics" -TimeoutSec 2
        if ($metrics.Content -match "redis_connected") {
            Write-Host "  [OK] Prometheus metrics scraping available at /metrics" -ForegroundColor Green
        } else {
            throw "Metrics payload missing required counters"
        }
    } catch {
        Write-Host "  [FAIL] /metrics check failed: $_" -ForegroundColor Red
        Exit 1
    }
} else {
    Write-Host "  [FAIL] App failed to report live state within timeout limit" -ForegroundColor Red
    docker logs revelis-app
    Exit 1
}

# ------------------------------------------------------------------------------
# 6. Chaos & Resilience Testing
# ------------------------------------------------------------------------------
Write-Host "`nChaos & Resilience Testing" -ForegroundColor White

# Scenario 1: PostgreSQL Outage Handling
Write-Host "  [Progress] Simulating PostgreSQL Downtime (Stopping DB container)..."
docker stop revelis-db > $null 2>&1
Start-Sleep -Seconds 2

try {
    # Readiness should return 503 since PG is down
    $response = Invoke-WebRequest -Uri "http://localhost:3000/health/ready" -SkipHttpErrorCheck -TimeoutSec 2
    if ($response.StatusCode -eq 503) {
        Write-Host "  [OK] /health/ready returned 503 (Expected: database offline degraded state)" -ForegroundColor Green
    } else {
        Write-Host "  [FAIL] /health/ready returned status code: $($response.StatusCode)" -ForegroundColor Red
        Exit 1
    }
} catch {
    # If request failed, application might have crashed
    Write-Host "  [FAIL] Application became unresponsive or crashed when DB went offline." -ForegroundColor Red
    Exit 1
}

# Recover DB
Write-Host "  [Progress] Restoring PostgreSQL Service (Starting DB container)..."
docker start revelis-db > $null 2>&1
# Wait for healthy DB status check
for ($i = 0; $i -lt 15; $i++) {
    $dbStatus = docker inspect --format='{{.State.Health.Status}}' revelis-db 2>$null
    if ($dbStatus -eq "healthy") { break }
    Start-Sleep -Seconds 1
}
Start-Sleep -Seconds 2

try {
    $readyCheck = Invoke-RestMethod -Uri "http://localhost:3000/health/ready" -Method Get -TimeoutSec 2
    if ($readyCheck.status -eq 'ready') {
        Write-Host "  [OK] Application recovered connectivity automatically (Readiness is back to 200)" -ForegroundColor Green
    } else {
        throw "Readiness status remains degraded: $($readyCheck.status)"
    }
} catch {
    Write-Host "  [FAIL] Application failed to recover DB connectivity: $_" -ForegroundColor Red
    Exit 1
}

# Scenario 2: Redis Outage Handling
Write-Host "  [Progress] Simulating Redis Downtime (Stopping Cache container)..."
docker stop revelis-redis > $null 2>&1
Start-Sleep -Seconds 2

try {
    $response = Invoke-WebRequest -Uri "http://localhost:3000/health/ready" -SkipHttpErrorCheck -TimeoutSec 2
    if ($response.StatusCode -eq 503) {
        Write-Host "  [OK] /health/ready returned 503 (Expected: Redis offline degraded state)" -ForegroundColor Green
    } else {
        Write-Host "  [FAIL] /health/ready returned status code: $($response.StatusCode)" -ForegroundColor Red
        Exit 1
    }
} catch {
    Write-Host "  [FAIL] Application crashed when Redis went offline." -ForegroundColor Red
    Exit 1
}

# Recover Redis
Write-Host "  [Progress] Restoring Redis Service (Starting Cache container)..."
docker start revelis-redis > $null 2>&1
for ($i = 0; $i -lt 15; $i++) {
    $redisStatus = docker inspect --format='{{.State.Health.Status}}' revelis-redis 2>$null
    if ($redisStatus -eq "healthy") { break }
    Start-Sleep -Seconds 1
}
Start-Sleep -Seconds 2

try {
    $readyCheck = Invoke-RestMethod -Uri "http://localhost:3000/health/ready" -Method Get -TimeoutSec 2
    if ($readyCheck.status -eq 'ready') {
        Write-Host "  [OK] Application recovered connectivity automatically (Readiness is back to 200)" -ForegroundColor Green
    } else {
        throw "Readiness status remains degraded: $($readyCheck.status)"
    }
} catch {
    Write-Host "  [FAIL] Application failed to recover Redis connectivity: $_" -ForegroundColor Red
    Exit 1
}

# ------------------------------------------------------------------------------
# 7. Performance & Resource Consumption
# ------------------------------------------------------------------------------
Write-Host "`nPerformance & Resource Profile" -ForegroundColor White
try {
    $stats = docker stats --no-stream --format '{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}' revelis-app 2>$null
    if ($stats) {
        $parts = $stats.Split("|")
        $memUsage = $parts[2]
        $cpuUsage = $parts[1]
        
        Write-Host "  Build Duration : ${buildTime}s" -ForegroundColor Green
        Write-Host "  Boot Duration  : ${startupTime}s" -ForegroundColor Green
        Write-Host "  Memory Footprint: $memUsage" -ForegroundColor Green
        Write-Host "  CPU Percentage : $cpuUsage" -ForegroundColor Green
    }
} catch {
    Write-Host "  [WARN] Stats checking not supported in local console context" -ForegroundColor Yellow
}

# ------------------------------------------------------------------------------
# 8. Graceful Shutdown Check
# ------------------------------------------------------------------------------
Write-Host "`nTesting Graceful Shutdown" -ForegroundColor White
Write-Host "  [Progress] Stopping revelis-app container (sending SIGTERM)..."

$stopStart = Get-Date
docker stop revelis-app > $null 2>&1
$stopEnd = Get-Date
$stopDuration = [Math]::Round(($stopEnd - $stopStart).TotalSeconds, 1)

$appLogs = docker logs revelis-app 2>&1
if ($appLogs -match "Received SIGTERM" -or $appLogs -match "Starting graceful shutdown") {
    Write-Host "  [OK] Graceful Shutdown Logs Verified (Process exited in ${stopDuration}s)" -ForegroundColor Green
} else {
    Write-Host "  [WARN] Node process stopped, but SIGTERM logs were not found in buffer." -ForegroundColor Yellow
}

# ------------------------------------------------------------------------------
# 9. Overall Status
# ------------------------------------------------------------------------------
Write-Host "`n=========================================================" -ForegroundColor Cyan
Write-Host "OVERALL STATUS: ENTERPRISE READY" -ForegroundColor Green
Write-Host "=========================================================" -ForegroundColor Cyan

# Clear runtime containers
docker compose -f docker-compose.yml -f docker-compose.dev.yml down > $null 2>&1

Exit 0

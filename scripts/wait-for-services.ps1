<#
.SYNOPSIS
    Block until the requested Compose services are actually ready.

.DESCRIPTION
    `docker compose up -d` returning does not mean a service can serve traffic.
    Migrations, seeds and pipeline runs need that distinction, and so does CI.

    This is the Windows counterpart of scripts/wait-for-services.sh and keeps
    the same service names, defaults and exit codes.

.EXAMPLE
    ./scripts/wait-for-services.ps1
    ./scripts/wait-for-services.ps1 -Services postgres,minio
#>
[CmdletBinding()]
param(
    [ValidateSet('postgres', 'minio', 'api')]
    [string[]]$Services = @('postgres', 'minio', 'api'),

    [int]$TimeoutSeconds = 120,

    [int]$IntervalSeconds = 2
)

$ErrorActionPreference = 'Stop'

$minioUrl = if ($env:MINIO_HEALTH_URL) {
    $env:MINIO_HEALTH_URL
} else {
    $port = if ($env:MINIO_API_HOST_PORT) { $env:MINIO_API_HOST_PORT } else { '9000' }
    "http://localhost:$port/minio/health/live"
}

$apiUrl = if ($env:API_HEALTH_URL) {
    $env:API_HEALTH_URL
} else {
    $port = if ($env:API_HOST_PORT) { $env:API_HOST_PORT } else { '4000' }
    "http://localhost:$port/health"
}

function Test-Endpoint {
    param([string]$Url)

    try {
        Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5 | Out-Null
        return $true
    } catch {
        return $false
    }
}

function Test-Postgres {
    # Credentials are read inside the container so they never appear in host
    # process arguments.
    docker compose exec -T postgres sh -c 'pg_isready -q -U "$POSTGRES_USER" -d "$POSTGRES_DB"' 2>$null | Out-Null
    return ($LASTEXITCODE -eq 0)
}

function Wait-Service {
    param(
        [string]$Name,
        [scriptblock]$Check
    )

    Write-Host "==> waiting for $Name " -NoNewline
    $elapsed = 0

    while (-not (& $Check)) {
        if ($elapsed -ge $TimeoutSeconds) {
            Write-Host "TIMED OUT after ${TimeoutSeconds}s"
            throw "$Name did not become ready within $TimeoutSeconds seconds"
        }
        Write-Host '.' -NoNewline
        Start-Sleep -Seconds $IntervalSeconds
        $elapsed += $IntervalSeconds
    }

    Write-Host ' ready'
}

foreach ($service in $Services) {
    switch ($service) {
        'postgres' { Wait-Service -Name 'postgres' -Check { Test-Postgres } }
        'minio'    { Wait-Service -Name 'minio' -Check { Test-Endpoint -Url $minioUrl } }
        # /health returns 503 until PostgreSQL is reachable, so a successful
        # request is the whole test.
        'api'      { Wait-Service -Name 'api' -Check { Test-Endpoint -Url $apiUrl } }
    }
}

Write-Host '==> all requested services are ready'

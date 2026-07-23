# Cloud Run Deployment Script for CalDAV Calendar Generator (PowerShell)
#
# Usage: .\deploy-cloud-run.ps1 -ProjectId "YOUR_PROJECT_ID" [-Region "asia-northeast1"] [-ServiceName "calendar-service"]
#
# Example: .\deploy-cloud-run.ps1 -ProjectId "my-project" -Region "asia-northeast1" -ServiceName "calendar-service"

param(
    [Parameter(Mandatory=$true)]
    [string]$ProjectId,

    [Parameter(Mandatory=$false)]
    [string]$Region = "asia-northeast1",

    [Parameter(Mandatory=$false)]
    [string]$ServiceName = "calendar-service"
)

Write-Host "=== CalDAV Calendar Generator - Cloud Run Deployment ===" -ForegroundColor Green
Write-Host ""

# Check if .env file exists
if (-Not (Test-Path ".env")) {
    Write-Host "Error: .env file not found" -ForegroundColor Red
    Write-Host "Please create a .env file with your configuration"
    Write-Host "You can use .env.example as a template"
    exit 1
}

# Load environment variables from .env
Write-Host "Loading environment variables from .env..." -ForegroundColor Yellow
$envVars = @{}
Get-Content .env | ForEach-Object {
    if ($_ -match '^\s*([^#][^=]+)=(.*)$') {
        $key = $matches[1].Trim()
        $value = $matches[2].Trim()
        # 行末コメント（VAR=value # メモ）を除去（クォートされていない値のみ）
        if ($value -notmatch '^["'']') {
            $value = ($value -replace '\s+#.*$', '').Trim()
        }
        # Remove quotes if present
        $value = $value -replace '^"(.*)"$', '$1'
        $value = $value -replace "^'(.*)'$", '$1'
        $envVars[$key] = $value
    }
}

# Check required environment variables
$requiredVars = @("GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "SESSION_SECRET")
foreach ($var in $requiredVars) {
    if (-Not $envVars.ContainsKey($var) -or [string]::IsNullOrWhiteSpace($envVars[$var])) {
        Write-Host "Error: $var is not set in .env file" -ForegroundColor Red
        exit 1
    }
}

# LLM は OpenAI / Anthropic のいずれかのキーが必要
$hasOpenAI = $envVars.ContainsKey("OPENAI_API_KEY") -and -not [string]::IsNullOrWhiteSpace($envVars["OPENAI_API_KEY"])
$hasAnthropic = $envVars.ContainsKey("ANTHROPIC_API_KEY") -and -not [string]::IsNullOrWhiteSpace($envVars["ANTHROPIC_API_KEY"])
if (-not $hasOpenAI -and -not $hasAnthropic) {
    Write-Host "Error: OPENAI_API_KEY か ANTHROPIC_API_KEY のどちらかを .env に設定してください" -ForegroundColor Red
    exit 1
}

Write-Host "[OK] Environment variables loaded" -ForegroundColor Green
Write-Host ""

# Set gcloud project
Write-Host "Setting gcloud project to: $ProjectId" -ForegroundColor Yellow
gcloud config set project $ProjectId

# Check if service already exists
Write-Host "Checking if service exists..." -ForegroundColor Yellow
$existingUrl = gcloud run services describe $ServiceName --region=$Region --format='value(status.url)' 2>$null

if ($existingUrl) {
    Write-Host "Updating existing service: $existingUrl" -ForegroundColor Yellow
    $redirectUri = "$existingUrl/auth/google/callback"
} else {
    Write-Host "This is a new deployment" -ForegroundColor Yellow
    $redirectUri = "https://$ServiceName-[hash].$Region.run.app/auth/google/callback"
}

# Build environment variables string
$corsOrigins = if ($envVars.ContainsKey("CORS_ORIGINS")) { $envVars["CORS_ORIGINS"] } else { "http://localhost:8080" }

Write-Host ""
Write-Host "Building and deploying to Cloud Run..." -ForegroundColor Yellow
Write-Host "Project: $ProjectId"
Write-Host "Region: $Region"
Write-Host "Service: $ServiceName"
Write-Host ""

# Create temporary env vars file for deployment
$envVarsFile = ".env.cloud-run.yaml"
$productionHost = if ($envVars.ContainsKey("PRODUCTION_HOST")) { $envVars["PRODUCTION_HOST"] } else { "" }
$llmProvider = if ($envVars.ContainsKey("LLM_PROVIDER")) { $envVars["LLM_PROVIDER"] } else { "openai" }

# NODE_ENV=production は必須（Firestore セッション・secure cookie を有効化）
$lines = @()
$lines += 'NODE_ENV: "production"'
$lines += "GOOGLE_CLIENT_ID: `"$($envVars['GOOGLE_CLIENT_ID'])`""
$lines += "GOOGLE_CLIENT_SECRET: `"$($envVars['GOOGLE_CLIENT_SECRET'])`""
$lines += "SESSION_SECRET: `"$($envVars['SESSION_SECRET'])`""
$lines += "GOOGLE_REDIRECT_URI: `"$redirectUri`""
$lines += "CORS_ORIGINS: `"$corsOrigins`""
$lines += "PRODUCTION_HOST: `"$productionHost`""
$lines += "LLM_PROVIDER: `"$llmProvider`""
if ($hasOpenAI) { $lines += "OPENAI_API_KEY: `"$($envVars['OPENAI_API_KEY'])`"" }
if ($envVars.ContainsKey("OPENAI_MODEL")) { $lines += "OPENAI_MODEL: `"$($envVars['OPENAI_MODEL'])`"" }
if ($hasAnthropic) { $lines += "ANTHROPIC_API_KEY: `"$($envVars['ANTHROPIC_API_KEY'])`"" }
if ($envVars.ContainsKey("ANTHROPIC_MODEL")) { $lines += "ANTHROPIC_MODEL: `"$($envVars['ANTHROPIC_MODEL'])`"" }
$envVarsContent = $lines -join "`n"

$envVarsContent | Out-File -FilePath $envVarsFile -Encoding UTF8

Write-Host "Created temporary environment variables file: $envVarsFile" -ForegroundColor Yellow

# Deploy to Cloud Run
# Note: .gcloudignore should exclude node_modules, so it won't be uploaded
Write-Host "Deploying to Cloud Run (node_modules will be excluded via .gcloudignore)..." -ForegroundColor Yellow

gcloud run deploy $ServiceName `
    --source . `
    --platform managed `
    --region $Region `
    --allow-unauthenticated `
    --env-vars-file $envVarsFile

# Clean up temporary file
if (Test-Path $envVarsFile) {
    Remove-Item $envVarsFile
    Write-Host "Cleaned up temporary file" -ForegroundColor Yellow
}

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "Deployment failed!" -ForegroundColor Red
    exit 1
}

# Get the deployed service URL
$serviceUrl = gcloud run services describe $ServiceName --region=$Region --format='value(status.url)'

# 新規デプロイ時は GOOGLE_REDIRECT_URI がプレースホルダのままなので、実URLで更新する
if ((-not $existingUrl) -and $serviceUrl) {
    Write-Host "Updating GOOGLE_REDIRECT_URI to actual service URL..." -ForegroundColor Yellow
    gcloud run services update $ServiceName --region $Region --update-env-vars "GOOGLE_REDIRECT_URI=$serviceUrl/auth/google/callback"
}

Write-Host ""
Write-Host "=== Deployment Complete ===" -ForegroundColor Green
Write-Host ""
Write-Host "Service URL: $serviceUrl" -ForegroundColor Green
Write-Host "Redirect URI: $serviceUrl/auth/google/callback" -ForegroundColor Green
Write-Host ""
Write-Host "[!] Important Next Steps:" -ForegroundColor Yellow
Write-Host "1. Go to Google Cloud Console (https://console.cloud.google.com/apis/credentials)"
Write-Host "2. Select your OAuth 2.0 Client ID"
Write-Host "3. Add the following to 'Authorized redirect URIs':"
Write-Host "   $serviceUrl/auth/google/callback" -ForegroundColor Green
Write-Host "4. Update your CORS_ORIGINS if needed:"
Write-Host "   $serviceUrl" -ForegroundColor Green
Write-Host "5. Sessions are stored in Firestore. The Cloud Run service account needs"
Write-Host "   roles/datastore.user, and a Firestore (Native mode) database must exist." -ForegroundColor Green
Write-Host ""
Write-Host "Deployment successful!" -ForegroundColor Green

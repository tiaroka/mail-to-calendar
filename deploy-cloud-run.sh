#!/bin/bash

# Cloud Run Deployment Script for CalDAV Calendar Generator
#
# Usage: ./deploy-cloud-run.sh [PROJECT_ID] [REGION] [SERVICE_NAME]
#
# Example: ./deploy-cloud-run.sh my-project asia-northeast1 calendar-service

set -e

# Default values
PROJECT_ID=${1:-""}
REGION=${2:-"asia-northeast1"}
SERVICE_NAME=${3:-"calendar-service"}

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== CalDAV Calendar Generator - Cloud Run Deployment ===${NC}"
echo ""

# Check if PROJECT_ID is provided
if [ -z "$PROJECT_ID" ]; then
    echo -e "${RED}Error: PROJECT_ID is required${NC}"
    echo "Usage: ./deploy-cloud-run.sh [PROJECT_ID] [REGION] [SERVICE_NAME]"
    echo "Example: ./deploy-cloud-run.sh my-project asia-northeast1 calendar-service"
    exit 1
fi

# Check if .env file exists
if [ ! -f .env ]; then
    echo -e "${RED}Error: .env file not found${NC}"
    echo "Please create a .env file with your configuration"
    echo "You can use .env.example as a template"
    exit 1
fi

# Load environment variables from .env
echo -e "${YELLOW}Loading environment variables from .env...${NC}"
export $(cat .env | grep -v '^#' | xargs)

# Check required environment variables
REQUIRED_VARS=("OPENAI_API_KEY" "GOOGLE_CLIENT_ID" "GOOGLE_CLIENT_SECRET" "SESSION_SECRET")
for VAR in "${REQUIRED_VARS[@]}"; do
    if [ -z "${!VAR}" ]; then
        echo -e "${RED}Error: $VAR is not set in .env file${NC}"
        exit 1
    fi
done

echo -e "${GREEN}✓ Environment variables loaded${NC}"
echo ""

# Set gcloud project
echo -e "${YELLOW}Setting gcloud project to: $PROJECT_ID${NC}"
gcloud config set project $PROJECT_ID

# Build and deploy to Cloud Run
echo -e "${YELLOW}Building and deploying to Cloud Run...${NC}"
echo "Project: $PROJECT_ID"
echo "Region: $REGION"
echo "Service: $SERVICE_NAME"
echo ""

# Get the deployed service URL (if exists)
EXISTING_URL=$(gcloud run services describe $SERVICE_NAME --region=$REGION --format='value(status.url)' 2>/dev/null || echo "")

if [ -z "$EXISTING_URL" ]; then
    echo -e "${YELLOW}This is a new deployment${NC}"
    REDIRECT_URI="https://$SERVICE_NAME-[hash].$REGION.run.app/auth/google/callback"
else
    echo -e "${YELLOW}Updating existing service: $EXISTING_URL${NC}"
    REDIRECT_URI="$EXISTING_URL/auth/google/callback"
fi

# Deploy to Cloud Run
gcloud run deploy $SERVICE_NAME \
    --source . \
    --platform managed \
    --region $REGION \
    --allow-unauthenticated \
    --set-env-vars "OPENAI_API_KEY=$OPENAI_API_KEY" \
    --set-env-vars "GOOGLE_CLIENT_ID=$GOOGLE_CLIENT_ID" \
    --set-env-vars "GOOGLE_CLIENT_SECRET=$GOOGLE_CLIENT_SECRET" \
    --set-env-vars "SESSION_SECRET=$SESSION_SECRET" \
    --set-env-vars "GOOGLE_REDIRECT_URI=$REDIRECT_URI" \
    --set-env-vars "CORS_ORIGINS=${CORS_ORIGINS:-http://localhost:8080}" \
    --set-env-vars "PRODUCTION_HOST=${PRODUCTION_HOST:-}"

# Get the deployed service URL
SERVICE_URL=$(gcloud run services describe $SERVICE_NAME --region=$REGION --format='value(status.url)')

echo ""
echo -e "${GREEN}=== Deployment Complete ===${NC}"
echo ""
echo -e "${GREEN}Service URL: $SERVICE_URL${NC}"
echo -e "${GREEN}Redirect URI: $SERVICE_URL/auth/google/callback${NC}"
echo ""
echo -e "${YELLOW}⚠️  Important Next Steps:${NC}"
echo "1. Go to Google Cloud Console (https://console.cloud.google.com/apis/credentials)"
echo "2. Select your OAuth 2.0 Client ID"
echo "3. Add the following to 'Authorized redirect URIs':"
echo -e "   ${GREEN}$SERVICE_URL/auth/google/callback${NC}"
echo "4. Update your CORS_ORIGINS if needed:"
echo -e "   ${GREEN}$SERVICE_URL${NC}"
echo ""
echo -e "${GREEN}Deployment successful! 🎉${NC}"

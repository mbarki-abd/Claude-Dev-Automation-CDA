#!/bin/bash
# CDA Full Deployment Script
# This script sets up the host and deploys CDA with Docker
# Usage: ./deploy.sh [--skip-setup]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "=== CDA Deployment Script ==="
echo "Project directory: $PROJECT_DIR"
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    echo "Please run as root (sudo)"
    exit 1
fi

# Parse arguments
SKIP_SETUP=false
for arg in "$@"; do
    case $arg in
        --skip-setup)
            SKIP_SETUP=true
            shift
            ;;
    esac
done

# Run host setup if not skipped
if [ "$SKIP_SETUP" = false ]; then
    echo "Running host setup..."
    bash "$SCRIPT_DIR/setup-host.sh"
else
    echo "Skipping host setup (--skip-setup flag provided)"
fi

# Check for required environment variables
echo ""
echo "Checking environment variables..."
REQUIRED_VARS=("ANTHROPIC_API_KEY")
OPTIONAL_VARS=("GITHUB_TOKEN" "HETZNER_API_TOKEN" "AZURE_CLIENT_ID" "AZURE_CLIENT_SECRET" "AZURE_TENANT_ID")

for var in "${REQUIRED_VARS[@]}"; do
    if [ -z "${!var}" ]; then
        echo "ERROR: Required environment variable $var is not set"
        echo "Please export $var before running this script"
        exit 1
    fi
done

for var in "${OPTIONAL_VARS[@]}"; do
    if [ -z "${!var}" ]; then
        echo "WARNING: Optional environment variable $var is not set"
    fi
done

# Build and deploy with Docker Compose
echo ""
echo "Building and deploying CDA containers..."
cd "$PROJECT_DIR"

# Create .env file if it doesn't exist
if [ ! -f .env ]; then
    echo "Creating .env file..."
    cat > .env << EOF
ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY:-}
GITHUB_TOKEN=${GITHUB_TOKEN:-}
HETZNER_API_TOKEN=${HETZNER_API_TOKEN:-}
AZURE_CLIENT_ID=${AZURE_CLIENT_ID:-}
AZURE_CLIENT_SECRET=${AZURE_CLIENT_SECRET:-}
AZURE_TENANT_ID=${AZURE_TENANT_ID:-}
PLANNER_PLAN_ID=${PLANNER_PLAN_ID:-}
EOF
fi

# Build and start containers
docker compose -f infrastructure/docker-compose.yml up -d --build

# Wait for services to be healthy
echo ""
echo "Waiting for services to be healthy..."
sleep 10

# Check service status
echo ""
echo "Checking service status..."
docker compose -f infrastructure/docker-compose.yml ps

# Test API health
echo ""
echo "Testing API health..."
API_HEALTH=$(curl -s http://localhost:3000/api/health || echo "FAILED")
if [[ "$API_HEALTH" == *"healthy"* ]]; then
    echo "API is healthy!"
else
    echo "WARNING: API health check failed"
    echo "Response: $API_HEALTH"
fi

echo ""
echo "=== Deployment Complete ==="
echo ""
echo "Services running:"
echo "  - API: http://localhost:3000"
echo "  - Dashboard: http://localhost:5173"
echo "  - PostgreSQL: localhost:5432"
echo "  - Redis: localhost:6379"
echo ""
echo "Next steps:"
echo "1. Configure nginx reverse proxy for SSL (optional)"
echo "2. Authenticate CLI tools on the host:"
echo "   - claude auth"
echo "   - az login"
echo "   - gcloud auth login"
echo "   - gh auth login"
echo ""

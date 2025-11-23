#!/bin/bash
#
# Build and run the Claude Dev Automation unified Docker container
#
# Usage:
#   ./scripts/docker-build.sh          # Build only
#   ./scripts/docker-build.sh --run    # Build and run
#   ./scripts/docker-build.sh --run -d # Build and run detached
#

set -e

cd "$(dirname "$0")/.."

echo "============================================"
echo "  Claude Dev Automation - Docker Build"
echo "============================================"
echo ""

# Check if Docker is available
if ! command -v docker &> /dev/null; then
    echo "Docker is not installed. Please install Docker first."
    echo "See: https://docs.docker.com/get-docker/"
    exit 1
fi

# Check if Docker daemon is running
if ! docker info &> /dev/null; then
    echo "Docker daemon is not running. Please start Docker."
    exit 1
fi

echo "Docker is ready!"
echo ""

RUN=false
DETACH=""

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --run|-r)
            RUN=true
            shift
            ;;
        -d|--detach)
            DETACH="-d"
            shift
            ;;
        *)
            shift
            ;;
    esac
done

# Build the container
echo "Building unified Docker container..."
echo "This may take several minutes on first build."
echo ""

docker build -t claude-dev-automation:unified -f docker/Dockerfile.unified .

echo ""
echo "Build successful!"

# Run if requested
if [ "$RUN" = true ]; then
    echo ""
    echo "Starting Claude Dev Automation container..."

    # Stop existing container if running
    docker stop cda-unified 2>/dev/null || true
    docker rm cda-unified 2>/dev/null || true

    # Build run command
    RUN_CMD="docker run --name cda-unified -p 8080:80"
    RUN_CMD="$RUN_CMD -v cda-postgres-data:/data/postgres"
    RUN_CMD="$RUN_CMD -v cda-redis-data:/data/redis"
    RUN_CMD="$RUN_CMD -v cda-logs:/var/log/supervisor"

    # Add .env file if exists
    if [ -f ".env" ]; then
        echo "Loading environment from .env file..."
        RUN_CMD="$RUN_CMD --env-file .env"
    fi

    RUN_CMD="$RUN_CMD $DETACH claude-dev-automation:unified"

    eval $RUN_CMD

    if [ -n "$DETACH" ]; then
        echo ""
        echo "Container started in background!"
        echo ""
        echo "Access the application:"
        echo "  Dashboard: http://localhost:8080"
        echo "  API:       http://localhost:8080/api"
        echo ""
        echo "Useful commands:"
        echo "  View logs:     docker logs -f cda-unified"
        echo "  Stop:          docker stop cda-unified"
        echo "  Restart:       docker restart cda-unified"
        echo "  Shell access:  docker exec -it cda-unified /bin/bash"
    fi
else
    echo ""
    echo "To run the container:"
    echo "  ./scripts/docker-build.sh --run"
    echo "  ./scripts/docker-build.sh --run -d"
    echo ""
    echo "Or using docker-compose:"
    echo "  docker-compose -f docker-compose.unified.yml up"
fi

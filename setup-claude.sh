#!/bin/bash
# Setup script for Claude Code in Docker container

echo "Setting up Claude Code authentication..."
echo ""
echo "This will open a shell in the container so you can run 'claude' to authenticate."
echo ""

# Make sure the container is running
if ! docker ps | grep -q kanban-prd-manager; then
    echo "Error: kanban-prd-manager container is not running."
    echo "Start it first with: docker compose up -d"
    exit 1
fi

echo "Opening shell in container..."
echo "Once inside, run: claude"
echo "This will authenticate and save your credentials to the persisted volume."
echo ""
echo "After authentication is complete, type 'exit' to leave the container."
echo ""

docker exec -it -u appuser kanban-prd-manager bash

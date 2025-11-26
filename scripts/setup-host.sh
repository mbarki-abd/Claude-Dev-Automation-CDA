#!/bin/bash
# CDA Host Setup Script
# This script installs all required CLI tools on the host machine
# Run this script on your server before deploying CDA

set -e

echo "=== CDA Host Setup Script ==="
echo "Installing required CLI tools..."
echo ""

# Update package lists
echo "[1/8] Updating package lists..."
apt-get update

# Install prerequisites
echo "[2/8] Installing prerequisites..."
apt-get install -y \
    ca-certificates \
    curl \
    wget \
    gnupg \
    lsb-release \
    apt-transport-https \
    jq \
    git \
    ssh

# Install Node.js 20
echo "[3/8] Installing Node.js 20..."
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
else
    echo "Node.js already installed: $(node --version)"
fi

# Install Claude Code CLI
echo "[4/9] Installing Claude Code CLI..."
if ! command -v claude &> /dev/null; then
    npm install -g @anthropic-ai/claude-code
else
    echo "Claude Code already installed: $(claude --version)"
fi

# Configure Claude Code with full permissions
echo "[5/9] Configuring Claude Code permissions..."
CLAUDE_CONFIG_DIR="$HOME/.claude"
CLAUDE_SETTINGS="$CLAUDE_CONFIG_DIR/settings.json"

mkdir -p "$CLAUDE_CONFIG_DIR"

cat > "$CLAUDE_SETTINGS" << 'CLAUDE_EOF'
{
  "permissions": {
    "allow": [
      "Bash(*)",
      "Read(*)",
      "Write(*)",
      "Edit(*)",
      "Glob(*)",
      "Grep(*)",
      "WebFetch(*)",
      "WebSearch(*)",
      "Task(*)",
      "NotebookEdit(*)"
    ],
    "deny": []
  },
  "enableAllProjectMcpServers": true
}
CLAUDE_EOF

echo "Claude Code configured with full permissions at $CLAUDE_SETTINGS"

# Install Azure CLI
echo "[6/9] Installing Azure CLI..."
if ! command -v az &> /dev/null; then
    curl -sL https://packages.microsoft.com/keys/microsoft.asc | gpg --dearmor -o /usr/share/keyrings/microsoft-archive-keyring.gpg
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/microsoft-archive-keyring.gpg] https://packages.microsoft.com/repos/azure-cli/ $(lsb_release -cs) main" > /etc/apt/sources.list.d/azure-cli.list
    apt-get update
    apt-get install -y azure-cli
else
    echo "Azure CLI already installed: $(az --version | head -1)"
fi

# Install Google Cloud CLI
echo "[7/9] Installing Google Cloud CLI..."
if ! command -v gcloud &> /dev/null; then
    curl https://packages.cloud.google.com/apt/doc/apt-key.gpg | gpg --dearmor -o /usr/share/keyrings/cloud.google.gpg
    echo "deb [signed-by=/usr/share/keyrings/cloud.google.gpg] https://packages.cloud.google.com/apt cloud-sdk main" > /etc/apt/sources.list.d/google-cloud-sdk.list
    apt-get update
    apt-get install -y google-cloud-cli
else
    echo "Google Cloud CLI already installed: $(gcloud --version | head -1)"
fi

# Install GitHub CLI
echo "[8/9] Installing GitHub CLI..."
if ! command -v gh &> /dev/null; then
    curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg
    chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list
    apt-get update
    apt-get install -y gh
else
    echo "GitHub CLI already installed: $(gh --version | head -1)"
fi

# Install Docker (if not already installed)
echo "[9/9] Installing Docker..."
if ! command -v docker &> /dev/null; then
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" > /etc/apt/sources.list.d/docker.list
    apt-get update
    apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
    systemctl enable docker
    systemctl start docker
else
    echo "Docker already installed: $(docker --version)"
fi

# Clean up
echo ""
echo "Cleaning up..."
apt-get clean
rm -rf /var/lib/apt/lists/*

# Verify installations
echo ""
echo "=== Installation Summary ==="
echo ""
echo "Node.js: $(node --version 2>/dev/null || echo 'NOT INSTALLED')"
echo "npm: $(npm --version 2>/dev/null || echo 'NOT INSTALLED')"
echo "Claude Code: $(claude --version 2>/dev/null || echo 'NOT INSTALLED')"
echo "Claude Settings: $([ -f "$HOME/.claude/settings.json" ] && echo 'CONFIGURED (Full Permissions)' || echo 'NOT CONFIGURED')"
echo "Azure CLI: $(az --version 2>/dev/null | head -1 || echo 'NOT INSTALLED')"
echo "Google Cloud CLI: $(gcloud --version 2>/dev/null | head -1 || echo 'NOT INSTALLED')"
echo "GitHub CLI: $(gh --version 2>/dev/null | head -1 || echo 'NOT INSTALLED')"
echo "Docker: $(docker --version 2>/dev/null || echo 'NOT INSTALLED')"
echo ""
echo "=== Setup Complete ==="
echo ""
echo "Claude Code is pre-configured with full permissions (no approval prompts)."
echo "Settings file: $HOME/.claude/settings.json"
echo ""
echo "Next steps:"
echo "1. Run 'claude auth' to authenticate Claude Code (or use CDA dashboard)"
echo "2. Run 'az login' to authenticate Azure CLI (or use CDA dashboard)"
echo "3. Run 'gcloud auth login' to authenticate Google Cloud CLI (or use CDA dashboard)"
echo "4. Run 'gh auth login' to authenticate GitHub CLI"
echo ""

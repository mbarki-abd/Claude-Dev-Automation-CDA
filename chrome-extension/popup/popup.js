// CLI Auth Manager - Popup Script
// Supports Claude Code, Azure CLI, and Google Cloud authentication

const API_BASE = 'https://cda.ilinqsoft.com/api';
const API_BASE_LOCAL = 'http://localhost:3000/api';

let isLocalServer = false;
let currentAuthSessions = {
  claude: null,
  azure: null,
  gcloud: null
};

// DOM Elements
const connectionDot = document.getElementById('connection-dot');
const connectionText = document.getElementById('connection-text');
const btnRemote = document.getElementById('btn-remote');
const btnLocal = document.getElementById('btn-local');
const logContainer = document.getElementById('log-container');

// Provider-specific elements
const providers = ['claude', 'azure', 'gcloud'];
const providerElements = {};

providers.forEach(provider => {
  providerElements[provider] = {
    status: document.getElementById(`${provider}-status`),
    details: document.getElementById(`${provider}-details`),
    authBtn: document.getElementById(`btn-auth-${provider}`),
    refreshBtn: document.getElementById(`btn-refresh-${provider}`),
    deviceCodeSection: document.getElementById(`${provider}-device-code`),
    codeDisplay: document.getElementById(`${provider}-code`)
  };
});

// Manual input elements
const manualProvider = document.getElementById('manual-provider');
const manualCodeInput = document.getElementById('manual-code-input');
const btnSubmitCode = document.getElementById('btn-submit-code');

// Utility functions
function getApiBase() {
  return isLocalServer ? API_BASE_LOCAL : API_BASE;
}

function addLog(message, type = '') {
  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  logContainer.appendChild(entry);
  logContainer.scrollTop = logContainer.scrollHeight;

  // Keep only last 20 entries
  while (logContainer.children.length > 20) {
    logContainer.removeChild(logContainer.firstChild);
  }
}

function updateConnectionStatus(connected) {
  if (connected) {
    connectionDot.className = 'status-dot connected';
    connectionText.textContent = 'Connected to server';
  } else {
    connectionDot.className = 'status-dot disconnected';
    connectionText.textContent = 'Disconnected';
  }
}

function updateProviderStatus(provider, status) {
  const elements = providerElements[provider];
  if (!elements) return;

  if (status.authenticated) {
    elements.status.className = 'auth-status-badge authenticated';
    elements.status.textContent = 'Authenticated';
    elements.details.textContent = status.details || 'Active';
    elements.deviceCodeSection.classList.remove('active');
  } else {
    elements.status.className = 'auth-status-badge not-authenticated';
    elements.status.textContent = 'Not Authenticated';
    elements.details.textContent = status.details || 'Click Authenticate to start';
  }
}

function showDeviceCode(provider, code, url) {
  const elements = providerElements[provider];
  if (!elements) return;

  elements.deviceCodeSection.classList.add('active');
  elements.codeDisplay.textContent = code || '--------';
  elements.status.className = 'auth-status-badge pending';
  elements.status.textContent = 'Pending...';

  // Open URL in new tab if provided
  if (url) {
    chrome.tabs.create({ url, active: true });
  }
}

// API Functions
async function fetchAuthStatus() {
  try {
    const response = await fetch(`${getApiBase()}/cli-auth/status`);
    if (!response.ok) throw new Error('Failed to fetch status');

    const data = await response.json();
    if (data.success) {
      updateConnectionStatus(true);

      // Update each provider
      if (data.data['claude-code']) {
        updateProviderStatus('claude', data.data['claude-code']);
      }
      if (data.data['azure-cli']) {
        updateProviderStatus('azure', data.data['azure-cli']);
      }
      if (data.data['gcloud']) {
        updateProviderStatus('gcloud', data.data['gcloud']);
      }

      addLog('Status refreshed', 'success');
    }
  } catch (error) {
    console.error('Status fetch error:', error);
    updateConnectionStatus(false);
    addLog('Failed to connect to server', 'error');
  }
}

async function startAuth(provider) {
  const apiProvider = provider === 'claude' ? 'claude-code' : provider === 'azure' ? 'azure-cli' : 'gcloud';
  addLog(`Starting ${provider} authentication...`);

  try {
    const response = await fetch(`${getApiBase()}/cli-auth/${apiProvider}/start`, {
      method: 'POST'
    });

    if (!response.ok) throw new Error('Failed to start auth');

    const data = await response.json();

    if (data.success && data.data) {
      currentAuthSessions[provider] = data.data;

      // Show device code if available
      if (data.data.userCode) {
        showDeviceCode(provider, data.data.userCode, data.data.authUrl);
        addLog(`Device code: ${data.data.userCode}`, 'success');
      } else if (data.data.authUrl) {
        // For OAuth flow without device code
        chrome.tabs.create({ url: data.data.authUrl, active: true });
        addLog('Opening auth URL...', 'success');

        // Start monitoring for completion
        monitorAuthSession(provider, data.data.id);
      }

      // Store session
      chrome.storage.local.set({ [`authSession_${provider}`]: data.data });
    } else {
      addLog(data.error?.message || 'Failed to start auth', 'error');
    }
  } catch (error) {
    console.error('Auth start error:', error);
    addLog(`Error: ${error.message}`, 'error');
  }
}

async function monitorAuthSession(provider, sessionId) {
  // Poll for session status
  const pollInterval = setInterval(async () => {
    try {
      const apiProvider = provider === 'claude' ? 'claude-code' : provider === 'azure' ? 'azure-cli' : 'gcloud';
      const response = await fetch(`${getApiBase()}/cli-auth/${apiProvider}/session/${sessionId}`);

      if (response.ok) {
        const data = await response.json();

        if (data.data?.status === 'success') {
          clearInterval(pollInterval);
          addLog(`${provider} authentication complete!`, 'success');
          fetchAuthStatus();
        } else if (data.data?.status === 'failed') {
          clearInterval(pollInterval);
          addLog(`${provider} authentication failed`, 'error');
          providerElements[provider].deviceCodeSection.classList.remove('active');
        }
      }
    } catch (error) {
      // Ignore polling errors
    }
  }, 3000);

  // Stop polling after 5 minutes
  setTimeout(() => {
    clearInterval(pollInterval);
  }, 300000);
}

async function submitManualCode(provider, code) {
  const apiProvider = provider === 'claude' ? 'claude-code' : provider === 'azure' ? 'azure-cli' : 'gcloud';
  addLog(`Submitting code for ${provider}...`);

  try {
    // Get current session
    const session = currentAuthSessions[provider];

    const response = await fetch(`${getApiBase()}/cli-auth/${apiProvider}/code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code,
        sessionId: session?.id
      })
    });

    if (response.ok) {
      addLog('Code submitted successfully', 'success');

      // Refresh status after a delay
      setTimeout(fetchAuthStatus, 2000);
    } else {
      const data = await response.json();
      addLog(data.error?.message || 'Failed to submit code', 'error');
    }
  } catch (error) {
    console.error('Code submit error:', error);
    addLog(`Error: ${error.message}`, 'error');
  }
}

// Event Listeners
btnRemote.addEventListener('click', () => {
  btnRemote.classList.add('active');
  btnLocal.classList.remove('active');
  isLocalServer = false;
  addLog('Switched to remote server');
  fetchAuthStatus();
});

btnLocal.addEventListener('click', () => {
  btnLocal.classList.add('active');
  btnRemote.classList.remove('active');
  isLocalServer = true;
  addLog('Switched to local server');
  fetchAuthStatus();
});

// Provider button handlers
providers.forEach(provider => {
  const elements = providerElements[provider];

  elements.authBtn.addEventListener('click', () => {
    startAuth(provider);
  });

  elements.refreshBtn.addEventListener('click', () => {
    fetchAuthStatus();
  });
});

// Manual code submission
btnSubmitCode.addEventListener('click', () => {
  const provider = manualProvider.value;
  const code = manualCodeInput.value.trim();

  if (code) {
    submitManualCode(provider, code);
    manualCodeInput.value = '';
  } else {
    addLog('Please enter a code', 'warning');
  }
});

manualCodeInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    btnSubmitCode.click();
  }
});

// Listen for messages from background script
chrome.runtime.onMessage.addListener((message) => {
  console.log('Popup received:', message);

  switch (message.type) {
    case 'auth_complete':
      addLog(`${message.provider || 'Auth'} completed!`, 'success');
      fetchAuthStatus();
      break;

    case 'auth_code_captured':
      addLog(`Code captured for ${message.provider}`, 'success');
      break;

    case 'status_update':
      if (message.data) {
        updateProviderStatus(message.provider, message.data);
      }
      break;

    case 'device_code':
      showDeviceCode(message.provider, message.code, message.url);
      break;
  }
});

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  addLog('Extension loaded');
  fetchAuthStatus();

  // Periodic refresh
  setInterval(fetchAuthStatus, 30000);
});

// Initial fetch
fetchAuthStatus();

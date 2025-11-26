// CLI Auth Manager - Content Script
// Runs on Anthropic, Microsoft, and Google authentication pages

console.log('[CLI Auth Manager] Content script loaded on:', window.location.href);

// Detect which provider we're authenticating with
function detectProvider() {
  const url = window.location.href;
  if (url.includes('console.anthropic.com') || url.includes('claude.ai')) {
    return 'claude';
  }
  if (url.includes('microsoft.com') || url.includes('microsoftonline.com') || url.includes('login.live.com')) {
    return 'azure';
  }
  if (url.includes('accounts.google.com') || url.includes('cloud.google.com')) {
    return 'gcloud';
  }
  return 'unknown';
}

const provider = detectProvider();
console.log('[CLI Auth Manager] Detected provider:', provider);

// Track sent codes to avoid duplicates
let sentCodes = new Set();

// Listen for OAuth redirect and capture the code
function checkForAuthCode() {
  const url = new URL(window.location.href);
  console.log('[CLI Auth Manager] Checking for auth code on:', url.pathname);

  // Claude OAuth callback
  if (provider === 'claude' && (url.pathname.includes('/oauth/code/callback') || url.href.includes('oauth/code/callback'))) {
    console.log('[CLI Auth Manager] ON CLAUDE CALLBACK PAGE!');
    setTimeout(() => extractAndSendCode('claude'), 1500);
    extractAndSendCode('claude');
    return;
  }

  // Microsoft device code flow completion
  if (provider === 'azure') {
    // Check if we're on the device code success page
    const pageText = document.body.innerText || '';
    if (pageText.includes('You have signed in') || pageText.includes('successfully signed in') ||
        pageText.includes('You\'re signed in') || pageText.includes('Vous êtes connecté')) {
      console.log('[CLI Auth Manager] Azure sign-in complete!');
      sendStatusToBackground('azure', true, 'Device code authentication complete');
      showNotification('Azure CLI authenticated successfully!', 'azure');
    }
  }

  // Google OAuth success
  if (provider === 'gcloud') {
    const pageText = document.body.innerText || '';
    if (pageText.includes('You are now authenticated') || pageText.includes('authentication successful') ||
        pageText.includes('Authorization code') || pageText.includes('code from the URL')) {
      console.log('[CLI Auth Manager] Google auth success page detected');

      // Try to extract auth code if present
      const codeMatch = pageText.match(/([0-9\/]{20,})/);
      if (codeMatch) {
        sendCodeToBackground(codeMatch[1], 'gcloud');
        showNotification('Google Cloud auth code captured!', 'gcloud');
      } else {
        sendStatusToBackground('gcloud', true, 'OAuth completed');
        showNotification('Google Cloud authenticated!', 'gcloud');
      }
    }
  }

  // Check for OAuth code in URL params (all providers)
  const code = url.searchParams.get('code');
  if (code && code.length > 10 && code !== 'true') {
    console.log('[CLI Auth Manager] Auth code found in URL:', code);
    sendCodeToBackground(code, provider);
    showNotification(`${provider.toUpperCase()} auth code captured!`, provider);
    return;
  }

  // Check for successful login
  const isLoggedIn = checkLoginStatus();
  if (isLoggedIn) {
    chrome.runtime.sendMessage({
      type: 'login_status',
      provider: provider,
      loggedIn: true,
      url: window.location.href
    });
  }
}

// Extract code from the callback page content
function extractAndSendCode(provider) {
  console.log('[CLI Auth Manager] Extracting code for', provider);

  const selectors = [
    'code', 'pre', '[data-code]', 'input[readonly]', '.code',
    '[class*="code"]', 'span[class*="mono"]', 'div[class*="mono"]',
    'input[type="text"]', 'textarea'
  ];

  for (const selector of selectors) {
    const elements = document.querySelectorAll(selector);
    for (const element of elements) {
      const text = (element.textContent || element.value || '').trim();
      if (text.length > 15 && text !== 'true' && /^[A-Za-z0-9_\/-]+$/.test(text)) {
        console.log('[CLI Auth Manager] FOUND AUTH CODE:', text);
        sendCodeToBackground(text, provider);
        showNotification('Authentication code captured!', provider);
        return;
      }
    }
  }

  // Try to find code pattern in page text
  const bodyText = document.body.innerText;
  const codePatterns = [
    /Your authorization code[:\s]+([A-Za-z0-9_\/-]{20,})/i,
    /authorization code[:\s]+([A-Za-z0-9_\/-]{20,})/i,
    /Enter this code[:\s]+([A-Za-z0-9_\/-]{20,})/i,
    /code[:\s]+([A-Za-z0-9_\/-]{20,})/i,
    /([A-Za-z0-9_\/-]{30,100})/
  ];

  for (const pattern of codePatterns) {
    const match = bodyText.match(pattern);
    if (match && match[1] && match[1] !== 'true') {
      console.log('[CLI Auth Manager] FOUND AUTH CODE via pattern:', match[1]);
      sendCodeToBackground(match[1], provider);
      showNotification('Authentication code captured!', provider);
      return;
    }
  }
}

// Send code to background script
function sendCodeToBackground(code, provider) {
  let cleanCode = code.split('#')[0].trim();

  const codeKey = `${provider}:${cleanCode}`;
  if (sentCodes.has(codeKey)) {
    console.log('[CLI Auth Manager] Code already sent, skipping');
    return;
  }

  sentCodes.add(codeKey);
  console.log('[CLI Auth Manager] Sending code to background:', cleanCode);

  chrome.runtime.sendMessage({
    type: 'auth_code_captured',
    provider: provider,
    code: cleanCode,
    url: window.location.href
  });
}

// Send status update to background
function sendStatusToBackground(provider, success, message) {
  chrome.runtime.sendMessage({
    type: 'auth_status_update',
    provider: provider,
    success: success,
    message: message,
    url: window.location.href
  });
}

// Check if user appears to be logged in
function checkLoginStatus() {
  if (provider === 'azure') {
    return document.body.innerText.includes('signed in') ||
           document.body.innerText.includes('connecté');
  }
  if (provider === 'gcloud') {
    return document.body.innerText.includes('authenticated') ||
           document.body.innerText.includes('Vous êtes authentifié');
  }
  // Claude
  const hasUserMenu = document.querySelector('[data-testid="user-menu"]') ||
                      document.querySelector('.user-avatar');
  return !!hasUserMenu;
}

// Show notification on page
function showNotification(message, provider) {
  const colors = {
    claude: 'linear-gradient(135deg, #d97706, #f59e0b)',
    azure: 'linear-gradient(135deg, #0078d4, #00bcf2)',
    gcloud: 'linear-gradient(135deg, #ea4335, #4285f4)',
    default: 'linear-gradient(135deg, #7c3aed, #00d4ff)'
  };

  const notification = document.createElement('div');
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: ${colors[provider] || colors.default};
    color: white;
    padding: 15px 25px;
    border-radius: 8px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px;
    z-index: 999999;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
    animation: slideIn 0.3s ease;
  `;

  notification.innerHTML = `<strong>CLI Auth Manager</strong><br>${message}`;
  document.body.appendChild(notification);

  const style = document.createElement('style');
  style.textContent = `
    @keyframes slideIn {
      from { transform: translateX(100%); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
  `;
  document.head.appendChild(style);

  setTimeout(() => {
    notification.style.animation = 'slideIn 0.3s ease reverse';
    setTimeout(() => notification.remove(), 300);
  }, 5000);
}

// Listen for messages from background
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[CLI Auth Manager] Content script received:', message);

  if (message.type === 'check_auth') {
    sendResponse({
      provider: provider,
      url: window.location.href,
      loggedIn: checkLoginStatus()
    });
  }

  return true;
});

// Run check on load
checkForAuthCode();

// Watch for page changes (SPA navigation)
const observer = new MutationObserver(() => {
  clearTimeout(window.authCheckTimeout);
  window.authCheckTimeout = setTimeout(checkForAuthCode, 1000);
});

observer.observe(document.body, {
  childList: true,
  subtree: true
});

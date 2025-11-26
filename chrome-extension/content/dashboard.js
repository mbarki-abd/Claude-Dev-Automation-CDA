// CDA Dashboard Content Script
// Injects on cda.ilinqsoft.com to communicate with the dashboard

console.log('[CDA Extension] Dashboard content script loaded');

// Set the global flag so dashboard knows extension is installed
window.__CDA_EXTENSION_INSTALLED__ = true;

// Listen for messages from the dashboard
window.addEventListener('message', (event) => {
  // Only accept messages from the same window
  if (event.source !== window) return;

  const { type, data } = event.data || {};

  switch (type) {
    case 'CDA_CHECK_EXTENSION':
      // Dashboard is checking if extension is installed
      console.log('[CDA Extension] Dashboard check received, responding...');
      window.postMessage({ type: 'CDA_EXTENSION_CONNECTED', version: '1.1.0' }, '*');
      break;

    case 'CDA_START_AUTH':
      // Dashboard wants to start authentication
      console.log('[CDA Extension] Start auth request:', data);
      chrome.runtime.sendMessage({
        type: 'start_auth',
        provider: data?.provider || 'claude'
      });
      break;

    case 'CDA_SUBMIT_CODE':
      // Dashboard is submitting a manual code
      console.log('[CDA Extension] Code submission:', data);
      chrome.runtime.sendMessage({
        type: 'manual_code',
        code: data?.code,
        provider: data?.provider || 'claude'
      });
      break;
  }
});

// Send initial connection message
window.postMessage({ type: 'CDA_EXTENSION_CONNECTED', version: '1.1.0' }, '*');

// Listen for messages from background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[CDA Extension] Message from background:', message);

  switch (message.type) {
    case 'auth_complete':
      // Notify dashboard that auth is complete
      window.postMessage({
        type: 'CDA_AUTH_COMPLETE',
        provider: message.provider,
        success: true
      }, '*');
      break;

    case 'code_captured':
      // Notify dashboard that code was captured
      window.postMessage({
        type: 'CDA_CODE_CAPTURED',
        code: message.code,
        provider: message.provider
      }, '*');
      break;

    case 'tokens_received':
      // Notify dashboard that tokens were received
      window.postMessage({
        type: 'CDA_TOKENS_RECEIVED',
        success: message.success
      }, '*');
      break;

    case 'status_update':
      // Forward status update to dashboard
      window.postMessage({
        type: 'CDA_STATUS_UPDATE',
        data: message.data
      }, '*');
      break;
  }

  sendResponse({ received: true });
  return true;
});

// Periodic heartbeat to keep dashboard aware of extension
setInterval(() => {
  window.postMessage({ type: 'CDA_EXTENSION_HEARTBEAT', version: '1.1.0' }, '*');
}, 5000);

console.log('[CDA Extension] Dashboard integration active');

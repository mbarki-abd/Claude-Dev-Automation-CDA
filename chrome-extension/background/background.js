// Claude CLI Auth Helper - Background Service Worker

const SERVER_URL = 'wss://cda.ilinqsoft.com/claude-auth-ws/extension';
const SERVER_URL_LOCAL = 'ws://localhost:3847/extension';

// OAuth configuration (extracted from Claude Code extension)
const OAUTH_CONFIG = {
  tokenEndpoint: 'https://console.anthropic.com/v1/oauth/token',
  clientId: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
  redirectUri: 'https://console.anthropic.com/oauth/code/callback'
};

let ws = null;
let isConnected = false;
let reconnectInterval = null;
let currentAuthSession = null;
let useLocalServer = false;

// Initialize connection
async function connect() {
  const serverUrl = useLocalServer ? SERVER_URL_LOCAL : SERVER_URL;

  try {
    ws = new WebSocket(serverUrl);

    ws.onopen = () => {
      console.log('Connected to Claude CLI Auth Manager server');
      isConnected = true;
      clearInterval(reconnectInterval);

      // Update badge to show connected status
      chrome.action.setBadgeBackgroundColor({ color: '#10b981' });
      chrome.action.setBadgeText({ text: 'ON' });

      // Notify popup if open
      chrome.runtime.sendMessage({ type: 'connection_status', connected: true });
    };

    ws.onclose = () => {
      console.log('Disconnected from server');
      isConnected = false;

      chrome.action.setBadgeBackgroundColor({ color: '#ef4444' });
      chrome.action.setBadgeText({ text: 'OFF' });

      chrome.runtime.sendMessage({ type: 'connection_status', connected: false });

      // Try to reconnect
      if (!reconnectInterval) {
        reconnectInterval = setInterval(() => {
          if (!isConnected) {
            console.log('Attempting to reconnect...');
            connect();
          }
        }, 5000);
      }
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);

      // If remote fails, try local
      if (!useLocalServer) {
        console.log('Trying local server...');
        useLocalServer = true;
        setTimeout(connect, 1000);
      }
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handleServerMessage(data);
      } catch (error) {
        console.error('Error parsing message:', error);
      }
    };
  } catch (error) {
    console.error('Connection error:', error);
  }
}

// Exchange auth code for tokens (done from extension to bypass Cloudflare)
async function exchangeCodeForTokens(code, codeVerifier) {
  console.log('Exchanging code for tokens from extension...');
  console.log('Code:', code);
  console.log('Code verifier:', codeVerifier);

  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: OAUTH_CONFIG.clientId,
    code: code,
    redirect_uri: OAUTH_CONFIG.redirectUri,
    code_verifier: codeVerifier
  });

  try {
    const response = await fetch(OAUTH_CONFIG.tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString()
    });

    console.log('Token response status:', response.status);

    if (response.ok) {
      const tokens = await response.json();
      console.log('Token exchange successful!');
      return tokens;
    } else {
      const errorText = await response.text();
      console.error('Token exchange failed:', response.status, errorText);
      throw new Error(`Token exchange failed: ${response.status}`);
    }
  } catch (error) {
    console.error('Token exchange error:', error);
    throw error;
  }
}

// Handle messages from server
async function handleServerMessage(data) {
  console.log('Received from server:', data);

  switch (data.type) {
    case 'auth_url':
      // Store session including code_verifier for token exchange
      currentAuthSession = data.data;
      console.log('Received auth session with code_verifier:', !!data.data.codeVerifier);
      await handleAuthUrl(data.data);
      break;

    case 'status':
      // Store current status
      chrome.storage.local.set({ authStatus: data.data });
      chrome.runtime.sendMessage({ type: 'status_update', data: data.data });
      break;

    case 'auth_complete':
      currentAuthSession = null;
      chrome.storage.local.set({ authStatus: data.data });
      chrome.runtime.sendMessage({ type: 'auth_complete', data: data.data });
      break;
  }
}

// Track if we're already handling an auth URL to prevent duplicates
let isHandlingAuthUrl = false;

// Handle authentication URL
async function handleAuthUrl(authData) {
  // Prevent duplicate handling
  if (isHandlingAuthUrl) {
    console.log('Already handling auth URL, ignoring duplicate');
    return;
  }

  isHandlingAuthUrl = true;
  console.log('Opening auth URL:', authData.url);

  // Store auth session
  chrome.storage.local.set({ currentAuthSession: authData });

  // Notify popup
  chrome.runtime.sendMessage({ type: 'auth_url_received', data: authData });

  // Open the authentication URL in a new tab
  const tab = await chrome.tabs.create({
    url: authData.url,
    active: true
  });

  // Store tab ID for monitoring
  chrome.storage.local.set({ authTabId: tab.id });

  // Monitor the tab for completion
  monitorAuthTab(tab.id, authData);

  // Reset flag after a delay
  setTimeout(() => {
    isHandlingAuthUrl = false;
  }, 5000);
}

// Monitor auth tab for completion
function monitorAuthTab(tabId, authData) {
  console.log('Monitoring tab:', tabId, 'for auth completion');

  const checkInterval = setInterval(async () => {
    try {
      const tab = await chrome.tabs.get(tabId);
      console.log('Tab URL:', tab.url);

      if (tab.url) {
        // Check if we're on the callback page
        if (tab.url.includes('console.anthropic.com/oauth/code/callback') ||
            tab.url.includes('/oauth/code/callback')) {
          console.log('On callback page, extracting code...');

          // Wait for page to load then extract code
          setTimeout(async () => {
            try {
              // Execute script to extract the code from the page
              const results = await chrome.scripting.executeScript({
                target: { tabId: tabId },
                func: () => {
                  // Look for the code in various places on the page
                  // The code is usually displayed in a code block or input field
                  const codeElement = document.querySelector('code') ||
                                      document.querySelector('pre') ||
                                      document.querySelector('[data-code]') ||
                                      document.querySelector('input[readonly]') ||
                                      document.querySelector('.code');

                  if (codeElement) {
                    return codeElement.textContent || codeElement.value;
                  }

                  // Try to find any element containing the code pattern
                  const allText = document.body.innerText;
                  const codeMatch = allText.match(/[A-Za-z0-9_-]{20,}/);
                  if (codeMatch) {
                    return codeMatch[0];
                  }

                  // Return all text for debugging
                  return { debug: true, text: allText.substring(0, 1000) };
                }
              });

              if (results && results[0] && results[0].result) {
                const result = results[0].result;
                console.log('Extracted from page:', result);

                if (typeof result === 'string' && result.length > 10) {
                  // Clean the code - remove hash fragment
                  const cleanCode = result.split('#')[0].trim();
                  console.log('Clean extracted code:', cleanCode);

                  clearInterval(checkInterval);

                  // If we have a code_verifier, do the token exchange from the extension
                  if (authData.codeVerifier) {
                    console.log('Performing token exchange from extension...');
                    try {
                      const tokens = await exchangeCodeForTokens(cleanCode, authData.codeVerifier);
                      console.log('Token exchange successful, sending tokens to server');

                      // Send tokens back to server to write credentials
                      sendToServer({
                        type: 'auth_tokens',
                        tokens: tokens,
                        sessionId: authData.sessionId
                      });

                      // Notify popup
                      chrome.runtime.sendMessage({
                        type: 'tokens_received',
                        success: true
                      });
                    } catch (error) {
                      console.error('Token exchange from extension failed:', error);
                      // Fall back to sending code to server
                      sendToServer({
                        type: 'auth_code',
                        code: cleanCode,
                        sessionId: authData.sessionId
                      });
                    }
                  } else {
                    // No code_verifier, send code to server (CLI flow)
                    sendToServer({
                      type: 'auth_code',
                      code: cleanCode,
                      sessionId: authData.sessionId
                    });

                    // Notify popup
                    chrome.runtime.sendMessage({
                      type: 'code_captured',
                      code: cleanCode
                    });
                  }

                  // Close the tab after a delay
                  setTimeout(() => {
                    chrome.tabs.remove(tabId).catch(() => {});
                  }, 3000);
                } else if (result.debug) {
                  console.log('Page content for debugging:', result.text);
                }
              }
            } catch (scriptError) {
              console.error('Script execution error:', scriptError);
            }
          }, 2000);

          return;
        }

        // Check for OAuth code in URL params (on callback page only)
        // Note: The initial authorize URL has code=true which is NOT the auth code
        // The real auth code only appears AFTER user authorizes on the callback page
        const url = new URL(tab.url);
        const code = url.searchParams.get('code');
        // Only capture if it's on callback page AND code is not 'true' (which is just a URL flag)
        if (code && code.length > 10 && code !== 'true' &&
            (tab.url.includes('/callback') || tab.url.includes('code='))) {
          console.log('Auth code captured from URL:', code);
          clearInterval(checkInterval);

          // Clean the code
          const cleanCode = code.split('#')[0].trim();

          // If we have a code_verifier, do the token exchange from the extension
          if (authData.codeVerifier) {
            console.log('Performing token exchange from URL capture...');
            try {
              const tokens = await exchangeCodeForTokens(cleanCode, authData.codeVerifier);
              console.log('Token exchange successful from URL capture');

              // Send tokens back to server to write credentials
              sendToServer({
                type: 'auth_tokens',
                tokens: tokens,
                sessionId: authData.sessionId
              });
            } catch (error) {
              console.error('Token exchange from URL capture failed:', error);
              // Fall back to sending code to server
              sendToServer({
                type: 'auth_code',
                code: cleanCode,
                sessionId: authData.sessionId
              });
            }
          } else {
            sendToServer({
              type: 'auth_code',
              code: cleanCode,
              sessionId: authData.sessionId
            });
          }

          setTimeout(() => {
            chrome.tabs.remove(tabId).catch(() => {});
          }, 2000);

          return;
        }

        // Check for successful login (landed on dashboard)
        if (tab.url.includes('console.anthropic.com') &&
            !tab.url.includes('login') &&
            !tab.url.includes('oauth') &&
            !tab.url.includes('authorize')) {
          console.log('Auth appears complete (on dashboard)');
          clearInterval(checkInterval);

          sendToServer({
            type: 'auth_completed',
            sessionId: authData.sessionId
          });
        }
      }
    } catch (error) {
      console.log('Auth tab closed or error:', error.message);
      clearInterval(checkInterval);
    }
  }, 1500);

  // Stop checking after 5 minutes
  setTimeout(() => {
    clearInterval(checkInterval);
  }, 300000);
}

// Send message to server
function sendToServer(message) {
  if (ws && isConnected) {
    ws.send(JSON.stringify(message));
    console.log('Sent to server:', message);
  } else {
    console.error('Not connected to server');
  }
}

// Handle messages from popup and content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Message received:', message.type, 'from:', sender.tab ? 'content script' : 'popup');

  switch (message.type) {
    case 'get_status':
      sendResponse({
        connected: isConnected,
        authSession: currentAuthSession
      });
      break;

    case 'start_auth':
      sendToServer({ type: 'start_auth' });
      sendResponse({ success: true });
      break;

    case 'manual_code':
      sendToServer({
        type: 'auth_code',
        code: message.code
      });
      sendResponse({ success: true });
      break;

    case 'auth_code_captured':
      // Received auth code from content script
      console.log('Auth code captured from content script:', message.code);
      if (message.code && currentAuthSession) {
        // Clean the code - remove any hash fragment
        const cleanCode = message.code.split('#')[0].trim();
        console.log('Clean auth code:', cleanCode);
        console.log('Has codeVerifier:', !!currentAuthSession.codeVerifier);

        // If we have a codeVerifier, do client-side token exchange
        if (currentAuthSession.codeVerifier) {
          console.log('Performing token exchange from content script handler...');
          (async () => {
            try {
              const tokens = await exchangeCodeForTokens(cleanCode, currentAuthSession.codeVerifier);
              console.log('Token exchange successful from content script handler!');

              // Send tokens back to server to write credentials
              sendToServer({
                type: 'auth_tokens',
                tokens: tokens,
                sessionId: currentAuthSession.sessionId
              });

              // Notify popup
              chrome.runtime.sendMessage({
                type: 'tokens_received',
                success: true
              }).catch(() => {});
            } catch (error) {
              console.error('Token exchange from content script handler failed:', error);
              // Fall back to sending code to server
              sendToServer({
                type: 'auth_code',
                code: cleanCode,
                sessionId: currentAuthSession.sessionId
              });
            }
            // Clear the session after exchange attempt
            currentAuthSession = null;
          })();
        } else {
          // No codeVerifier, send code to server (old flow)
          sendToServer({
            type: 'auth_code',
            code: cleanCode,
            sessionId: currentAuthSession.sessionId
          });

          // Notify popup
          chrome.runtime.sendMessage({
            type: 'code_captured',
            code: cleanCode
          }).catch(() => {});

          // Clear the session to prevent duplicate sends
          currentAuthSession = null;
        }
      }
      sendResponse({ success: true });
      break;

    case 'login_status':
      // User logged in successfully
      if (message.loggedIn && currentAuthSession) {
        sendToServer({
          type: 'auth_completed',
          sessionId: currentAuthSession.sessionId
        });
        currentAuthSession = null;
      }
      sendResponse({ success: true });
      break;

    case 'connect':
      useLocalServer = message.local || false;
      connect();
      sendResponse({ success: true });
      break;

    case 'disconnect':
      if (ws) {
        ws.close();
      }
      sendResponse({ success: true });
      break;
  }

  return true; // Keep channel open for async response
});

// Initialize on install/startup
chrome.runtime.onInstalled.addListener(() => {
  console.log('Claude CLI Auth Helper installed');
  chrome.action.setBadgeBackgroundColor({ color: '#666' });
  chrome.action.setBadgeText({ text: '...' });
  connect();
});

chrome.runtime.onStartup.addListener(() => {
  connect();
});

// Start connection
connect();

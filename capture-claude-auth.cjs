/**
 * HTTP/HTTPS Proxy to capture Claude authentication traffic
 *
 * Usage:
 * 1. Run this script: node capture-claude-auth.cjs
 * 2. Set proxy: set HTTP_PROXY=http://localhost:8888 && set HTTPS_PROXY=http://localhost:8888
 * 3. Run: claude auth
 * 4. Complete auth in browser
 * 5. Check captured-requests.json for details
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');
const fs = require('fs');
const path = require('path');

const PROXY_PORT = 8888;
const capturedRequests = [];
const outputFile = path.join(__dirname, 'captured-requests.json');

console.log('🔍 Claude Auth Traffic Capture Proxy');
console.log('=====================================\n');

// Create proxy server
const proxy = http.createServer((clientReq, clientRes) => {
  const reqUrl = new URL(clientReq.url, `http://${clientReq.headers.host}`);

  console.log(`\n📡 ${clientReq.method} ${reqUrl.href}`);
  console.log(`   Headers: ${JSON.stringify(clientReq.headers, null, 2)}`);

  // Capture request details
  const requestData = {
    timestamp: new Date().toISOString(),
    method: clientReq.method,
    url: reqUrl.href,
    headers: clientReq.headers,
    body: null
  };

  // Collect request body
  let reqBody = [];
  clientReq.on('data', (chunk) => {
    reqBody.push(chunk);
  });

  clientReq.on('end', () => {
    if (reqBody.length > 0) {
      requestData.body = Buffer.concat(reqBody).toString();
      console.log(`   Body: ${requestData.body}`);
    }

    // Determine if HTTPS
    const isHttps = reqUrl.protocol === 'https:';
    const httpModule = isHttps ? https : http;

    // Forward request to target
    const options = {
      hostname: reqUrl.hostname,
      port: reqUrl.port || (isHttps ? 443 : 80),
      path: reqUrl.pathname + reqUrl.search,
      method: clientReq.method,
      headers: { ...clientReq.headers }
    };

    // Remove proxy-specific headers
    delete options.headers['proxy-connection'];

    const proxyReq = httpModule.request(options, (proxyRes) => {
      console.log(`   ← Response: ${proxyRes.statusCode}`);
      console.log(`   ← Headers: ${JSON.stringify(proxyRes.headers, null, 2)}`);

      // Capture response details
      const responseData = {
        statusCode: proxyRes.statusCode,
        headers: proxyRes.headers,
        body: null
      };

      // Collect response body
      let resBody = [];
      proxyRes.on('data', (chunk) => {
        resBody.push(chunk);
      });

      proxyRes.on('end', () => {
        if (resBody.length > 0) {
          const bodyBuffer = Buffer.concat(resBody);
          const bodyString = bodyBuffer.toString();
          responseData.body = bodyString;

          // Try to parse as JSON for pretty output
          try {
            const jsonBody = JSON.parse(bodyString);
            console.log(`   ← Body: ${JSON.stringify(jsonBody, null, 2)}`);
          } catch {
            console.log(`   ← Body (text): ${bodyString.substring(0, 200)}...`);
          }
        }

        // Save captured request + response
        capturedRequests.push({
          request: requestData,
          response: responseData
        });

        // Write to file immediately
        fs.writeFileSync(outputFile, JSON.stringify(capturedRequests, null, 2));
        console.log(`   ✓ Saved to ${outputFile}`);

        // Forward response to client
        clientRes.writeHead(proxyRes.statusCode, proxyRes.headers);
        if (resBody.length > 0) {
          clientRes.write(Buffer.concat(resBody));
        }
        clientRes.end();
      });
    });

    proxyReq.on('error', (err) => {
      console.error(`   ✗ Proxy request error: ${err.message}`);
      clientRes.writeHead(500);
      clientRes.end('Proxy Error');
    });

    // Send request body if present
    if (reqBody.length > 0) {
      proxyReq.write(Buffer.concat(reqBody));
    }
    proxyReq.end();
  });
});

// Handle CONNECT for HTTPS
proxy.on('connect', (req, clientSocket, head) => {
  console.log(`\n🔐 HTTPS CONNECT ${req.url}`);

  const { port, hostname } = new URL(`http://${req.url}`);
  const serverSocket = http.request({
    host: hostname,
    port: port || 443,
    method: 'CONNECT'
  });

  serverSocket.on('connect', (res, socket, head) => {
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    socket.write(head);
    socket.pipe(clientSocket);
    clientSocket.pipe(socket);
  });

  serverSocket.on('error', (err) => {
    console.error(`   ✗ CONNECT error: ${err.message}`);
    clientSocket.end();
  });

  serverSocket.end();
});

proxy.listen(PROXY_PORT, () => {
  console.log(`✓ Proxy server listening on http://localhost:${PROXY_PORT}\n`);
  console.log('Set environment variables:');
  console.log(`  Windows (CMD):    set HTTP_PROXY=http://localhost:${PROXY_PORT} && set HTTPS_PROXY=http://localhost:${PROXY_PORT}`);
  console.log(`  Windows (PS):     $env:HTTP_PROXY="http://localhost:${PROXY_PORT}"; $env:HTTPS_PROXY="http://localhost:${PROXY_PORT}"`);
  console.log(`  Linux/Mac:        export HTTP_PROXY=http://localhost:${PROXY_PORT} HTTPS_PROXY=http://localhost:${PROXY_PORT}`);
  console.log('\nThen run: claude auth\n');
  console.log('All requests will be saved to:', outputFile);
  console.log('\nPress Ctrl+C to stop\n');
});

proxy.on('error', (err) => {
  console.error('Proxy server error:', err);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n📊 Capture Summary:');
  console.log(`   Total requests captured: ${capturedRequests.length}`);
  console.log(`   Saved to: ${outputFile}`);
  console.log('\nProxy stopped.');
  process.exit(0);
});

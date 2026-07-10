
const http = require('http');
const hyco = require('hyco-https');

// Relay configuration
const RELAY_NAMESPACE = process.env.RELAY_NAMESPACE;
const HYBRID_CONNECTION_NAME = process.env.HYBRID_CONNECTION_NAME;
const CLIENT_SAS_KEY_NAME = process.env.CLIENT_SAS_KEY_NAME;
const CLIENT_SAS_KEY = process.env.CLIENT_SAS_KEY;

// Build Relay URI + token
const relayUri = hyco.createRelayHttpsUri(
  RELAY_NAMESPACE,
  HYBRID_CONNECTION_NAME
);

const relayToken = () =>
  hyco.createRelayToken(
    relayUri,
    CLIENT_SAS_KEY_NAME,
    CLIENT_SAS_KEY
  );

console.log('Relay URI:', relayUri);

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'proxy-connection',
  'keep-alive',
  'transfer-encoding',
  'upgrade',
  'te',
  'trailer',
  'host'
]);

function sanitizeRequestHeaders(originalHeaders) {
  const newHeaders = {
    ServiceBusAuthorization: relayToken()
  };

  for (const [header, value] of Object.entries(
    originalHeaders || {}
  )) {
    if (HOP_BY_HOP_HEADERS.has(header.toLowerCase())) {
      continue;
    }
    newHeaders[header] = value;
  }

  if (!newHeaders['content-type']) {
    newHeaders['content-type'] =
      'application/json';
  }

  if (!newHeaders.accept) {
    newHeaders.accept = '*/*';
  }

  return newHeaders;
}

function sanitizeResponseHeaders(originalHeaders) {
  const newHeaders = {};

  for (const [header, value] of Object.entries(
    originalHeaders || {}
  )) {
    if (HOP_BY_HOP_HEADERS.has(header.toLowerCase())) {
      continue;
    }
    newHeaders[header] = value;
  }

  return newHeaders;
}

function sendThroughRelay(clientReq, clientRes) {
  console.log(
    `Incoming request: ${clientReq.method} ${clientReq.url}`
  );

  const sendHeaders =
    sanitizeRequestHeaders(clientReq.headers);

  console.log(
    'Headers sent to relay:',
    sendHeaders
  );

  const options = {
    hostname: RELAY_NAMESPACE,
    path: `/${HYBRID_CONNECTION_NAME}${clientReq.url}`,
    method: clientReq.method,
    headers: sendHeaders
  };

  const relayReq = hyco.request(
    options,
    relayRes => {
      console.log(
        `Relay response status: ${relayRes.statusCode}`
      );

      // Forward all response headers
      clientRes.writeHead(relayRes.statusCode, sanitizeResponseHeaders(relayRes.headers));

      // STREAM relay response directly
      relayRes.pipe(clientRes);

      relayRes.on('error', err => {
        console.error(
          'Relay response stream failed:',
          err
        );
        if (!clientRes.headersSent) {
          clientRes.writeHead(502, {
            'Content-Type': 'text/plain'
          });
        }
        clientRes.end(
          `Relay response failed: ${err.message}`
        );
      });

      relayRes.on('end', () => {
        console.log(
          'Relay response completed'
        );
      });
    }
  );

  relayReq.on('error', err => {
    console.error(
      'Relay request failed:',
      err
    );

    if (!clientRes.headersSent) {
      clientRes.writeHead(500, {
        'Content-Type': 'text/plain'
      });
    }

    clientRes.end(
      `Relay request failed: ${err.message}`
    );
  });

  // STREAM request body directly
  clientReq.pipe(relayReq);

  clientReq.on('aborted', () => {
    relayReq.destroy();
  });
}

const server = http.createServer((req, res) => {
  sendThroughRelay(req, res);
});

server.listen(3000, () => {
  console.log(
    'Proxy listening on port 3000'
  );
});

let shuttingDown = false;

function shutdown(signal) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;

  console.log(`Received ${signal}. Shutting down gracefully...`);

  server.close(err => {
    if (err) {
      console.error('Error while closing HTTP server:', err);
      process.exit(1);
      return;
    }

    console.log('HTTP server closed. Exiting.');
    process.exit(0);
  });

  // Force exit if long-lived sockets block close forever.
  setTimeout(() => {
    console.error('Graceful shutdown timed out. Forcing exit.');
    process.exit(1);
  }, 8000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

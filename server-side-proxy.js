// TODO: don't log tokens

const hyco = require('hyco-https');
const http = require('http');
const https = require('https');


var args = {
    ns: process.env.RELAY_NAMESPACE,
    hybrid_connection_name: process.env.HYBRID_CONNECTION_NAME,
    path: "/" +process.env.HYBRID_CONNECTION_NAME,
    keyrule: process.env.SERVER_SAS_KEY_NAME,
    key: process.env.SERVER_SAS_KEY,
    client_keyrule: process.env.CLIENT_SAS_KEY_NAME,
    client_key: process.env.CLIENT_SAS_KEY,
    target_url: process.env.TARGET_URL
};

function sanitizeRequestHeaders(headers, targetHost) {
    const blocked = new Set([
        'connection',
        'proxy-connection',
        'keep-alive',
        'transfer-encoding',
        'upgrade',
        'te',
        'trailer',
        'host'
    ]);

    const clean = {};
    for (const [name, value] of Object.entries(headers || {})) {
        const key = name.toLowerCase();
        if (blocked.has(key)) {
            continue;
        }
        clean[name] = value;
    }

    clean.host = targetHost;
    return clean;
}

function sanitizeResponseHeaders(headers) {
    const blocked = new Set([
        'connection',
        'proxy-connection',
        'keep-alive',
        'transfer-encoding',
        'upgrade',
        'te',
        'trailer'
    ]);

    const clean = {};
    for (const [name, value] of Object.entries(headers || {})) {
        if (!blocked.has(name.toLowerCase())) {
            clean[name] = value;
        }
    }

    return clean;
}

/**
 * STREAMING FORWARDER
 * - Streams request body to target
 * - Streams response body back to client
 */
function forwardStreaming(req, res, targetUrl) {
    const isHttps = targetUrl.startsWith("https://");
    const client = isHttps ? https : http;

    const urlObj = new URL(targetUrl);

    const options = {
        hostname: urlObj.hostname,
        port: urlObj.port || (isHttps ? 443 : 80),
        path: urlObj.pathname + urlObj.search,
        method: req.method,
        headers: sanitizeRequestHeaders(req.headers, urlObj.host)
    };

    console.log("Forwarding (streaming) →", options);

    const proxyReq = client.request(options, proxyRes => {
        console.log("Received streaming response:", proxyRes.statusCode);

        // Relay manages hop-by-hop framing itself.
        const responseHeaders = sanitizeResponseHeaders(proxyRes.headers);
        res.writeHead(proxyRes.statusCode, responseHeaders);
        proxyRes.pipe(res);

        proxyRes.on("error", err => {
            console.error("Upstream response error:", err);
            if (!res.headersSent) {
                res.writeHead(502, { "Content-Type": "text/plain" });
            }
            res.end("Bad gateway");
        });
    });

    proxyReq.on("error", err => {
        console.error("Proxy error:", err);
        res.writeHead(502, { "Content-Type": "text/plain" });
        res.end("Bad gateway");
    });

    req.pipe(proxyReq);

    req.on("aborted", () => {
        proxyReq.destroy();
    });
}

/**
 * HYBRID CONNECTION SERVER
 */
const uri = hyco.createRelayListenUri(args.ns, args.hybrid_connection_name);
var server = null;
function initServer() {
    server = hyco.createRelayedServer(
        { 
            server: uri, 
            token: () => hyco.createRelayToken(uri, args.keyrule, args.key) 
        },
        (req, res) => {
            try {
                if (req.url.startsWith(args.path +"/healthCheck")) {
                    res.writeHead(200, { "Content-Type": "text/plain" });
                    res.end("OK");
                }
                else if (req.url.startsWith(args.path +"/v1")) {
                    console.log("Incoming request:", req.method, req.url);

                    // Remove your prefix
                    const rewrittenUrl = args.target_url + req.url.substring(args.path.length);

                    console.log("→ Forwarding to:", rewrittenUrl);

                    forwardStreaming(req, res, rewrittenUrl);
                } else {
                    console.error("Incoming request with invalid path:", req.method, req.url);
                    res.writeHead(404, { "Content-Type": "text/plain" });
                    res.end("Not found");
                }
            } catch (err) {
                console.error("Error:", err);

                res.writeHead(502, { "Content-Type": "text/plain" });
                res.end("Bad gateway");

                console.log("Attempt recovery.", err.message);
            }
        }
    );

    server.listen(err => {
        if (err) {
            console.log("Server error:", err);
            return;
        }
        console.log("Hybrid Connection streaming relay is running");
    });

    server.on("error", err => {
        console.log("Relay error:", err);
    });

    // server.on("close", () => {
    //     console.log("Relay server closed");
    //     process.exit(1);
    // });
}

initServer();


let shuttingDown = false;
const pingIntervalMs = Number(process.env.PING_INTERVAL_MS || 5000);
const pingTimer = setInterval(() => {

    https.get({
        hostname : args.ns,
        path : args.path +"/healthCheck",
        port : 443,
        headers : {
            'ServiceBusAuthorization' : 
               https.createRelayToken(https.createRelayHttpsUri(args.ns, args.hybrid_connection_name), args.client_keyrule, args.client_key)
        }
    }, (res) => {
        let error;
        if (res.statusCode !== 200) {
            console.error('Request Failed.\n Status Code:' + res.statusCode);
            try {
                server.close();
            } catch (err) {
                console.error("Error while closing relay server:", err);
            }
            initServer();
            res.resume();
        } 
        else {
            console.log('Listener healthy.')
        };
    }).on('error', (e) => {
        console.error(`Got error: ${e.message}`);
    });

    console.log(`[ping] ${new Date().toISOString()} relay alive`);
}, pingIntervalMs);

// Do not keep the process alive only for heartbeat logs.
pingTimer.unref();

function shutdown(signal) {
    if (shuttingDown) {
        return;
    }
    shuttingDown = true;

    console.log(`Received ${signal}. Shutting down gracefully...`);

    clearInterval(pingTimer);

    server.close(err => {
        if (err) {
            console.error("Error while closing relay server:", err);
            process.exit(1);
            return;
        }

        console.log("Relay server closed. Exiting.");
        process.exit(0);
    });

    // Force exit if long-lived sockets block close forever.
    setTimeout(() => {
        console.error("Graceful shutdown timed out. Forcing exit.");
        process.exit(1);
    }, 8000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

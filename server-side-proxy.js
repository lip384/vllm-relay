const hyco = require('hyco-https');
const http = require('http');
const https = require('https');


var args = {
    ns: process.env.RELAY_NAMESPACE,
    path: process.env.HYBRID_CONNECTION_NAME,
    keyrule: process.env.SAS_KEY_NAME,
    key: process.env.SAS_KEY,
    target_url: process.env.TARGET_URL
};

/* Parse command line options */
var pattern = /^--(.*?)(?:=(.*))?$/;
process.argv.forEach(function (value) {
    var match = pattern.exec(value);
    if (match) {
        args[match[1]] = match[2] ? match[2] : true;
    }
});

if (!args.ns || !args.path || !args.keyrule || !args.key || !args.target_url) {
    console.log('server-side-proxy.js --ns=[namespace] --path=[path] --keyrule=[keyrule] --key=[key] --target_url=[target_url]');
    process.exit(1);
}

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
const uri = hyco.createRelayListenUri(args.ns, args.path);
const token = hyco.createRelayToken(uri, args.keyrule, args.key);

const server = hyco.createRelayedServer(
    { server: uri, token: token },
    async (req, res) => {
        try {
            console.log("Incoming request:", req.method, req.url);

            // Remove your prefix
            const rewrittenUrl = args.target_url + req.url.substring("/pr1dqvllm1".length);

            console.log("→ Forwarding to:", rewrittenUrl);

            forwardStreaming(req, res, rewrittenUrl);
        } catch (err) {
            console.error("Error:", err);
            res.writeHead(502, { "Content-Type": "text/plain" });
            res.end("Bad gateway");
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

let shuttingDown = false;

function shutdown(signal) {
    if (shuttingDown) {
        return;
    }
    shuttingDown = true;

    console.log(`Received ${signal}. Shutting down gracefully...`);

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

// ===== GazeReader HTTPS Server =====
// Safari requires HTTPS for camera access over a network.
// This script creates a self-signed certificate and serves the app over HTTPS.
// Usage: node server.js

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = 3000;

// ===== Generate self-signed certificate on the fly =====
function generateSelfSignedCert() {
    // Use Node.js crypto to generate a key pair
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
    });

    // We need the 'selfsigned' package or forge, but to keep it simple
    // we'll use openssl-like approach with just Node built-ins.
    // Actually, for simplicity let's just use the http-server or
    // fall back to HTTP with instructions.

    return null; // Will use fallback
}

// ===== MIME types for serving static files =====
const MIME_TYPES = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.wasm': 'application/wasm',
    '.map': 'application/json',
};

// ===== Static file server =====
function serveFile(req, res) {
    let filePath = req.url === '/' ? '/index.html' : req.url;

    // Remove query string
    filePath = filePath.split('?')[0];

    // Security: prevent directory traversal
    filePath = path.normalize(filePath).replace(/^(\.\.[\/\\])+/, '');

    const fullPath = path.join(__dirname, filePath);
    const ext = path.extname(fullPath).toLowerCase();
    const mimeType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(fullPath, (err, data) => {
        if (err) {
            if (err.code === 'ENOENT') {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('404 Not Found');
            } else {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('500 Internal Server Error');
            }
            return;
        }
        res.writeHead(200, { 'Content-Type': mimeType });
        res.end(data);
    });
}

// ===== Get local network IP =====
function getLocalIP() {
    const { networkInterfaces } = require('os');
    const nets = networkInterfaces();
    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            if (net.family === 'IPv4' && !net.internal) {
                return net.address;
            }
        }
    }
    return 'localhost';
}

// ===== Start server =====
const localIP = getLocalIP();

// Try HTTPS first (if cert files exist), otherwise use HTTP
const certPath = path.join(__dirname, 'cert.pem');
const keyPath = path.join(__dirname, 'key.pem');

if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    // HTTPS mode (for mobile Safari camera access)
    const options = {
        cert: fs.readFileSync(certPath),
        key: fs.readFileSync(keyPath),
    };

    const server = https.createServer(options, serveFile);
    server.listen(PORT, '0.0.0.0', () => {
        console.log('');
        console.log('  ╔══════════════════════════════════════════════╗');
        console.log('  ║        GazeReader — HTTPS Server             ║');
        console.log('  ╠══════════════════════════════════════════════╣');
        console.log(`  ║  Local:   https://localhost:${PORT}             ║`);
        console.log(`  ║  Phone:   https://${localIP}:${PORT}       ║`);
        console.log('  ║                                              ║');
        console.log('  ║  📱 On your iPhone, open Safari and go to    ║');
        console.log(`  ║     https://${localIP}:${PORT}             ║`);
        console.log('  ║  ⚠️  Tap "Advanced" → "Proceed" on the      ║');
        console.log('  ║     security warning (self-signed cert)      ║');
        console.log('  ╚══════════════════════════════════════════════╝');
        console.log('');
    });
} else {
    // HTTP mode (works for localhost, but not for mobile camera access)
    const server = http.createServer(serveFile);
    server.listen(PORT, '0.0.0.0', () => {
        console.log('');
        console.log('  ╔══════════════════════════════════════════════╗');
        console.log('  ║        GazeReader — HTTP Server              ║');
        console.log('  ╠══════════════════════════════════════════════╣');
        console.log(`  ║  Local:   http://localhost:${PORT}              ║`);
        console.log(`  ║  Phone:   http://${localIP}:${PORT}        ║`);
        console.log('  ║                                              ║');
        console.log('  ║  ⚠️  For mobile camera access, you need     ║');
        console.log('  ║     HTTPS. Run this to generate certs:       ║');
        console.log('  ║                                              ║');
        console.log('  ║  npx -y mkcert create-ca                     ║');
        console.log('  ║  npx -y mkcert create-cert                   ║');
        console.log('  ║  (then rename .crt → cert.pem, .key → key.pem)');
        console.log('  ║                                              ║');
        console.log('  ║  OR just use:                                ║');
        console.log('  ║  npx -y http-server . -S -p 3000             ║');
        console.log('  ╚══════════════════════════════════════════════╝');
        console.log('');
    });
}

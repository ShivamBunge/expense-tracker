require('dotenv').config();
const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
const { isValidExpense, parseExpense } = require('./services/parserService');
const { appendToSheet } = require('./services/sheetsService');
const { createSheetsWriter } = require('./services/queueService');
const { getQrPage } = require('./services/qrPageService');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const HTTP_PORT = Number(process.env.HTTP_PORT || 3000);
const API_TOKEN = (process.env.API_TOKEN || '').trim();
const SELF_ONLY = String(process.env.SELF_ONLY || 'true').toLowerCase() === 'true';
const SELF_CHAT_ID = (process.env.SELF_CHAT_ID || '').trim();
const ALLOW_AUTH_RESET = String(process.env.ALLOW_AUTH_RESET || 'false').toLowerCase() === 'true';
const QUEUE_FILE = process.env.QUEUE_FILE || path.join(__dirname, 'data', 'expense-queue.jsonl');
const FLUSH_INTERVAL_MS = Number(process.env.FLUSH_INTERVAL_MS || 30_000);

const spreadsheetId = process.env.SPREADSHEET_ID;
if (!spreadsheetId) {
    console.error('FATAL: SPREADSHEET_ID not set in environment.');
    process.exit(1);
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let client = null;
let qrCodeString = null;
let connectionStatus = 'disconnected';
let reconnectAttempt = 0;
let reconnectTimer = null;
let resettingAuth = false;

const RECONNECT_BASE_MS = Number(process.env.RECONNECT_BASE_MS || 5_000);
const RECONNECT_MAX_MS = Number(process.env.RECONNECT_MAX_MS || 120_000);

const sheetsWriter = createSheetsWriter({
    writeFn: appendToSheet,
    queueFileAbs: QUEUE_FILE,
    maxAttempts: Number(process.env.FLUSH_MAX_ATTEMPTS || 6)
});

const processedMessageIds = new Set();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function computeReconnectDelayMs(attempt) {
    const exp = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * Math.pow(2, attempt));
    const jitter = Math.floor(Math.random() * 1000);
    return exp + jitter;
}

function scheduleReconnect(reason) {
    if (resettingAuth) return;
    if (reconnectTimer) return;
    const delay = computeReconnectDelayMs(reconnectAttempt);
    console.error('[reconnect] scheduling in', delay, 'ms (attempt=' + reconnectAttempt + ') reason=' + reason);
    reconnectTimer = setTimeout(async () => {
        reconnectTimer = null;
        reconnectAttempt += 1;
        await startWhatsAppClient();
    }, delay);
}

function shouldProcessOnce(msg) {
    const id = msg?.id?._serialized || msg?.id?.id || (msg?.from + '|' + msg?.to + '|' + msg?.timestamp + '|' + msg?.body);
    if (!id) return true;
    if (processedMessageIds.has(id)) return false;
    processedMessageIds.add(id);
    if (processedMessageIds.size > 500) processedMessageIds.clear();
    return true;
}

// ---------------------------------------------------------------------------
// WhatsApp Client
// ---------------------------------------------------------------------------
async function startWhatsAppClient() {
    connectionStatus = 'starting';
    try {
        if (client) {
            try { await client.destroy(); } catch {}
            client = null;
        }
        client = new Client({
            authStrategy: new LocalAuth(),
            puppeteer: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] }
        });
        wireClientHandlers(client);
        await client.initialize();
    } catch (e) {
        console.error('[startClient] failed', e);
        connectionStatus = 'error';
        scheduleReconnect('start_failed');
    }
}

async function stopWhatsAppClient() {
    if (client) {
        try { await client.destroy(); } catch {}
        client = null;
    }
    connectionStatus = 'disconnected';
    qrCodeString = null;
}

async function restartWhatsAppClient() {
    console.log('[restart] Restarting WhatsApp client...');
    resettingAuth = true;
    await stopWhatsAppClient();
    await new Promise(r => setTimeout(r, 1000));
    const authDir = path.join(__dirname, '.wwebjs_auth');
    try { fs.rmSync(authDir, { recursive: true, force: true }); } catch {}
    reconnectAttempt = 0;
    resettingAuth = false;
    await startWhatsAppClient();
}

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------
async function handleExpenseMessage(sourceEvent, msg) {
    console.log('[' + sourceEvent + '] from=' + msg.from + ' to=' + msg.to + ' fromMe=' + msg.fromMe + ' body=' + JSON.stringify(msg.body));
    if (!shouldProcessOnce(msg)) return;
    if (SELF_ONLY) {
        if (SELF_CHAT_ID) {
            const chatId = msg.fromMe ? msg.to : msg.from;
            if (chatId !== SELF_CHAT_ID) return;
        } else {
            if (!msg.fromMe && msg.from !== msg.to) return;
        }
    }
    const text = (msg.body || '').trim();
    if (!text) return;
    if (/^(help|\?)$/i.test(text)) {
        await msg.reply(['Commands:', '- help', '- reset auth (requires ALLOW_AUTH_RESET=true)', '', 'Log an expense:', '- 120 chai', '- 120 chai Food (or last word as a category)'].join('\n'));
        return;
    }
    if (/^reset\s+auth$/i.test(text)) {
        if (!ALLOW_AUTH_RESET) { await msg.reply('Auth reset is disabled. Set ALLOW_AUTH_RESET=true in .env to enable it.'); return; }
        await msg.reply('Resetting auth and restarting... Scan the new QR code.');
        restartWhatsAppClient();
        return;
    }
    if (!isValidExpense(text)) return;
    const parsedData = parseExpense(text);
    if (!parsedData) return;
    const metaId = msg?.id?._serialized || msg?.id?.id;
    const out = await sheetsWriter.recordAndFlush(parsedData, { id: metaId, sourceEvent, from: msg.from, to: msg.to });
    if (out.ok && (out.remaining || 0) === 0) {
        await msg.reply('Logged! ' + parsedData.description + ' (' + parsedData.amount + ') [' + parsedData.category + ']');
        return;
    }
    const remaining = out.remaining ?? sheetsWriter.getQueueSize();
    await msg.reply('Saved locally, will retry. Queued: ' + remaining + ' Error: ' + (out.error || 'transient'));
}

// ---------------------------------------------------------------------------
// WhatsApp event handlers
// ---------------------------------------------------------------------------
function wireClientHandlers(c) {
    c.on('qr', (qr) => {
        qrCodeString = qr;
        connectionStatus = 'awaiting_scan';
        console.log('--- SCAN THIS QR CODE WITH YOUR WHATSAPP ---');
        qrcode.generate(qr, { small: true });
    });
    c.on('ready', () => {
        reconnectAttempt = 0;
        connectionStatus = 'connected';
        qrCodeString = null;
        console.log('Expense Bot is authenticated, live, and listening for inputs!');
    });
    c.on('authenticated', () => { connectionStatus = 'authenticated'; console.log('[authenticated] WhatsApp session authenticated'); });
    c.on('auth_failure', (m) => { console.error('[auth_failure]', m); connectionStatus = 'auth_failure'; scheduleReconnect('auth_failure'); });
    c.on('disconnected', async (reason) => {
        console.error('[disconnected]', reason);
        connectionStatus = 'disconnected';
        if (/logout/i.test(String(reason))) {
            console.log('[disconnected] Device was unlinked. Wiping auth and restarting client...');
            restartWhatsAppClient();
            return;
        }
        scheduleReconnect('disconnected:' + reason);
    });
    c.on('change_state', (state) => console.log('[change_state]', state));
    c.on('loading_screen', (percent, message) => console.log('[loading_screen]', percent, message));
    c.on('message', (msg) => { handleExpenseMessage('message', msg).catch(err => console.error('[handleExpenseMessage] unhandled', err)); });
    c.on('message_create', (msg) => { if (!msg.fromMe) return; handleExpenseMessage('message_create', msg).catch(err => console.error('[handleExpenseMessage] unhandled', err)); });
}

// ---------------------------------------------------------------------------
// Express server
// ---------------------------------------------------------------------------
const app = express();
app.use(express.json());

// Protect API endpoints with a token (set API_TOKEN in .env)
function requireToken(req, res, next) {
    if (!API_TOKEN) return next(); // No token configured = open access
    const provided = req.query.token || req.headers['x-api-token'];
    if (provided !== API_TOKEN) {
        return res.status(401).json({ error: 'Unauthorized. Provide ?token= or x-api-token header' });
    }
    next();
}

app.get('/', requireToken, (req, res) => {
    const qrBase64 = qrCodeString ? Buffer.from(qrCodeString).toString('base64') : null;
    // If the request accepts HTML, show the page; otherwise return JSON
    const acceptsHtml = req.accepts('html');
    if (acceptsHtml && qrCodeString) {
        res.send(getQrPage(qrBase64));
    } else if (acceptsHtml && connectionStatus === 'connected') {
        res.send(getQrPage(null));
    } else {
        res.json({ status: connectionStatus, qr: qrBase64, uptime: process.uptime(), queueSize: sheetsWriter.getQueueSize() });
    }
});

app.post('/restart', requireToken, (req, res) => {
    console.log('[HTTP] Manual restart requested');
    restartWhatsAppClient();
    res.json({ ok: true, message: 'Restarting WhatsApp client...' });
});

app.post('/shutdown', requireToken, (req, res) => {
    res.json({ ok: true, message: 'Shutting down...' });
    setImmediate(() => gracefulShutdown('HTTP_SHUTDOWN'));
});

const HOST = process.env.HTTP_HOST || '0.0.0.0';
app.listen(HTTP_PORT, HOST, () => {
    console.log('[server] HTTP server listening on http://' + HOST + ':' + HTTP_PORT);
    const tokenInfo = API_TOKEN ? 'with token auth' : '(no API_TOKEN set - open access)';
    console.log('[server] Status: http://localhost:' + HTTP_PORT + '/?token=' + API_TOKEN + ' ' + tokenInfo);
});

// ---------------------------------------------------------------------------
// Flush loop
// ---------------------------------------------------------------------------
const flushInterval = setInterval(async () => {
    try {
        const before = sheetsWriter.getQueueSize();
        if (before === 0) return;
        const out = await sheetsWriter.flushWithRetry();
        const after = sheetsWriter.getQueueSize();
        if (after !== before) console.log('[flush] wrote=' + (out.wrote || 0) + ' remaining=' + after);
    } catch (e) { console.error('[flush] error', e); }
}, FLUSH_INTERVAL_MS);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
startWhatsAppClient();

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------
async function gracefulShutdown(signal) {
    console.log('[shutdown] Received ' + signal + ', flushing queue...');
    clearInterval(flushInterval);
    clearTimeout(reconnectTimer);
    try {
        const out = await sheetsWriter.flushWithRetry();
        console.log('[shutdown] Flushed: wrote=' + (out.wrote || 0) + ' remaining=' + (out.remaining || 0));
    } catch (e) { console.error('[shutdown] Flush error', e); }
    if (client) { try { await client.destroy(); } catch {} }
    process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('uncaughtException', (err) => { console.error('[uncaughtException]', err.message); });
process.on('unhandledRejection', (err) => { console.error('[unhandledRejection]', err); });

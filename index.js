require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
const { isValidExpense, parseExpense } = require('./services/parserService');
const { appendToSheet } = require('./services/sheetsService');
const { acquireLock } = require('./services/singleInstance');
const { killZombieChromeForSession } = require('./services/windowsChromeCleanup');
const { createSheetsWriter } = require('./services/queueService');

const spreadsheetId = process.env.SPREADSHEET_ID;
if (!spreadsheetId) {
    console.error('FATAL: SPREADSHEET_ID not set in environment. Copy .env.example to .env and set SPREADSHEET_ID.');
    process.exit(1);
}

// Ensure only one instance runs (prevents session lock & duplicates).
try {
    acquireLock('expense-bot');
} catch (e) {
    console.error(e?.message || e);
    process.exit(1);
}

// Best-effort: kill only the bot's stale puppeteer Chrome (Windows).
const SESSION_DIR = path.join(__dirname, '.wwebjs_auth', 'session');
const KILL_ZOMBIE_CHROME = String(process.env.KILL_ZOMBIE_CHROME || 'true').toLowerCase() === 'true';
if (KILL_ZOMBIE_CHROME) {
    const res = killZombieChromeForSession(SESSION_DIR);
    if (res.killed > 0) console.log(`[startup] Killed stale chrome PIDs: ${res.pids.join(', ')}`);
}

let client;
let reconnectAttempt = 0;
let reconnectTimer = null;
const RECONNECT_BASE_MS = Number(process.env.RECONNECT_BASE_MS || 5_000);
const RECONNECT_MAX_MS = Number(process.env.RECONNECT_MAX_MS || 120_000);

function computeReconnectDelayMs(attempt) {
    const exp = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * Math.pow(2, attempt));
    const jitter = Math.floor(Math.random() * 1_000);
    return exp + jitter;
}

function scheduleReconnect(reason) {
    if (reconnectTimer) return;
    const delay = computeReconnectDelayMs(reconnectAttempt);
    console.error(`[reconnect] scheduling reconnect in ${delay}ms (attempt=${reconnectAttempt}) reason=${reason}`);
    reconnectTimer = setTimeout(async () => {
        reconnectTimer = null;
        reconnectAttempt += 1;
        await startClient();
    }, delay);
}

async function startClient() {
    try {
        if (client) {
            try {
                await client.destroy();
            } catch {
                // ignore
            }
        }

        if (KILL_ZOMBIE_CHROME) {
            killZombieChromeForSession(SESSION_DIR);
        }

        client = new Client({
            authStrategy: new LocalAuth(),
            puppeteer: {
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
            }
        });

        wireClientHandlers(client);
        await client.initialize();
    } catch (e) {
        console.error('[startClient] failed', e);
        scheduleReconnect('start_failed');
    }
}

const SELF_ONLY = String(process.env.SELF_ONLY || 'true').toLowerCase() === 'true';
const SELF_CHAT_ID = (process.env.SELF_CHAT_ID || '').trim();
const ALLOW_AUTH_RESET = String(process.env.ALLOW_AUTH_RESET || 'false').toLowerCase() === 'true';
const QUEUE_FILE = process.env.QUEUE_FILE || path.join(__dirname, 'data', 'expense-queue.jsonl');
const FLUSH_INTERVAL_MS = Number(process.env.FLUSH_INTERVAL_MS || 30_000);

const sheetsWriter = createSheetsWriter({
    writeFn: appendToSheet,
    queueFileAbs: QUEUE_FILE,
    maxAttempts: Number(process.env.FLUSH_MAX_ATTEMPTS || 6)
});

const processedMessageIds = new Set();
function shouldProcessOnce(msg) {
    const id =
        msg?.id?._serialized ||
        msg?.id?.id ||
        `${msg?.from}|${msg?.to}|${msg?.timestamp}|${msg?.body}`;
    if (!id) return true;
    if (processedMessageIds.has(id)) return false;
    processedMessageIds.add(id);
    if (processedMessageIds.size > 500) processedMessageIds.clear();
    return true;
}

async function handleExpenseMessage(sourceEvent, msg) {
    console.log(
        `[${sourceEvent}] from=${msg.from} to=${msg.to} fromMe=${msg.fromMe} body=${JSON.stringify(msg.body)}`
    );
    if (!shouldProcessOnce(msg)) return;

    // If you only want to log expenses from "Message Yourself", keep SELF_ONLY=true (default).
    // Set SELF_ONLY=false in .env to allow logging from any chat.
    if (SELF_ONLY) {
        // WhatsApp sometimes uses @lid chat ids, so msg.to === msg.from is not reliable.
        // If SELF_CHAT_ID is provided, we strictly match against it.
        // Example observed: to=105544861933666@lid for "Message Yourself".
        if (SELF_CHAT_ID) {
            const chatId = msg.fromMe ? msg.to : msg.from;
            if (chatId !== SELF_CHAT_ID) return;
        } else {
            // Fallback: only allow messages that look like "self chat" in older id formats.
            const isLegacySelfChat = msg.fromMe && msg.to === msg.from;
            if (!isLegacySelfChat) return;
        }
    }

    const text = (msg.body || '').trim();
    if (!text) return;

    // Commands (only safe in your allowed chat due to SELF_ONLY filter above)
    if (/^(help|\?)$/i.test(text)) {
        await msg.reply(
            [
                'Commands:',
                '- help',
                '- reset auth (requires ALLOW_AUTH_RESET=true)',
                '',
                'Log an expense:',
                '- 120 chai',
                '- 120 chai Food (or last word as a category)'
            ].join('\n')
        );
        return;
    }

    if (/^reset\s+auth$/i.test(text)) {
        if (!ALLOW_AUTH_RESET) {
            await msg.reply('❌ Auth reset is disabled. Set ALLOW_AUTH_RESET=true in .env to enable it.');
            return;
        }

        try {
            // Best-effort attempt to logout from WhatsApp Web.
            // Even if it fails, removing LocalAuth will force QR login next start.
            await client.logout().catch(() => undefined);
        } finally {
            const authDir = path.join(__dirname, '.wwebjs_auth');
            try {
                fs.rmSync(authDir, { recursive: true, force: true });
            } catch (e) {
                console.error('[reset_auth] Failed to remove auth folder', e);
            }
        }

        await msg.reply(
            '✅ Auth reset done.\n' +
                'Now restart the bot. It will print a QR code; re-link via WhatsApp → Linked devices → Link a device.'
        );
        // Exit so a process manager (or you) can restart cleanly.
        process.exit(0);
    }

    if (!isValidExpense(text)) return;

    const parsedData = parseExpense(text);

    const metaId = msg?.id?._serialized || msg?.id?.id;
    const out = await sheetsWriter.recordAndFlush(parsedData, {
        id: metaId,
        sourceEvent,
        from: msg.from,
        to: msg.to
    });

    if (out.ok && (out.remaining || 0) === 0) {
        await msg.reply(`✅ Logged!\n📝 ${parsedData.description}\n💰 ${parsedData.amount}\n🗂️ ${parsedData.category}`);
        return;
    }

    // If Sheets is down/transient, we keep the expense queued.
    const remaining = out.remaining ?? sheetsWriter.getQueueSize();
    await msg.reply(
        `⚠️ Saved locally, will retry syncing to Google Sheets.\n` +
            `Queued: ${remaining}\n` +
            `Last error: ${out.error || 'transient/unavailable'}`
    );
}

function wireClientHandlers(c) {
    c.on('qr', (qr) => {
        console.log('--- SCAN THIS QR CODE WITH YOUR WHATSAPP ---');
        qrcode.generate(qr, { small: true });
    });

    c.on('ready', () => {
        reconnectAttempt = 0;
        console.log('Expense Bot is authenticated, live, and listening for inputs!');
    });

    c.on('authenticated', () => console.log('[authenticated] WhatsApp session authenticated'));
    c.on('auth_failure', (m) => {
        console.error('[auth_failure]', m);
        // Auth failure usually requires QR re-link. We don't auto-delete auth here;
        // user can send "reset auth" (if enabled) or manually delete auth folder.
        scheduleReconnect('auth_failure');
    });
    c.on('disconnected', (reason) => {
        console.error('[disconnected]', reason);
        scheduleReconnect(`disconnected:${reason}`);
    });
    c.on('change_state', (state) => console.log('[change_state]', state));
    c.on('loading_screen', (percent, message) => console.log('[loading_screen]', percent, message));

    // Incoming messages (other people -> you)
    c.on('message', async (msg) => {
        await handleExpenseMessage('message', msg);
    });

    // Messages created in the session (includes your own messages; useful for "Message Yourself")
    c.on('message_create', async (msg) => {
        await handleExpenseMessage('message_create', msg);
    });
}

startClient();

// Background flush loop so queued items eventually sync even if you don't send new messages.
setInterval(async () => {
    try {
        const before = sheetsWriter.getQueueSize();
        if (before === 0) return;
        const out = await sheetsWriter.flushWithRetry();
        const after = sheetsWriter.getQueueSize();
        if (after !== before) {
            console.log(`[flush] wrote=${out.wrote || 0} remaining=${after}`);
        }
    } catch (e) {
        console.error('[flush] error', e);
    }
}, FLUSH_INTERVAL_MS);
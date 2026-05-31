require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { isValidExpense, parseExpense } = require('./services/parserService');
const { appendToSheet } = require('./services/sheetsService');
const { createSheetsWriter } = require('./services/queueService');
const { getLastTransactions, getMonthSummary, getLastMonthSummary } = require('./services/sheetsReaderService');
const path = require('path');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const ALLOWED_USER_IDS = (process.env.ALLOWED_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
const QUEUE_FILE = process.env.QUEUE_FILE || path.join(__dirname, 'data', 'expense-queue.jsonl');
const FLUSH_INTERVAL_MS = Number(process.env.FLUSH_INTERVAL_MS || 30_000);

if (!TELEGRAM_TOKEN) {
    console.error('FATAL: TELEGRAM_TOKEN not set in environment.');
    process.exit(1);
}

const spreadsheetId = process.env.SPREADSHEET_ID;
if (!spreadsheetId) {
    console.error('FATAL: SPREADSHEET_ID not set in environment.');
    process.exit(1);
}

// ---------------------------------------------------------------------------
// Queue writer for retrying failed sheet writes
// ---------------------------------------------------------------------------
const sheetsWriter = createSheetsWriter({
    writeFn: appendToSheet,
    queueFileAbs: QUEUE_FILE,
    maxAttempts: Number(process.env.FLUSH_MAX_ATTEMPTS || 6)
});

// ---------------------------------------------------------------------------
// Telegram Bot
// ---------------------------------------------------------------------------
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

console.log('[telegram] Bot started, listening for messages...');

// Authorization check
function isAllowed(userId) {
    if (ALLOWED_USER_IDS.length === 0) return true; // Allow all if not configured
    return ALLOWED_USER_IDS.includes(String(userId));
}

// Format amount with sign for display
function formatAmount(amount) {
    const num = parseFloat(amount);
    if (num < 0) return `💸 -${Math.abs(num).toFixed(2)}`;
    return `💰 +${num.toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const text = (msg.text || '').trim();
    const userName = msg.from.first_name || 'User';

    console.log(`[message] from=${userName} (${userId}) chat=${chatId} text=${JSON.stringify(text)}`);

    // Authorization
    if (!isAllowed(userId)) {
        bot.sendMessage(chatId, 'Sorry, you are not authorized to use this bot.');
        return;
    }

    // Help command
    if (/^\/start$|^\/help$|^(help|\?)$/i.test(text)) {
        bot.sendMessage(chatId, [
            '📋 *Expense Bot Commands*',
            '',
            '📝 *Log expenses:*',
            '`100 chai` - debit (expense)',
            '`-500 salary` - credit (income)',
            '`200 pizza Outing` - with category',
            '',
            '📊 *View data:*',
            '`/last` - Last 5 transactions',
            '`/month` - This month summary',
            '`/lastmonth` - Last month summary',
            '/status - Bot status',
            '/help - Show this',
        ].join('\n'), { parse_mode: 'Markdown' });
        return;
    }

    // Last 5 transactions
    if (/^\/last$|^\/recent$/i.test(text)) {
        bot.sendMessage(chatId, '⏳ Fetching last transactions...');
        const transactions = await getLastTransactions(5);
        if (transactions.length === 0) {
            bot.sendMessage(chatId, 'No transactions found.');
            return;
        }
        const lines = transactions.map((t, i) => {
            const date = t.timestamp.split(' ')[0] || t.timestamp;
            return `${i + 1}. ${date} ${formatAmount(t.amount)} ${t.description} [${t.category}]`;
        });
        bot.sendMessage(chatId, '📋 *Last 5 Transactions*\n\n' + lines.join('\n'), { parse_mode: 'Markdown' });
        return;
    }

    // Monthly summary
    if (/^\/month$|^\/summary$/i.test(text)) {
        bot.sendMessage(chatId, '⏳ Calculating monthly summary...');
        const summary = await getMonthSummary();
        if (summary.transactionCount === 0) {
            bot.sendMessage(chatId, 'No transactions this month.');
            return;
        }

        // Category breakdown
        const catLines = Object.entries(summary.categoryTotals)
            .sort(([, a], [, b]) => b - a)
            .map(([cat, amt]) => {
                const num = parseFloat(amt);
                if (num < 0) return `  ${cat}: 💸 ${Math.abs(num).toFixed(2)}`;
                return `  ${cat}: 💰 ${num.toFixed(2)}`;
            });

        bot.sendMessage(chatId, [
            '📊 *This Month Summary*',
            '',
            `📝 Transactions: ${summary.transactionCount}`,
            `💸 Total Debit: ${summary.totalDebit}`,
            `💰 Total Credit: ${summary.totalCredit}`,
            `📊 Net: ${parseFloat(summary.netBalance) >= 0 ? '💰' : '💸'} ${Math.abs(summary.netBalance)}`,
            '',
            '*Category Breakdown:*',
            ...catLines,
        ].join('\n'), { parse_mode: 'Markdown' });
        return;
    }

    // Last month summary
    if (/^\/lastmonth$/i.test(text)) {
        bot.sendMessage(chatId, '⏳ Calculating last month summary...');
        const summary = await getLastMonthSummary();
        if (summary.transactionCount === 0) {
            bot.sendMessage(chatId, `No transactions in ${summary.monthName}.`);
            return;
        }

        const catLines = Object.entries(summary.categoryTotals)
            .sort(([, a], [, b]) => b - a)
            .map(([cat, amt]) => {
                const num = parseFloat(amt);
                if (num < 0) return `  ${cat}: 💸 ${Math.abs(num).toFixed(2)}`;
                return `  ${cat}: 💰 ${num.toFixed(2)}`;
            });

        bot.sendMessage(chatId, [
            `📊 *${summary.monthName} Summary*`,
            '',
            `📝 Transactions: ${summary.transactionCount}`,
            `💸 Total Debit: ${summary.totalDebit}`,
            `💰 Total Credit: ${summary.totalCredit}`,
            `📊 Net: ${parseFloat(summary.netBalance) >= 0 ? '💰' : '💸'} ${Math.abs(summary.netBalance)}`,
            '',
            '*Category Breakdown:*',
            ...catLines,
        ].join('\n'), { parse_mode: 'Markdown' });
        return;
    }

    // Status command
    if (/^\/status$/i.test(text)) {
        const queueSize = sheetsWriter.getQueueSize();
        bot.sendMessage(chatId, `✅ Bot is running!\nPending writes: ${queueSize}`);
        return;
    }

    // Validate expense format
    if (!isValidExpense(text)) {
        bot.sendMessage(chatId, '❌ Invalid format. Send something like:\n`100 chai`\nor `-500 rent`', { parse_mode: 'Markdown' });
        return;
    }

    // Parse expense
    const parsedData = parseExpense(text);
    if (!parsedData) {
        bot.sendMessage(chatId, '❌ Could not parse expense. Try: `100 chai`', { parse_mode: 'Markdown' });
        return;
    }

    // Try to log to Google Sheets
    const out = await sheetsWriter.recordAndFlush(parsedData, { source: 'telegram', userId, userName });

    if (out.ok && (out.remaining || 0) === 0) {
        const sign = parsedData.amount.startsWith('-') ? '💸' : '💰';
        bot.sendMessage(chatId, `${sign} Logged! *${parsedData.description}* (${parsedData.amount}) [${parsedData.category}]`, { parse_mode: 'Markdown' });
    } else {
        const remaining = out.remaining ?? sheetsWriter.getQueueSize();
        bot.sendMessage(chatId, `⏳ Saved locally, will retry. Queued: ${remaining}`);
    }
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------
bot.on('polling_error', (error) => {
    console.error('[telegram] Polling error:', error.message);
});

bot.on('error', (error) => {
    console.error('[telegram] Error:', error.message);
});

// ---------------------------------------------------------------------------
// Flush loop - retry failed sheet writes periodically
// ---------------------------------------------------------------------------
setInterval(async () => {
    try {
        const before = sheetsWriter.getQueueSize();
        if (before === 0) return;
        const out = await sheetsWriter.flushWithRetry();
        const after = sheetsWriter.getQueueSize();
        if (after !== before) console.log('[flush] wrote=' + (out.wrote || 0) + ' remaining=' + after);
    } catch (e) { console.error('[flush] error', e.message); }
}, FLUSH_INTERVAL_MS);

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------
async function gracefulShutdown(signal) {
    console.log(`[shutdown] Received ${signal}, flushing queue...`);
    try {
        const out = await sheetsWriter.flushWithRetry();
        console.log('[shutdown] Flushed: wrote=' + (out.wrote || 0) + ' remaining=' + (out.remaining || 0));
    } catch (e) { console.error('[shutdown] Flush error', e.message); }
    process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('uncaughtException', (err) => console.error('[uncaughtException]', err.message));
process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err));

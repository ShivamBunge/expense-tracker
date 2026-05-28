require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { isValidExpense, parseExpense } = require('./services/parserService');
const { appendToSheet } = require('./services/sheetsService');

const spreadsheetId = process.env.SPREADSHEET_ID;
if (!spreadsheetId) {
    console.error('FATAL: SPREADSHEET_ID not set in environment. Copy .env.example to .env and set SPREADSHEET_ID.');
    process.exit(1);
}

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        // Crucial flags for bypass restrictions on free cloud instances
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    }
});

client.on('qr', (qr) => {
    console.log('--- SCAN THIS QR CODE WITH YOUR WHATSAPP ---');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('Expense Bot is authenticated, live, and listening for inputs!');
});

const SELF_ONLY = String(process.env.SELF_ONLY || 'true').toLowerCase() === 'true';

client.on('message', async (msg) => {
    // This event fires for incoming messages. It is the most reliable place
    // to validate parsing + confirm the bot is actually receiving updates.
    console.log(
        `[message] from=${msg.from} to=${msg.to} fromMe=${msg.fromMe} body=${JSON.stringify(msg.body)}`
    );

    // If you only want to log expenses from "Message Yourself", keep SELF_ONLY=true (default).
    // Set SELF_ONLY=false in .env to allow logging from any chat.
    if (SELF_ONLY) {
        const isSelfChat = msg.fromMe && msg.to === msg.from;
        if (!isSelfChat) return;
    }

    const text = (msg.body || '').trim();
    if (!text) return;

    if (!isValidExpense(text)) return;

    const parsedData = parseExpense(text);

    const success = await appendToSheet(parsedData);
    if (success) {
        await msg.reply(`✅ Logged!\n📝 ${parsedData.description}\n💰 ${parsedData.amount}\n🗂️ ${parsedData.category}`);
    } else {
        await msg.reply('❌ Failed to connect to Google Sheets. Check server logs.');
    }
});

client.initialize();
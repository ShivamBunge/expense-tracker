const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');

// On Fly.io / cloud: use GOOGLE_CREDENTIALS env var (JSON string)
// Locally: fall back to credentials.json file
const CREDENTIALS_JSON = process.env.GOOGLE_CREDENTIALS;
const KEY_PATH = path.join(__dirname, '../credentials.json');

let auth;

if (CREDENTIALS_JSON) {
    const credentials = JSON.parse(CREDENTIALS_JSON);
    auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
} else if (fs.existsSync(KEY_PATH)) {
    auth = new google.auth.GoogleAuth({
        keyFile: KEY_PATH,
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
} else {
    console.error('No Google credentials found. Set GOOGLE_CREDENTIALS env var or place credentials.json in project root.');
    process.exit(1);
}

module.exports = auth;

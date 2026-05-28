const { google } = require('googleapis');
const path = require('path');

// Loads credentials from the root directory
const KEY_PATH = path.join(__dirname, '../credentials.json');

const auth = new google.auth.GoogleAuth({
    keyFile: KEY_PATH,
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
});

module.exports = auth;
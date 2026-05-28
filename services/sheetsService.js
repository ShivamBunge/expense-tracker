require('dotenv').config();
const { google } = require('googleapis');
const auth = require('../config/google-auth');

const spreadsheetId = process.env.SPREADSHEET_ID;
const sheetName = process.env.SHEET_NAME || 'Sheet1';

async function appendToSheet(expenseData) {
    if (!spreadsheetId) {
        console.error('Missing SPREADSHEET_ID environment variable.');
        return false;
    }

    const row = [
        expenseData.timestamp,
        expenseData.description,
        expenseData.amount,
        expenseData.category
    ];

    try {
        const client = await auth.getClient();
        const sheets = google.sheets({ version: 'v4', auth: client });
        await sheets.spreadsheets.values.append({
            spreadsheetId,
            range: `${sheetName}!A:D`,
            valueInputOption: 'USER_ENTERED',
            requestBody: {
                values: [row]
            }
        });
        console.log(`Successfully logged: ${expenseData.description} (${expenseData.amount})`);
        return true;
    } catch (error) {
        console.error('Google Sheets API Error: ', error);
        return false;
    }
}

module.exports = { appendToSheet };

require('dotenv').config();
const { google } = require('googleapis');
const auth = require('../config/google-auth');

const spreadsheetId = process.env.SPREADSHEET_ID;
const sheetName = process.env.SHEET_NAME || 'Sheet1';

function formatSheetsError(err) {
    const status = err?.response?.status ?? err?.status;
    const message =
        err?.response?.data?.error?.message ||
        err?.message ||
        'Unknown error';
    return status ? `${status} ${message}` : message;
}

async function appendToSheet(expenseData) {
    if (!spreadsheetId) {
        console.error('Missing SPREADSHEET_ID environment variable.');
        return { ok: false, error: 'Missing SPREADSHEET_ID environment variable.' };
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
        // Use values.append to automatically find the next empty row.
        const res = await sheets.spreadsheets.values.append({
            spreadsheetId,
            range: `${sheetName}!A:D`,
            valueInputOption: 'USER_ENTERED',
            insertDataOption: 'INSERT_ROWS',
            requestBody: { values: [row] }
        });
        const updatedRange = res.data?.updates?.updatedRange || 'unknown';
        console.log(`Wrote to range ${updatedRange}`);
        console.log(`Successfully logged: ${expenseData.description} (${expenseData.amount})`);
        return { ok: true };
    } catch (error) {
        console.error('Google Sheets API Error: ', error);
        return { ok: false, error: formatSheetsError(error) };
    }
}

module.exports = { appendToSheet };
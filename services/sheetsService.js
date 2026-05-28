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
        // `values.append` can still shift the destination if Sheets detects the "table"
        // starting at a different column. To force A:D, we compute the next empty row
        // based on column A and then do a strict update to A{n}:D{n}.
        const colA = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: `${sheetName}!A:A`
        });
        const usedRows = colA.data?.values?.length || 0; // includes header row
        const nextRow = Math.max(usedRows + 1, 2); // never overwrite header
        const targetRange = `${sheetName}!A${nextRow}:D${nextRow}`;

        await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: targetRange,
            valueInputOption: 'USER_ENTERED',
            requestBody: {
                values: [row]
            }
        });
        console.log(`Wrote to range ${targetRange}`);
        console.log(`Successfully logged: ${expenseData.description} (${expenseData.amount})`);
        return { ok: true };
    } catch (error) {
        console.error('Google Sheets API Error: ', error);
        return { ok: false, error: formatSheetsError(error) };
    }
}

module.exports = { appendToSheet };
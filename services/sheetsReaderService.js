require('dotenv').config();
const { google } = require('googleapis');
const auth = require('../config/google-auth');

const spreadsheetId = process.env.SPREADSHEET_ID;
const sheetName = process.env.SHEET_NAME || 'Sheet1';

async function getLastTransactions(count = 5) {
    if (!spreadsheetId) {
        console.error('Missing SPREADSHEET_ID environment variable.');
        return [];
    }

    try {
        const client = await auth.getClient();
        const sheets = google.sheets({ version: 'v4', auth: client });
        const res = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: `${sheetName}!A:D`,
        });

        const rows = res.data.values || [];
        if (rows.length <= 1) return []; // Only header row

        // Skip header row, get last N rows
        const dataRows = rows.slice(1);
        const last = dataRows.slice(-count).reverse();

        return last.map(row => ({
            timestamp: row[0] || '',
            description: row[1] || '',
            amount: row[2] || '',
            category: row[3] || ''
        }));
    } catch (error) {
        console.error('Google Sheets API Read Error:', error.message);
        return [];
    }
}

async function getMonthTransactions(targetMonth, targetYear) {
    if (!spreadsheetId) {
        console.error('Missing SPREADSHEET_ID environment variable.');
        return [];
    }

    try {
        const client = await auth.getClient();
        const sheets = google.sheets({ version: 'v4', auth: client });
        const res = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: `${sheetName}!A:D`,
        });

        const rows = res.data.values || [];
        if (rows.length <= 1) return [];

        // Skip header row, filter by target month/year
        const dataRows = rows.slice(1);
        const monthRows = dataRows.filter(row => {
            if (!row[0]) return false;
            try {
                // Sheet format: M/D/YYYY H:MM:SS
                const parts = row[0].split(/[/ :]/);
                if (parts.length >= 3) {
                    const month = parseInt(parts[0]) - 1; // 0-based
                    const year = parseInt(parts[2]);
                    return month === targetMonth && year === targetYear;
                }
            } catch { }
            return false;
        });

        return monthRows.map(row => ({
            timestamp: row[0] || '',
            description: row[1] || '',
            amount: row[2] || '',
            category: row[3] || ''
        }));
    } catch (error) {
        console.error('Google Sheets API Read Error:', error.message);
        return [];
    }
}

async function getCurrentMonthTransactions() {
    const now = new Date();
    return getMonthTransactions(now.getMonth(), now.getFullYear());
}

async function getLastMonthTransactions() {
    const now = new Date();
    const lastMonth = now.getMonth() === 0 ? 11 : now.getMonth() - 1;
    const lastYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
    return getMonthTransactions(lastMonth, lastYear);
}

async function getMonthSummary() {
    const transactions = await getCurrentMonthTransactions();
    
    let totalDebit = 0;
    let totalCredit = 0;
    const categoryTotals = {};

    for (const t of transactions) {
        const amount = parseFloat(t.amount) || 0;
        if (amount < 0) {
            totalDebit += Math.abs(amount);
        } else {
            totalCredit += amount;
        }
        
        const cat = t.category || 'Other';
        categoryTotals[cat] = (categoryTotals[cat] || 0) + amount;
    }

    return {
        totalDebit: totalDebit.toFixed(2),
        totalCredit: totalCredit.toFixed(2),
        netBalance: (totalCredit - totalDebit).toFixed(2),
        transactionCount: transactions.length,
        categoryTotals
    };
}

async function getLastMonthSummary() {
    const now = new Date();
    const lastMonth = now.getMonth() === 0 ? 11 : now.getMonth() - 1;
    const lastYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const monthName = monthNames[lastMonth];
    
    const transactions = await getMonthTransactions(lastMonth, lastYear);
    
    let totalDebit = 0;
    let totalCredit = 0;
    const categoryTotals = {};

    for (const t of transactions) {
        const amount = parseFloat(t.amount) || 0;
        if (amount < 0) {
            totalDebit += Math.abs(amount);
        } else {
            totalCredit += amount;
        }
        
        const cat = t.category || 'Other';
        categoryTotals[cat] = (categoryTotals[cat] || 0) + amount;
    }

    return {
        monthName,
        totalDebit: totalDebit.toFixed(2),
        totalCredit: totalCredit.toFixed(2),
        netBalance: (totalCredit - totalDebit).toFixed(2),
        transactionCount: transactions.length,
        categoryTotals
    };
}

module.exports = { getLastTransactions, getCurrentMonthTransactions, getLastMonthTransactions, getMonthSummary, getLastMonthSummary };

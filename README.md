# Telegram Expense Bot

Log expenses to Google Sheets via Telegram messages.

## Setup

1. `npm install`
2. Create a `.env` file (see `.env.example`)
3. Get a Telegram bot token from [@BotFather](https://t.me/BotFather)
4. Share your Google Sheet with your service account email as Editor
5. Run `npm start`

## Commands

| Command | Description |
|---------|-------------|
| `100 chai` | Log debit (expense) |
| `-500 salary` | Log credit (income) |
| `200 pizza Outing` | Log with category |
| `/last` | Last 5 transactions |
| `/month` | This month summary |
| `/lastmonth` | Last month summary |
| `/help` | Show all commands |

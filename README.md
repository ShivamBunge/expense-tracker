# Personal WhatsApp Expense Tracker Bot

An automation script that captures expenses sent via WhatsApp "Message Yourself" and records them into a Google Sheet in real time.

## Local Setup Instructions

1. Clone this directory.
2. Run `npm install`.
3. Put your Google Service Account JSON file in the root directory named `credentials.json`.
4. Share your Target Google Sheet with the `client_email` listed in your `credentials.json` file as an **Editor**.
5. Create a `.env` file based on the structure shown below and update your target Spreadsheet ID.
6. Run `npm start`.
7. Scan the generated QR code in your terminal with your mobile phone via WhatsApp -> Linked Devices.
/**
 * Returns an HTML page that displays a QR code from base64 PNG data,
 * or a "connected" page when qrPngBase64 is null.
 */
function getQrPage(qrPngBase64) {
    if (!qrPngBase64) {
        return `<!DOCTYPE html>
<html>
<head><title>Expense Bot</title>
<style>
body { font-family: sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #f5f5f5; }
.card { background: white; padding: 2rem; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); text-align: center; }
.status-connected { color: #22c55e; font-weight: bold; }
</style>
</head>
<body>
<div class="card">
    <h2>Expense Bot</h2>
    <p>Status: <span class="status-connected">Connected</span></p>
    <p>The bot is linked to WhatsApp and running.</p>
</div>
</body>
</html>`;
    }

    return `<!DOCTYPE html>
<html>
<head><title>Scan QR Code</title>
<style>
body { font-family: sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #f5f5f5; }
.card { background: white; padding: 2rem; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); text-align: center; }
.qr-img { width: 256px; height: 256px; image-rendering: pixelated; }
.refresh { margin-top: 1rem; color: #666; font-size: 0.9rem; }
</style>
</head>
<body>
<div class="card">
    <h2>Scan QR Code</h2>
    <p>Open WhatsApp → Linked Devices → Link a Device</p>
    <img class="qr-img" src="data:image/png;base64,${qrPngBase64}" alt="QR Code" />
    <p class="refresh">Refresh this page if QR expired</p>
</div>
</body>
</html>`;
}

module.exports = { getQrPage };

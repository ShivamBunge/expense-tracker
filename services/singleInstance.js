const fs = require('fs');
const os = require('os');
const path = require('path');

function isProcessRunning(pid) {
    if (!pid || typeof pid !== 'number') return false;
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

function acquireLock(lockName = 'expense-bot') {
    const lockPath = path.join(os.tmpdir(), `${lockName}.lock.json`);

    try {
        if (fs.existsSync(lockPath)) {
            const raw = fs.readFileSync(lockPath, 'utf8');
            const existing = JSON.parse(raw);
            const existingPid = Number(existing?.pid);
            if (isProcessRunning(existingPid)) {
                const err = new Error(`Another instance is running (pid=${existingPid}).`);
                err.code = 'E_ALREADY_RUNNING';
                throw err;
            }
        }
    } catch (e) {
        // If lock is corrupted or unreadable, treat it as stale and overwrite below.
        if (e?.code === 'E_ALREADY_RUNNING') throw e;
    }

    const payload = {
        pid: process.pid,
        startedAt: new Date().toISOString()
    };
    fs.writeFileSync(lockPath, JSON.stringify(payload, null, 2), 'utf8');

    const cleanup = () => {
        try {
            if (fs.existsSync(lockPath)) {
                const raw = fs.readFileSync(lockPath, 'utf8');
                const existing = JSON.parse(raw);
                if (Number(existing?.pid) === process.pid) {
                    fs.unlinkSync(lockPath);
                }
            }
        } catch {
            // ignore
        }
    };

    process.on('exit', cleanup);
    process.on('SIGINT', () => process.exit(0));
    process.on('SIGTERM', () => process.exit(0));

    return { lockPath };
}

module.exports = { acquireLock };


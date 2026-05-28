const fs = require('fs');
const path = require('path');

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

function safeJsonParse(line) {
    try {
        return JSON.parse(line);
    } catch {
        return null;
    }
}

function isTransientSheetsError(errorString) {
    // We format errors as "STATUS message" in sheetsService.
    // Treat 429 and 5xx as transient.
    const m = String(errorString || '').match(/^\s*(\d{3})\b/);
    const status = m ? Number(m[1]) : null;
    if (!status) return false;
    return status === 429 || (status >= 500 && status <= 599);
}

function ensureDir(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
}

function createQueue(queueFileAbs) {
    const queueFile = path.resolve(queueFileAbs);
    ensureDir(path.dirname(queueFile));

    function enqueue(item) {
        const line = JSON.stringify(item);
        fs.appendFileSync(queueFile, line + '\n', 'utf8');
    }

    function readAll() {
        if (!fs.existsSync(queueFile)) return [];
        const raw = fs.readFileSync(queueFile, 'utf8');
        const lines = raw.split(/\r?\n/).filter(Boolean);
        return lines.map(safeJsonParse).filter(Boolean);
    }

    function rewrite(items) {
        const content = items.map((i) => JSON.stringify(i)).join('\n');
        fs.writeFileSync(queueFile, content ? content + '\n' : '', 'utf8');
    }

    return { queueFile, enqueue, readAll, rewrite };
}

function createSheetsWriter({ writeFn, queueFileAbs, maxAttempts = 6 }) {
    const queue = createQueue(queueFileAbs);
    let flushing = false;

    async function flushOnce() {
        if (flushing) return { ok: true, skipped: true, remaining: queue.readAll().length };
        flushing = true;
        try {
            const items = queue.readAll();
            const remaining = [];
            let wrote = 0;

            for (const item of items) {
                const res = await writeFn(item.expense);
                if (res.ok) {
                    wrote += 1;
                    continue;
                }

                // If not transient, keep it but don't block later ones forever.
                // We'll re-queue and continue.
                remaining.push({
                    ...item,
                    attempts: (item.attempts || 0) + 1,
                    lastError: res.error,
                    lastTriedAt: new Date().toISOString()
                });
            }

            queue.rewrite(remaining);
            return { ok: true, wrote, remaining: remaining.length };
        } finally {
            flushing = false;
        }
    }

    async function flushWithRetry() {
        let attempt = 0;
        while (attempt < maxAttempts) {
            const snapshot = queue.readAll();
            if (snapshot.length === 0) return { ok: true, wrote: 0, remaining: 0 };

            const out = await flushOnce();
            if (!out.ok) return out;

            const after = queue.readAll();
            if (after.length === 0) return { ok: true, wrote: out.wrote || 0, remaining: 0 };

            const lastErr = after[0]?.lastError;
            if (!isTransientSheetsError(lastErr)) {
                // Not transient; stop retry loop to avoid hammering.
                return { ok: true, wrote: out.wrote || 0, remaining: after.length, stoppedOn: 'non_transient' };
            }

            const delay = Math.min(60_000, 2_000 * Math.pow(2, attempt));
            await sleep(delay);
            attempt += 1;
        }
        return { ok: false, error: 'Flush retries exhausted', remaining: queue.readAll().length };
    }

    async function recordAndFlush(expense, meta) {
        const item = {
            id: meta?.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
            enqueuedAt: new Date().toISOString(),
            attempts: 0,
            expense,
            meta: meta || {}
        };
        queue.enqueue(item);
        const out = await flushWithRetry();
        return { ...out, queueFile: queue.queueFile };
    }

    function getQueueSize() {
        return queue.readAll().length;
    }

    return { recordAndFlush, flushWithRetry, flushOnce, getQueueSize, queueFile: queue.queueFile };
}

module.exports = { createSheetsWriter };


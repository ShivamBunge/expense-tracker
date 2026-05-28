const { execSync } = require('child_process');
const path = require('path');

function buildWmicLikeClause(userDataDir) {
    // WMIC LIKE uses % wildcard. Also requires backslashes to be escaped in our JS string.
    // We'll match a distinctive piece: \.wwebjs_auth\session
    const needle = userDataDir.replace(/\\/g, '\\\\');
    return `%${needle}%`;
}

function killZombieChromeForSession(sessionDirAbs) {
    if (process.platform !== 'win32') return { killed: 0, pids: [] };

    const userDataDir = path.resolve(sessionDirAbs);
    const like = buildWmicLikeClause(userDataDir);

    const listCmd = `wmic process where "name='chrome.exe' and CommandLine like '${like}'" get ProcessId`;
    let output = '';
    try {
        output = execSync(listCmd, { stdio: ['ignore', 'pipe', 'pipe'] }).toString('utf8');
    } catch {
        return { killed: 0, pids: [] };
    }

    const pids = output
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => /^[0-9]+$/.test(l))
        .map((l) => Number(l));

    let killed = 0;
    for (const pid of [...new Set(pids)]) {
        try {
            execSync(`taskkill /PID ${pid} /F`, { stdio: ['ignore', 'ignore', 'ignore'] });
            killed += 1;
        } catch {
            // ignore
        }
    }

    return { killed, pids: [...new Set(pids)] };
}

module.exports = { killZombieChromeForSession };


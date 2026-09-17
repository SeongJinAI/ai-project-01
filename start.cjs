const { spawn, execFileSync } = require('node:child_process');
const { existsSync, readFileSync } = require('node:fs');
const path = require('node:path');
const isWSL = process.platform === 'linux' && /microsoft/i.test(readFileSync('/proc/sys/kernel/osrelease', 'utf8'));
if (isWSL && !process.argv.includes('--linux')) {
  const script = execFileSync('wslpath', ['-w', path.join(__dirname, 'windows.ps1')], { encoding: 'utf8' }).trim();
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], { stdio: 'inherit' });
  child.on('error', error => { console.error('Windows 실행 실패:', error.message); process.exitCode = 1; });
  child.on('exit', code => { process.exitCode = code ?? 1; });
} else {
const electron = require('electron');
const args = ['.', ...process.argv.slice(2).filter(arg => arg !== '--linux')];
const address = process.env.DBUS_SESSION_BUS_ADDRESS || '';
const socket = address.match(/^unix:path=([^,;]+)/)?.[1];
const needsSession = process.platform === 'linux' && (!address || (socket && !existsSync(socket)));
const useSession = needsSession && existsSync('/usr/bin/dbus-run-session');
const child = spawn(useSession ? '/usr/bin/dbus-run-session' : electron, useSession ? ['--', electron, ...args] : args, { stdio: 'inherit' });
child.on('error', error => { console.error('Orbit 실행 실패:', error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 0; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));

}

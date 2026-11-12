const net = require('node:net');
const path = require('node:path');
const {spawn} = require('node:child_process');

async function availablePort() {
  const listener = net.createServer();
  await new Promise((resolve, reject) => listener.once('error', reject).listen(0, '127.0.0.1', resolve));
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  return port;
}

async function startServer({dice = [6,2,1,6,3,4,5], port} = {}) {
  port ||= await availablePort();
  const root = path.resolve(__dirname, '../..');
  const child = spawn(process.execPath, [
    '--require', path.join(root, 'tests/support/deterministic-dice.cjs'),
    path.join(root, 'server.js')
  ], {
    cwd: root,
    env: {...process.env, PORT: String(port), DATABASE_URL: '', LUDO_TEST_DICE: dice.join(',')},
    stdio: ['ignore','pipe','pipe']
  });
  let logs = '';
  child.stdout.on('data', chunk => { logs += chunk.toString(); });
  child.stderr.on('data', chunk => { logs += chunk.toString(); });
  const baseURL = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 8000;
  while(Date.now() < deadline) {
    if(child.exitCode !== null) throw new Error(`Test server exited early.\n${logs}`);
    try {
      const response = await fetch(baseURL);
      if(response.ok) return {child,baseURL,logs:()=>logs,close:()=>stopServer(child)};
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  await stopServer(child);
  throw new Error(`Test server did not become ready.\n${logs}`);
}

async function stopServer(child) {
  if(child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise(resolve => child.once('exit', resolve)),
    new Promise(resolve => setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 1500))
  ]);
}

module.exports = {startServer,stopServer};

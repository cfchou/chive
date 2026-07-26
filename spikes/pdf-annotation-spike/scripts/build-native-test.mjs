import { spawn } from 'node:child_process';
import { rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const capabilityPath = path.join(root, 'src-tauri', 'capabilities', 'wdio.json');

const capability = {
  $schema: '../gen/schemas/desktop-schema.json',
  identifier: 'wdio-test',
  description: 'Test-only capability for WDIO Tauri smoke tests',
  windows: ['main'],
  permissions: ['wdio:default', 'wdio-webdriver:default']
};

async function run() {
  process.env.VITE_WDIO_TAURI = '1';

  await writeFile(capabilityPath, `${JSON.stringify(capability, null, 2)}\n`);

  const child = spawn('tauri', ['build', '--debug', '--features', 'wdio', '--no-bundle'], {
    cwd: root,
    env: process.env,
    stdio: 'inherit'
  });

  const result = await new Promise((resolve) => {
    child.on('close', (code, signal) => resolve({ code, signal }));
  });

  await rm(capabilityPath, { force: true });

  if (result.signal) {
    process.kill(process.pid, result.signal);
    return;
  }

  process.exit(result.code ?? 1);
}

run().catch(async (error) => {
  await rm(capabilityPath, { force: true });
  console.error(error);
  process.exit(1);
});

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../app/server.js';

try {
  const server = await startServer({ dataDir: join(dirname(fileURLToPath(import.meta.url)), '.data'), demo: true });
  console.log(`Replay Mark demo: http://127.0.0.1:${server.address().port}`);
} catch (e) { console.error(`Cannot start demo: ${e.message}`); process.exitCode = 1; }

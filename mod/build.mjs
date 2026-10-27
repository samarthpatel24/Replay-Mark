import { readFile, writeFile, mkdir, mkdtemp, cp, access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { defaultDataDir } from '../app/server.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
export const requiredAssets = [
  'panorama/layout/replay/citadel_hud_replay.vxml_c',
  'panorama/scripts/rm_config.vjs_c',
  'panorama/scripts/rm_spike.vjs_c',
  'panorama/styles/rm_spike.vcss_c'
];

export async function prepareSpike({ dataDir = defaultDataDir(), buildDir = join(ROOT, 'build') } = {}) {
  let token;
  try { ({ token } = JSON.parse(await readFile(join(dataDir, 'db.json'), 'utf8'))); }
  catch { throw new Error('Cannot read companion workspace. Start Replay Mark first or pass its data directory.'); }
  if (typeof token !== 'string' || !/^[a-f0-9]{48}$/.test(token)) throw new Error('Companion workspace has no valid bridge token.');
  await mkdir(buildDir, { recursive: true });
  const stage = await mkdtemp(join(buildDir, 'spike-'));
  const source = join(stage, 'source');
  await cp(join(ROOT, 'src'), source, { recursive: true });
  const config = { bridgeUrl: 'http://127.0.0.1:47800/bridge?token=' + token };
  await writeFile(join(source, 'panorama/scripts/rm_config.js'), 'var RMConfig = ' + JSON.stringify(config) + ';\n', { mode: 0o600 });
  return { source, compiled: source + '_compiled', vpk: join(stage, 'pak77_dir.vpk') };
}

function runTool(executable, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', errors = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('Build tool timed out: ' + executable)); }, 120000);
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { errors += chunk; });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => { clearTimeout(timer); if (code !== 0) reject(new Error(`Build tool failed (${code}): ${errors || executable}`)); else resolve(output); });
  });
}

export async function buildSpike({ compiler, packer, run = runTool, ...options } = {}) {
  if (!compiler || !packer) throw new Error('Provide paths to the Source2 compiler wrapper and vpkeditcli.');
  await access(compiler); await access(packer);
  const paths = await prepareSpike(options);
  await run(resolve(compiler), [paths.source]);
  for (const asset of requiredAssets) {
    try { await access(join(paths.compiled, asset)); }
    catch { throw new Error('Compiler did not create ' + asset); }
  }
  await run(resolve(packer), [paths.compiled, '-o', paths.vpk, '-s', '--no-progress']);
  await access(paths.vpk);
  const tree = (await run(resolve(packer), [paths.vpk, '--file-tree', '--no-progress'])).replace(/\\/g, '/').toLowerCase();
  for (const asset of requiredAssets) if (!tree.includes(asset)) throw new Error('Packed VPK is missing ' + asset);
  return paths;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv[2] === '--prepare-only') {
      const paths = await prepareSpike({ dataDir: process.argv[3] || defaultDataDir() });
      console.log('Spike source prepared: ' + paths.source);
    } else {
      if (process.platform !== 'win32') throw new Error('Compiling the spike requires Windows. Use --prepare-only on Mac.');
      const paths = await buildSpike({ compiler: process.argv[2], packer: process.argv[3], dataDir: process.argv[4] || defaultDataDir() });
      console.log('Spike VPK built: ' + paths.vpk);
    }
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}

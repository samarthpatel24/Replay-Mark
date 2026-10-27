import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { prepareSpike, buildSpike, requiredAssets } from '../../mod/build.mjs';

test('spike preparation keeps token in generated source; build checks compiler output and packed assets', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rm-build-test-'));
  try {
    const token = 'a'.repeat(48), buildDir = join(root, 'build');
    await writeFile(join(root, 'db.json'), JSON.stringify({ token }));
    const paths = await prepareSpike({ dataDir: root, buildDir });
    const config = vm.runInNewContext(await readFile(join(paths.source, 'panorama/scripts/rm_config.js'), 'utf8') + '\nRMConfig');
    assert.equal(config.bridgeUrl, 'http://127.0.0.1:47800/bridge?token=' + token);
    assert.match(await readFile(join(paths.source, 'panorama/layout/replay/citadel_hud_replay.xml'), 'utf8'), /RMSpike\.addBookmark\(\)/);
    const compiler = join(root, 'compiler.exe'), packer = join(root, 'vpkeditcli.exe');
    await writeFile(compiler, ''); await writeFile(packer, '');
    const calls = [];
    const run = async (executable, args) => {
      calls.push({ executable, args });
      if (executable === compiler) {
        for (const asset of requiredAssets) { const file = join(args[0] + '_compiled', asset); await mkdir(dirname(file), { recursive: true }); await writeFile(file, 'compiled test fixture'); }
      } else if (args.includes('-o')) await writeFile(args[args.indexOf('-o') + 1], 'VPK test fixture');
      else return requiredAssets.join('\n');
      return '';
    };
    const built = await buildSpike({ compiler, packer, dataDir: root, buildDir, run });
    assert.equal(calls.length, 3);
    assert.equal(calls[0].args[0], built.source);
    assert.deepEqual(calls[1].args, [built.compiled, '-o', built.vpk, '-s', '--no-progress']);
    assert.deepEqual(calls[2].args, [built.vpk, '--file-tree', '--no-progress']);
    await assert.rejects(buildSpike({ compiler, packer, dataDir: root, buildDir, run: async () => '' }), /Compiler did not create/);
    await assert.rejects(buildSpike({ compiler, packer, dataDir: root, buildDir, run: (exe, args) => args.includes('--file-tree') ? Promise.resolve('wrong asset') : run(exe, args) }), /Packed VPK is missing/);
    await writeFile(join(root, 'db.json'), JSON.stringify({ token: 'invalid' }));
    await assert.rejects(prepareSpike({ dataDir: root, buildDir }), /valid bridge token/);
  } finally { await rm(root, { recursive: true, force: true }); }
});


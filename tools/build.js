'use strict';
// Packages src/ into "Beacon Builds\Beacon-<version>-Windows\Beacon" (outside OneDrive),
// checks every file arrived, writes a file list the updater checks, zips it, and copies the zip
// into dist\. Run: npm run build
//
// Why outside OneDrive: when a folder is deleted and made again under the same name, OneDrive can
// replay the old delete over the new files, which left earlier builds with files missing.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { packager } = require('@electron/packager');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');
const BUILDS = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Beacon Builds');
const pkg = require(path.join(SRC, 'package.json'));
const ELECTRON = require(path.join(ROOT, 'node_modules', 'electron', 'package.json')).version;
const LEFT_OUT = new Set(['mock.js']); // test mode only

/** Every file under dir as {"relative/path": size}. */
function listFiles(dir) {
  const out = {};
  const walk = (d) => {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, f.name);
      if (f.isDirectory()) walk(p); else out[path.relative(dir, p).split(path.sep).join('/')] = fs.statSync(p).size;
    }
  };
  walk(dir);
  return out;
}

async function zipWithRetry(zip, cwd, folder) {
  // Windows' own tar writes zip files and, unlike Compress-Archive, fails loudly. Antivirus can
  // briefly lock fresh files, so wait and try again a few times.
  const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
  for (let attempt = 1; ; attempt++) {
    try { execFileSync(tar, ['-a', '-c', '-f', zip, '-C', cwd, folder], { stdio: 'inherit' }); return; }
    catch (e) {
      fs.rmSync(zip, { force: true });
      if (attempt >= 4) throw e;
      console.log('Zip failed, a file was probably busy. Trying again in 5 seconds...');
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

(async () => {
  if (!fs.existsSync(path.join(SRC, 'client.json'))) console.log('No src/client.json: this build asks for a Google key file on first start.');
  const name = 'Beacon-' + pkg.version + '-Windows';
  const outDir = path.join(BUILDS, name);
  const zip = outDir + '.zip';
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.rmSync(zip, { force: true });
  fs.rmSync(path.join(BUILDS, '.tmp'), { recursive: true, force: true });

  const [built] = await packager({
    dir: SRC, out: path.join(BUILDS, '.tmp'), overwrite: true,
    platform: 'win32', arch: 'x64', electronVersion: ELECTRON,
    name: pkg.productName, executableName: pkg.productName, appVersion: pkg.version,
    icon: path.join(SRC, 'assets', 'icon.ico'), asar: false, prune: false,
    ignore: [...LEFT_OUT].map((f) => new RegExp('^/' + f.replace('.', '\\.') + '$')),
    win32metadata: { CompanyName: pkg.author, FileDescription: pkg.productName, ProductName: pkg.productName, InternalName: pkg.productName, OriginalFilename: pkg.productName + '.exe' },
    appCopyright: 'Copyright (C) ' + new Date().getFullYear() + ' ' + pkg.author,
  });

  const appDir = path.join(outDir, pkg.productName);
  fs.mkdirSync(outDir, { recursive: true });
  fs.renameSync(built, appDir);
  fs.rmSync(path.join(BUILDS, '.tmp'), { recursive: true, force: true });

  // Every source file must be in the build, byte for byte the same size.
  const appFiles = path.join(appDir, 'resources', 'app');
  const want = listFiles(SRC); const got = listFiles(appFiles);
  const bad = Object.keys(want).filter((f) => !LEFT_OUT.has(f) && got[f] !== want[f]);
  if (bad.length) throw new Error('Build is missing or changed ' + bad.length + ' file(s): ' + bad.slice(0, 5).join(', '));

  const readme = fs.readFileSync(path.join(ROOT, 'READ ME FIRST.txt'), 'utf8').replace(/^Beacon [\d.]+/, 'Beacon ' + pkg.version);
  fs.writeFileSync(path.join(appDir, 'READ ME FIRST.txt'), readme);
  // The updater refuses a copy whose files do not match this list.
  const files = listFiles(appDir);
  fs.writeFileSync(path.join(appFiles, 'manifest.json'), JSON.stringify({ version: pkg.version, files }));

  await zipWithRetry(zip, outDir, pkg.productName);
  fs.mkdirSync(DIST, { recursive: true });
  const distZip = path.join(DIST, name + '.zip');
  fs.copyFileSync(zip, distZip);
  if (fs.statSync(distZip).size !== fs.statSync(zip).size) throw new Error('Copying the zip into dist did not finish.');

  console.log('Checked', Object.keys(files).length, 'files');
  console.log('Built  ', appDir);
  console.log('Zipped ', zip);
  console.log('Copied ', path.relative(ROOT, distZip));
})().catch((e) => { console.error(e.message || e); process.exit(1); });

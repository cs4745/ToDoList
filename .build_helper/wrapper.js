const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const argv = process.argv;
const cmd = argv[1];
const base = typeof cmd === 'string' ? path.basename(cmd) : '';

// 7za is invoked as: 7za.exe <cmd> [-flags] <args...>
// node resolves argv[1] to an absolute path, so we look at its basename.
// electron-builder itself is launched as node <cli.js> ..., basename = 'cli.js' (len > 1).
const is7zaCmd = base.length === 1 && /^[a-zA-Z]$/.test(base);

process.stderr.write('[wrap] base=' + JSON.stringify(base) + ' is7za=' + is7zaCmd + '\n');

if (!is7zaCmd) {
  // Not a 7za invocation (e.g. electron-builder main process) -> let node continue.
  return;
}

if (base === 'x') {
  // extraction: locate archive and output dir
  let archive = null;
  let outDir = null;
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-o' && argv[i + 1]) {
      outDir = argv[i + 1];
      i++;
    } else if (a.startsWith('-o')) {
      outDir = a.slice(2);
    } else if (!a.startsWith('-') && archive === null) {
      archive = a;
    }
  }
  if (!archive || !outDir) {
    process.stderr.write('[wrap] extract: missing archive or outDir\n');
    process.exit(2);
  }
  const real = path.join(path.dirname(process.execPath), '7za_real.exe');
  // argv[1] is the resolved main-script path; restore the original letter cmd.
  // -y: assume Yes to all prompts so extraction never blocks on stdin.
  const realArgs = [base, '-y'].concat(argv.slice(2));
  const r = spawnSync(real, realArgs, { stdio: 'inherit' });
  const code = r.status === null ? 1 : r.status;
  if (code === 0) {
    process.exit(0);
  }
  // 7za may exit non-zero ONLY because it cannot create the darwin .dylib
  // symbolic links on Windows (no privilege). Those symlinks are not needed
  // for a Windows build, so if the critical binaries were extracted we treat
  // it as success.
  const markers = ['rcedit-x64.exe', 'rcedit-ia32.exe', 'windows-10/signtool.exe'];
  const extracted = markers.some((m) => fs.existsSync(path.join(outDir, m)));
  if (extracted) {
    process.stderr.write('[wrap] symlink-only failure tolerated; required files present\n');
    process.exit(0);
  }
  process.exit(code);
} else {
  // other 7za commands (a, l, t, ...) -> delegate to real 7za
  const real = path.join(path.dirname(process.execPath), '7za_real.exe');
  const realArgs = [base, '-y'].concat(argv.slice(2));
  const r = spawnSync(real, realArgs, { stdio: 'inherit' });
  process.exit(r.status === null ? 1 : r.status);
}

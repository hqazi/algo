/**
 * Package the app with electron-builder (T13, SPEC §11): `electron-builder.yml`
 * plus an afterPack hook that flips the Electron fuses (D-17) before
 * electron-builder signs anything. Run after `electron-vite build`
 * (`npm run package` does both).
 *
 *   tsx packaging/package.ts [--dir] [--publish always|never]
 *     [--target <name>] [--version <v>] [--feed <url>]
 *
 * `--dir` stops at the unpacked app (no installers): the quick local check.
 * Builds for the OS it runs on; the release workflow runs it on all three.
 * For update tests only: `--target` builds one target (e.g. AppImage),
 * `--version` overrides the packaged version, and `--feed` points the
 * updater at a plain HTTP folder instead of GitHub Releases.
 */
import { join } from 'node:path';
import { Arch, build, type AfterPackContext, type Configuration } from 'electron-builder';
import { applyFuses, expectedFuses, readFuses } from './fuses';

/** The file `flipFuses` takes: the `.app` bundle on macOS, the executable elsewhere. */
export function fuseTarget(ctx: {
  appOutDir: string;
  electronPlatformName: string;
  productFilename: string;
  executableName: string;
}): string {
  switch (ctx.electronPlatformName) {
    case 'darwin':
    case 'mas':
      return join(ctx.appOutDir, `${ctx.productFilename}.app`);
    case 'win32':
      return join(ctx.appOutDir, `${ctx.productFilename}.exe`);
    default:
      return join(ctx.appOutDir, ctx.executableName);
  }
}

async function afterPack(ctx: AfterPackContext): Promise<void> {
  const target = fuseTarget({
    appOutDir: ctx.appOutDir,
    electronPlatformName: ctx.electronPlatformName,
    productFilename: ctx.packager.appInfo.productFilename,
    // Only the Linux packager has one (from `executableName` in the config).
    executableName:
      (ctx.packager as unknown as { executableName?: string }).executableName ??
      ctx.packager.appInfo.productFilename,
  });
  const arch = Arch[ctx.arch];
  await applyFuses(target, ctx.electronPlatformName, arch);
  // Read them back: a packaged app with the wrong fuses must not ship.
  const actual = await readFuses(target);
  const wrong = Object.entries(expectedFuses()).filter(([k, v]) => actual[k] !== v);
  if (wrong.length > 0) {
    throw new Error(`fuses not as configured in ${target}: ${wrong.map(([k]) => k).join(', ')}`);
  }
  console.log(`  • fuses flipped and checked  file=${target} arch=${arch}`);
}

async function main(argv: string[]): Promise<void> {
  const flag = (name: string): string | undefined => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const publish = flag('--publish') ?? 'never';
  if (publish !== 'always' && publish !== 'never') throw new Error('--publish always|never');
  const version = flag('--version');
  const feed = flag('--feed');
  const target = flag('--target');
  // Merged over electron-builder.yml.
  const config: Configuration = {
    afterPack,
    ...(version ? { extraMetadata: { version } } : {}),
    // A list replaces the file's `publish` object; an object would be merged into it.
    ...(feed ? { publish: [{ provider: 'generic', url: feed }] } : {}),
  };
  const platform =
    process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : 'linux';
  const files = await build({
    projectDir: join(import.meta.dirname, '..'),
    publish,
    dir: argv.includes('--dir'),
    ...(target ? { [platform]: [target] } : {}),
    config,
  });
  for (const f of files) console.log(f);
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main(process.argv.slice(2)).catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
}

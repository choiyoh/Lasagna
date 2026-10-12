import { cpSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

/** 번들하지 않고 런타임에 require 하는 네이티브 모듈. vite.*.config.ts의 external과 같아야 한다. */
export const EXTERNAL_NATIVE = ['better-sqlite3', '@parcel/watcher'];

const require = createRequire(import.meta.url);

function pkgDir(name: string, from: string): string | undefined {
  try {
    return path.dirname(require.resolve(`${name}/package.json`, { paths: [from] }));
  } catch {
    return undefined;
  }
}

/** 현재 플랫폼에 맞는 선택 의존성만 포함한다(예: @parcel/watcher-darwin-arm64). */
function optionalMatchesPlatform(name: string): boolean {
  const plat = process.platform;
  const arch = process.arch;
  if (!name.startsWith('@parcel/watcher-')) return false;
  const suffix = name.slice('@parcel/watcher-'.length);
  if (!suffix.startsWith(`${plat}-${arch}`)) return false;
  return true;
}

const SKIP_TOP_LEVEL = new Set(['deps', 'src', 'test', 'tests', 'docs']);

/** 네이티브 모듈과 그 런타임 의존성 폐포를 앱 빌드 디렉터리의 node_modules로 복사한다. */
export function copyNativeModules(buildPath: string, fromDir: string) {
  const seen = new Set<string>();
  const queue: { name: string; from: string }[] = EXTERNAL_NATIVE.map((name) => ({ name, from: fromDir }));
  while (queue.length) {
    const { name, from } = queue.shift()!;
    const dir = pkgDir(name, from);
    if (!dir || seen.has(dir)) continue;
    seen.add(dir);

    const dest = path.join(buildPath, 'node_modules', name);
    mkdirSync(path.dirname(dest), { recursive: true });
    cpSync(dir, dest, {
      recursive: true,
      filter: (src) => {
        const rel = path.relative(dir, src);
        const top = rel.split(path.sep)[0] ?? '';
        if (SKIP_TOP_LEVEL.has(top)) return false;
        // 다른 플랫폼 prebuild는 제외
        if (top === 'prebuilds' && rel !== 'prebuilds' && !path.basename(src).startsWith(`${process.platform}-${process.arch}`) && path.dirname(rel) === 'prebuilds') {
          return false;
        }
        // 빌드 중간 산출물 제외
        return !/\.(o|mk|stamp|Makefile)$/.test(src) && !src.includes(`${path.sep}obj.target`);
      },
    });

    const meta = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
    };
    for (const dep of Object.keys(meta.dependencies ?? {})) queue.push({ name: dep, from: dir });
    for (const dep of Object.keys(meta.optionalDependencies ?? {})) {
      if (optionalMatchesPlatform(dep)) queue.push({ name: dep, from: dir });
    }
    if (!existsSync(dest)) throw new Error(`복사 실패: ${name}`);
  }
  return [...seen];
}

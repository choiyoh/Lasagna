#!/usr/bin/env bash
# macOS 설치 파일을 이 맥에서 만들어 GitHub 릴리스에 올린다(CI 분량 절약).
# 사용: scripts/release-mac.sh v0.3.0   (릴리스가 아직 없으면 새로 만든다)
set -euo pipefail
tag="${1:?사용법: scripts/release-mac.sh <태그>  예) v0.3.0}"
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
pnpm install --frozen-lockfile
pnpm --filter @nopsidian/desktop make -- --platform=darwin
dmg="$(ls apps/desktop/out/make/dmg/*/Nopsidian.dmg | head -1)"
zip="$(ls apps/desktop/out/make/zip/darwin/*/*.zip | head -1)"
if ! gh release view "$tag" >/dev/null 2>&1; then
  gh release create "$tag" --title "$tag" --generate-notes --notes "서명하지 않은 빌드입니다. macOS: .dmg 를 Applications 로 옮긴 뒤 처음 한 번은 우클릭 → 열기."
fi
gh release upload "$tag" "$dmg" "$zip" --clobber
echo "올렸어요: $(gh release view "$tag" --json url -q .url)"

#!/usr/bin/env bash
# Build, test and package one release zip:
#
#   articledrop-<version>.zip
#   └── articledrop-<version>/
#       ├── 1-install/articledrop/     main.js, manifest.json, styles.css → copy into <vault>/.obsidian/plugins/
#       ├── 2-github-release/          the same three files, to attach to a GitHub release
#       ├── 3-source/articledrop/      full source (no node_modules) for the GitHub repository
#       ├── CHANGELOG.md
#       └── 읽어보기.txt
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="${1:-$(dirname "$ROOT")}"
cd "$ROOT"

VERSION="$(node -p "require('./manifest.json').version")"
NAME="articledrop-${VERSION}"

npm run build >/dev/null
npm test >/dev/null

# The Obsidian review bot installs with a plain `npm ci`. Reproduce that in a clean copy
# so an out-of-date package-lock.json is caught here instead of in review.
CHECK="$(mktemp -d)"
tar --exclude=./node_modules -cf - . | tar -xf - -C "$CHECK"
if ! (cd "$CHECK" && npm ci --no-audit --no-fund --ignore-scripts >/dev/null 2>&1 && npm run build >/dev/null 2>&1); then
	rm -rf "$CHECK"
	echo "npm ci failed in a clean copy: run 'npm install' (without --legacy-peer-deps) and try again." >&2
	exit 1
fi
rm -rf "$CHECK"

STAGE="$(mktemp -d)"
PKG="$STAGE/$NAME"
mkdir -p "$PKG/1-install/articledrop" "$PKG/2-github-release" "$PKG/3-source"

cp main.js manifest.json styles.css "$PKG/1-install/articledrop/"
cp main.js manifest.json styles.css "$PKG/2-github-release/"

mkdir -p "$PKG/3-source/articledrop"
tar --exclude=./node_modules --exclude=./main.js --exclude=./data.json --exclude='.DS_Store' -cf - . | tar -xf - -C "$PKG/3-source/articledrop"
cp CHANGELOG.md "$PKG/"

cat > "$PKG/읽어보기.txt" <<EOF
Articledrop ${VERSION}

1-install
  articledrop 폴더를 통째로 <볼트>/.obsidian/plugins/ 안에 넣으세요.
  이미 설치돼 있다면 안의 세 파일(main.js, manifest.json, styles.css)을 덮어쓰면 됩니다.
  Obsidian에서 플러그인을 다시 켜거나 앱을 다시 시작하세요.

2-github-release
  GitHub 저장소의 Releases에서 태그를 ${VERSION} 으로 만들고
  이 세 파일을 첨부하세요. (커뮤니티 플러그인 배포용)

3-source
  저장소에 올릴 소스 전체입니다. node_modules는 빠져 있으니
  받은 뒤 npm install 을 먼저 실행하세요.

CHANGELOG.md
  이번 버전에서 바뀐 내용.
EOF

rm -f "$OUT_DIR/$NAME.zip"
(cd "$STAGE" && zip -qr "$OUT_DIR/$NAME.zip" "$NAME")
rm -rf "$STAGE"
echo "$OUT_DIR/$NAME.zip"

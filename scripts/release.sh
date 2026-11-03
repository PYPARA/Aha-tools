#!/usr/bin/env bash
# 打包 AhaTools.app，并用本机固定的自签名证书签名。
# 证书第一次运行时生成，之后一直复用：签名不变，「辅助功能」等系统授权在更新后不会失效。
# 证书在单独的钥匙串文件里，不放进登录钥匙串、不加入搜索列表，也不设为系统信任。
set -euo pipefail
cd "$(dirname "$0")/.."

NAME="AhaTools Self-Signed"
DIR="${AHATOOLS_SIGNING_DIR:-$HOME/Library/Application Support/AhaTools Signing}"
KEYCHAIN="$DIR/signing.keychain-db"
APP="src-tauri/target/release/bundle/macos/AhaTools.app"

create_identity() {
  echo "==> 生成自签名证书：$DIR"
  mkdir -p "$DIR"
  chmod 700 "$DIR"
  local tmp
  tmp=$(mktemp -d)
  cat >"$tmp/cert.cnf" <<EOF
[req]
distinguished_name = dn
x509_extensions = ext
prompt = no
[dn]
CN = $NAME
[ext]
basicConstraints = critical, CA:false
keyUsage = critical, digitalSignature
extendedKeyUsage = critical, codeSigning
subjectKeyIdentifier = hash
EOF
  openssl req -x509 -newkey rsa:2048 -nodes -days 7300 -config "$tmp/cert.cnf" \
    -keyout "$tmp/key.pem" -out "$tmp/cert.pem" 2>/dev/null
  openssl pkcs12 -export -legacy -name "$NAME" -passout pass:ahatools \
    -inkey "$tmp/key.pem" -in "$tmp/cert.pem" -out "$tmp/id.p12"

  # create-keychain 会把新钥匙串加进用户搜索列表；签名时直接指定文件，所以恢复原列表。
  local original=()
  while IFS= read -r line; do
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line#\"}"
    original+=("${line%\"}")
  done < <(security list-keychains -d user)
  security create-keychain -p "" "$KEYCHAIN"
  security list-keychains -d user -s "${original[@]}"
  security set-keychain-settings "$KEYCHAIN"
  security unlock-keychain -p "" "$KEYCHAIN"
  security import "$tmp/id.p12" -k "$KEYCHAIN" -P ahatools -T /usr/bin/codesign >/dev/null
  security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "" "$KEYCHAIN" >/dev/null
  cp "$tmp/cert.pem" "$DIR/certificate.pem"
  rm -rf "$tmp"
}

[[ -f "$KEYCHAIN" ]] || create_identity
security unlock-keychain -p "" "$KEYCHAIN"

echo "==> 打包"
bun run tauri build --bundles app

echo "==> 签名"
codesign --force --deep --sign "$NAME" --keychain "$KEYCHAIN" --timestamp=none "$APP"
codesign --verify --deep --strict "$APP"
codesign --display --requirements - "$APP" 2>&1 | grep designated

echo "==> 完成：$APP"

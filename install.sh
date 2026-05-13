#!/usr/bin/env bash
# coclaude installer
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/<owner>/<repo>/main/install.sh | bash
#
# Environment overrides:
#   COCLAUDE_REPO       GitHub repo in "owner/repo" form (default: see REPO below)
#   COCLAUDE_VERSION    Specific version tag to install (default: latest)
#   COCLAUDE_INSTALL    Install directory (default: $HOME/.local/bin)

set -euo pipefail

REPO="${COCLAUDE_REPO:-OWNER/REPO}"
VERSION="${COCLAUDE_VERSION:-latest}"
INSTALL_DIR="${COCLAUDE_INSTALL:-$HOME/.local/bin}"

if [ "$REPO" = "OWNER/REPO" ]; then
  echo "error: this install script ships with a placeholder repo." >&2
  echo "Set COCLAUDE_REPO=owner/repo or edit the script before running." >&2
  exit 1
fi

# Detect OS
case "$(uname -s)" in
  Darwin) OS="darwin" ;;
  Linux)  OS="linux" ;;
  *)      echo "error: unsupported OS: $(uname -s)" >&2; exit 1 ;;
esac

# Detect arch
case "$(uname -m)" in
  x86_64 | amd64) ARCH="x64" ;;
  arm64 | aarch64) ARCH="arm64" ;;
  *) echo "error: unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac

ASSET="coclaude-${OS}-${ARCH}"

if [ "$VERSION" = "latest" ]; then
  URL="https://github.com/${REPO}/releases/latest/download/${ASSET}"
else
  URL="https://github.com/${REPO}/releases/download/${VERSION}/${ASSET}"
fi

echo "→ Downloading ${ASSET} from ${URL}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

if ! curl -fsSL "$URL" -o "$TMP/coclaude"; then
  echo "error: failed to download $URL" >&2
  echo "       verify the version exists at https://github.com/${REPO}/releases" >&2
  exit 1
fi

chmod +x "$TMP/coclaude"

mkdir -p "$INSTALL_DIR"
mv "$TMP/coclaude" "$INSTALL_DIR/coclaude"

echo "✓ Installed coclaude to ${INSTALL_DIR}/coclaude"

# macOS quarantine: warn the user about the Gatekeeper bypass we haven't
# bought signing for yet.
if [ "$OS" = "darwin" ]; then
  echo
  echo "Note: macOS may quarantine downloaded binaries. If you see a"
  echo "Gatekeeper warning, run:"
  echo "    xattr -d com.apple.quarantine ${INSTALL_DIR}/coclaude"
fi

case ":$PATH:" in
  *":$INSTALL_DIR:"*) ;;
  *)
    echo
    echo "Note: ${INSTALL_DIR} is not on your PATH. Add this to your shell rc:"
    echo "    export PATH=\"${INSTALL_DIR}:\$PATH\""
    ;;
esac

echo
"$INSTALL_DIR/coclaude" --version || true

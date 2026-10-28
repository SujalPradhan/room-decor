#!/bin/zsh
set -e
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  if test -f "$HOME/.nvm/nvm.sh"; then
    source "$HOME/.nvm/nvm.sh"
    nvm use 22 >/dev/null
  fi
fi
npm run laptop

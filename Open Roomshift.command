#!/bin/zsh
set -e
cd "$(dirname "$0")"
if test -f "$HOME/.nvm/nvm.sh"; then
  source "$HOME/.nvm/nvm.sh"
  nvm use 24 >/dev/null
fi
npm run laptop

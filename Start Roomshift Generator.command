#!/bin/zsh
set -e
cd "$(dirname "$0")"
roomshift_node="$HOME/.nvm/versions/node/v24.19.0/bin/node"
if ! test -x "$roomshift_node"; then
  echo 'Roomshift needs Node 24. Install it before enabling the automatic generator.'
  exit 1
fi
"$roomshift_node" "$PWD/scripts/install-generator-service.mjs" install --node "$roomshift_node"
open 'https://roomshift-studio.dearmacaw4.chatgpt.site'
echo 'The generator will start automatically when you log in. You can close this window.'

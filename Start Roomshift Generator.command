#!/bin/zsh
set -e
cd "$(dirname "$0")"
if test -f "$HOME/.nvm/nvm.sh"; then
  source "$HOME/.nvm/nvm.sh"
  nvm use 24 >/dev/null
fi
open 'https://roomshift-studio.dearmacaw4.chatgpt.site'
echo 'Keep this window open while creating models. This pilot stops after 3 jobs or one idle hour.'
exec node --env-file=../.env scripts/local-pipeline-worker.mjs --max-jobs 3 --idle-seconds 3600

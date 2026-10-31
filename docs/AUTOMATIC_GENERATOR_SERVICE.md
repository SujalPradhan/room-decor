# Automatic product generator on this Mac

Double-click **Start Roomshift Generator.command** once. It registers Roomshift’s own login service and opens the public editor. After that, paste a product link in the editor; the outgoing worker starts when you log in and recovers after a restart. The terminal window can close.

The service runs on this logged-in Mac. Its idle polling allows normal sleep; it prevents idle sleep only while processing an actual job. A sleeping, shut-down or disconnected laptop cannot process new models until it reconnects. Closing the lid still allows macOS to sleep normally.

## Setup and controls

Use Node 24. These commands run from `/Users/sujal/room-decor/product-studio`:

```sh
/Users/sujal/.nvm/versions/node/v24.19.0/bin/node scripts/install-generator-service.mjs dry-run --output artifacts/generator-service-plan.plist
plutil -lint artifacts/generator-service-plan.plist
/Users/sujal/.nvm/versions/node/v24.19.0/bin/node scripts/install-generator-service.mjs install
/Users/sujal/.nvm/versions/node/v24.19.0/bin/node scripts/install-generator-service.mjs status
/Users/sujal/.nvm/versions/node/v24.19.0/bin/node scripts/install-generator-service.mjs uninstall
```

`dry-run` checks prerequisites and optionally writes a reviewable plist; it never registers or starts a service. `install` is idempotent for the same launch settings. `uninstall` stops only Roomshift’s named service and removes its plist; credentials, generated models and private logs stay on disk. A manually started worker is separate; stop it before the first service installation. The worker’s existing process lock rejects duplicate workers.

The optional `--node /absolute/path/to/node` and `--env-file /absolute/path/to/.env` flags customize installation paths. The installed worker reads the env file directly with Node’s `--env-file`; the installer never reads credential values. Updating Node or moving this checkout requires uninstalling and installing the service with the new paths. Uninstalling during an active job interrupts it, so do this between jobs.

## What is installed

- Own service only: `~/Library/LaunchAgents/com.roomshift.generator.plist` in the current user’s GUI login session. No root access, listener, public laptop port, or changes to other login services.
- Absolute Node 24, env-file, checkout, and worker paths. An absolute Blender wrapper lives in ignored `artifacts/generator-service/bin/blender` and is placed on a fixed PATH.
- `RunAtLoad` and `KeepAlive`, with a 30-second restart throttle. Each worker remains bounded to 3 jobs or one idle hour, then launchd starts another worker. Server limits remain 3 jobs per user and 6 globally per UTC day. Paid Meshy generation stays disabled.
- Private logs: `~/Library/Logs/RoomshiftGenerator/worker.log` and `worker-error.log`, mode `0600`, in a mode `0700` folder. The service uses umask `077`. Logs contain bounded stages and generic errors, not credential values or provider response dumps.

The existing `artifacts/local-worker.lock` contains a PID and process nonce. A live lock prevents a second worker from changing the active worker’s heartbeat. A stale lock from a process that exited is recovered conservatively. The installer does not remove another worker’s lock or kill manually started processes.

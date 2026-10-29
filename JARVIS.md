# Personal Jarvis desktop

This fork adds a `jarvis` desktop build variant while keeping Hermes Agent as the runtime. Upstream variants, controls, themes and license notices remain available. Animation is deferred until voice and task workflows are validated.

## Build and launch locally

Use Node >=26 and the root lockfile install. Configure the existing Hermes installation and the separate `jarvis` profile first. In the Jarvis project workspace the persona source is `../config/jarvis/SOUL.md`; install it into the profile through Hermes's supported SOUL.md mechanism. Credentials remain in Hermes's private stores.

From this checkout:

```sh
HERMES_DESKTOP_VARIANT=jarvis npm run build --workspace apps/desktop
node_modules/.bin/electron apps/desktop --profile jarvis
```

`--profile jarvis` uses Hermes Desktop's supported profile selection. An environment-only `HERMES_HOME` override does not reliably select the desktop's initial profile. The profile must already exist; this patch does not silently copy personal memory, credentials or settings.

The app uses `com.yashraj.jarvis`, the Jarvis product name and its own `Jarvis` directory under Electron's app-data location. Newly created desktop state directories use POSIX mode 0700. It does not claim the existing `hermes://` OS handler. Runtime OAuth/provider configuration and conversation data remain owned by Hermes.

This initial variant uses the existing bootstrap/local-runtime contract. It does not embed Python or model weights. The local development validation used the recovered installed Hermes revision `74195d3680784111a58ce6643e16c7bd082a40a7`.

## Packaging and updates

Keep `HERMES_DESKTOP_VARIANT=jarvis` set for both build and packaging. For a prepared local Linux AppImage build, use the existing builder:

```sh
HERMES_DESKTOP_VARIANT=jarvis npm run builder --workspace apps/desktop -- --linux AppImage --publish never
```

AppImage installation on a clean target is still a separate acceptance check. Jarvis package updates are external: the build has no upstream release feed and must not publish to Hermes's channels. Hermes runtime updates remain separately managed through Hermes. The shared GitHub desktop release workflow does not publish Jarvis artifacts; the local prepared builder below produces the versioned artifact without uploading it.

The prepared desktop builder can create a versioned Linux Jarvis AppImage from a stable release tag, without embedding the Hermes runtime:

```sh
python scripts/bundles/desktop.py --tag vX.Y.Z --release-commit <full-commit-sha> --variant jarvis
```

Use the stable release process's matching annotated claim (`RELEASE_CLAIM_TAG=rc.N-vX.Y.Z` and its exact object ID in `RELEASE_CLAIM_OBJECT`). Jarvis rejects commit-only, canary, and non-Linux builds. The resulting AppImage is still externally delivered; this command does not publish it or enable in-app updates. Validate replacement and user-data compatibility before distributing an upgrade.

## Validation of this patch

- Identity, update-ownership and OS-protocol behavior tests: 30 passed.
- Desktop compiler and product-builder tests: 30 passed, including reuse of a renderer across identities.
- Desktop typechecks, focused ESLint and the 13 `scripts/check` checks passed before the final documentation checkpoint.
- Desktop source build and the prepared Webapp build passed. The Webapp stays on its existing identity; desktop title generation is applied by the desktop compiler after rendering.
- Playwright verified the Jarvis app/window title, Jarvis profile, a fresh real provider response, settings open/close, and the `Jarvis HUD` title. Test windows were closed afterwards.

Two unchanged Wayland entry tests fail on this host on both the base revision and the patch: they expect Wayland while the proprietary NVIDIA-driver path selects X11. These failures are recorded separately from the passing identity checks. The optional X11 HUD modifier helper also lacks XInput2 development headers. Neither a full desktop suite pass nor working microphone/speech behavior is claimed here.

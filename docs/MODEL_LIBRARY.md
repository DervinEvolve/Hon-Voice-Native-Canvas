# Optional 3D library

The canvas catalog has 44 third-party GLB models: characters, buildings, trees,
vehicles and other objects. They total about 2.4 GB. Download the library when
you want to use those catalog entries in a local workspace.

## Install

1. Open the [model asset release](https://github.com/DervinEvolve/Hon-Voice-Native-Canvas/releases/tag/canvas-assets-v1).
2. Download `hon-model-library-1.zip`, `hon-model-library-2.zip` and `SHA256SUMS`.
3. Check the downloaded ZIP checksums. On macOS, run `shasum -a 256 -c SHA256SUMS`
   in the download folder. Linux uses `sha256sum -c SHA256SUMS`.
4. Unzip both packs from the repository root. Their paths begin with
   `public/assets/3d/`, so they fill the directory the canvas expects.
5. Run `python3 scripts/model-library.py verify` from the repository root.

The last command checks every model's size and SHA-256 against
[the manifest](3D_ASSET_MANIFEST.json). It makes no network requests.
The extracted GLBs are ignored by Git. The source and CI can be downloaded
without the library; catalog entries need their local files before they load.

## Credits

These are existing models by the creators listed in [3D asset credits](3D_ASSET_CREDITS.md).
Each file has a recorded author, source and CC-BY-4.0 license. Both packs include
the complete credits, source metadata and hash manifest. Preserve those records
and the embedded notices when sharing the files. The credits describe the
renaming and conversions found in the metadata.

The project's MIT license covers my original code. The models retain
[CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/).
The eighteen files with unconfirmed or restricted terms are excluded.
Apple's SHARP weights are downloaded separately under Apple's own terms.

## Maintainer packaging

`scripts/model-library.py pack --cache /path/to/local-lfs-cache --output /path/to/new-packs`
builds two ZIP files and their checksums from the 44 approved original objects.
It checks each object's size and SHA-256 while packaging, and includes only the
manifest paths and credit documents. It refuses to replace existing packs.

# Third-party materials

The root MIT license applies to original contributions by Dervin Dimanche. It does not relicense dependencies, models, weights, datasets, media, logos, or borrowed code carrying its own terms. Preserve the original notices when redistributing third-party material.

## Apple ML SHARP

The integration calls [Apple ML SHARP](https://github.com/apple/ml-sharp); it is not a newly trained reconstruction model. Upstream [software terms](https://github.com/apple/ml-sharp/blob/main/LICENSE) and [acknowledgements](https://github.com/apple/ml-sharp/blob/main/ACKNOWLEDGEMENTS) apply to that software. The [model weights license](https://github.com/apple/ml-sharp/blob/main/LICENSE_MODEL) is separate and permits non-commercial scientific research and academic development. It excludes commercial exploitation, product development, and use in a commercial product or service. This project's MIT license does not override that restriction. Model redistribution has additional notice requirements in that agreement.

The Modal worker downloads upstream software, pinned to one ml-sharp commit, and the weights during setup, and copies `LICENSE`, `LICENSE_MODEL` and `ACKNOWLEDGEMENTS` next to the checkpoint. Keep the upstream notices with those downloads. Anyone redistributing the weights or a model derived from them must include a copy of the model license and the notice "Apple Machine Learning Research Model is licensed under the Apple Machine Learning Research Model License Agreement." Do not package weights as MIT-licensed project assets. Setup and pins are in [modal/README.md](modal/README.md).

## Other software

PlayCanvas, its splat tools, React, Three.js, and other packages retain the licenses included in their distributions. The lockfile records dependency versions; preserve the applicable notices when shipping a bundle. Provider SDKs, hosted generation services, and model outputs also have separate terms.

## Media and assets in this repository

This is the complete list of images, models and other media that ship in the tree or that the code loads from a fixed address. Anything whose provenance or license could not be confirmed was removed instead of listed (see "Removed" below).

| Asset | Where | Provenance and terms |
|---|---|---|
| README captures | `docs/assets/hon-speech-generated-image.png`, `docs/assets/hon-speech-splat-scene.png`, `docs/assets/hon-canvas-3d.png` | Captures supplied by Dervin of his own Hon sessions. The root code license does not grant rights to provider trademarks or to generated content visible in them; generated images carry the generating provider's terms |
| Built-in 3D models | 44 optional `*.glb` files installed under `public/assets/3d/` from the model Release packs | CC-BY 4.0, credited per file in [3D asset credits](docs/3D_ASSET_CREDITS.md). Both packs include the credits, source metadata and content hashes. Keep the attributions when redistributing |
| Hon wordmark | `src/assets/hon-logo.svg`, `src/assets/hon-logo-clean.svg`, `public/hon-logo.svg` | The project's own wordmark. The nine interface icons in `public/` are Lucide icons; see the Lucide section below |
| 3D thumbnail placeholder | `public/model-placeholder.svg` | Drawn for this project (an outline cube); MIT with the code |
| Initials avatars | `src/utils/initialsAvatar.ts` | Generated in the browser from a name's initials; no image files |
| Sky HDRIs | Eight files loaded at runtime from `dl.polyhaven.org` in `src/lib/playcanvas/skyboxLoader.ts` (not stored in this repository) | Poly Haven publishes all of its assets under CC0 ([polyhaven.com/license](https://polyhaven.com/license)) |

Provider and model names appear in the interface as plain text only. They are trademarks of their owners, and naming a provider does not imply endorsement.

## Removed

Removed before publication because consent, provenance or license was not confirmed: the names, roles and photos of people other than the author; sample creator handles, profile photos and videos; avatar photos from photo services; provider, model, social-network and company logos (bundled files and inline marks); images and videos hosted on the author's old Cloudinary account (including the landing gallery and demo videos); Higgsfield's hosted preset previews; two character models hot-linked from three.js examples; stock-photo test defaults; two old comic-app screenshots; and the fixed Luma captures that `generate_world_scene` used to return. The 18 3D models listed in `docs/PRIVATE_ASSET_QUARANTINE.json` were already excluded. None of these are licensed by this repository.

## Code credits

`src/lib/playcanvas/gsplat-reveal-radial.ts` adapts PlayCanvas Engine’s [radial reveal example](https://github.com/playcanvas/engine/blob/main/scripts/esm/gsplat/reveal-radial.mjs) for Hon’s splat scene. PlayCanvas Engine is MIT licensed, copyright PlayCanvas Ltd. The complete original notice is preserved in [docs/licenses/PlayCanvas-Engine-MIT.txt](docs/licenses/PlayCanvas-Engine-MIT.txt), with the reviewed source revision and license checksum alongside it.

`src/lib/playcanvas/animatedCharacterController.ts` and `src/lib/playcanvas/grassSystem.ts` cite Tezumie's Codevre demo as visual inspiration. The author confirmed that the demo was a visual reference, not a source of copied or adapted code. The original reference is retained in the file headers.

## Stageshow wrapper in docs/readme-visual

[docs/readme-visual](docs/readme-visual/README.md) holds a small optional wrapper derived from [Benji Taylor’s Stageshow](https://github.com/benjitaylor/skills/tree/main/stageshow), used under MIT; its original notice is in `docs/readme-visual/LICENSE.stageshow.txt`. It only displays one existing capture and needs the Stageshow kit, which is not in this repository. The README images do not use it: they are the plain captures in `docs/assets/`.

## Lucide icons

The nine interface icons in `public/` (`Play.svg`, `SupportCreator.svg`, `add to collection.svg`, `comment.svg`, `fullscreen.svg`, `leftarrow.svg`, `rightarrow.svg`, `share.svg`, `subscribe.svg`) are the Lucide icons `play`, `heart-handshake`, `bookmark-plus`, `message-circle`, `maximize`, `chevron-left`, `chevron-right`, `share-2` and `user-plus` (lucide-static 0.468.0), recoloured to white. Lucide is ISC licensed; the license text is in `public/LICENSE.lucide.txt`. Portions of Lucide are from Feather (MIT), copyright Cole Bemis.

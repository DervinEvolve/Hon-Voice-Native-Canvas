# SHARP worker on Modal (image to Gaussian splat)

`sharp_splat.py` is a Modal GPU function that runs [Apple ML SHARP](https://github.com/apple/ml-sharp) on one image and returns a PLY Gaussian splat. Hon's `/api/sharp/submit` route calls it, stores the result in a private Supabase bucket and hands the browser a short-lived signed URL. The full security setup for both sides is in [docs/SPLAT_SECURITY_SETUP.md](../docs/SPLAT_SECURITY_SETUP.md); this page covers the worker.

## Licenses

The SHARP code and the SHARP model weights are Apple's, under two separate licenses. Neither is covered by this project's MIT license, and neither is stored in this repository; the worker downloads both while Modal builds its image.

| What | License | What it means here |
|---|---|---|
| SHARP software (`/opt/sharp` in the image) | Upstream [LICENSE](https://github.com/apple/ml-sharp/blob/main/LICENSE) and [ACKNOWLEDGEMENTS](https://github.com/apple/ml-sharp/blob/main/ACKNOWLEDGEMENTS) | Keep the upstream notices with the software |
| SHARP model weights (`sharp_2572gikvuh.pt`) | Apple Machine Learning Research Model License Agreement ([LICENSE_MODEL](https://github.com/apple/ml-sharp/blob/main/LICENSE_MODEL)) | Research use only, as quoted below |

From `LICENSE_MODEL` at the pinned commit:

> "Research Purposes" means non-commercial scientific research and academic development activities, such as experimentation, analysis, testing conducted by You with the sole intent to advance scientific knowledge and research. "Research Purposes" does not include any commercial exploitation, product development or use in any commercial product or service.

If you redistribute the weights or anything derived from them, the agreement requires you to include a copy of it and this notice: "Apple Machine Learning Research Model is licensed under the Apple Machine Learning Research Model License Agreement." The image build copies `LICENSE`, `LICENSE_MODEL` and `ACKNOWLEDGEMENTS` next to the checkpoint in `/root/.cache/sharp/`.

Do not run this worker as part of a commercial product or service.

## What is pinned

| Item | Pinned to | Where |
|---|---|---|
| SHARP source | Commit `aed6527499ef91cba3b54c18d49a870f25947190` of `https://github.com/apple/ml-sharp.git` (main on 2026-09-11). The build checks out that commit and fails if `HEAD` differs | `SHARP_COMMIT` in `sharp_splat.py` |
| SHARP Python dependencies | The `requirements.txt` lock in that commit (`torch==2.8.0`, `torchvision==0.23.0` and the rest) | `pip install -r requirements.txt` in the image |
| Worker web dependency | `fastapi==0.115.14` | `sharp_splat.py` |
| Checkpoint URL | `https://ml-site.cdn-apple.com/models/sharp/sharp_2572gikvuh.pt`, the URL that commit's README and `src/sharp/cli/predict.py` (`DEFAULT_MODEL_URL`) publish | `SHARP_CHECKPOINT_URL` |
| Checkpoint SHA-256 | `94211a75198c47f61fca7d739ba08a215418d8d398d48fddf023baccc24f073d`. The build rejects a missing pin or a download that does not match | `SHARP_CHECKPOINT_SHA256` |

To check the pinned checksum, or prepare a deliberate update, download the checkpoint from Apple's URL on a machine you trust and hash it:

```bash
curl -fsSLo sharp_2572gikvuh.pt https://ml-site.cdn-apple.com/models/sharp/sharp_2572gikvuh.pt
sha256sum sharp_2572gikvuh.pt     # macOS: shasum -a 256 sharp_2572gikvuh.pt
```

Compare the result with `SHARP_CHECKPOINT_SHA256`. Delete the local weights if you do not need them. When you move to a newer SHARP commit, read the upstream changes and both license files again, then update `SHARP_COMMIT` and the checksum together.

## Setup

Prerequisites: a Modal account, the Modal CLI (`pip install modal`) and `modal token new` on your own machine. That CLI token is for deploying only; it never goes into Vercel or any app configuration.

1. Create the Modal secret the worker reads:

   ```bash
   modal secret create hon-sharp-config HON_SPLAT_IMAGE_HOSTS=<your-project-ref>.supabase.co
   ```

   To use a different dedicated secret, set `HON_SHARP_CONFIG_SECRET` to its name when running `modal deploy`. It defaults to `hon-sharp-config`.

   `HON_SPLAT_IMAGE_HOSTS` is a comma-separated list of exact hostnames the worker may fetch images from. No wildcards. List only hosts you control or trust; this list is the worker's remote-fetch boundary.

2. Deploy from the repository root:

   ```bash
   modal deploy modal/sharp_splat.py
   ```

   The endpoint requires Modal proxy authentication (`requires_proxy_auth=True`). Requests without a valid proxy token are refused by Modal before they reach the function.

3. In the Modal dashboard, create a dedicated web **Proxy Token** for the server ([Modal proxy auth](https://modal.com/docs/guide/webhook-proxy-auth)).

   A Proxy Token can invoke protected web endpoints in its workspace or assigned environment; it is not restricted to one endpoint. Keep it server-side and separate from account-management tokens.

4. On the Vercel project (server-side variables only), set:

   | Variable | Value |
   |---|---|
   | `MODAL_SHARP_ENDPOINT` | The `https://…modal.run` URL printed by `modal deploy`. The API only accepts `*.modal.run` over https |
   | `MODAL_SHARP_PROXY_KEY` | The proxy token ID |
   | `MODAL_SHARP_PROXY_SECRET` | The proxy token secret |

   Do not use `MODAL_TOKEN_ID`, `MODAL_TOKEN_SECRET` or any other workspace or account token here. Those grant control of the whole Modal workspace.

5. On the Supabase side, apply `migrations/add_sharp_jobs_table.sql` and then `migrations/secure_sharp_jobs.sql` (see [migrations/README.md](../migrations/README.md)). Results go to the private `hon-private-splats` bucket under the verified owner's path. Set `SUPABASE_URL`, the server-only `SUPABASE_SECRET_KEY` (legacy aliases are accepted), and `HON_SPLAT_ALLOWED_USER_IDS` and the sign-in variables as described in [docs/SPLAT_SECURITY_SETUP.md](../docs/SPLAT_SECURITY_SETUP.md).

## Limits in the worker

| Limit | Value |
|---|---|
| Image source | `https` only, port 443, no user info, host must be in `HON_SPLAT_IMAGE_HOSTS` and must not be a private address |
| Redirects | Refused |
| Image types | JPEG, PNG, WebP |
| Image size | 20 MiB |
| PLY output | 128 MiB |
| Concurrency | One container (`max_containers=1`). This limits parallel jobs, not total spend |
| GPU and time | A10G, 300 s per call, 240 s for inference |

Set a spending limit in the Modal dashboard. The worker has no budget of its own.

## Tests

The worker tests load the real `image_to_splat` function without Modal and check the URL, redirect and size limits and the pins above:

```bash
python -m venv .venv-worker && .venv-worker/bin/pip install fastapi==0.115.14
.venv-worker/bin/python -m unittest discover -s tests -p 'test_sharp_worker_security.py'
```

They run in CI. They do not build the image or run inference; I have not run this pinned build on Modal yet.

## Flow

```
Selected panel image (approved host)
      ↓
/api/sharp/submit  (verified sign-in, allowlist, job row owned by the user)
      ↓  Modal-Key / Modal-Secret proxy token
Modal: sharp_splat.py  (A10G, SHARP predict)
      ↓  PLY, base64
/api/sharp/submit  (size and format checks)
      ↓
Supabase Storage: hon-private-splats/<owner>/<job>/output.ply  (private)
      ↓  signed URL, five minutes
Immersive canvas renders the splat
```

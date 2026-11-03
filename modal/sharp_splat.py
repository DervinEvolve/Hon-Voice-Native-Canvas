"""
Modal function for Apple Sharp - Image to Gaussian Splat conversion

This function:
1. Downloads an image from a URL
2. Runs Apple Sharp model inference
3. Returns the generated .ply Gaussian splat file

Deploy with: modal deploy modal/sharp_splat.py
"""

import modal
import os
import tempfile
import uuid
from pathlib import Path

# Create the Modal app
app = modal.App("hon-sharp-splat")

# Apple ML SHARP, pinned to one upstream commit. Update the commit and the
# checkpoint checksum together, after reading upstream changes and licenses.
SHARP_REPO = "https://github.com/apple/ml-sharp.git"
SHARP_COMMIT = "aed6527499ef91cba3b54c18d49a870f25947190"  # main on 2026-09-11

# Checkpoint URL as published in that commit's README and
# src/sharp/cli/predict.py (DEFAULT_MODEL_URL). The weights are under Apple's
# separate model license (LICENSE_MODEL: non-commercial research only).
SHARP_CHECKPOINT_URL = "https://ml-site.cdn-apple.com/models/sharp/sharp_2572gikvuh.pt"
SHARP_CHECKPOINT_PATH = "/root/.cache/sharp/sharp_2572gikvuh.pt"
# Verified SHA-256 pin. Recompute from the official URL when updating weights:
#   curl -fsSLo sharp_2572gikvuh.pt https://ml-site.cdn-apple.com/models/sharp/sharp_2572gikvuh.pt
#   sha256sum sharp_2572gikvuh.pt
# The image build stops while it is empty or when the download does not match.
SHARP_CHECKPOINT_SHA256 = "94211a75198c47f61fca7d739ba08a215418d8d398d48fddf023baccc24f073d"

if SHARP_CHECKPOINT_SHA256:
    _verify_checkpoint = f"echo '{SHARP_CHECKPOINT_SHA256}  {SHARP_CHECKPOINT_PATH}' | sha256sum -c -"
else:
    _verify_checkpoint = (
        "echo 'Set SHARP_CHECKPOINT_SHA256 in modal/sharp_splat.py before building the worker.' >&2 && exit 1"
    )

# Define the container image. SHARP's own dependencies come from the
# requirements.txt lock in the pinned commit; the worker adds FastAPI for the
# web endpoint.
sharp_image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("git", "wget", "libgl1-mesa-glx", "libglib2.0-0")
    .run_commands(
        f"git clone {SHARP_REPO} /opt/sharp",
        f"cd /opt/sharp && git checkout --detach {SHARP_COMMIT}",
        f"test \"$(git -C /opt/sharp rev-parse HEAD)\" = {SHARP_COMMIT}",
        "cd /opt/sharp && pip install -r requirements.txt",
        "pip install fastapi==0.115.14",
        "mkdir -p /root/.cache/sharp",
        f"wget -O {SHARP_CHECKPOINT_PATH} {SHARP_CHECKPOINT_URL}",
        _verify_checkpoint,
        # Keep the upstream notices next to the downloaded software and weights.
        "cp /opt/sharp/LICENSE /opt/sharp/LICENSE_MODEL /opt/sharp/ACKNOWLEDGEMENTS /root/.cache/sharp/",
    )
)

# Volume for caching model weights
model_cache = modal.Volume.from_name("sharp-model-cache", create_if_missing=True)


from pydantic import BaseModel

class SplatRequest(BaseModel):
    image_url: str


@app.function(
    image=sharp_image,
    gpu="A10G",  # Good balance of cost and performance
    timeout=300,  # 5 minute timeout
    volumes={"/cache": model_cache},
    secrets=[modal.Secret.from_name(os.environ.get("HON_SHARP_CONFIG_SECRET", "hon-sharp-config"))],
    max_containers=1,
)
@modal.fastapi_endpoint(method="POST", requires_proxy_auth=True)
def image_to_splat(body: SplatRequest) -> dict:
    """
    Convert an image URL to a Gaussian splat .ply file

    Args:
        body: SplatRequest with image_url

    Returns:
        dict with 'ply_data' (base64 encoded) and 'filename'
    """
    import requests
    import base64
    import subprocess
    import sys
    
    from urllib.parse import urlsplit
    import ipaddress
    from fastapi import HTTPException

    image_url = body.image_url
    url = urlsplit(image_url)
    allowed_hosts = {h.strip() for h in os.environ.get('HON_SPLAT_IMAGE_HOSTS', '').split(',') if h.strip()}
    host = url.hostname or ''
    try:
        public_ip = ipaddress.ip_address(host).is_global
    except ValueError:
        public_ip = host not in {'localhost'} and not host.endswith(('.local', '.internal', '.localhost'))
    if (len(image_url) > 8192 or url.scheme != 'https' or url.username or url.password
            or url.port not in (None, 443) or host not in allowed_hosts or not public_ip):
        raise HTTPException(status_code=400, detail='Image host is not allowed')

    # Add sharp to path
    sys.path.insert(0, "/opt/sharp")

    with tempfile.TemporaryDirectory() as tmpdir:
        tmpdir = Path(tmpdir)

        # Exact operator-configured hosts only; no redirects to a second target.
        # Do not log signed source URLs.
        max_image_bytes = 20 * 1024 * 1024
        with requests.get(image_url, timeout=(10, 30), stream=True, allow_redirects=False) as response:
            if response.status_code != 200:
                raise HTTPException(status_code=502, detail='Image download failed')
            content_type = response.headers.get('content-type', '').split(';')[0].strip().lower()
            extensions = {'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp'}
            if content_type not in extensions:
                raise HTTPException(status_code=400, detail='Unsupported image type')
            if int(response.headers.get('content-length', '0')) > max_image_bytes:
                raise HTTPException(status_code=413, detail='Image is too large')
            input_path = tmpdir / ('input' + extensions[content_type])
            length = 0
            with input_path.open('wb') as image_file:
                for chunk in response.iter_content(65536):
                    length += len(chunk)
                    if length > max_image_bytes:
                        raise HTTPException(status_code=413, detail='Image is too large')
                    image_file.write(chunk)

        # Create output directory
        output_dir = tmpdir / "output"
        output_dir.mkdir()

        # Run Sharp inference
        checkpoint_path = "/root/.cache/sharp/sharp_2572gikvuh.pt"

        print("[Sharp] Running inference...")
        result = subprocess.run(
            [
                "sharp", "predict",
                "-i", str(input_path),
                "-o", str(output_dir),
                "-c", checkpoint_path,
            ],
            capture_output=True,
            text=True,
            timeout=240,  # 4 minute timeout for inference
        )

        if result.returncode != 0:
            print(f"[Sharp] Error: {result.stderr}")
            raise RuntimeError(f"Sharp inference failed: {result.stderr}")

        print(f"[Sharp] Inference complete: {result.stdout}")

        # Find the output .ply file
        ply_files = list(output_dir.glob("*.ply"))
        if not ply_files:
            raise RuntimeError("No .ply file generated")

        ply_path = ply_files[0]
        print(f"[Sharp] Output file: {ply_path} ({ply_path.stat().st_size} bytes)")

        # Read and encode the PLY file
        if ply_path.stat().st_size > 128 * 1024 * 1024:
            raise RuntimeError('Generated splat exceeds the output limit')
        ply_data = ply_path.read_bytes()
        ply_base64 = base64.b64encode(ply_data).decode('utf-8')

        # Generate a unique filename
        filename = f"splat_{uuid.uuid4().hex[:8]}.ply"

        return {
            "ply_data": ply_base64,
            "filename": filename,
            "size_bytes": len(ply_data),
        }


@app.function(
    image=sharp_image,
    gpu="A10G",
    timeout=300,
)
def health_check() -> dict:
    """Check if Sharp is properly installed and model is available"""
    import subprocess

    result = subprocess.run(["sharp", "--help"], capture_output=True, text=True)
    model_exists = Path(SHARP_CHECKPOINT_PATH).exists()

    return {
        "sharp_installed": result.returncode == 0,
        "model_available": model_exists,
        "status": "healthy" if (result.returncode == 0 and model_exists) else "unhealthy",
    }


# Local entrypoint for testing
@app.local_entrypoint()
def main(image_url: str = ""):
    """Test the Sharp function with an image you have the rights to use (pass --image-url)."""
    if not image_url:
        raise SystemExit("Pass --image-url with an image URL from an approved host that you have the rights to use.")
    print(f"Testing with image: {image_url}")
    result = image_to_splat.remote(SplatRequest(image_url=image_url))
    print(f"Result: filename={result['filename']}, size={result['size_bytes']} bytes")

    # Save the PLY file locally for inspection
    import base64
    ply_data = base64.b64decode(result['ply_data'])
    output_path = Path(result['filename'])
    output_path.write_bytes(ply_data)
    print(f"Saved to: {output_path}")


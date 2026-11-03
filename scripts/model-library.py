"""Verify the optional model library, or package approved bytes for a release.

This script makes no network requests. The pack command is for maintainers
with a local Git LFS object cache from the private preparation workspace.
"""

import argparse
import hashlib
import json
from pathlib import Path
import zipfile


ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "docs/3D_ASSET_MANIFEST.json"


def approved_models():
    rows = json.loads(MANIFEST.read_text())
    seen = set()
    for row in rows:
        path = Path(row["path"])
        if (path.is_absolute() or ".." in path.parts
                or not path.as_posix().startswith("public/assets/3d/")
                or path.suffix != ".glb" or row["path"] in seen):
            raise ValueError("Invalid or duplicate model path")
        seen.add(row["path"])
        digest = row["sha256"]
        if len(digest) != 64 or any(c not in "0123456789abcdef" for c in digest):
            raise ValueError("Invalid model checksum")
        if not isinstance(row["size"], int) or row["size"] <= 0:
            raise ValueError("Invalid model size")
    return rows


def digest_file(path):
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def check_model(path, row):
    if path.is_symlink() or not path.is_file():
        raise ValueError(f"Missing model or unexpected symlink: {row['path']}")
    if path.stat().st_size != row["size"] or digest_file(path) != row["sha256"]:
        raise ValueError(f"Model checksum or size differs: {row['path']}")


def verify(rows):
    failures = []
    for row in rows:
        try:
            path = ROOT / row["path"]
            if not path.resolve().is_relative_to(ROOT.resolve()):
                raise ValueError(f"Model path leaves the checkout: {row['path']}")
            check_model(path, row)
        except ValueError as error:
            failures.append(str(error))
    if failures:
        raise SystemExit("\n".join(failures))
    print(f"Verified {len(rows)} models against the published SHA-256 manifest.")


def pack(rows, cache, output):
    output.mkdir(parents=True, exist_ok=True)
    groups = [[], []]
    totals = [0, 0]
    for row in sorted(rows, key=lambda item: (-item["size"], item["path"])):
        index = totals.index(min(totals))
        groups[index].append(row)
        totals[index] += row["size"]
    if max(totals) >= 1_950_000_000:
        raise ValueError("Model packs need a different split to fit release limits")

    checksums = []
    for number, group in enumerate(groups, start=1):
        destination = output / f"hon-model-library-{number}.zip"
        if destination.exists():
            raise ValueError(f"Refusing to replace {destination}")
        # Stored ZIP members preserve the original bytes and avoid another
        # compression dependency. Each pack carries the complete credits.
        with zipfile.ZipFile(destination, "x", compression=zipfile.ZIP_STORED) as archive:
            for row in sorted(group, key=lambda item: item["path"]):
                sha = row["sha256"]
                source = cache / "objects" / sha[:2] / sha[2:4] / sha
                if source.is_symlink() or not source.resolve().is_relative_to(cache.resolve()):
                    raise ValueError("Unexpected model cache path")
                if source.stat().st_size != row["size"]:
                    raise ValueError(f"Model size differs: {row['path']}")
                info = zipfile.ZipInfo(row["path"], date_time=(1980, 1, 1, 0, 0, 0))
                info.external_attr = 0o100644 << 16
                digest = hashlib.sha256()
                with source.open("rb") as incoming, archive.open(info, "w") as outgoing:
                    while chunk := incoming.read(1024 * 1024):
                        digest.update(chunk)
                        outgoing.write(chunk)
                if digest.hexdigest() != sha:
                    raise ValueError(f"Model checksum differs: {row['path']}")
            for relative in ("docs/3D_ASSET_CREDITS.md", "docs/3D_ASSET_CREDITS.json",
                             "docs/3D_ASSET_MANIFEST.json", "docs/MODEL_LIBRARY.md"):
                info = zipfile.ZipInfo(relative, date_time=(1980, 1, 1, 0, 0, 0))
                info.external_attr = 0o100644 << 16
                archive.writestr(info, (ROOT / relative).read_bytes())
        if destination.stat().st_size >= 2 * 1024 ** 3:
            raise ValueError("Model pack exceeds GitHub's per-asset release limit")
        checksum = digest_file(destination)
        checksums.append(f"{checksum}  {destination.name}")
        print(f"Pack {number}: {len(group)} verified models, {destination.stat().st_size} bytes", flush=True)
    (output / "SHA256SUMS").write_text("\n".join(checksums) + "\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("verify", help="Check installed optional models")
    command = commands.add_parser("pack", help="Build credited release packs from a local cache")
    command.add_argument("--cache", required=True, type=Path)
    command.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    rows = approved_models()
    if args.command == "verify":
        verify(rows)
    else:
        pack(rows, args.cache, args.output)

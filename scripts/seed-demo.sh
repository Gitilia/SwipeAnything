#!/usr/bin/env bash
# Seed /tmp/swipe-demo with a mix of preview types for local QA.
set -euo pipefail

DEST="${1:-/tmp/swipe-demo}"
mkdir -p "$DEST"

echo "Meeting notes — keep or toss?" >"$DEST/meeting-notes.txt"
echo "Random screenshot memo" >"$DEST/screenshot-memo.txt"
printf 'item,status\nbeach photo,keep?\nfood photo,keep?\nclip,review\n' >"$DEST/inbox.csv"

# Solid PNGs (no Pillow required)
python3 - <<'PY' "$DEST"
import struct, zlib, sys
from pathlib import Path

dest = Path(sys.argv[1])

def chunk(tag: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

def solid_png(w: int, h: int, r: int, g: int, b: int) -> bytes:
    raw = b"".join(b"\x00" + bytes([r, g, b]) * w for _ in range(h))
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )

(dest / "photo-beach.png").write_bytes(solid_png(320, 200, 56, 120, 200))
(dest / "photo-food.png").write_bytes(solid_png(320, 200, 200, 90, 60))
print(f"wrote PNGs into {dest}")
PY

if command -v ffmpeg >/dev/null 2>&1; then
  ffmpeg -y -hide_banner -loglevel error \
    -f lavfi -i "color=c=#38bdf8:s=320x180:d=2" \
    -f lavfi -i "sine=f=440:d=2" \
    -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest \
    "$DEST/clip-demo.mp4"
  echo "wrote clip-demo.mp4"
else
  echo "ffmpeg not found — skipping video seed" >&2
fi

# One-page PDF with visible Helvetica text (so Quick Look / iframe aren't blank)
python3 - <<'PY' "$DEST"
from pathlib import Path
import sys

content = b"BT /F1 22 Tf 40 200 Td (Receipt scan demo) Tj 0 -36 Td (Keep or toss?) Tj ET"
stream = b"<< /Length %d >>stream\n" % len(content) + content + b"\nendstream"

parts = []
def add(obj: bytes):
    parts.append(obj)
    return sum(len(p) for p in parts[:-1])

# Build with xref
objs = []
objs.append(b"1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n")
objs.append(b"2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj\n")
objs.append(
    b"3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 300] "
    b"/Contents 4 0 R /Resources<< /Font<< /F1 5 0 R >> >> >>endobj\n"
)
objs.append(b"4 0 obj" + stream + b"\nendobj\n")
objs.append(b"5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj\n")

out = bytearray(b"%PDF-1.4\n")
offsets = [0]
for obj in objs:
    offsets.append(len(out))
    out.extend(obj)
xref_pos = len(out)
out.extend(f"xref\n0 {len(offsets)}\n".encode())
out.extend(b"0000000000 65535 f \n")
for off in offsets[1:]:
    out.extend(f"{off:010d} 00000 n \n".encode())
out.extend(f"trailer<< /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{xref_pos}\n%%EOF\n".encode())
Path(sys.argv[1], "receipt-scan.pdf").write_bytes(out)
print("wrote receipt-scan.pdf")
PY

# Small zip with a couple of files inside (list-only preview)
rm -f "$DEST/bundle-demo.zip"
(
  cd "$DEST"
  printf 'hello from zip\n' > /tmp/swipe-zip-a.txt
  printf 'item,qty\nwidgets,3\n' > /tmp/swipe-zip-b.csv
  zip -q bundle-demo.zip /tmp/swipe-zip-a.txt /tmp/swipe-zip-b.csv 2>/dev/null \
    || python3 - <<'PY'
import zipfile, pathlib
z = pathlib.Path("/tmp/swipe-demo/bundle-demo.zip")
with zipfile.ZipFile(z, "w") as zf:
    zf.writestr("readme.txt", "hello from zip\n")
    zf.writestr("data/rows.csv", "item,qty\nwidgets,3\n")
print("wrote", z)
PY
)
# Prefer tidy names inside the archive when zip CLI used absolute paths
if command -v zip >/dev/null 2>&1; then
  rm -f "$DEST/bundle-demo.zip"
  mkdir -p /tmp/swipe-zip-seed/data
  printf 'hello from zip\n' > /tmp/swipe-zip-seed/readme.txt
  printf 'item,qty\nwidgets,3\n' > /tmp/swipe-zip-seed/data/rows.csv
  (cd /tmp/swipe-zip-seed && zip -qr "$DEST/bundle-demo.zip" readme.txt data)
  echo "wrote bundle-demo.zip"
fi

# Optional: copy a real RAW from the user library if present (can't synthesize these)
if ! compgen -G "$DEST/sample-raw.*" >/dev/null 2>&1; then
  sample="$(find "$HOME/Pictures" "$HOME/Desktop" "$HOME/Downloads" \
    \( -iname '*.dng' -o -iname '*.cr2' -o -iname '*.cr3' -o -iname '*.nef' -o -iname '*.arw' \) \
    -type f 2>/dev/null | head -n 1 || true)"
  if [[ -n "${sample}" ]]; then
    ext="${sample##*.}"
    cp "$sample" "$DEST/sample-raw.${ext}"
    echo "copied RAW sample from $sample"
  else
    echo "no RAW found under Pictures/Desktop/Downloads — drop a .dng/.cr2 into $DEST to try"
  fi
fi

echo "Demo ready: $DEST"
ls -la "$DEST"

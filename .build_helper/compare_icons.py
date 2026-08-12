#!/usr/bin/env python3
"""Compare the icon embedded in an exe against a reference .ico file.

Extracts every RT_ICON image blob from the exe (via pefile, read-only) and
every image blob from the .ico, then checks set-equality of the raw bytes.
If they match, the exe carries exactly the reference icon (not a default one).
"""
import sys
import os
import struct

try:
    import pefile
except ImportError:
    print("PEFILE_MISSING")
    sys.exit(2)


def extract_exe_icons(exe_path):
    pe = pefile.PE(exe_path)
    blobs = []
    if not hasattr(pe, "DIRECTORY_ENTRY_RESOURCE"):
        return blobs
    for entry in pe.DIRECTORY_ENTRY_RESOURCE.entries:
        # RT_ICON = 3
        if entry.id == pefile.RESOURCE_TYPE["RT_ICON"]:
            for lang in entry.directory.entries:
                for leaf in lang.directory.entries:
                    data = pe.get_data(leaf.data.struct.OffsetToData, leaf.data.struct.Size)
                    blobs.append(data)
    return blobs


def extract_ico_images(ico_path):
    with open(ico_path, "rb") as f:
        data = f.read()
    if data[:4] != b"\x00\x00\x01\x00":
        print("NOT_AN_ICO")
        sys.exit(1)
    count = struct.unpack("<H", data[4:6])[0]
    images = []
    for i in range(count):
        off = 6 + i * 16
        size = struct.unpack("<I", data[off + 8:off + 12])[0]
        offset = struct.unpack("<I", data[off + 12:off + 16])[0]
        images.append(data[offset:offset + size])
    return images


def main():
    if len(sys.argv) < 3:
        print("usage: compare_icons.py <exe> <ico>")
        sys.exit(1)
    exe, ico = sys.argv[1], sys.argv[2]
    exe_blobs = extract_exe_icons(exe)
    ico_images = extract_ico_images(ico)
    print(f"exe icon images: {len(exe_blobs)}")
    print(f"ico images: {len(ico_images)}")
    exe_set = {b for b in exe_blobs}
    ico_set = {b for b in ico_images}
    # pairwise match
    matched = 0
    remaining = set(ico_set)
    for b in exe_set:
        for r in list(remaining):
            if r == b:
                matched += 1
                remaining.discard(r)
                break
    print(f"matched images: {matched}/{len(ico_set)}")
    if matched == len(ico_set) and len(exe_set) >= len(ico_set):
        print("RESULT: ICON_MATCHES_REFERENCE")
    else:
        print("RESULT: ICON_DIFFERS_FROM_REFERENCE")
        # show sizes for diagnosis
        print("exe sizes:", sorted(len(b) for b in exe_blobs))
        print("ico sizes:", sorted(len(b) for b in ico_images))


if __name__ == "__main__":
    main()

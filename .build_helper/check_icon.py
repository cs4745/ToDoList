#!/usr/bin/env python3
"""Verify (and optionally patch) the icon embedded in an Electron portable .exe.

Why this script exists:
  electron-builder's portable target is a 7z *self-extracting* archive: a PE
  executable with the 7z payload APPENDED after the PE image. Tools like
  `rcedit` rewrite the entire PE and TRUNCATE the file at the end of the PE
  image, silently discarding the appended 7z payload (collapsing the ~69 MB
  exe to a ~410 KB stub). So we must inspect/patch resources WITHOUT touching
  the trailing data.

This script uses `pefile` only to READ resources (verify mode). It never
rewrites the file, so the overlay is always preserved.
"""
import sys
import os

try:
    import pefile
except ImportError:
    print("PEFILE_MISSING")
    sys.exit(2)


def verify_icon(exe_path):
    if not os.path.isfile(exe_path):
        print(f"EXE_MISSING: {exe_path}")
        return 1
    pe = pefile.PE(exe_path)
    found_group = False
    found_icons = 0
    try:
        if hasattr(pe, "DIRECTORY_ENTRY_RESOURCE"):
            for entry in pe.DIRECTORY_ENTRY_RESOURCE.entries:
                if entry.id == pefile.RESOURCE_TYPE["RT_GROUP_ICON"]:
                    found_group = True
                    for lang in entry.directory.entries:
                        for leaf in lang.directory.entries:
                            found_icons += 1
    except Exception as e:
        print(f"RESOURCE_SCAN_ERROR: {e}")
    print(f"GROUP_ICON_PRESENT: {found_group}")
    print(f"ICON_RESOURCE_COUNT: {found_icons}")
    # overlay (the appended 7z sfx payload)
    try:
        overlay = pe.get_overlay_data()
        if overlay is not None:
            print(f"OVERLAY_PRESENT: True | bytes={len(overlay)}")
        else:
            print("OVERLAY_PRESENT: False")
    except Exception:
        print("OVERLAY_PRESENT: unknown")
    return 0


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("usage: check_icon.py <exe>")
        sys.exit(1)
    sys.exit(verify_icon(sys.argv[1]))

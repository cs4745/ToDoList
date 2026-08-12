import sys, struct
import pefile
from PIL import Image

exe = sys.argv[1] if len(sys.argv) > 1 else r"F:\Workspaces\Trae\ToDoList\dist\每周待办-1.0.0-便携版.exe"
out = sys.argv[2] if len(sys.argv) > 2 else r"F:\Workspaces\Trae\ToDoList\dist\_extracted_icon.png"

RT_ICON = 3
RT_GROUP_ICON = 14

pe = pefile.PE(exe, fast_load=False)
if not hasattr(pe, 'DIRECTORY_ENTRY_RESOURCE'):
    print("NO RESOURCE DIRECTORY"); sys.exit(1)

images = {}
groups = {}

def raw_id(e):
    # resource dir entry: high bit set => name (ignore), else integer id
    sid = e.struct.Id
    if sid & 0x80000000:
        return None
    return sid

def collect(node, ids, leaves):
    if hasattr(node, 'directory'):
        for e in node.directory.entries:
            collect(e, ids + [raw_id(e)], leaves)
    elif hasattr(node, 'data'):
        leaves.append((ids, pe.get_data(node.data.struct.OffsetToData, node.data.struct.Size)))

leaves = []
for e in pe.DIRECTORY_ENTRY_RESOURCE.entries:
    collect(e, [raw_id(e)], leaves)
for ids, data in leaves:
    if ids and ids[0] == RT_ICON:
        images[ids[1]] = data
    elif ids and ids[0] == RT_GROUP_ICON:
        groups[ids[1]] = data

print("RT_ICON ids:", sorted(images.keys()), "sizes:", {k: len(v) for k, v in images.items()})
print("RT_GROUP_ICON ids:", sorted(groups.keys()))
if not groups:
    print("NO GROUP ICON; raw leaf ids:", [l[0] for l in leaves]); sys.exit(1)

gid = sorted(groups.keys())[0]
gd = groups[gid]
count = struct.unpack_from('<H', gd, 4)[0]
print("group icon entries:", count)

entries = []
for i in range(count):
    rec = gd[6 + i * 14: 6 + (i + 1) * 14]
    w, h, bpp, res, planes, bitcount, bytesinres, icon_id = struct.unpack('<BBBBHHIH', rec)
    img = images.get(icon_id, images.get(sorted(images.keys())[i % len(images)]))
    entries.append((w, h, planes, bitcount, img))

ico = bytearray()
ico += struct.pack('<HHH', 0, 1, count)
offset = 6 + count * 16
for (w, h, planes, bitcount, img) in entries:
    ico += struct.pack('<BBBBHHII', w, h, 0, 0, planes, bitcount, len(img), offset)
    offset += len(img)
for (w, h, planes, bitcount, img) in entries:
    ico += img

with open(out.replace('.png', '.ico'), 'wb') as f:
    f.write(ico)
im = Image.open(out.replace('.png', '.ico'))
print("ico sizes:", im.info.get('sizes'))
im.save(out)
print("saved png:", out)

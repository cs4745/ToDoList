import struct
from PIL import Image, ImageDraw

OUT = r"F:\Workspaces\Trae\ToDoList\assets\icon.ico"
SIZES = [16, 24, 32, 48, 64, 128, 256]


def render(S):
    ss = max(S * 4, 256)
    # 渐变背景（紫蓝）
    grad = Image.new("RGB", (ss, ss))
    gd = ImageDraw.Draw(grad)
    top = (0x66, 0x7e, 0xea)
    bot = (0x76, 0x4b, 0xa2)
    for y in range(ss):
        t = y / (ss - 1)
        r = int(top[0] + (bot[0] - top[0]) * t)
        g = int(top[1] + (bot[1] - top[1]) * t)
        b = int(top[2] + (bot[2] - top[2]) * t)
        gd.line([(0, y), (ss, y)], fill=(r, g, b))
    # 圆角遮罩
    mask = Image.new("L", (ss, ss), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, ss - 1, ss - 1], radius=int(ss * 0.22), fill=255)
    base = Image.new("RGBA", (ss, ss))
    base.paste(grad, (0, 0), mask)
    # 白色对勾
    cd = ImageDraw.Draw(base)
    lw = max(2, int(ss * 0.11))
    p0 = (0.27 * ss, 0.53 * ss)
    p1 = (0.45 * ss, 0.70 * ss)
    p2 = (0.75 * ss, 0.33 * ss)
    cd.line([p0, p1], fill=(255, 255, 255, 255), width=lw, joint="curve")
    cd.line([p1, p2], fill=(255, 255, 255, 255), width=lw, joint="curve")
    for p in (p0, p1, p2):
        cd.ellipse([p[0] - lw / 2, p[1] - lw / 2, p[0] + lw / 2, p[1] + lw / 2],
                   fill=(255, 255, 255, 255))
    return base.resize((S, S), Image.LANCZOS)


def bmp_ico_frame(img):
    S = img.size[0]
    img = img.convert("RGBA")
    px = img.load()
    xor = bytearray()
    for y in range(S - 1, -1, -1):          # 底部向上
        for x in range(S):
            r, g, b, a = px[x, y]
            xor += bytes((b, g, r, a))       # BGRA
    rowbytes = ((S + 31) // 32) * 4
    andm = bytearray(rowbytes * S)          # 全 0 = 不透明
    bih = struct.pack("<IiiHHIIiiII", 40, S, 2 * S, 1, 32, 0, 0, 0, 0, 0, 0)
    return bytes(bih) + bytes(xor) + bytes(andm)


frames = [render(s) for s in SIZES]
entries = []
imagedata = b""
offset = 6 + 16 * len(SIZES)
for img in frames:
    d = bmp_ico_frame(img)
    entries.append((img.size[0], d))
    imagedata += d

icondir = bytearray()
icondir += struct.pack("<HHH", 0, 1, len(SIZES))
for (s, d) in entries:
    w = s & 0xFF
    icondir += struct.pack("<BBBBHHII", w, w, 0, 0, 1, 32, len(d), offset)
    offset += len(d)

with open(OUT, "wb") as f:
    f.write(icondir)
    f.write(imagedata)
print("wrote", OUT, "bytes=", len(icondir) + len(imagedata))

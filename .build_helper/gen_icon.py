import os
from PIL import Image, ImageDraw

TOP = (102, 126, 234)   # 667eea
BOT = (118, 75, 162)    # 764ba2
SIZES = [16, 24, 32, 48, 64, 128, 256]
SUPER = 1024

def lerp(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))

def make_master():
    N = SUPER
    # 垂直渐变背景
    grad = Image.new('RGB', (N, N))
    px = grad.load()
    for y in range(N):
        c = lerp(TOP, BOT, y / (N - 1))
        for x in range(N):
            px[x, y] = c
    # 圆角矩形遮罩（圆角约 22%）
    mask = Image.new('L', (N, N), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, N - 1, N - 1], radius=int(N * 0.22), fill=255)
    base = Image.new('RGBA', (N, N), (0, 0, 0, 0))
    base.paste(grad, (0, 0), mask)
    # 白色对勾
    chk = Image.new('RGBA', (N, N), (0, 0, 0, 0))
    cd = ImageDraw.Draw(chk)
    w = int(N * 0.13)
    pts = [(int(0.30 * N), int(0.53 * N)),
           (int(0.45 * N), int(0.68 * N)),
           (int(0.73 * N), int(0.34 * N))]
    for a, b in [(pts[0], pts[1]), (pts[1], pts[2])]:
        cd.line([a, b], fill=(255, 255, 255, 255), width=w, joint='curve')
    for p in pts:
        cd.ellipse([p[0] - w // 2, p[1] - w // 2, p[0] + w // 2, p[1] + w // 2], fill=(255, 255, 255, 255))
    return Image.alpha_composite(base, chk)

os.makedirs('assets', exist_ok=True)
master = make_master()
master.resize((256, 256), Image.LANCZOS).save('assets/icon.png')
master.save('assets/icon.ico', sizes=[(s, s) for s in SIZES])
print('icon.ico + icon.png generated; sizes=', SIZES)

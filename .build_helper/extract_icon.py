import ctypes, sys
from ctypes import c_void_p, c_uint32, c_int, c_uint16, c_uint, c_wchar_p, byref, c_bool, c_wchar

user32 = ctypes.windll.user32
gdi32 = ctypes.windll.gdi32
shell32 = ctypes.windll.shell32

gdi32.GetObjectW.argtypes = [c_void_p, c_int, c_void_p]
gdi32.GetObjectW.restype = c_int
gdi32.CreateDIBSection.argtypes = [c_void_p, c_void_p, c_uint, c_void_p, c_void_p, c_uint]
gdi32.CreateDIBSection.restype = c_void_p
gdi32.GetDIBits.argtypes = [c_void_p, c_void_p, c_uint, c_uint, c_void_p, c_void_p]
gdi32.GetDIBits.restype = c_int
gdi32.SelectObject.argtypes = [c_void_p, c_void_p]
gdi32.SelectObject.restype = c_void_p
gdi32.CreateCompatibleDC.argtypes = [c_void_p]
gdi32.CreateCompatibleDC.restype = c_void_p
user32.GetDC.argtypes = [c_void_p]
user32.GetDC.restype = c_void_p
user32.DrawIconEx.argtypes = [c_void_p, c_int, c_int, c_void_p, c_int, c_int, c_uint, c_void_p, c_uint]
user32.DrawIconEx.restype = c_bool
user32.DestroyIcon.argtypes = [c_void_p]
user32.DestroyIcon.restype = c_bool

class SHFILEINFO(ctypes.Structure):
    _fields_ = [("hIcon", c_void_p), ("iIcon", c_int), ("dwAttributes", c_uint32),
                ("szDisplayName", c_wchar * 260), ("szTypeName", c_wchar * 80)]

exe = sys.argv[1] if len(sys.argv) > 1 else r"F:\Workspaces\Trae\ToDoList\dist\每周待办-1.0.0-便携版.exe"
out = sys.argv[2] if len(sys.argv) > 2 else r"F:\Workspaces\Trae\ToDoList\dist\_extracted_icon.png"

shfi = SHFILEINFO()
# SHGFI_ICON = 0x100, SHGFI_LARGEICON = 0
ret = shell32.SHGetFileInfoW(c_wchar_p(exe), 0, byref(shfi), ctypes.sizeof(SHFILEINFO), 0x100)
print("SHGetFileInfo ret:", ret, "hIcon:", shfi.hIcon)
if not ret or not shfi.hIcon:
    print("NO ICON (Explorer sees no custom icon)"); sys.exit(1)

hicon = shfi.hIcon

class BITMAPINFOHEADER(ctypes.Structure):
    _fields_ = [("biSize", c_uint32), ("biWidth", c_int), ("biHeight", c_int), ("biPlanes", c_uint16),
                ("biBitCount", c_uint16), ("biCompression", c_uint32), ("biSizeImage", c_uint32),
                ("biXPelsPerMeter", c_int), ("biYPelsPerMeter", c_int), ("biClrUsed", c_uint32), ("biClrImportant", c_uint32)]

w = h = 256  # typical large icon size; we'll just render at 256
bih = BITMAPINFOHEADER()
bih.biSize = ctypes.sizeof(BITMAPINFOHEADER)
bih.biWidth = w
bih.biHeight = -w
bih.biPlanes = 1
bih.biBitCount = 32
bih.biCompression = 0

hdc = user32.GetDC(0)
ppvBits = c_void_p()
hbmp = gdi32.CreateDIBSection(hdc, byref(bih), 0, byref(ppvBits), None, 0)
hdcMem = gdi32.CreateCompatibleDC(hdc)
gdi32.SelectObject(hdcMem, hbmp)
ok = user32.DrawIconEx(hdcMem, 0, 0, hicon, w, w, 0, None, 3)
print("DrawIconEx ok:", ok)
buf = ctypes.create_string_buffer(w * w * 4)
gdi32.GetDIBits(hdcMem, hbmp, 0, w, buf, byref(bih))

pixels = buf.raw
img = bytearray()
stride = w * 4
for y in range(w):
    row = pixels[y * stride:(y + 1) * stride]
    for x in range(w):
        b, g, r, a = row[x * 4:x * 4 + 4]
        img += bytes((r, g, b, a))

from PIL import Image
Image.frombytes("RGBA", (w, w), bytes(img)).save(out)
print("saved", out)
user32.DestroyIcon(hicon)

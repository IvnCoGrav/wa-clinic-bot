import os
from PIL import Image, ImageOps

source_image_path = r"C:\Users\Ivan\.gemini\antigravity-ide\brain\a7dc1221-82c8-48c6-8de7-e3ec4a1227f4\.user_uploaded\media_1787145917593.png"
output_dir = r"c:\Users\Ivan\.gemini\antigravity\scratch\wa-clinic-bot\packages\admin-dashboard\public"

os.makedirs(output_dir, exist_ok=True)

# 1. Load source image and ensure RGBA
img = Image.open(source_image_path).convert("RGBA")

# 2. Autocrop / bbox to get exact logo content
bbox = img.getbbox()
if bbox:
    cropped = img.crop(bbox)
else:
    cropped = img

w, h = cropped.size
print(f"Loaded logo bounding box: {w}x{h}")

def create_square_icon(src_img, size, padding_ratio=0.12, bg_color=(0, 0, 0, 0)):
    canvas = Image.new("RGBA", (size, size), bg_color)
    max_dim = int(size * (1.0 - 2 * padding_ratio))
    
    # Scale preserving aspect ratio
    src_w, src_h = src_img.size
    scale = min(max_dim / src_w, max_dim / src_h)
    new_w = max(1, int(src_w * scale))
    new_h = max(1, int(src_h * scale))
    
    resized = src_img.resize((new_w, new_h), Image.Resampling.LANCZOS)
    
    offset_x = (size - new_w) // 2
    offset_y = (size - new_h) // 2
    
    canvas.paste(resized, (offset_x, offset_y), resized)
    return canvas

# 3. Generate 512x512 transparent (any)
icon_512 = create_square_icon(cropped, 512, padding_ratio=0.08)
icon_512.save(os.path.join(output_dir, "pwa-512x512.png"), "PNG")
print("Saved pwa-512x512.png")

# 4. Generate 512x512 maskable (with safe area 18% padding on dark background #020617)
icon_maskable_dark = create_square_icon(cropped, 512, padding_ratio=0.18, bg_color=(2, 6, 23, 255))
icon_maskable_dark.save(os.path.join(output_dir, "pwa-maskable-512x512.png"), "PNG")
print("Saved pwa-maskable-512x512.png")

# 5. Generate 192x192 transparent
icon_192 = create_square_icon(cropped, 192, padding_ratio=0.08)
icon_192.save(os.path.join(output_dir, "pwa-192x192.png"), "PNG")
print("Saved pwa-192x192.png")

# 6. Generate apple-touch-icon 180x180 (solid white/light background for iOS)
icon_apple = create_square_icon(cropped, 180, padding_ratio=0.10, bg_color=(255, 255, 255, 255))
icon_apple.save(os.path.join(output_dir, "apple-touch-icon.png"), "PNG")
print("Saved apple-touch-icon.png")

# 7. Generate favicon.png 32x32 and 64x64
favicon_32 = create_square_icon(cropped, 32, padding_ratio=0.04)
favicon_32.save(os.path.join(output_dir, "favicon.png"), "PNG")

favicon_64 = create_square_icon(cropped, 64, padding_ratio=0.04)
favicon_64.save(os.path.join(output_dir, "favicon-64.png"), "PNG")

# 8. Generate multi-size favicon.ico (16, 32, 48, 64)
icon_16 = create_square_icon(cropped, 16, padding_ratio=0.02)
icon_32 = create_square_icon(cropped, 32, padding_ratio=0.02)
icon_48 = create_square_icon(cropped, 48, padding_ratio=0.04)
icon_64 = create_square_icon(cropped, 64, padding_ratio=0.04)

icon_64.save(
    os.path.join(output_dir, "favicon.ico"),
    format="ICO",
    sizes=[(16, 16), (32, 32), (48, 48), (64, 64)],
    append_images=[icon_16, icon_32, icon_48]
)
print("Saved favicon.ico")

print("All PWA and favicon assets generated successfully!")

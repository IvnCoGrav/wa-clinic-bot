import os
import io
import shutil
import resvg_py
from PIL import Image

svg_master_path = r"c:\Users\Ivan\.gemini\antigravity\scratch\wa-clinic-bot\packages\admin-dashboard\public\Master Logo Kala.svg"
output_dir = r"c:\Users\Ivan\.gemini\antigravity\scratch\wa-clinic-bot\packages\admin-dashboard\public"

# 1. Copy master SVG to standard pwa-icon.svg
shutil.copyfile(svg_master_path, os.path.join(output_dir, "pwa-icon.svg"))
print("Saved pwa-icon.svg from Master Logo Kala.svg")

# Read SVG content
with open(svg_master_path, "r", encoding="utf-8") as f:
    svg_data = f.read()

def render_vector_png(svg_str, target_size, padding_ratio=0.10, bg_color=None):
    """
    Renders vector SVG directly at high resolution, centers it in a target_size x target_size canvas
    with perfect vector antialiasing.
    """
    glyph_size = int(target_size * (1.0 - 2 * padding_ratio))
    
    # Render SVG at exact glyph_size using resvg Rust engine
    rendered_png_bytes = resvg_py.svg_to_bytes(svg_str, width=glyph_size, height=glyph_size)
    glyph_img = Image.open(io.BytesIO(rendered_png_bytes)).convert("RGBA")
    
    # Create target canvas
    if bg_color:
        canvas = Image.new("RGBA", (target_size, target_size), bg_color)
    else:
        canvas = Image.new("RGBA", (target_size, target_size), (0, 0, 0, 0))
    
    offset_x = (target_size - glyph_img.width) // 2
    offset_y = (target_size - glyph_img.height) // 2
    
    canvas.paste(glyph_img, (offset_x, offset_y), glyph_img)
    return canvas

# 2. Generate 512x512 transparent (purpose: any)
pwa_512 = render_vector_png(svg_data, 512, padding_ratio=0.08)
pwa_512.save(os.path.join(output_dir, "pwa-512x512.png"), "PNG")
print("Generated HD pwa-512x512.png")

# 3. Generate 512x512 maskable (purpose: maskable, with 18% safe area padding on dark brand #020617)
pwa_maskable = render_vector_png(svg_data, 512, padding_ratio=0.18, bg_color=(2, 6, 23, 255))
pwa_maskable.save(os.path.join(output_dir, "pwa-maskable-512x512.png"), "PNG")
print("Generated HD pwa-maskable-512x512.png")

# 4. Generate 192x192 transparent
pwa_192 = render_vector_png(svg_data, 192, padding_ratio=0.08)
pwa_192.save(os.path.join(output_dir, "pwa-192x192.png"), "PNG")
print("Generated HD pwa-192x192.png")

# 5. Generate apple-touch-icon 180x180 (solid white background for crisp iOS display)
apple_180 = render_vector_png(svg_data, 180, padding_ratio=0.10, bg_color=(255, 255, 255, 255))
apple_180.save(os.path.join(output_dir, "apple-touch-icon.png"), "PNG")
print("Generated HD apple-touch-icon.png")

# 6. Generate favicon 32x32 and 64x64 PNG
fav_32 = render_vector_png(svg_data, 32, padding_ratio=0.04)
fav_32.save(os.path.join(output_dir, "favicon.png"), "PNG")

fav_64 = render_vector_png(svg_data, 64, padding_ratio=0.04)
fav_64.save(os.path.join(output_dir, "favicon-64.png"), "PNG")

# 7. Generate multi-resolution favicon.ico
fav_16 = render_vector_png(svg_data, 16, padding_ratio=0.02)
fav_48 = render_vector_png(svg_data, 48, padding_ratio=0.04)

fav_64.save(
    os.path.join(output_dir, "favicon.ico"),
    format="ICO",
    sizes=[(16, 16), (32, 32), (48, 48), (64, 64)],
    append_images=[fav_16, fav_32, fav_48]
)
print("Generated HD multi-resolution favicon.ico")
print("All vector assets rendered at 100% crisp vector quality!")

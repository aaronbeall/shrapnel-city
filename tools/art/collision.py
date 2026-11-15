"""Read a level's collision map (levels/NN_name/collision.png) as wall and chasm coverage.

The map is black for walls, #999999 for chasms (impassable but shoot-over) and white
for open floor, anti-aliased at the edges. Coverage is 0..1 per pixel.
"""
import numpy as np
from PIL import Image
from scipy import ndimage as ndi


def coverage(path, W, H):
    v = np.array(Image.open(path).convert('L'), np.float32)[:H, :W]
    # grey edge pixels next to a chasm blend chasm with floor or wall; elsewhere they blend wall with floor
    near_chasm = ndi.binary_dilation(np.abs(v - 153) < 12, iterations=2)
    wall = np.where(near_chasm, np.clip((153 - v) / 153, 0, 1), (255 - v) / 255)
    chasm = np.where(near_chasm, np.where(v >= 153, (255 - v) / 102, 1 - wall), 0)
    return wall.astype(np.float32), np.clip(chasm, 0, 1).astype(np.float32)

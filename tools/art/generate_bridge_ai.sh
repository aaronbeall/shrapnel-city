#!/bin/bash
# Repaint the Bridge background with OpenAI image generation, keeping its layout.
#   OPENAI_API_KEY=... tools/art/generate_bridge_ai.sh
# 1. paint_bridge.py paints a collision-accurate base from level3's shape.
# 2. gpt-image-2 repaints it in the style of backgrounds 0-2 (passed as references).
# 3. align.py warps the result so its walls line up with collision again.
set -euo pipefail
cd "$(dirname "$0")/../.."
L="source/library/level assets"
OUT="$L/background3/shape 1/bitmap 1.png"
T=$(mktemp -d)
python3 tools/art/paint_bridge.py
cp "$OUT" "$T/base_full.png"
python3 -c "from PIL import Image; Image.open('$T/base_full.png').convert('RGB').resize((1536,576),Image.LANCZOS).save('$T/base.png')"
curl -sf https://api.openai.com/v1/images/edits -H "Authorization: Bearer $OPENAI_API_KEY" \
  -F model=gpt-image-2 -F size=1536x576 -F quality=high \
  -F "image[]=@$T/base.png" \
  -F "image[]=@$L/background2/shape 1/bitmap 1.png" \
  -F "image[]=@$L/background0/shape 1/bitmap 1.png" \
  -F "image[]=@$L/background1/shape 1/bitmap 1.png" \
  -F "prompt=<tools/art/bridge_prompt.txt" > "$T/out.json"
python3 -c "import json,base64; open('$T/gen.png','wb').write(base64.b64decode(json.load(open('$T/out.json'))['data'][0]['b64_json']))"
python3 tools/art/align.py "$T/gen.png" "$T/base_full.png" "$T/aligned.png"
python3 -c "from PIL import Image; Image.open('$T/aligned.png').convert('RGBA').save('$OUT', optimize=True)"
echo "wrote $OUT"

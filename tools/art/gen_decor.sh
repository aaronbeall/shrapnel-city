#!/bin/bash
# Generate the decor sprite sheets with OpenAI gpt-image-2, using only the
# original levels (backgrounds 0-2) as style references.
#   OPENAI_API_KEY=... tools/art/gen_decor.sh [sheet ...]     (default: all)
# Writes tools/art/parts/decor/sheet_<name>.png; then run cut_decor.py.
set -uo pipefail
cd "$(dirname "$0")/parts/decor"
R="../../../../source/library/level assets"
sheets=("$@"); [ ${#sheets[@]} -eq 0 ] && sheets=(vents greebles greebles2 lights floorpaint wallmarks rails)
one() {
  local n=$1 tmp; tmp=$(mktemp)
  if [ -f "$n.noref" ]; then  # this sheet works better without a reference image
    python3 -c "import json,sys; print(json.dumps({'model':'gpt-image-2','size':'1536x1024','quality':'high','prompt':open('$n.txt').read()+'\n'+open('_common.txt').read().replace('The attached image is one level','Style: like a level')}))" |
      curl -s https://api.openai.com/v1/images/generations -H "Authorization: Bearer $OPENAI_API_KEY" -H "Content-Type: application/json" -d @- > "$tmp"
  else
    curl -s https://api.openai.com/v1/images/edits -H "Authorization: Bearer $OPENAI_API_KEY" \
      -F model=gpt-image-2 -F size=1536x1024 -F quality=high \
      -F "image[]=@$R/background2/shape 1/bitmap 1.png" \
      -F "prompt=$(cat $n.txt; echo; cat _common.txt)" > "$tmp"
  fi
  python3 - "$tmp" "sheet_$n.png" <<'PY'
import json, base64, sys
d = json.load(open(sys.argv[1]))
if 'error' in d: print(sys.argv[2], 'ERROR', d['error'].get('message')); sys.exit(1)
open(sys.argv[2], 'wb').write(base64.b64decode(d['data'][0]['b64_json'])); print('wrote', sys.argv[2])
PY
  rm -f "$tmp"
}
for n in "${sheets[@]}"; do one "$n" & done; wait

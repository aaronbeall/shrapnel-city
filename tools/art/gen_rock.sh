#!/bin/bash
# Generate the rock and earth art set (badlands + concrete bunker, first used by 08 Bunker) with
# OpenAI gpt-image-2. Same shape as gen_city.sh:
#   OPENAI_API_KEY=... tools/art/gen_rock.sh [name ...]      (default: everything)
# Textures: tools/art/parts/rock/<name>.png from <name>.prompt.txt + common.prompt.txt, with
# the original levels (backgrounds 0-2) as the only style references.
# Decor sheets: tools/art/parts/decor/sheet_rock-<name>.png from decor/rock-<name>.txt +
# decor/_rock.txt, with background 2 only (or none, with a .noref file); then run
# tools/art/cut_decor.py rock-... to cut them into sprites.
set -uo pipefail
ART="$(cd "$(dirname "$0")" && pwd)"
LV="$ART/../../levels"
TEX=(dirt gravel rock concrete bunker chasm sandbag)
SHEETS=(ground groundpaint top bunker floorpaint lights)
names=("$@"); [ ${#names[@]} -eq 0 ] && names=("${TEX[@]}" "${SHEETS[@]/#/rock-}")

save() {  # response json -> png
  python3 - "$1" "$2" <<'PY'
import json, base64, sys
d = json.load(open(sys.argv[1]))
if 'error' in d: print(sys.argv[2], 'ERROR', d['error'].get('message')); sys.exit(1)
open(sys.argv[2], 'wb').write(base64.b64decode(d['data'][0]['b64_json'])); print('wrote', sys.argv[2])
PY
}

texture() {
  local n=$1 tmp; tmp=$(mktemp)
  curl -s https://api.openai.com/v1/images/edits -H "Authorization: Bearer $OPENAI_API_KEY" \
    -F model=gpt-image-2 -F size=1024x1024 -F quality=high \
    -F "image[]=@$LV/00_Training/background.png" -F "image[]=@$LV/01_DropZone/background.png" -F "image[]=@$LV/02_FirstBlock/background.png" \
    -F "prompt=$(cat "$ART/parts/rock/common.prompt.txt"; echo; cat "$ART/parts/rock/$n.prompt.txt")" > "$tmp"
  save "$tmp" "$ART/parts/rock/$n.png"; rm -f "$tmp"
}

sheet() {
  local n=$1 tmp; tmp=$(mktemp)
  local D="$ART/parts/decor"
  if [ -f "$D/$n.noref" ]; then
    python3 -c "import json; print(json.dumps({'model':'gpt-image-2','size':'1536x1024','quality':'high','prompt':open('$D/$n.txt').read()+'\n'+open('$D/_rock.txt').read().replace('The attached image is one level','Style: like a level')}))" |
      curl -s https://api.openai.com/v1/images/generations -H "Authorization: Bearer $OPENAI_API_KEY" -H "Content-Type: application/json" -d @- > "$tmp"
  else
    curl -s https://api.openai.com/v1/images/edits -H "Authorization: Bearer $OPENAI_API_KEY" \
      -F model=gpt-image-2 -F size=1536x1024 -F quality=high \
      -F "image[]=@$LV/02_FirstBlock/background.png" \
      -F "prompt=$(cat "$D/$n.txt"; echo; cat "$D/_rock.txt")" > "$tmp"
  fi
  save "$tmp" "$D/sheet_$n.png"; rm -f "$tmp"
}

for n in "${names[@]}"; do
  case $n in rock-*) sheet "$n" & ;; *) texture "$n" & ;; esac
done
wait

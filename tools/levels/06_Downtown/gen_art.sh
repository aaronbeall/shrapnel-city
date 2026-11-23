#!/bin/bash
# Generate 06 Downtown's own decor sheets with OpenAI gpt-image-2 (night, no reference image).
#   OPENAI_API_KEY=... tools/levels/06_Downtown/gen_art.sh [city-downtown city-neon]
# Prompts: tools/levels/06_Downtown/art/<name>.txt + _night.txt. Writes
# tools/art/parts/decor/sheet_<name>.png; then: python3 tools/art/cut_decor.py <name>
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
D="$HERE/../../art/parts/decor"
names=("$@"); [ ${#names[@]} -eq 0 ] && names=(city-downtown city-neon)
for n in "${names[@]}"; do
  (
    tmp=$(mktemp)
    python3 -c "import json,sys; print(json.dumps({'model':'gpt-image-2','size':'1536x1024','quality':'high','prompt':open(sys.argv[1]).read()+'\n'+open(sys.argv[2]).read()}))" "$HERE/art/$n.txt" "$HERE/art/_night.txt" |
      curl -s https://api.openai.com/v1/images/generations -H "Authorization: Bearer $OPENAI_API_KEY" -H "Content-Type: application/json" -d @- > "$tmp"
    python3 - "$tmp" "$D/sheet_$n.png" <<'PY'
import json, base64, sys
d = json.load(open(sys.argv[1]))
if 'error' in d: print(sys.argv[2], 'ERROR', d['error'].get('message')); sys.exit(1)
open(sys.argv[2], 'wb').write(base64.b64decode(d['data'][0]['b64_json'])); print('wrote', sys.argv[2])
PY
    rm -f "$tmp"
  ) &
done
wait

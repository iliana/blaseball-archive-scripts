#!/bin/bash
set -euxo pipefail
for file in *.json; do
    prev="$(find -- *.json.gz | tail -n 1)"
    if cmp <(zcat "$prev" | jq -cS 'del(.clientMeta)') <(jq -cS 'del(.clientMeta)' "$file") >/dev/null; then
        rm "$file"
    else
        gzip "$file"
    fi
done

#!/bin/sh
# same as run_week.sh, but skips weeks another worker has already finished or started
O=${10}; T=$2; W=$1
[ -e "$O/res_${T}_$W.json" ] && exit 0
[ -e "$O/claim_${T}_$W" ] && exit 0
: > "$O/claim_${T}_$W"
exec "$(cd "$(dirname "$0")" && pwd)/run_week.sh" "$@"

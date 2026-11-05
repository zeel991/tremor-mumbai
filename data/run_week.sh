#!/bin/sh
# usage: run_week.sh <week> <tag> <pool> <dec0> <dec1> <sym0> <sym1> <fee> <llama.json> <outdir> <klcache>
W=$1; T=$2; P=$3; D0=$4; D1=$5; S0=$6; S1=$7; F=$8; L=$9; O=${10}; KL=${11}
DIR=$(cd "$(dirname "$0")" && pwd)
[ -s "$O/swaps_${T}_$W.json" ] || python3 -I "$DIR/fetch_swaps_pool.py" "$P" "$W" "$D0" "$D1" "$O/swaps_${T}_$W.json" >/dev/null
python3 -I "$DIR/markout_pool.py" "$O/swaps_${T}_$W.json" "$S0" "$S1" "$F" "$L" "$KL" > "$O/res_${T}_$W.json"

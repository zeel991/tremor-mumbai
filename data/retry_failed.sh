#!/bin/sh
# usage: retry_failed.sh <full_dir> <klcache> <llama_uni.json> <llama_ethusdc30.json>
O=$1; KL=$2; LU=$3; LE=$4; D=$(cd "$(dirname "$0")" && pwd)
for W in $(cat "$O/weeks.txt"); do
  for T in uniweth ethusdc30; do
    f="$O/res_${T}_$W.json"
    if ! python3 -I -c "import json,sys; json.load(open(sys.argv[1]))" "$f" 2>/dev/null; then
      rm -f "$f" "$O/swaps_${T}_$W.json"
      for try in 1 2 3; do
        if [ $T = uniweth ]; then "$D/run_week.sh" $W uniweth 0x1d42064fc4beb5f8aaf85f4617ae8b3b5b8bd801 18 18 UNI ETH 0.003 "$LU" "$O" "$KL"
        else "$D/run_week.sh" $W ethusdc30 0x8ad599c3a0ff1de082011efddc58f1908eb6e6d8 6 18 USD ETH 0.003 "$LE" "$O" "$KL"; fi
        python3 -I -c "import json,sys; json.load(open(sys.argv[1]))" "$f" 2>/dev/null && break
        rm -f "$f" "$O/swaps_${T}_$W.json"; sleep 5
      done
      echo "retried $T $W: $( [ -s "$f" ] && echo ok || echo FAILED)"
    fi
  done
done

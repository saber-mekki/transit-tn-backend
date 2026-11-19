#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
# simulate-live-trips.sh — moves 3 fake transporters along real Tunisian
# roads so you can watch the live map update in real time.
#
#   Kasserine → Tunis  (Sbiba, Rouhia, Makthar, Siliana, Bou Arada, El Fahs)
#   Tabarka   → Tunis  (Aïn Draham, Jendouba, Béja, Medjez el Bab, Tebourba)
#   Sfax      → Tunis  (A1: El Jem, Msaken, Sousse, Enfidha, Bouficha)
#
# What it does:
#   1. logs in as operator(s)
#   2. creates 1 TRANSPORTER trip per route + 1 test shipment, sets it IN_TRANSIT
#      (→ trip is "en_cours", so the backend accepts its positions)
#   3. POSTs a position every $INTERVAL s per trip to /api/trips/:id/location
#   4. on arrival marks the shipment DELIVERED (marker disappears from the map)
#   5. on exit / Ctrl+C deletes everything it created (KEEP=1 to keep it)
#
# Usage:
#   ./scripts/simulate-live-trips.sh
#   API_URL=http://192.168.2.204:3001 INTERVAL=2 STEP_KM=2 ./scripts/simulate-live-trips.sh
#   OPERATORS="sfax_express:Operator@123!,other_op:Pass@123!" ./scripts/simulate-live-trips.sh
#
# ⚠  Start the backend with a higher tracking limit, otherwise POSTs get 429:
#      TRACKING_RATE_LIMIT=10000 npm run dev
# ⚠  Your .env DATABASE_URL may point to PRODUCTION. Use a local database
#    (DATABASE_URL=postgresql://...localhost.../transit_tn npm run dev).
#
# Requires: bash, curl, jq, awk
# ─────────────────────────────────────────────────────────────────────
set -uo pipefail
export LC_ALL=C   # decimal point "." for awk/printf (French locales use ",")

API_URL="${API_URL:-http://localhost:3001}"
INTERVAL="${INTERVAL:-3}"        # seconds between ticks
STEP_KM="${STEP_KM:-1.5}"        # distance moved per tick
OPERATORS="${OPERATORS:-sfax_express:Operator@123!}"
KEEP="${KEEP:-0}"
LOOP="${LOOP:-0}"                # 1 = restart a route when it arrives instead of delivering

for bin in curl jq awk; do
  command -v "$bin" >/dev/null || { echo "❌ '$bin' is required"; exit 1; }
done

if [[ "$API_URL" =~ onrender\.com|transit-tn\.tn ]] && [[ "${ALLOW_PROD:-0}" != "1" ]]; then
  echo "❌ API_URL looks like production ($API_URL)."
  echo "   This script creates trips visible to real users. Re-run with ALLOW_PROD=1 if you really mean it."
  exit 1
fi

# ─── Routes: "City|lat,lng lat,lng ..." (waypoints along the actual roads) ───
ROUTE_NAMES=("Kasserine" "Tabarka" "Sfax")
ROUTE_POINTS=(
  # Kasserine → Sbiba → Rouhia → Makthar → Siliana → Bou Arada → El Fahs → Bir Mcherga → Mohamedia → Tunis
  "35.1676,8.8365 35.3530,8.9480 35.5433,9.0736 35.6536,9.0539 35.8550,9.2050 36.0849,9.3708 36.2300,9.5100 36.3528,9.6219 36.3744,9.9067 36.5203,10.0110 36.6767,10.1561 36.7500,10.1750 36.8008,10.1800"
  # Tabarka → Aïn Draham → Fernana → Jendouba → Bou Salem → Béja → Oued Zarga → Medjez el Bab → Tebourba → Jedeida → Manouba → Tunis
  "36.9544,8.7580 36.8650,8.7250 36.7792,8.6880 36.6556,8.6950 36.5011,8.7803 36.6114,8.9700 36.7256,9.1817 36.6736,9.4278 36.6497,9.6122 36.8297,9.8411 36.8483,9.9300 36.8100,10.0970 36.8008,10.1800"
  # Sfax → A1 → El Jem → Msaken → Sousse junction → Enfidha → Bouficha → Hammamet junction → Mornag → Ben Arous → Tunis
  "34.7406,10.7603 34.8600,10.7000 35.0700,10.6900 35.3000,10.6800 35.5000,10.6200 35.7300,10.5800 35.8600,10.5400 36.0000,10.4500 36.1350,10.3808 36.3000,10.4500 36.4500,10.4700 36.6000,10.4000 36.6800,10.2900 36.7531,10.2189 36.8008,10.1800"
)
DEST_CITY="Tunis"

# Densify waypoints → "lat lng heading" every $STEP_KM km.
densify() {
  echo "$1" | tr ' ' '\n' | awk -F, -v step="$STEP_KM" '
    function rad(d) { return d * 3.141592653589793 / 180 }
    function dist(a1, o1, a2, o2,   dl, dg, h) {
      dl = rad(a2 - a1); dg = rad(o2 - o1)
      h = sin(dl/2)^2 + cos(rad(a1)) * cos(rad(a2)) * sin(dg/2)^2
      return 2 * 6371 * atan2(sqrt(h), sqrt(1 - h))
    }
    function bearing(a1, o1, a2, o2,   y, x, b) {
      y = sin(rad(o2 - o1)) * cos(rad(a2))
      x = cos(rad(a1)) * sin(rad(a2)) - sin(rad(a1)) * cos(rad(a2)) * cos(rad(o2 - o1))
      b = atan2(y, x) * 180 / 3.141592653589793
      return (b + 360) % 360
    }
    BEGIN { n = 0 }
    NF == 2 { lat[n] = $1; lng[n] = $2; n++ }
    END {
      for (i = 0; i < n - 1; i++) {
        d = dist(lat[i], lng[i], lat[i+1], lng[i+1])
        k = int(d / step); if (k < 1) k = 1
        hd = bearing(lat[i], lng[i], lat[i+1], lng[i+1])
        for (j = 0; j < k; j++) {
          t = j / k
          printf "%.6f %.6f %.0f\n", lat[i] + (lat[i+1] - lat[i]) * t, lng[i] + (lng[i+1] - lng[i]) * t, hd
        }
      }
      printf "%.6f %.6f %.0f\n", lat[n-1], lng[n-1], hd
    }'
}

# ─── HTTP helpers ───
# api METHOD PATH TOKEN [JSON] → prints body, sets HTTP_CODE
HTTP_CODE=0
api() {
  local method="$1" path="$2" token="${3:-}" body="${4:-}" out
  local args=(-s -m 60 -X "$method" -H "Content-Type: application/json" -w $'\n%{http_code}')
  [[ -n "$token" ]] && args+=(-H "Authorization: Bearer $token")
  [[ -n "$body" ]] && args+=(--data "$body")
  out=$(curl "${args[@]}" "$API_URL$path") || { HTTP_CODE=000; echo ""; return 1; }
  HTTP_CODE="${out##*$'\n'}"
  echo "${out%$'\n'*}"
}

# ─── Login operators ───
IFS=',' read -r -a OPS <<< "$OPERATORS"
TOKENS=()
echo "🔐 Logging in to $API_URL ..."
for op in "${OPS[@]}"; do
  user="${op%%:*}"; pass="${op#*:}"
  body=$(jq -nc --arg e "$user" --arg p "$pass" '{email:$e, password:$p}')
  res=$(api POST /api/auth/login "" "$body")
  token=$(echo "$res" | jq -r '.token // empty' 2>/dev/null)
  role=$(echo "$res" | jq -r '.user.role // empty' 2>/dev/null)
  if [[ -z "$token" ]]; then echo "❌ Login failed for $user (HTTP $HTTP_CODE): $res"; exit 1; fi
  if [[ "$role" != "OPERATOR" && "$role" != "ADMIN" ]]; then echo "❌ $user is $role, need OPERATOR"; exit 1; fi
  echo "   ✓ $user"
  TOKENS+=("$token")
done

# ─── Create trips + shipments ───
TRIP_IDS=(); SHIP_IDS=(); TRIP_TOKENS=(); POINTS_FILES=(); IDX=(); DONE=()
TMP_DIR=$(mktemp -d)

cleanup() {
  trap - EXIT INT TERM
  echo
  if [[ "$KEEP" == "1" ]]; then echo "📌 KEEP=1 → trips kept: ${TRIP_IDS[*]:-}"; rm -rf "$TMP_DIR"; exit 0; fi
  echo "🧹 Cleaning up ..."
  for i in "${!TRIP_IDS[@]}"; do
    tok="${TRIP_TOKENS[$i]}"
    api PUT /api/shipments/bulk-status "$tok" "$(jq -nc --arg t "${TRIP_IDS[$i]}" '{tripId:$t, status:"DELIVERED"}')" >/dev/null
    [[ -n "${SHIP_IDS[$i]:-}" ]] && api DELETE "/api/shipments/${SHIP_IDS[$i]}" "$tok" >/dev/null
    api DELETE "/api/trips/${TRIP_IDS[$i]}" "$tok" >/dev/null
    echo "   ✓ removed trip ${TRIP_IDS[$i]}"
  done
  rm -rf "$TMP_DIR"
  exit 0
}
trap cleanup EXIT INT TERM

now_iso() { date -u +%Y-%m-%dT%H:%M:%S.000Z; }
later_iso() { date -u -d "+$1 minutes" +%Y-%m-%dT%H:%M:%S.000Z 2>/dev/null || date -u -v+"$1"M +%Y-%m-%dT%H:%M:%S.000Z; }

echo "🚚 Creating trips ..."
for i in "${!ROUTE_NAMES[@]}"; do
  from="${ROUTE_NAMES[$i]}"
  tok="${TOKENS[$(( i % ${#TOKENS[@]} ))]}"
  pf="$TMP_DIR/route_$i.txt"
  densify "${ROUTE_POINTS[$i]}" > "$pf"

  trip_body=$(jq -nc --arg f "$from" --arg t "$DEST_CITY" --arg d "$(later_iso 5)" --arg a "$(later_iso 240)" \
    '{type:"TRANSPORTER", fromCity:$f, toCity:$t, departureTime:$d, arrivalTime:$a,
      contactInfo:"+216 00 000 000", vehicleType:"Camion (simulation)", availableSpace:"—", eta:"", route:[$f,$t]}')
  res=$(api POST /api/trips "$tok" "$trip_body")
  trip_id=$(echo "$res" | jq -r '.id // empty' 2>/dev/null)
  [[ -z "$trip_id" ]] && { echo "❌ Trip creation failed (HTTP $HTTP_CODE): $res"; exit 1; }

  ship_body=$(jq -nc --arg f "$from" --arg t "$DEST_CITY" --arg id "$trip_id" \
    '{senderName:"Simulation", senderPhone:"00000000", receiverName:"Simulation", receiverPhone:"00000000",
      description:"Colis de test (simulation live map)", fromCity:$f, toCity:$t, tripId:$id}')
  res=$(api POST /api/shipments "$tok" "$ship_body")
  ship_id=$(echo "$res" | jq -r '.id // empty' 2>/dev/null)
  api PUT /api/shipments/bulk-status "$tok" "$(jq -nc --arg t "$trip_id" '{tripId:$t, status:"IN_TRANSIT"}')" >/dev/null

  TRIP_IDS+=("$trip_id"); SHIP_IDS+=("$ship_id"); TRIP_TOKENS+=("$tok")
  POINTS_FILES+=("$pf"); IDX+=(0); DONE+=(0)
  echo "   ✓ $from → $DEST_CITY  trip=$trip_id  ($(wc -l < "$pf") points)"
done

# ─── Drive ───
echo "▶  Sending positions every ${INTERVAL}s (Ctrl+C to stop) — open the live map now."
tick=0
while :; do
  active=0
  for i in "${!TRIP_IDS[@]}"; do
    [[ "${DONE[$i]}" == "1" ]] && continue
    active=1
    pf="${POINTS_FILES[$i]}"
    total=$(wc -l < "$pf")
    if (( IDX[i] >= total )); then
      if [[ "$LOOP" == "1" ]]; then IDX[i]=0; else
        api PUT /api/shipments/bulk-status "${TRIP_TOKENS[$i]}" "$(jq -nc --arg t "${TRIP_IDS[$i]}" '{tripId:$t, status:"DELIVERED"}')" >/dev/null
        echo "🏁 ${ROUTE_NAMES[$i]} → $DEST_CITY arrived (livré)"
        DONE[i]=1; continue
      fi
    fi
    read -r lat lng heading < <(sed -n "$(( IDX[i] + 1 ))p" "$pf")
    # Realistic speed 75–100 km/h, in m/s
    speed=$(awk -v r="$RANDOM" 'BEGIN { printf "%.1f", 20.8 + (r % 700) / 100 }')
    body=$(jq -nc --argjson la "$lat" --argjson ln "$lng" --argjson s "$speed" --argjson h "$heading" '{lat:$la, lng:$ln, speed:$s, heading:$h}')
    res=$(api POST "/api/trips/${TRIP_IDS[$i]}/location" "${TRIP_TOKENS[$i]}" "$body")
    case "$HTTP_CODE" in
      200) printf "  %-10s %3d/%-3d  %s,%s  %s km/h  👀 %s\n" "${ROUTE_NAMES[$i]}" "$(( IDX[i] + 1 ))" "$total" "$lat" "$lng" \
             "$(awk -v s="$speed" 'BEGIN{printf "%.0f", s*3.6}')" "$(echo "$res" | jq -r '(.listeners // 0) + (.mapViewers // 0)')" ;;
      429) echo "⚠  429 rate limited — restart the backend with TRACKING_RATE_LIMIT=10000" ;;
      409) echo "⚠  ${ROUTE_NAMES[$i]}: trip no longer en_cours ($res)"; DONE[i]=1 ;;
      *)   echo "⚠  ${ROUTE_NAMES[$i]}: HTTP $HTTP_CODE $res" ;;
    esac
    IDX[i]=$(( IDX[i] + 1 ))
  done
  (( active == 0 )) && { echo "✅ All trips arrived."; break; }
  tick=$(( tick + 1 ))
  sleep "$INTERVAL"
done

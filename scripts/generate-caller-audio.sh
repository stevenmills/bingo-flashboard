#!/usr/bin/env bash
# Generate pre-recorded bingo caller clips for browser playback (Bluetooth-friendly).
# Requires macOS `say` and `ffmpeg`.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PACK_ID="${CALLER_VOICE_PACK:-Female1}"
case "$PACK_ID" in
  Female1) PACK_SLUG=F1 ;;
  Female2) PACK_SLUG=F2 ;;
  Male1) PACK_SLUG=M1 ;;
  Male2) PACK_SLUG=M2 ;;
  *) echo "Unknown CALLER_VOICE_PACK=$PACK_ID (Female1|Female2|Male1|Male2)" >&2; exit 1 ;;
esac
OUT_DIR="${ROOT}/frontend/public/cv/${PACK_SLUG}"
VOICE="${CALLER_VOICE:-Daniel}"
RATE="${CALLER_SAY_RATE:-160}"
# Keep clips tiny for SPIFFS (many small files have filesystem overhead).
SAMPLE_RATE="${CALLER_SAMPLE_RATE:-16000}"
BITRATE="${CALLER_MP3_BITRATE:-16k}"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

letter_name() {
  case "$1" in
    B) echo "Bee" ;;
    I) echo "Eye" ;;
    N) echo "En" ;;
    G) echo "Gee" ;;
    O) echo "Oh" ;;
    *) echo "$1" ;;
  esac
}

letter_for_number() {
  local n="$1"
  if (( n >= 1 && n <= 15 )); then echo "B"
  elif (( n >= 16 && n <= 30 )); then echo "I"
  elif (( n >= 31 && n <= 45 )); then echo "N"
  elif (( n >= 46 && n <= 60 )); then echo "G"
  else echo "O"
  fi
}

number_word() {
  # Spoken forms so TTS never says "capital" or digit-by-digit.
  case "$1" in
    1) echo "one" ;;
    2) echo "two" ;;
    3) echo "three" ;;
    4) echo "four" ;;
    5) echo "five" ;;
    6) echo "six" ;;
    7) echo "seven" ;;
    8) echo "eight" ;;
    9) echo "nine" ;;
    10) echo "ten" ;;
    11) echo "eleven" ;;
    12) echo "twelve" ;;
    13) echo "thirteen" ;;
    14) echo "fourteen" ;;
    15) echo "fifteen" ;;
    16) echo "sixteen" ;;
    17) echo "seventeen" ;;
    18) echo "eighteen" ;;
    19) echo "nineteen" ;;
    20) echo "twenty" ;;
    21) echo "twenty one" ;;
    22) echo "twenty two" ;;
    23) echo "twenty three" ;;
    24) echo "twenty four" ;;
    25) echo "twenty five" ;;
    26) echo "twenty six" ;;
    27) echo "twenty seven" ;;
    28) echo "twenty eight" ;;
    29) echo "twenty nine" ;;
    30) echo "thirty" ;;
    31) echo "thirty one" ;;
    32) echo "thirty two" ;;
    33) echo "thirty three" ;;
    34) echo "thirty four" ;;
    35) echo "thirty five" ;;
    36) echo "thirty six" ;;
    37) echo "thirty seven" ;;
    38) echo "thirty eight" ;;
    39) echo "thirty nine" ;;
    40) echo "forty" ;;
    41) echo "forty one" ;;
    42) echo "forty two" ;;
    43) echo "forty three" ;;
    44) echo "forty four" ;;
    45) echo "forty five" ;;
    46) echo "forty six" ;;
    47) echo "forty seven" ;;
    48) echo "forty eight" ;;
    49) echo "forty nine" ;;
    50) echo "fifty" ;;
    51) echo "fifty one" ;;
    52) echo "fifty two" ;;
    53) echo "fifty three" ;;
    54) echo "fifty four" ;;
    55) echo "fifty five" ;;
    56) echo "fifty six" ;;
    57) echo "fifty seven" ;;
    58) echo "fifty eight" ;;
    59) echo "fifty nine" ;;
    60) echo "sixty" ;;
    61) echo "sixty one" ;;
    62) echo "sixty two" ;;
    63) echo "sixty three" ;;
    64) echo "sixty four" ;;
    65) echo "sixty five" ;;
    66) echo "sixty six" ;;
    67) echo "sixty seven" ;;
    68) echo "sixty eight" ;;
    69) echo "sixty nine" ;;
    70) echo "seventy" ;;
    71) echo "seventy one" ;;
    72) echo "seventy two" ;;
    73) echo "seventy three" ;;
    74) echo "seventy four" ;;
    75) echo "seventy five" ;;
    *) echo "$1" ;;
  esac
}

render_clip() {
  local text="$1"
  local out_mp3="$2"
  local wav="${TMP_DIR}/clip.wav"
  say -v "$VOICE" -r "$RATE" -o "$wav" --data-format="LEI16@${SAMPLE_RATE}" "$text"
  # Mono, low sample-rate, low bitrate — speech stays clear enough for call-outs.
  ffmpeg -y -loglevel error -i "$wav" -ac 1 -ar "$SAMPLE_RATE" \
    -codec:a libmp3lame -b:a "$BITRATE" -compression_level 9 "$out_mp3"
}

mkdir -p "$OUT_DIR"
# Remove previous clips in this pack only.
rm -f "$OUT_DIR"/*.mp3

echo "Generating caller clips pack=${PACK_ID} slug=${PACK_SLUG} voice=${VOICE} rate=${RATE} bitrate=${BITRATE}"
echo "Output: ${OUT_DIR}"

render_clip "Caller on" "${OUT_DIR}/on.mp3"
render_clip "Jokes on" "${OUT_DIR}/jokes-on.mp3"
render_clip "Bingo!" "${OUT_DIR}/bingo.mp3"

for n in $(seq 1 75); do
  letter="$(letter_for_number "$n")"
  spoken_letter="$(letter_name "$letter")"
  spoken_number="$(number_word "$n")"
  # Slight pause between letter and number via punctuation.
  text="${spoken_letter}, ${spoken_number}"
  out="${OUT_DIR}/${letter}-${n}.mp3"
  render_clip "$text" "$out"
  printf "  %s\n" "${letter}-${n}.mp3"
done

# Supplemental joke clips — full 1–75 set is generated via OpenAI TTS:
#   CALLER_ONLY_JOKES=1 node scripts/generate-caller-audio-openai.mjs
echo "Generating joke clips (legacy subset; prefer OpenAI script for full set)..."
render_clip "Before anyone yells 'BINGO,' let's make sure you've actually got it!" "${OUT_DIR}/joke-B-4.mp3"
printf "  %s\n" "joke-B-4.mp3"
render_clip "Sixty-seven! Oddly satisfying, just like a perfectly centered daub." "${OUT_DIR}/joke-O-67.mp3"
printf "  %s\n" "joke-O-67.mp3"

total_bytes="$(du -sk "$OUT_DIR"/*.mp3 | awk '{s+=$1} END {print s*1024}')"
count="$(ls -1 "$OUT_DIR"/*.mp3 | wc -l | tr -d ' ')"
echo ""
echo "Done: ${count} clips, $(python3 -c "print(f'{${total_bytes}/1024:.0f} KB')") total"
echo "Example: ${OUT_DIR}/B-15.mp3"

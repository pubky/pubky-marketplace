#!/usr/bin/env bash
# Proves queue tickets disappear on INT/TERM, and a dead PID cannot block
# the next waiter. Portable across Linux (flock) and macOS (python3 fcntl.flock).
set -euo pipefail
# Background jobs ignore SIGINT unless job control is on. The real gate is
# foreground and does receive Ctrl-C. Monitor mode gives each job its own
# process group so the signals under test are delivered.
set -m

DIR="$(cd "$(dirname "$0")" && pwd)"
export HEAVY_LOCK_DIR
HEAVY_LOCK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/heavy-lock-test.XXXXXX")"
# shellcheck source=heavy-lock.sh
source "$DIR/heavy-lock.sh"

pids=""
track() { pids="$pids $1"; }

cleanup() {
  local p
  for p in $pids; do
    kill -9 "$p" 2>/dev/null || true
  done
  wait 2>/dev/null || true
  rm -rf "$HEAVY_LOCK_DIR"
}
trap cleanup EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

process_gone() {
  local pid="$1" state
  if ! kill -0 "$pid" 2>/dev/null; then
    return 0
  fi
  state=$(ps -o stat= -p "$pid" 2>/dev/null | tr -d '[:space:]' || true)
  case "$state" in
    Z*) return 0 ;;
  esac
  return 1
}

ticket_for() {
  local pid="$1" f pid2 epoch
  for f in "$HEAVY_LOCK_DIR"/vrt.q/*.ticket; do
    [ -e "$f" ] || continue
    pid2=""
    epoch=""
    read -r pid2 epoch < "$f" || true
    if [ "$pid2" = "$pid" ]; then
      printf '%s\n' "$f"
      return 0
    fi
  done
  return 1
}

wait_for() {
  local file="$1" needle="$2" i
  for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25; do
    if [ -f "$file" ] && grep -q "$needle" "$file"; then
      return 0
    fi
    sleep 0.2
  done
  return 1
}

echo "test: command status is preserved"
set +e
run_heavy node bash -c 'exit 3'
st=$?
set -e
[ "$st" = 3 ] || fail "exit status $st"

echo "test: previous EXIT trap is restored"
restored="$(
  HEAVY_LOCK_DIR="$HEAVY_LOCK_DIR" bash -c '
    source "$1"
    trap "echo ORIGINAL" EXIT
    run_heavy node true
    trap -p EXIT
  ' _ "$DIR/heavy-lock.sh"
)"
printf '%s\n' "$restored" | grep -q ORIGINAL || fail "EXIT trap was not restored: $restored"

# One VRT slot. The holder occupies it. Two waiters queue. Killing the first
# must drop its ticket, and the second must run once the holder finishes.
interrupt_and_proceed() {
  local sig="$1" label="$2"
  local logdir holder w1 w2 t1 deadline
  rm -rf "$HEAVY_LOCK_DIR"
  mkdir -p "$HEAVY_LOCK_DIR"
  logdir="$HEAVY_LOCK_DIR/logs"
  mkdir -p "$logdir"

  run_heavy vrt bash -c 'printf hold > "$1"; sleep 6' _ "$logdir/holder" \
    >"$logdir/holder.out" 2>"$logdir/holder.err" &
  holder=$!
  track "$holder"
  wait_for "$logdir/holder" hold || fail "$label: holder did not start"

  run_heavy vrt bash -c 'printf ran > "$1"' _ "$logdir/w1" \
    >"$logdir/w1.out" 2>"$logdir/w1.err" &
  w1=$!
  track "$w1"
  run_heavy vrt bash -c 'printf ran > "$1"' _ "$logdir/w2" \
    >"$logdir/w2.out" 2>"$logdir/w2.err" &
  w2=$!
  track "$w2"
  wait_for "$logdir/w1.err" waiting || fail "$label: w1 did not wait"
  wait_for "$logdir/w2.err" waiting || fail "$label: w2 did not wait"
  t1="$(ticket_for "$w1")" || fail "$label: w1 has no ticket"

  # Signal the job's process group, as Ctrl-C does for a foreground gate.
  kill -s "$sig" -- "-$w1" 2>/dev/null || kill -s "$sig" "$w1" || true
  deadline=$(( $(date +%s) + 3 ))
  while [ -e "$t1" ]; do
    [ "$(date +%s)" -gt "$deadline" ] && fail "$label: ticket remained after $sig"
    sleep 0.1
  done
  deadline=$(( $(date +%s) + 3 ))
  while ! process_gone "$w1"; do
    [ "$(date +%s)" -gt "$deadline" ] && fail "$label: waiter still alive after $sig"
    sleep 0.1
  done
  if [ -f "$logdir/w2" ]; then
    fail "$label: next gate ran while the slot was still held"
  fi

  deadline=$(( $(date +%s) + 12 ))
  while [ ! -f "$logdir/w2" ]; do
    [ "$(date +%s)" -gt "$deadline" ] && fail "$label: next gate did not proceed"
    sleep 0.2
  done
  wait "$holder" || fail "$label: holder failed"
  wait "$w2" || fail "$label: next gate failed"
  wait "$w1" 2>/dev/null || true
  echo "$label ok"
}

echo "test: SIGINT drops the waiting ticket and the next gate proceeds"
interrupt_and_proceed INT "SIGINT"

echo "test: SIGTERM drops the waiting ticket and the next gate proceeds"
interrupt_and_proceed TERM "SIGTERM"

echo "test: a SIGKILL ticket expires so the next gate proceeds"
rm -rf "$HEAVY_LOCK_DIR"
mkdir -p "$HEAVY_LOCK_DIR"
logdir="$HEAVY_LOCK_DIR/logs"
mkdir -p "$logdir"
run_heavy vrt bash -c 'printf hold > "$1"; sleep 6' _ "$logdir/holder" \
  >"$logdir/holder.out" 2>"$logdir/holder.err" &
holder=$!
track "$holder"
wait_for "$logdir/holder" hold || fail "SIGKILL: holder did not start"
run_heavy vrt bash -c 'printf ran > "$1"' _ "$logdir/killed" \
  >"$logdir/killed.out" 2>"$logdir/killed.err" &
killed=$!
track "$killed"
wait_for "$logdir/killed.err" waiting || fail "SIGKILL: waiter did not wait"
tleak="$(ticket_for "$killed")" || fail "SIGKILL: no ticket"
kill -9 "$killed" || true
sleep 0.3
[ -e "$tleak" ] || fail "SIGKILL: ticket vanished without a scanner or a trap"
run_heavy vrt bash -c 'printf ran > "$1"' _ "$logdir/next" \
  >"$logdir/next.out" 2>"$logdir/next.err" &
next=$!
track "$next"
deadline=$(( $(date +%s) + 3 ))
while [ -e "$tleak" ]; do
  [ "$(date +%s)" -gt "$deadline" ] && fail "SIGKILL: dead ticket was not expired"
  sleep 0.1
done
if [ -f "$logdir/holder" ] && [ -f "$logdir/next" ]; then
  # next must not finish before the holder releases; the file appears when it runs
  :
fi
deadline=$(( $(date +%s) + 12 ))
while [ ! -f "$logdir/next" ]; do
  [ "$(date +%s)" -gt "$deadline" ] && fail "SIGKILL: next gate did not proceed"
  sleep 0.2
done
wait "$holder" || fail "SIGKILL: holder failed"
wait "$next" || fail "SIGKILL: next gate failed"
wait "$killed" 2>/dev/null || true
echo "SIGKILL ok"

echo "test: vrt and cargo refuse below the disk floor"
rm -rf "$HEAVY_LOCK_DIR"
mkdir -p "$HEAVY_LOCK_DIR"
logdir="$HEAVY_LOCK_DIR/logs"
mkdir -p "$logdir"
for class in vrt cargo; do
  set +e
  HEAVY_DISK_VOLUMES="$HEAVY_LOCK_DIR" HEAVY_DISK_FLOOR_GIB=999999999 \
    run_heavy "$class" bash -c 'printf ran > "$1"' _ "$logdir/$class" \
    2>"$logdir/$class.err"
  st=$?
  set -e
  [ "$st" != 0 ] || fail "disk floor: $class ran below the floor"
  [ ! -e "$logdir/$class" ] || fail "disk floor: $class command started"
  grep -q "refusing class=${class}" "$logdir/$class.err" \
    || fail "disk floor: $class printed no refusal"
  ls "$HEAVY_LOCK_DIR/${class}.q"/*.ticket >/dev/null 2>&1 \
    && fail "disk floor: $class left a ticket"
done
echo "disk floor refusal ok"

echo "test: node ignores the disk floor; vrt runs above it; unmounted volumes are skipped"
HEAVY_DISK_VOLUMES="$HEAVY_LOCK_DIR" HEAVY_DISK_FLOOR_GIB=999999999 \
  run_heavy node bash -c 'printf ran > "$1"' _ "$logdir/node"
[ -f "$logdir/node" ] || fail "disk floor: node did not run"
HEAVY_DISK_VOLUMES="$HEAVY_LOCK_DIR /nonexistent-heavy-lock-volume" HEAVY_DISK_FLOOR_GIB=0 \
  run_heavy vrt bash -c 'printf ran > "$1"' _ "$logdir/vrt-ok"
[ -f "$logdir/vrt-ok" ] || fail "disk floor: vrt did not run above the floor"
echo "disk floor pass ok"

echo "test: the floor is rechecked after the queue wait"
late_vol="$HEAVY_LOCK_DIR/late-volume"
run_heavy vrt bash -c 'printf hold > "$1"; sleep 3' _ "$logdir/late-holder" \
  >"$logdir/late-holder.out" 2>"$logdir/late-holder.err" &
holder=$!
track "$holder"
wait_for "$logdir/late-holder" hold || fail "recheck: holder did not start"
HEAVY_DISK_VOLUMES="$late_vol" HEAVY_DISK_FLOOR_GIB=999999999 \
  run_heavy vrt bash -c 'printf ran > "$1"' _ "$logdir/late" \
  >"$logdir/late.out" 2>"$logdir/late.err" &
late=$!
track "$late"
wait_for "$logdir/late.err" waiting || fail "recheck: waiter did not queue"
mkdir -p "$late_vol"
set +e
wait "$late"
st=$?
set -e
[ "$st" != 0 ] || fail "recheck: waiter ran below the floor"
[ ! -e "$logdir/late" ] || fail "recheck: waiter command started"
grep -q 'refusing class=vrt' "$logdir/late.err" || fail "recheck: no refusal"
wait "$holder" || fail "recheck: holder failed"
ls "$HEAVY_LOCK_DIR/vrt.q"/*.ticket >/dev/null 2>&1 && fail "recheck: ticket left behind"
echo "disk floor recheck ok"

echo "test: fresh lock dirs are 0700 and group/world-writable lock dirs are refused"
rm -rf "$HEAVY_LOCK_DIR"
fresh_dir="$HEAVY_LOCK_DIR/fresh"
HEAVY_LOCK_DIR="$fresh_dir" run_heavy node true
[ "$(heavy_dir_mode "$fresh_dir")" = "700" ] || fail "perms: fresh lock dir mode=$(heavy_dir_mode "$fresh_dir")"
[ "$(heavy_dir_mode "$fresh_dir/node.q")" = "700" ] || fail "perms: fresh queue dir mode=$(heavy_dir_mode "$fresh_dir/node.q")"

wide_dir="$HEAVY_LOCK_DIR/wide"
mkdir -p "$wide_dir"
chmod 777 "$wide_dir"
set +e
HEAVY_LOCK_DIR="$wide_dir" run_heavy node true 2>"$HEAVY_LOCK_DIR/wide.err"
st=$?
set -e
[ "$st" != 0 ] || fail "perms: 0777 lock dir was not refused"
grep -q "group- or world-writable" "$HEAVY_LOCK_DIR/wide.err" \
  || fail "perms: 0777 error message: $(cat "$HEAVY_LOCK_DIR/wide.err")"
echo "directory permissions ok"

echo "test: symlink lock directory, queue directory, lock files, and tickets are refused or safely removed"
sym_target="$HEAVY_LOCK_DIR/target"
mkdir -m 700 -p "$sym_target"
sym_lockdir="$HEAVY_LOCK_DIR/sym-lockdir"
ln -s "$sym_target" "$sym_lockdir"
set +e
HEAVY_LOCK_DIR="$sym_lockdir" run_heavy node true 2>"$HEAVY_LOCK_DIR/sym1.err"
st=$?
set -e
[ "$st" != 0 ] || fail "symlink lockdir: run_heavy succeeded"
grep -q "refusing symlink" "$HEAVY_LOCK_DIR/sym1.err" || fail "symlink lockdir: wrong error: $(cat "$HEAVY_LOCK_DIR/sym1.err")"

qsym_dir="$HEAVY_LOCK_DIR/qsym"
mkdir -m 700 -p "$qsym_dir"
ln -s "$sym_target" "$qsym_dir/node.q"
set +e
HEAVY_LOCK_DIR="$qsym_dir" run_heavy node true 2>"$HEAVY_LOCK_DIR/sym2.err"
st=$?
set -e
[ "$st" != 0 ] || fail "symlink qdir: run_heavy succeeded"

fsym_dir="$HEAVY_LOCK_DIR/fsym"
mkdir -m 700 -p "$fsym_dir"
victim="$HEAVY_LOCK_DIR/victim"
printf 'intact\n' > "$victim"
ln -s "$victim" "$fsym_dir/node.issue.lock"
set +e
HEAVY_LOCK_DIR="$fsym_dir" run_heavy node true 2>"$HEAVY_LOCK_DIR/sym3.err"
st=$?
set -e
[ "$st" != 0 ] || fail "symlink issue lockfile: run_heavy succeeded"
[ "$(cat "$victim")" = "intact" ] || fail "symlink issue lockfile clobbered victim"

rm -f "$fsym_dir/node.issue.lock"
ln -s "$victim" "$fsym_dir/node.1.lock"
set +e
HEAVY_LOCK_DIR="$fsym_dir" run_heavy node true 2>"$HEAVY_LOCK_DIR/sym4.err"
st=$?
set -e
[ "$st" != 0 ] || fail "symlink slot lockfile: run_heavy succeeded"
[ "$(cat "$victim")" = "intact" ] || fail "symlink slot lockfile clobbered victim"

if command -v python3 >/dev/null 2>&1; then
  set +e
  HEAVY_LOCK_BACKEND=python3 HEAVY_LOCK_DIR="$fsym_dir" run_heavy node true 2>"$HEAVY_LOCK_DIR/sym5.err"
  st=$?
  set -e
  [ "$st" != 0 ] || fail "python3 O_NOFOLLOW: run_heavy succeeded on symlink slot lockfile"
fi

# Symlink ticket inside queue dir must be unlinked without touching target.
tsym_dir="$HEAVY_LOCK_DIR/tsym"
mkdir -m 700 -p "$tsym_dir/node.q"
ticket_victim="$HEAVY_LOCK_DIR/ticket-victim"
printf 'untouched\n' > "$ticket_victim"
ln -s "$ticket_victim" "$tsym_dir/node.q/00000000000000000001.ticket"
HEAVY_LOCK_DIR="$tsym_dir" run_heavy node true
[ ! -L "$tsym_dir/node.q/00000000000000000001.ticket" ] || fail "symlink ticket was not removed"
[ "$(cat "$ticket_victim")" = "untouched" ] || fail "symlink ticket target was modified"
echo "symlink refusal ok"

echo "test: malformed ticket filenames, PIDs, and epochs cannot inject Bash arithmetic"
inj_dir="$HEAVY_LOCK_DIR/inj"
mkdir -m 700 -p "$inj_dir/node.q"
pwn_name="$inj_dir/pwn_name"
pwn_pid="$HEAVY_LOCK_DIR/pwn_pid"
pwn_epoch="$HEAVY_LOCK_DIR/pwn_epoch"
# Crafted filename (no slashes, valid POSIX filename) that would execute touch
# if expanded unvalidated in $((10#...)).
: > "$inj_dir/node.q/a[\$(touch pwn_name)].ticket"
# Crafted PID and epoch contents with a live PID for the epoch case.
printf 'a[$(touch %s)] 1700000000\n' "$pwn_pid" > "$inj_dir/node.q/00000000000000000001.ticket"
printf '%s a[$(touch %s)]\n' "$$" "$pwn_epoch" > "$inj_dir/node.q/00000000000000000002.ticket"
(cd "$inj_dir" && HEAVY_LOCK_DIR="$inj_dir" run_heavy node true)
[ ! -e "$pwn_name" ] || fail "arithmetic injection via ticket filename"
[ ! -e "$pwn_pid" ] || fail "arithmetic injection via ticket PID"
[ ! -e "$pwn_epoch" ] || fail "arithmetic injection via ticket epoch"
ls "$inj_dir/node.q"/*.ticket >/dev/null 2>&1 && fail "malformed tickets were not reaped"
echo "arithmetic injection immunity ok"

echo "test: wrapped command exiting 75 is returned once without retrying"
exit75_dir="$HEAVY_LOCK_DIR/exit75"
count75="$HEAVY_LOCK_DIR/count75"
: > "$count75"
set +e
HEAVY_LOCK_DIR="$exit75_dir" run_heavy node bash -c 'printf x >> "$1"; exit 75' _ "$count75"
st=$?
set -e
[ "$st" = 75 ] || fail "exit 75: expected 75, got $st"
[ "$(wc -c < "$count75" | tr -d ' ')" = "1" ] || fail "exit 75: command ran more than once"
ls "$exit75_dir/node.q"/*.ticket >/dev/null 2>&1 && fail "exit 75: ticket left behind"
echo "exit 75 ok"

echo "test: pre-start backend errors (EACCES and unknown backend) fail closed without looping"
eacces_dir="$HEAVY_LOCK_DIR/eacces"
mkdir -m 700 -p "$eacces_dir"
if [ "$(id -u)" -ne 0 ]; then
  : > "$eacces_dir/node.1.lock"
  chmod 000 "$eacces_dir/node.1.lock"
  set +e
  HEAVY_LOCK_DIR="$eacces_dir" run_heavy node true 2>"$HEAVY_LOCK_DIR/eacces.err"
  st=$?
  set -e
  chmod 600 "$eacces_dir/node.1.lock"
  [ "$st" != 0 ] || fail "EACCES: run_heavy succeeded on mode 000 slot lockfile"
  ls "$eacces_dir/node.q"/*.ticket >/dev/null 2>&1 && fail "EACCES: ticket left behind"
fi
set +e
HEAVY_LOCK_BACKEND=bogus HEAVY_LOCK_DIR="$eacces_dir" run_heavy node true 2>"$HEAVY_LOCK_DIR/bogus.err"
st=$?
set -e
[ "$st" != 0 ] || fail "unknown backend: run_heavy succeeded"
echo "backend error propagation ok"

echo "test: non-numeric HEAVY_DISK_FLOOR_GIB fails closed"
for bad_floor in abc -5 "10 GiB"; do
  set +e
  HEAVY_DISK_VOLUMES="$HEAVY_LOCK_DIR" HEAVY_DISK_FLOOR_GIB="$bad_floor" \
    run_heavy vrt bash -c 'printf ran > "$1"' _ "$HEAVY_LOCK_DIR/bad-floor" \
    2>"$HEAVY_LOCK_DIR/bad-floor.err"
  st=$?
  set -e
  [ "$st" != 0 ] || fail "bad floor ($bad_floor): run_heavy succeeded"
  [ ! -e "$HEAVY_LOCK_DIR/bad-floor" ] || fail "bad floor ($bad_floor): command ran"
  grep -q "non-negative integer" "$HEAVY_LOCK_DIR/bad-floor.err" \
    || fail "bad floor ($bad_floor): missing error: $(cat "$HEAVY_LOCK_DIR/bad-floor.err")"
done
echo "non-numeric disk floor refusal ok"

echo "ALL OK"

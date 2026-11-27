#!/usr/bin/env bash
# Proves queue tickets disappear on INT/TERM, active holders cancel promptly on
# direct SIGTERM, and dead PIDs cannot block the next waiter. Portable across
# Linux (flock) and macOS (python3 fcntl.flock).
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

reset_lock_dir() {
  rm -rf "$HEAVY_LOCK_DIR"
  (umask 077 && mkdir -p "$HEAVY_LOCK_DIR")
}

cleanup() {
  local p
  for p in $pids; do
    kill -9 -- "-$p" 2>/dev/null || true
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
  reset_lock_dir
  logdir="$HEAVY_LOCK_DIR/logs"
  (umask 077 && mkdir -p "$logdir")

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

# Active-holder direct-TERM regression: sending SIGTERM directly to the
# run_heavy shell PID (not its process group) must immediately cancel the
# active lock holder and payload subtree, remove its ticket, prevent the
# payload from completing, and release the slot for a queued waiter.
active_holder_direct_term() {
  local backend="$1"
  local logdir holder next payload_pid t0 t1 elapsed st deadline
  reset_lock_dir
  logdir="$HEAVY_LOCK_DIR/logs"
  (umask 077 && mkdir -p "$logdir")

  HEAVY_LOCK_BACKEND="$backend" HEAVY_LOCK_DIR="$HEAVY_LOCK_DIR" \
    bash -c '
      source "$1"
      run_heavy vrt bash -c '\''
        printf "%s\n" "$$" > "$1"
        printf hold > "$2"
        sleep 6
        printf completed > "$3"
      '\'' _ "$2" "$3" "$4"
    ' _ "$DIR/heavy-lock.sh" "$logdir/payload.pid" "$logdir/started" "$logdir/completed" \
    >"$logdir/holder.out" 2>"$logdir/holder.err" &
  holder=$!
  track "$holder"
  wait_for "$logdir/started" hold || fail "direct-TERM ($backend): holder did not start"
  payload_pid="$(tr -cd '0-9' < "$logdir/payload.pid")"
  [ -n "$payload_pid" ] || fail "direct-TERM ($backend): missing payload pid"

  HEAVY_LOCK_BACKEND="$backend" HEAVY_LOCK_DIR="$HEAVY_LOCK_DIR" \
    run_heavy vrt bash -c 'printf ran > "$1"' _ "$logdir/next" \
    >"$logdir/next.out" 2>"$logdir/next.err" &
  next=$!
  track "$next"
  wait_for "$logdir/next.err" waiting || fail "direct-TERM ($backend): waiter did not queue"

  # Signal ONLY the run_heavy shell PID, never its process group.
  t0=$(date +%s)
  kill -s TERM "$holder" || true
  set +e
  wait "$holder"
  st=$?
  set -e
  t1=$(date +%s)
  elapsed=$((t1 - t0))
  [ "$st" -eq 143 ] || fail "direct-TERM ($backend): expected exit 143, got $st"
  [ "$elapsed" -le 3 ] || fail "direct-TERM ($backend): holder took ${elapsed}s to exit (deferred trap)"

  deadline=$(( $(date +%s) + 2 ))
  while ! process_gone "$payload_pid"; do
    [ "$(date +%s)" -gt "$deadline" ] && fail "direct-TERM ($backend): payload $payload_pid still alive"
    sleep 0.1
  done
  [ ! -e "$logdir/completed" ] || fail "direct-TERM ($backend): payload wrote completion marker"

  deadline=$(( $(date +%s) + 3 ))
  while [ ! -f "$logdir/next" ]; do
    [ "$(date +%s)" -gt "$deadline" ] && fail "direct-TERM ($backend): next waiter did not acquire released slot"
    sleep 0.1
  done
  wait "$next" || fail "direct-TERM ($backend): next waiter failed"
  ls "$HEAVY_LOCK_DIR"/ran.* >/dev/null 2>&1 && fail "direct-TERM ($backend): ran.* marker left behind"
  echo "direct-TERM ($backend) ok"
}

echo "test: direct SIGTERM to active holder cancels payload and releases slot"
if command -v flock >/dev/null 2>&1; then
  active_holder_direct_term flock
fi
if command -v python3 >/dev/null 2>&1; then
  active_holder_direct_term python3
fi

pty_controlling_tty_test() {
  local backend="$1"
  local logdir
  reset_lock_dir
  logdir="$HEAVY_LOCK_DIR/logs"
  (umask 077 && mkdir -p "$logdir")

  HEAVY_LOCK_BACKEND="$backend" HEAVY_LOCK_DIR="$HEAVY_LOCK_DIR" \
    python3 - "$DIR/heavy-lock.sh" "$HEAVY_LOCK_DIR" "$logdir" "$backend" <<'PY'
import errno
import fcntl
import glob
import os
import pty
import select
import signal
import subprocess
import sys
import termios
import time

script, lock_dir, logdir, backend = sys.argv[1:5]

def spawn_in_pty(cmd):
    master, slave = pty.openpty()
    def make_ctty():
        os.setsid()
        fcntl.ioctl(slave, termios.TIOCSCTTY, 0)
    proc = subprocess.Popen(
        cmd,
        stdin=slave,
        stdout=slave,
        stderr=slave,
        close_fds=True,
        preexec_fn=make_ctty,
    )
    os.close(slave)
    return proc, master

def drain_available(fd):
    chunks = []
    while True:
        r, _, _ = select.select([fd], [], [], 0.02)
        if not r:
            break
        try:
            data = os.read(fd, 4096)
        except OSError as exc:
            if exc.errno in (errno.EIO, errno.EBADF):
                break
            raise
        if not data:
            break
        chunks.append(data)
    return b"".join(chunks)

def pid_gone(pid):
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return True
    except PermissionError:
        return False
    out = subprocess.run(
        ["ps", "-o", "stat=", "-p", str(pid)],
        capture_output=True,
        text=True,
        check=False,
    ).stdout.strip()
    return (not out) or out.startswith("Z")

# 1. stty tostop stderr/stdout write + TTY read must not stop on SIGTTOU/SIGTTIN.
proc, master = spawn_in_pty([
    "bash", "-c",
    """set -euo pipefail
stty tostop
source "$1"
run_heavy node bash -c 'IFS= read -r line; printf "PTY_GOT:%s\n" "$line"'
""",
    "_", script,
])
buf = bytearray()
sent = False
deadline = time.monotonic() + 5.0
try:
    while time.monotonic() < deadline:
        buf.extend(drain_available(master))
        if not sent and b"heavy-lock: hold" in buf:
            os.write(master, b"hello\n")
            sent = True
        if proc.poll() is not None:
            buf.extend(drain_available(master))
            break
        time.sleep(0.05)
    if proc.poll() is None:
        os.kill(proc.pid, signal.SIGKILL)
        proc.wait()
        raise SystemExit(
            f"PTY ({backend}) stty tostop/read hung (SIGTTOU/SIGTTIN?): {buf!r}"
        )
    if proc.returncode != 0 or b"PTY_GOT:hello" not in buf:
        raise SystemExit(
            f"PTY ({backend}) stty tostop/read failed rc={proc.returncode}: {buf!r}"
        )
finally:
    os.close(master)

# 2. Direct SIGTERM and SIGINT on a controlling PTY with stty tostop cancel
# promptly (<2s), kill payload, leave no completion marker or ran.* leak.
for sig, expected_codes, label in [
    (signal.SIGTERM, (-signal.SIGTERM, 143), "SIGTERM"),
    (signal.SIGINT, (-signal.SIGINT, 130), "SIGINT"),
]:
    pid_file = os.path.join(logdir, f"pty-{label}.pid")
    started_file = os.path.join(logdir, f"pty-{label}.started")
    done_file = os.path.join(logdir, f"pty-{label}.completed")
    for path in (pid_file, started_file, done_file):
        if os.path.exists(path):
            os.unlink(path)

    proc, master = spawn_in_pty([
        "bash", "-c",
        """set -euo pipefail
stty tostop
source "$1"
run_heavy vrt bash -c 'printf "%s\n" "$$" > "$1"; printf hold > "$2"; sleep 6; printf completed > "$3"' _ "$2" "$3" "$4"
""",
        "_", script, pid_file, started_file, done_file,
    ])
    try:
        wait_deadline = time.monotonic() + 5.0
        while time.monotonic() < wait_deadline:
            drain_available(master)
            if os.path.exists(started_file) and os.path.getsize(started_file) > 0:
                break
            if proc.poll() is not None:
                raise SystemExit(
                    f"PTY ({backend}) {label}: holder exited early rc={proc.returncode}"
                )
            time.sleep(0.05)
        else:
            os.kill(proc.pid, signal.SIGKILL)
            proc.wait()
            raise SystemExit(f"PTY ({backend}) {label}: holder did not start")

        payload_pid = int(open(pid_file).read().strip())
        t0 = time.monotonic()
        os.kill(proc.pid, sig)
        while time.monotonic() - t0 < 2.0:
            drain_available(master)
            if proc.poll() is not None:
                break
            time.sleep(0.05)
        elapsed = time.monotonic() - t0
        if proc.poll() is None:
            os.kill(proc.pid, signal.SIGKILL)
            proc.wait()
            raise SystemExit(
                f"PTY ({backend}) {label}: holder hung past 2s ({elapsed:.2f}s)"
            )
        if proc.returncode not in expected_codes:
            raise SystemExit(
                f"PTY ({backend}) {label}: expected rc in {expected_codes}, got {proc.returncode}"
            )
        if elapsed >= 2.0:
            raise SystemExit(f"PTY ({backend}) {label}: took {elapsed:.2f}s (>=2s)")

        kill_deadline = time.monotonic() + 2.0
        while not pid_gone(payload_pid):
            if time.monotonic() > kill_deadline:
                raise SystemExit(
                    f"PTY ({backend}) {label}: payload {payload_pid} still alive"
                )
            time.sleep(0.05)
        if os.path.exists(done_file):
            raise SystemExit(
                f"PTY ({backend}) {label}: payload wrote completion marker"
            )
        leaked = glob.glob(os.path.join(lock_dir, "ran.*"))
        if leaked:
            raise SystemExit(f"PTY ({backend}) {label}: leaked marker(s) {leaked}")
    finally:
        os.close(master)
PY
  echo "controlling-PTY ($backend) ok"
}

echo "test: controlling PTY with stty tostop, TTY read, and direct SIGTERM/SIGINT"
if command -v python3 >/dev/null 2>&1; then
  if command -v flock >/dev/null 2>&1; then
    pty_controlling_tty_test flock
  fi
  pty_controlling_tty_test python3
fi

echo "test: a SIGKILL ticket expires so the next gate proceeds"
reset_lock_dir
logdir="$HEAVY_LOCK_DIR/logs"
(umask 077 && mkdir -p "$logdir")
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
reset_lock_dir
logdir="$HEAVY_LOCK_DIR/logs"
(umask 077 && mkdir -p "$logdir")
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
reset_lock_dir
fresh_dir="$HEAVY_LOCK_DIR/fresh"
HEAVY_LOCK_DIR="$fresh_dir" run_heavy node true
[ "$(heavy_dir_mode "$fresh_dir")" = "700" ] || fail "perms: fresh lock dir mode=$(heavy_dir_mode "$fresh_dir")"
[ "$(heavy_dir_mode "$fresh_dir/node.q")" = "700" ] || fail "perms: fresh queue dir mode=$(heavy_dir_mode "$fresh_dir/node.q")"

for bad_mode in 775 777; do
  wide_dir="$HEAVY_LOCK_DIR/wide-${bad_mode}"
  mkdir -p "$wide_dir"
  chmod "$bad_mode" "$wide_dir"
  set +e
  HEAVY_LOCK_DIR="$wide_dir" run_heavy node true 2>"$HEAVY_LOCK_DIR/wide-${bad_mode}.err"
  st=$?
  set -e
  [ "$st" != 0 ] || fail "perms: 0${bad_mode} lock dir was not refused"
  grep -q "group- or world-writable" "$HEAVY_LOCK_DIR/wide-${bad_mode}.err" \
    || fail "perms: 0${bad_mode} error message: $(cat "$HEAVY_LOCK_DIR/wide-${bad_mode}.err")"
done
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
(umask 077 && mkdir -p "$tsym_dir/node.q")
ticket_victim="$HEAVY_LOCK_DIR/ticket-victim"
printf 'untouched\n' > "$ticket_victim"
ln -s "$ticket_victim" "$tsym_dir/node.q/00000000000000000001.ticket"
HEAVY_LOCK_DIR="$tsym_dir" run_heavy node true
[ ! -L "$tsym_dir/node.q/00000000000000000001.ticket" ] || fail "symlink ticket was not removed"
[ "$(cat "$ticket_victim")" = "untouched" ] || fail "symlink ticket target was modified"
echo "symlink refusal ok"

echo "test: malformed ticket filenames, PIDs, and epochs cannot inject Bash arithmetic"
inj_dir="$HEAVY_LOCK_DIR/inj"
(umask 077 && mkdir -p "$inj_dir/node.q")
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

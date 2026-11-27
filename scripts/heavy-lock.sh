#!/usr/bin/env bash
# Fair slots for pre-push work that used to share one heavy.lock.
#
# Each class has its own ticket queue. A process may run only when fewer than
# SLOTS older live tickets exist, then it holds one slot using a portable file
# lock (flock on Linux or Python fcntl.flock on macOS and Linux).
# Each scan drops a ticket whose PID is dead, a zombie, or reused.
# EXIT, INT, and TERM remove the current ticket immediately. SIGKILL cannot
# be caught; the next scan expires that ticket so it cannot block the queue.
#
#   vrt    1 slot   Playwright in Docker. Browsers and /dev/shm are what
#                   exhaust the Docker VM, so this stays exclusive.
#   cargo  2 slots  Rust clippy and tests, plus their Postgres or Neo4j.
#                   Those containers are small next to a 16GB Docker VM, and
#                   the compilers run on the host.
#   node   1 slot   Host typecheck and vitest. Separate from cargo and vrt,
#                   so a Shop typecheck does not wait behind either.
#
# Classes do not exclude each other. A VRT run and two cargo runs can overlap.
#
# Optional disk floor: when both HEAVY_DISK_VOLUMES is non-empty and
# HEAVY_DISK_FLOOR_GIB is greater than 0, vrt and cargo refuse to take a slot
# if a mounted volume has less than HEAVY_DISK_FLOOR_GIB free. Disabled by
# default. A volume that is not mounted is skipped. node is not checked.
#
# HEAVY_LOCK_DIR overrides the directory (defaults to a private 0700 per-UID
# path under XDG_RUNTIME_DIR, TMPDIR, or /tmp).

if [ -z "${HEAVY_LOCK_DIR:-}" ]; then
  _heavy_base="${XDG_RUNTIME_DIR:-${TMPDIR:-/tmp}}"
  _heavy_base="${_heavy_base%/}"
  [ -n "$_heavy_base" ] || _heavy_base="/"
  HEAVY_LOCK_DIR="${_heavy_base}/pubky-marketplace-locks-$(id -u)"
  unset _heavy_base
fi
HEAVY_DISK_FLOOR_GIB="${HEAVY_DISK_FLOOR_GIB:-0}"
HEAVY_DISK_VOLUMES="${HEAVY_DISK_VOLUMES:-}"

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  echo "source scripts/heavy-lock.sh" >&2
  exit 1
fi

heavy_slots() {
  case "$1" in
    vrt) echo 1 ;;
    cargo) echo 2 ;;
    node) echo 1 ;;
    *)
      echo "heavy-lock: unknown class: $1" >&2
      return 1
      ;;
  esac
}

heavy_dir_mode() {
  local dir="$1" m=""
  if m="$(stat -c '%a' "$dir" 2>/dev/null)" && [[ "$m" =~ ^[0-7]+$ ]]; then
    printf '%s\n' "$m"
    return 0
  fi
  if m="$(stat -f '%Lp' "$dir" 2>/dev/null)" && [[ "$m" =~ ^[0-7]+$ ]]; then
    printf '%s\n' "$m"
    return 0
  fi
  echo "heavy-lock: could not inspect permissions of $dir" >&2
  return 1
}

heavy_verify_dir() {
  local dir="$1" parent mode perm
  if [ -z "$dir" ] || [ -L "$dir" ]; then
    echo "heavy-lock: refusing symlink or empty lock directory: $dir" >&2
    return 1
  fi
  if [ ! -e "$dir" ]; then
    parent="$(dirname "$dir")"
    if [ ! -d "$parent" ]; then
      (umask 077 && mkdir -p "$parent") || return 1
    fi
    (umask 077 && mkdir -m 700 "$dir") 2>/dev/null || true
  fi
  if [ -L "$dir" ] || [ ! -d "$dir" ] || [ ! -O "$dir" ]; then
    echo "heavy-lock: refusing unsafe lock directory (must be user-owned directory, not symlink): $dir" >&2
    return 1
  fi
  mode="$(heavy_dir_mode "$dir")" || return 1
  if ! [[ "$mode" =~ ^[0-7]+$ ]]; then
    echo "heavy-lock: refusing lock directory with unreadable mode: $dir" >&2
    return 1
  fi
  perm=$((8#$mode))
  if [ $((perm & 8#0022)) -ne 0 ]; then
    echo "heavy-lock: refusing group- or world-writable lock directory (mode ${mode}): $dir" >&2
    return 1
  fi
}

heavy_check_lockfile() {
  local lockfile="$1"
  if [ -L "$lockfile" ]; then
    echo "heavy-lock: refusing symlink lockfile: $lockfile" >&2
    return 1
  fi
  if [ -e "$lockfile" ] && { [ ! -f "$lockfile" ] || [ ! -O "$lockfile" ]; }; then
    echo "heavy-lock: refusing unsafe lockfile: $lockfile" >&2
    return 1
  fi
}

heavy_with_lock() {
  local mode="$1" lockfile="$2" backend="${HEAVY_LOCK_BACKEND:-auto}"
  shift 2
  heavy_check_lockfile "$lockfile" || return 1
  if [ "$backend" = auto ]; then
    if command -v flock >/dev/null 2>&1; then
      backend=flock
    elif command -v python3 >/dev/null 2>&1; then
      backend=python3
    else
      echo "heavy-lock: need flock or python3 on PATH" >&2
      return 1
    fi
  fi
  case "$backend" in
    flock)
      if [ ! -e "$lockfile" ]; then
        (umask 077 && : >> "$lockfile") 2>/dev/null || true
      fi
      heavy_check_lockfile "$lockfile" || return 1
      if [ "$mode" = try ]; then
        flock -n -E 75 -- "$lockfile" "$@"
      else
        flock -- "$lockfile" "$@"
      fi
      ;;
    python3)
      python3 -c '
import fcntl, os, stat, sys
mode, lockfile = sys.argv[1], sys.argv[2]
cmd = sys.argv[3:]
oflags = os.O_CREAT | os.O_RDWR | getattr(os, "O_NOFOLLOW", 0)
fd = os.open(lockfile, oflags, 0o600)
st = os.fstat(fd)
if not stat.S_ISREG(st.st_mode) or st.st_uid != os.geteuid():
    os.close(fd)
    sys.exit(1)
flags = fcntl.LOCK_EX | (fcntl.LOCK_NB if mode == "try" else 0)
try:
    fcntl.flock(fd, flags)
except BlockingIOError:
    os.close(fd)
    sys.exit(75)
os.set_inheritable(fd, True)
os.execvp(cmd[0], cmd)
' "$mode" "$lockfile" "$@"
      ;;
    *)
      echo "heavy-lock: unknown lock backend: $backend" >&2
      return 1
      ;;
  esac
}

# 0 when every configured mounted volume has at least the floor free.
# Otherwise prints the refusal and returns 1.
heavy_disk_ok() {
  local class="$1" vol free_kib free_gib status=0
  case "$class" in
    vrt|cargo) ;;
    *) return 0 ;;
  esac
  if ! [[ "${HEAVY_DISK_FLOOR_GIB:-0}" =~ ^[0-9]+$ ]]; then
    echo "heavy-lock: HEAVY_DISK_FLOOR_GIB must be a non-negative integer (got '${HEAVY_DISK_FLOOR_GIB:-}')" >&2
    return 1
  fi
  if [ -z "$HEAVY_DISK_VOLUMES" ] || [ "$((10#${HEAVY_DISK_FLOOR_GIB:-0}))" -le 0 ]; then
    return 0
  fi
  for vol in $HEAVY_DISK_VOLUMES; do
    [ -d "$vol" ] || continue
    free_kib=$(df -Pk "$vol" 2>/dev/null | awk 'NR == 2 { print $4 }')
    [[ "$free_kib" =~ ^[0-9]+$ ]] || continue
    free_gib=$((free_kib / 1048576))
    if [ "$free_gib" -lt "$((10#${HEAVY_DISK_FLOOR_GIB:-0}))" ]; then
      echo "heavy-lock: refusing class=${class}: ${vol} has ${free_gib} GiB free, floor is ${HEAVY_DISK_FLOOR_GIB} GiB" >&2
      status=1
    fi
  done
  if [ "$status" -ne 0 ]; then
    echo "heavy-lock: free disk space or adjust HEAVY_DISK_FLOOR_GIB / HEAVY_DISK_VOLUMES" >&2
  fi
  return "$status"
}

etime_to_seconds() {
  local t="$1" days=0 n a b c
  t="${t#-}"
  if [[ "$t" == *-* ]]; then
    days="${t%%-*}"
    t="${t#*-}"
  fi
  [[ "$days" =~ ^[0-9]+$ ]] || return 1
  n=$(printf '%s\n' "$t" | awk -F: '{print NF}')
  IFS=: read -r a b c <<< "$t"
  a="${a:-0}"
  b="${b:-0}"
  c="${c:-0}"
  [[ "$a" =~ ^[0-9]+$ && "$b" =~ ^[0-9]+$ && "$c" =~ ^[0-9]+$ ]] || return 1
  a=$((10#$a))
  b=$((10#$b))
  c=$((10#$c))
  days=$((10#$days))
  if [ "$n" -le 1 ]; then
    echo "$a"
  elif [ "$n" -eq 2 ]; then
    echo $((days * 86400 + a * 60 + b))
  else
    echo $((days * 86400 + a * 3600 + b * 60 + c))
  fi
}

heavy_release() {
  local ticket="${HEAVY_TICKET:-}"
  local marker="${HEAVY_MARKER:-}"
  HEAVY_TICKET=""
  HEAVY_MARKER=""
  if [ -n "$ticket" ]; then
    rm -f "$ticket"
  fi
  if [ -n "$marker" ]; then
    rm -f "$marker"
  fi
}

heavy_pid_gone() {
  local pid="$1" state
  if ! [[ "$pid" =~ ^[0-9]+$ ]] || [ "$((10#$pid))" -le 0 ]; then
    return 0
  fi
  if ! kill -0 "$pid" 2>/dev/null; then
    return 0
  fi
  state=$(ps -o stat= -p "$pid" 2>/dev/null | tr -d '[:space:]' || true)
  case "$state" in
    Z*) return 0 ;;
  esac
  return 1
}

heavy_signal_tree() {
  local sig="$1" pid="$2" child
  if ! [[ "$pid" =~ ^[0-9]+$ ]] || [ "$((10#$pid))" -le 0 ]; then
    return 0
  fi
  for child in $(pgrep -P "$pid" 2>/dev/null || true); do
    heavy_signal_tree "$sig" "$child"
  done
  kill -s "$sig" "$pid" 2>/dev/null || true
}

# Installed only while this shell owns a ticket. Previous handlers are put
# back when the command returns. A signal re-raises itself so the exit status
# stays the signal.
heavy_finish_exit() {
  local status=$?
  heavy_release
  trap - EXIT
  if [ -n "${HEAVY_SAVED_EXIT:-}" ]; then
    eval "$HEAVY_SAVED_EXIT"
  fi
  exit "$status"
}

heavy_finish_signal() {
  local sig="$1" child_sig child self holder_pid marker i
  self="${HEAVY_SELF:-$$}"
  holder_pid="${HEAVY_HOLDER_PID:-}"
  marker="${HEAVY_MARKER:-}"
  HEAVY_HOLDER_PID=""
  child_sig="$sig"
  if [ "$child_sig" = INT ]; then
    # POSIX async children forked without monitor mode ignore SIGINT; send
    # SIGTERM to cancel them while still re-raising SIGINT on this shell.
    child_sig=TERM
  fi
  heavy_release
  if [ -n "$holder_pid" ]; then
    heavy_signal_tree "$child_sig" "$holder_pid"
    for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
      if heavy_pid_gone "$holder_pid"; then
        break
      fi
      sleep 0.05
      if [ "$i" -eq 4 ] || [ "$i" -eq 10 ]; then
        heavy_signal_tree "$child_sig" "$holder_pid"
      fi
    done
    if heavy_pid_gone "$holder_pid"; then
      wait "$holder_pid" 2>/dev/null || true
    fi
    if [ -n "$marker" ]; then
      rm -f "$marker"
    fi
  fi
  for child in $(pgrep -P "$self" 2>/dev/null || true); do
    heavy_signal_tree "$child_sig" "$child"
  done
  trap - EXIT INT TERM
  if [[ "$self" =~ ^[0-9]+$ ]] && [ "$((10#$self))" -gt 0 ]; then
    kill -s "$sig" "$self"
  fi
}

heavy_arm_traps() {
  # Bash 4+ reports the parent shell's traps from `trap -p` inside a subshell
  # even though subshells reset traps on fork. Only save and restore traps at
  # the top-level shell so a backgrounded `run_heavy ... &` cannot re-arm and
  # fire the caller's EXIT/signal traps.
  if [ "${BASH_SUBSHELL:-0}" -eq 0 ]; then
    HEAVY_SAVED_EXIT=$(trap -p EXIT || true)
    HEAVY_SAVED_INT=$(trap -p INT || true)
    HEAVY_SAVED_TERM=$(trap -p TERM || true)
  else
    HEAVY_SAVED_EXIT=""
    HEAVY_SAVED_INT=""
    HEAVY_SAVED_TERM=""
  fi
  trap 'heavy_finish_exit' EXIT
  trap 'heavy_finish_signal INT' INT
  trap 'heavy_finish_signal TERM' TERM
}

heavy_disarm_traps() {
  trap - EXIT INT TERM
  if [ -n "${HEAVY_SAVED_EXIT:-}" ]; then
    eval "$HEAVY_SAVED_EXIT"
  fi
  if [ -n "${HEAVY_SAVED_INT:-}" ]; then
    eval "$HEAVY_SAVED_INT"
  fi
  if [ -n "${HEAVY_SAVED_TERM:-}" ]; then
    eval "$HEAVY_SAVED_TERM"
  fi
  HEAVY_SAVED_EXIT=""
  HEAVY_SAVED_INT=""
  HEAVY_SAVED_TERM=""
}

heavy_issue() {
  local class="$1"
  local self_pid="$2"
  local qdir="$HEAVY_LOCK_DIR/${class}.q"
  local seqfile="$HEAVY_LOCK_DIR/${class}.seq"
  local issue="$HEAVY_LOCK_DIR/${class}.issue.lock"
  if ! [[ "$self_pid" =~ ^[0-9]+$ ]] || [ "$((10#$self_pid))" -le 0 ]; then
    echo "heavy-lock: invalid pid: $self_pid" >&2
    return 1
  fi
  heavy_verify_dir "$HEAVY_LOCK_DIR" || return 1
  heavy_verify_dir "$qdir" || return 1
  if [ -L "$seqfile" ]; then
    echo "heavy-lock: refusing symlink sequence file: $seqfile" >&2
    return 1
  fi
  heavy_with_lock block "$issue" bash -c '
    set -euo pipefail
    umask 077
    seqfile="$1"
    qdir="$2"
    pid="$3"
    if [ -L "$seqfile" ]; then
      echo "heavy-lock: refusing symlink sequence file: $seqfile" >&2
      exit 1
    fi
    n=0
    if [ -f "$seqfile" ]; then
      n=$(tr -cd "0-9" < "$seqfile" || true)
    fi
    if ! [[ "$n" =~ ^[0-9]+$ ]]; then
      n=0
    fi
    n=$((10#$n + 1))
    tmp=$(mktemp "${seqfile}.XXXXXX")
    printf "%s\n" "$n" > "$tmp"
    mv -f "$tmp" "$seqfile"
    name=$(printf "%020d" "$n")
    ttmp=$(mktemp "${qdir}/.ticket.XXXXXX")
    printf "%s %s\n" "$pid" "$(date +%s)" > "$ttmp"
    mv -f "$ttmp" "$qdir/${name}.ticket"
    printf "%s\n" "$n"
  ' _ "$seqfile" "$qdir" "$self_pid"
}

# 0 when the ticket must be removed: empty/malformed PID, dead PID, zombie,
# malformed epoch, or a reused PID whose process started after the ticket was
# written.
heavy_pid_dead() {
  local pid="$1" epoch="$2" state etime es now age
  if ! [[ "$pid" =~ ^[0-9]+$ ]] || [ "$((10#$pid))" -le 0 ]; then
    return 0
  fi
  if ! kill -0 "$pid" 2>/dev/null; then
    return 0
  fi
  state=$(ps -o stat= -p "$pid" 2>/dev/null | tr -d '[:space:]' || true)
  case "$state" in
    Z*) return 0 ;;
  esac
  if [ -z "$epoch" ]; then
    return 1
  fi
  if ! [[ "$epoch" =~ ^[0-9]+$ ]]; then
    return 0
  fi
  etime=$(ps -o etime= -p "$pid" 2>/dev/null | tr -d '[:space:]' || true)
  if [ -z "$etime" ]; then
    return 1
  fi
  es=$(etime_to_seconds "$etime") || return 1
  [[ "$es" =~ ^[0-9]+$ ]] || return 1
  now=$(date +%s)
  [[ "$now" =~ ^[0-9]+$ ]] || return 1
  age=$((10#$now - 10#$epoch))
  if [ "$age" -gt 3 ] && [ "$es" -lt $((age - 3)) ]; then
    return 0
  fi
  return 1
}

heavy_sweep() {
  local class="$1"
  local dir="$HEAVY_LOCK_DIR/${class}.q"
  local f base stem pid epoch
  [ -d "$dir" ] && [ ! -L "$dir" ] || return 0
  for f in "$dir"/*.ticket; do
    [ -e "$f" ] || [ -L "$f" ] || continue
    if [ -L "$f" ]; then
      rm -f "$f"
      continue
    fi
    base=$(basename "$f")
    stem="${base%.ticket}"
    if ! [[ "$stem" =~ ^[0-9]+$ ]] || [ ! -f "$f" ] || [ ! -O "$f" ]; then
      rm -f "$f"
      continue
    fi
    pid=""
    epoch=""
    read -r pid epoch _ < "$f" || true
    if heavy_pid_dead "$pid" "$epoch"; then
      rm -f "$f"
    fi
  done
}

heavy_ahead() {
  local class="$1" myseq="$2"
  local dir="$HEAVY_LOCK_DIR/${class}.q"
  local ahead=0 f base stem seq
  if ! [[ "$myseq" =~ ^[0-9]+$ ]]; then
    echo "heavy-lock: invalid sequence number: $myseq" >&2
    return 1
  fi
  heavy_sweep "$class"
  [ -d "$dir" ] && [ ! -L "$dir" ] || { echo 0; return 0; }
  for f in "$dir"/*.ticket; do
    [ -f "$f" ] && [ ! -L "$f" ] || continue
    base=$(basename "$f")
    stem="${base%.ticket}"
    [[ "$stem" =~ ^[0-9]+$ ]] || continue
    seq=$((10#$stem))
    if [ "$seq" -lt "$((10#$myseq))" ]; then
      ahead=$((ahead + 1))
    fi
  done
  echo "$ahead"
}

# Run the command inside one slot. Sets HEAVY_SLOT_RAN=1 when the wrapped
# command actually started so run_heavy returns its exact exit status
# (including 75) without retrying. When HEAVY_SLOT_RAN=0, returns 75 only on
# lock contention and propagates non-75 pre-start backend errors (e.g. EACCES,
# ELOOP) so run_heavy fails closed instead of retrying indefinitely.
heavy_run_in_slot() {
  local slotfile="$1"
  local marker hold_msg slot_status=0 had_m=0 holder_pid
  shift
  hold_msg="$1"
  shift
  HEAVY_SLOT_RAN=0
  heavy_check_lockfile "$slotfile" || return 1
  marker=$(umask 077 && mktemp "${HEAVY_LOCK_DIR}/ran.XXXXXX")
  : > "$marker"
  HEAVY_MARKER="$marker"
  # Keep the async lock holder in the caller's foreground process group
  # (temporarily disabling monitor mode across the fork and passing <&0) so
  # controlling TTYs with `stty tostop` or TTY reads never stop on
  # SIGTTOU/SIGTTIN, while `wait` remains interruptible on SIGTERM/SIGINT.
  case "$-" in
    *m*)
      had_m=1
      set +m 2>/dev/null || true
      ;;
  esac
  heavy_with_lock try "$slotfile" bash -c '
    printf 1 > "$1"
    shift
    printf "%s\n" "$1" >&2
    shift
    "$@"
  ' _ "$marker" "$hold_msg" "$@" <&0 &
  holder_pid=$!
  if [ "$had_m" = 1 ]; then
    set -m 2>/dev/null || true
  fi
  HEAVY_HOLDER_PID="$holder_pid"
  # `||` keeps a non-zero status under set -e. A bare assignment from $? after
  # `if` is wrong on bash 3.2: a failed if with no else reports status 0.
  wait "$holder_pid" || slot_status=$?
  HEAVY_HOLDER_PID=""
  if [ -s "$marker" ]; then
    HEAVY_SLOT_RAN=1
    rm -f "$marker"
    HEAVY_MARKER=""
    return "$slot_status"
  fi
  rm -f "$marker"
  HEAVY_MARKER=""
  if [ "$slot_status" -eq 75 ]; then
    return 75
  fi
  if [ "$slot_status" -eq 0 ]; then
    return 1
  fi
  return "$slot_status"
}

run_heavy() {
  local class="$1"
  shift
  local slots seq ahead last i st
  local self_pid pidfile
  slots=$(heavy_slots "$class") || return 1
  heavy_disk_ok "$class" || return 1
  heavy_verify_dir "$HEAVY_LOCK_DIR" || return 1
  # heavy_issue runs inside a command substitution, and that subshell exits
  # as soon as the ticket number is printed. Record this shell, not that
  # subshell. $$ is the outermost shell even inside a background job, and
  # bash 3.2 has no BASHPID, so a direct child reports this process.
  pidfile="$(umask 077 && mktemp "${HEAVY_LOCK_DIR}/self.XXXXXX")"
  sh -c 'echo $PPID' > "$pidfile"
  self_pid="$(tr -cd '0-9' < "$pidfile")"
  rm -f "$pidfile"
  if ! [[ "$self_pid" =~ ^[0-9]+$ ]] || [ "$((10#$self_pid))" -le 0 ]; then
    echo "heavy-lock: could not read own pid" >&2
    return 1
  fi
  HEAVY_SELF=$self_pid
  seq=$(heavy_issue "$class" "$self_pid") || return 1
  if ! [[ "$seq" =~ ^[0-9]+$ ]]; then
    echo "heavy-lock: could not take a ${class} ticket" >&2
    return 1
  fi
  HEAVY_TICKET="$HEAVY_LOCK_DIR/${class}.q/$(printf '%020d' "$seq").ticket"
  heavy_arm_traps
  last=""
  while true; do
    ahead=$(heavy_ahead "$class" "$seq") || {
      heavy_release
      heavy_disarm_traps
      return 1
    }
    if [ "$ahead" -lt "$slots" ]; then
      break
    fi
    if [ "$ahead" != "$last" ]; then
      echo "heavy-lock: waiting class=${class} ticket=${seq} ahead=${ahead} slots=${slots}" >&2
      last=$ahead
    fi
    sleep 0.25
  done
  # The wait can be long; recheck just before the slot is taken.
  if ! heavy_disk_ok "$class"; then
    heavy_release
    heavy_disarm_traps
    return 1
  fi
  while true; do
    i=1
    while [ "$i" -le "$slots" ]; do
      st=0
      HEAVY_SLOT_RAN=0
      heavy_run_in_slot "$HEAVY_LOCK_DIR/${class}.${i}.lock" \
        "heavy-lock: hold class=${class} slot=${i} ticket=${seq}" \
        "$@" || st=$?
      if [ "$HEAVY_SLOT_RAN" -eq 1 ]; then
        heavy_release
        heavy_disarm_traps
        return "$st"
      fi
      if [ "$st" -ne 75 ]; then
        heavy_release
        heavy_disarm_traps
        return "$st"
      fi
      i=$((i + 1))
    done
    sleep 0.2
  done
}

#!/bin/sh
# Hello world in Python, Rust and Go inside the runner image, with the
# container executor's hardening (SPEC §6.5, D-31): no network, read-only
# root, uid 65534, no capabilities, an exec tmpfs /build.
#   runner-image/smoke.sh <image>
set -eu
image=${1:?usage: smoke.sh <image>}
runtime=${RUNTIME:-docker}

run() {
  "$runtime" run --rm --network none --read-only --cap-drop ALL \
    --security-opt no-new-privileges --user 65534:65534 --pids-limit 128 \
    --memory 512m --memory-swap 512m --cpus 1 --pull never \
    --tmpfs /tmp:rw,noexec,size=64m --tmpfs /build:rw,exec,size=256m,mode=1777 \
    --workdir /build --env HOME=/build --env CARGO_HOME=/build/cargo \
    --env GOCACHE=/build/gocache --env GOPATH=/build/gopath \
    "$image" sh -c "$1"
}

check() {
  name=$1
  out=$(run "$2")
  if [ "$out" = "hello, $name" ]; then
    echo "ok   $name"
  else
    echo "FAIL $name: got: $out" >&2
    exit 1
  fi
}

"$runtime" image inspect "$image" --format 'image {{.Os}}/{{.Architecture}} user={{.Config.User}}'

check python 'python3 -c "print(\"hello, python\")"'

check rust 'mkdir -p hello/src && cd hello &&
printf "[package]\nname = \"hello\"\nversion = \"0.1.0\"\nedition = \"2021\"\n" > Cargo.toml &&
printf "fn main() { println!(\"hello, rust\"); }\n" > src/main.rs &&
cargo build --quiet --offline --release && ./target/release/hello'

check go 'mkdir hello && cd hello && printf "module hello\n\ngo 1.22\n" > go.mod &&
printf "package main\n\nimport \"fmt\"\n\nfunc main() { fmt.Println(\"hello, go\") }\n" > main.go &&
go build -o hello . && ./hello'

# The root filesystem is read-only and the user cannot write outside /build.
run 'if touch /usr/local/x 2>/dev/null; then echo writable; exit 1; fi; test "$(id -u)" = 65534'
echo "ok   read-only root, uid 65534"

# The runner image (T19, SPEC §6.5, D-34):
#   ghcr.io/hqazi/algorithm-tutor-runner:<app version>
# Python, Rust and Go for the container executor (D-31). Contract: `python3`,
# `cargo`, `go`, `sh`, `cp`, `sleep` and `kill` on PATH, usable by uid 65534
# with a read-only root filesystem and no network. The harnesses have no
# dependencies (D-29), so nothing is pre-fetched.
#
# Toolchains are pinned by the base images' tags and index digests (both
# multi-arch: linux/amd64 and linux/arm64). Change all three together and
# record the new versions in DECISIONS.md.
ARG RUST_IMAGE=rust:1.100.0-slim-trixie@sha256:6f14b2b4b278ec0d50aa1d69541c304ce0f95e0f6268487aa9924af1c2e9aebe
ARG GO_IMAGE=golang:1.27.4-trixie@sha256:f18c3d73a184fb0582828510722e723b63a93f7188d11dd223d9be6f6880e65d

FROM ${GO_IMAGE} AS go

FROM ${RUST_IMAGE}
# Python 3.13 from Debian trixie (the patch level follows Debian's updates).
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3-minimal \
 && rm -rf /var/lib/apt/lists/* /usr/share/doc/* /usr/share/man/* \
 && rm -rf /usr/local/rustup/toolchains/*/share/doc
COPY --from=go /usr/local/go /usr/local/go
RUN rm -rf /usr/local/go/test /usr/local/go/doc /usr/local/go/api

ENV PATH=/usr/local/cargo/bin:/usr/local/go/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    RUSTUP_HOME=/usr/local/rustup \
    GOTOOLCHAIN=local \
    GOPROXY=off \
    GOFLAGS=-buildvcs=false \
    CGO_ENABLED=0 \
    CARGO_TERM_COLOR=never \
    PYTHONDONTWRITEBYTECODE=1 \
    HOME=/tmp

# Fails the build if a toolchain is missing.
RUN python3 --version && cargo --version && rustc --version && go version

LABEL org.opencontainers.image.source="https://github.com/hqazi/algo" \
      org.opencontainers.image.description="Algorithm Tutor runner: Python, Rust and Go for the container sandbox" \
      org.opencontainers.image.licenses="Apache-2.0"

USER 65534:65534
WORKDIR /tmp
CMD ["sh"]

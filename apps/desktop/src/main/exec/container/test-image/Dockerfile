# A stand-in for the runner image (T19) for the container executor's tests:
# `cargo`, `go` and a POSIX shell on PATH. Not published anywhere.
FROM golang:1.24-bookworm AS go
FROM rust:1-slim-bookworm
COPY --from=go /usr/local/go /usr/local/go
ENV PATH=/usr/local/cargo/bin:/usr/local/go/bin:$PATH

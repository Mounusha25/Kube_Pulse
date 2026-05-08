# ---- Build Stage ----
FROM golang:1.22-alpine AS builder

WORKDIR /app
COPY go.mod ./
RUN go mod download
COPY main.go ./
RUN CGO_ENABLED=0 GOOS=linux go build -o kubeguard-exporter .

# ---- Runtime Stage ----
FROM scratch
COPY --from=builder /app/kubeguard-exporter /kubeguard-exporter
EXPOSE 8080
ENTRYPOINT ["/kubeguard-exporter"]

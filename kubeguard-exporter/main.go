package main

import (
	"encoding/json"
	"log"
	"net/http"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// MetricPayload is the JSON body sent by the Node.js agent
type MetricPayload struct {
	PodName         string  `json:"podName"`
	PredictedMemory float64 `json:"predictedMemory"`
	IsAnomaly       int     `json:"isAnomaly"`
}

var (
	predictedMemoryGauge = prometheus.NewGaugeVec(
		prometheus.GaugeOpts{
			Name: "kubeguard_predicted_memory_ratio",
			Help: "LSTM-predicted memory usage ratio (0-1) relative to pod memory limit",
		},
		[]string{"pod"},
	)

	anomalyGauge = prometheus.NewGaugeVec(
		prometheus.GaugeOpts{
			Name: "kubeguard_anomaly_detected",
			Help: "1 if an anomaly was detected for the pod, 0 otherwise",
		},
		[]string{"pod"},
	)

	totalAnomaliesCounter = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "kubeguard_anomalies_total",
			Help: "Total number of anomalies detected per pod since exporter start",
		},
		[]string{"pod"},
	)
)

func init() {
	prometheus.MustRegister(predictedMemoryGauge)
	prometheus.MustRegister(anomalyGauge)
	prometheus.MustRegister(totalAnomaliesCounter)
}

func metricsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "only POST allowed", http.StatusMethodNotAllowed)
		return
	}

	var payload MetricPayload
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, "invalid JSON payload", http.StatusBadRequest)
		return
	}

	predictedMemoryGauge.WithLabelValues(payload.PodName).Set(payload.PredictedMemory)
	anomalyGauge.WithLabelValues(payload.PodName).Set(float64(payload.IsAnomaly))

	if payload.IsAnomaly == 1 {
		totalAnomaliesCounter.WithLabelValues(payload.PodName).Inc()
	}

	log.Printf("[KubeGuard Exporter] pod=%s predicted=%.4f anomaly=%d",
		payload.PodName, payload.PredictedMemory, payload.IsAnomaly)

	w.WriteHeader(http.StatusOK)
}

func main() {
	http.HandleFunc("/report", metricsHandler)
	http.Handle("/metrics", promhttp.Handler())

	http.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	log.Println("[KubeGuard Exporter] Listening on :8080")
	log.Println("[KubeGuard Exporter]   POST /report  — receive metrics from agent")
	log.Println("[KubeGuard Exporter]   GET  /metrics — Prometheus scrape endpoint")

	if err := http.ListenAndServe(":8080", nil); err != nil {
		log.Fatalf("server failed: %v", err)
	}
}

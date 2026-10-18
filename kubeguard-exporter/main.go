package main

import (
	"encoding/json"
	"log"
	"math"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// MetricPayload is the JSON body sent by the Node.js agent
type MetricPayload struct {
	Namespace             string  `json:"namespace"`
	PodName               string  `json:"podName"`
	PredictedMemory       float64 `json:"predictedMemory"`
	IsAnomaly             int     `json:"isAnomaly"`
	DriftReady            int     `json:"driftReady"`
	InputDriftPSI         float64 `json:"inputDriftPsi"`
	PredictionDriftPSI    float64 `json:"predictionDriftPsi"`
	DriftDetected         int     `json:"driftDetected"`
	RetrainingRecommended int     `json:"retrainingRecommended"`
	DriftWindowSamples    int     `json:"driftWindowSamples"`
}

var (
	lastSeenMu sync.Mutex
	lastSeen   = map[seriesKey]time.Time{}

	predictedMemoryGauge = prometheus.NewGaugeVec(
		prometheus.GaugeOpts{
			Name: "kubeguard_predicted_memory_ratio",
			Help: "LSTM-predicted memory usage ratio (0-1) relative to pod memory limit",
		},
		[]string{"namespace", "pod"},
	)

	anomalyGauge = prometheus.NewGaugeVec(
		prometheus.GaugeOpts{
			Name: "kubeguard_anomaly_detected",
			Help: "1 if an anomaly was detected for the pod, 0 otherwise",
		},
		[]string{"namespace", "pod"},
	)

	totalAnomaliesCounter = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "kubeguard_anomalies_total",
			Help: "Total number of anomalies detected per pod since exporter start",
		},
		[]string{"namespace", "pod"},
	)

	driftReadyGauge = prometheus.NewGaugeVec(
		prometheus.GaugeOpts{Name: "kubeguard_drift_ready", Help: "1 when enough live samples exist to evaluate model drift"},
		[]string{"namespace", "pod"},
	)
	inputDriftGauge = prometheus.NewGaugeVec(
		prometheus.GaugeOpts{Name: "kubeguard_input_drift_psi", Help: "Population Stability Index for normalized pod memory input"},
		[]string{"namespace", "pod"},
	)
	predictionDriftGauge = prometheus.NewGaugeVec(
		prometheus.GaugeOpts{Name: "kubeguard_prediction_drift_psi", Help: "Population Stability Index for predicted memory ratio"},
		[]string{"namespace", "pod"},
	)
	driftDetectedGauge = prometheus.NewGaugeVec(
		prometheus.GaugeOpts{Name: "kubeguard_drift_detected", Help: "1 when sustained input or prediction drift is detected"},
		[]string{"namespace", "pod"},
	)
	retrainingRecommendedGauge = prometheus.NewGaugeVec(
		prometheus.GaugeOpts{Name: "kubeguard_retraining_recommended", Help: "1 when drift warrants a human-approved retraining review"},
		[]string{"namespace", "pod"},
	)
	driftWindowSamplesGauge = prometheus.NewGaugeVec(
		prometheus.GaugeOpts{Name: "kubeguard_drift_window_samples", Help: "Number of live input and prediction pairs in the drift window"},
		[]string{"namespace", "pod"},
	)
)

type seriesKey struct {
	namespace string
	pod       string
}

func markSeen(namespace, pod string, now time.Time) {
	lastSeenMu.Lock()
	defer lastSeenMu.Unlock()
	lastSeen[seriesKey{namespace: namespace, pod: pod}] = now
}

func cleanupStale(now time.Time, staleAfter time.Duration) int {
	lastSeenMu.Lock()
	defer lastSeenMu.Unlock()
	removed := 0
	for key, seenAt := range lastSeen {
		if now.Sub(seenAt) < staleAfter {
			continue
		}
		labels := []string{key.namespace, key.pod}
		predictedMemoryGauge.DeleteLabelValues(labels...)
		anomalyGauge.DeleteLabelValues(labels...)
		totalAnomaliesCounter.DeleteLabelValues(labels...)
		driftReadyGauge.DeleteLabelValues(labels...)
		inputDriftGauge.DeleteLabelValues(labels...)
		predictionDriftGauge.DeleteLabelValues(labels...)
		driftDetectedGauge.DeleteLabelValues(labels...)
		retrainingRecommendedGauge.DeleteLabelValues(labels...)
		driftWindowSamplesGauge.DeleteLabelValues(labels...)
		delete(lastSeen, key)
		removed++
	}
	return removed
}

func init() {
	prometheus.MustRegister(predictedMemoryGauge)
	prometheus.MustRegister(anomalyGauge)
	prometheus.MustRegister(totalAnomaliesCounter)
	prometheus.MustRegister(driftReadyGauge)
	prometheus.MustRegister(inputDriftGauge)
	prometheus.MustRegister(predictionDriftGauge)
	prometheus.MustRegister(driftDetectedGauge)
	prometheus.MustRegister(retrainingRecommendedGauge)
	prometheus.MustRegister(driftWindowSamplesGauge)
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

	if payload.Namespace == "" {
		payload.Namespace = "default"
	}
	if payload.PodName == "" || math.IsNaN(payload.PredictedMemory) || math.IsInf(payload.PredictedMemory, 0) {
		http.Error(w, "podName and finite predictedMemory are required", http.StatusBadRequest)
		return
	}
	predictedMemoryGauge.WithLabelValues(payload.Namespace, payload.PodName).Set(payload.PredictedMemory)
	anomalyGauge.WithLabelValues(payload.Namespace, payload.PodName).Set(float64(payload.IsAnomaly))
	driftReadyGauge.WithLabelValues(payload.Namespace, payload.PodName).Set(float64(payload.DriftReady))
	inputDriftGauge.WithLabelValues(payload.Namespace, payload.PodName).Set(payload.InputDriftPSI)
	predictionDriftGauge.WithLabelValues(payload.Namespace, payload.PodName).Set(payload.PredictionDriftPSI)
	driftDetectedGauge.WithLabelValues(payload.Namespace, payload.PodName).Set(float64(payload.DriftDetected))
	retrainingRecommendedGauge.WithLabelValues(payload.Namespace, payload.PodName).Set(float64(payload.RetrainingRecommended))
	driftWindowSamplesGauge.WithLabelValues(payload.Namespace, payload.PodName).Set(float64(payload.DriftWindowSamples))
	markSeen(payload.Namespace, payload.PodName, time.Now())

	if payload.IsAnomaly == 1 {
		totalAnomaliesCounter.WithLabelValues(payload.Namespace, payload.PodName).Inc()
	}

	log.Printf("[KubeGuard Exporter] pod=%s predicted=%.4f anomaly=%d",
		payload.PodName, payload.PredictedMemory, payload.IsAnomaly)

	w.WriteHeader(http.StatusOK)
}

func main() {
	staleAfter := 5 * time.Minute
	if raw := os.Getenv("KUBEGUARD_STALE_AFTER"); raw != "" {
		parsed, err := time.ParseDuration(raw)
		if err != nil || parsed <= 0 {
			log.Fatalf("invalid KUBEGUARD_STALE_AFTER: %q", raw)
		}
		staleAfter = parsed
	}
	go func() {
		ticker := time.NewTicker(time.Minute)
		defer ticker.Stop()
		for now := range ticker.C {
			if removed := cleanupStale(now, staleAfter); removed > 0 {
				log.Printf("[KubeGuard Exporter] removed %d stale pod metric series", removed)
			}
		}
	}()

	http.HandleFunc("/report", metricsHandler)
	http.Handle("/metrics", promhttp.Handler())

	http.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	log.Println("[KubeGuard Exporter] Listening on :8080")
	log.Println("[KubeGuard Exporter]   POST /report  — receive metrics from agent")
	log.Println("[KubeGuard Exporter]   GET  /metrics — Prometheus scrape endpoint")
	log.Printf("[KubeGuard Exporter]   stale series expire after %s", staleAfter)

	if err := http.ListenAndServe(":8080", nil); err != nil {
		log.Fatalf("server failed: %v", err)
	}
}

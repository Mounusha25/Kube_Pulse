package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestMetricsHandlerAcceptsDriftPayload(t *testing.T) {
	body := `{"namespace":"shop","podName":"api-1","predictedMemory":0.72,"isAnomaly":0,"driftReady":1,"inputDriftPsi":0.24,"predictionDriftPsi":0.18,"driftDetected":1,"retrainingRecommended":1,"driftWindowSamples":120}`
	request := httptest.NewRequest(http.MethodPost, "/report", strings.NewReader(body))
	response := httptest.NewRecorder()
	metricsHandler(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", response.Code, response.Body.String())
	}
}

func TestCleanupStaleRemovesOnlyExpiredSeries(t *testing.T) {
	lastSeenMu.Lock()
	lastSeen = map[seriesKey]time.Time{}
	lastSeenMu.Unlock()
	now := time.Date(2026, 10, 18, 9, 0, 0, 0, time.UTC)
	markSeen("shop", "old", now.Add(-10*time.Minute))
	markSeen("shop", "current", now.Add(-time.Minute))
	if removed := cleanupStale(now, 5*time.Minute); removed != 1 {
		t.Fatalf("expected one stale series removed, got %d", removed)
	}
	lastSeenMu.Lock()
	defer lastSeenMu.Unlock()
	if _, exists := lastSeen[seriesKey{namespace: "shop", pod: "old"}]; exists {
		t.Fatal("old series was not removed")
	}
	if _, exists := lastSeen[seriesKey{namespace: "shop", pod: "current"}]; !exists {
		t.Fatal("current series was removed")
	}
}

func TestMetricsHandlerRejectsMissingPod(t *testing.T) {
	request := httptest.NewRequest(http.MethodPost, "/report", strings.NewReader(`{"predictedMemory":0.4}`))
	response := httptest.NewRecorder()
	metricsHandler(response, request)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", response.Code)
	}
}

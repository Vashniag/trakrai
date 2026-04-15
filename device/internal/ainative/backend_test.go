package ainative

import "testing"

func TestParseBackendResponse(t *testing.T) {
	result, err := parseBackendResponse("OK\treq-1\t15.5\tperson,0.9,10,20,30,40;car,0.8,50,60,70,80", "req-1", "/tmp/out.jpg")
	if err != nil {
		t.Fatalf("parseBackendResponse failed: %v", err)
	}
	if len(result.Detections) != 2 {
		t.Fatalf("expected 2 detections, got %d", len(result.Detections))
	}
	if result.Detections[0].Label != "person" {
		t.Fatalf("unexpected first label: %s", result.Detections[0].Label)
	}
}

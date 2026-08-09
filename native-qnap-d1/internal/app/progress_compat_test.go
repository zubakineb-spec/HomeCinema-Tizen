package app

import (
	"encoding/json"
	"testing"
)

func TestProgressCompletedAcceptsBool(t *testing.T) {
	var p Progress
	if err := json.Unmarshal([]byte(`{"source_url":"x","position_ms":123,"duration_ms":456,"completed":true}`), &p); err != nil {
		t.Fatal(err)
	}
	if p.Completed != 1 { t.Fatalf("completed=%d want 1", p.Completed) }

	if err := json.Unmarshal([]byte(`{"source_url":"x","completed":false}`), &p); err != nil {
		t.Fatal(err)
	}
	if p.Completed != 0 { t.Fatalf("completed=%d want 0", p.Completed) }
}

func TestProgressCompletedAcceptsNumeric(t *testing.T) {
	var p Progress
	if err := json.Unmarshal([]byte(`{"source_url":"x","completed":1}`), &p); err != nil {
		t.Fatal(err)
	}
	if p.Completed != 1 { t.Fatalf("completed=%d want 1", p.Completed) }

	if err := json.Unmarshal([]byte(`{"source_url":"x","completed":0}`), &p); err != nil {
		t.Fatal(err)
	}
	if p.Completed != 0 { t.Fatalf("completed=%d want 0", p.Completed) }
}

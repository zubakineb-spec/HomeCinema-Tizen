package app

import "testing"

func TestRC317ContinueUsesLatestSeriesActivity(t *testing.T) {
	st := State{
		Shows: []Show{{ID: 10, Title: "Breaking Bad", RecognizedTitle: "Во все тяжкие"}},
		Episodes: []Episode{
			{ID: 101, ShowID: 10, SourceURL: "e1", Season: 1, Episode: 1, Title: "Серия 1"},
			{ID: 102, ShowID: 10, SourceURL: "e2", Season: 1, Episode: 2, Title: "Серия 2"},
			{ID: 103, ShowID: 10, SourceURL: "e3", Season: 1, Episode: 3, Title: "Серия 3"},
		},
		Progress: map[string]Progress{
			"e1": {SourceURL: "e1", PositionMS: 120000, DurationMS: 2400000, Completed: 0, UpdatedAt: "2026-08-15T10:00:00Z"},
			"e2": {SourceURL: "e2", PositionMS: 2400000, DurationMS: 2400000, Completed: 1, UpdatedAt: "2026-08-16T10:00:00Z"},
		},
	}

	items := continueItems(st)
	if len(items) != 1 {
		t.Fatalf("continue items=%d want 1: %#v", len(items), items)
	}
	item := items[0]
	if item["source_url"] != "e3" {
		t.Fatalf("source=%v want e3", item["source_url"])
	}
	if item["parent_title"] != "Во все тяжкие" {
		t.Fatalf("parent_title=%v", item["parent_title"])
	}
	if item["position_ms"] != int64(0) {
		t.Fatalf("position_ms=%v want 0", item["position_ms"])
	}
}

func TestRC317ContinueResumesNewestUnfinishedEpisode(t *testing.T) {
	st := State{
		Shows: []Show{{ID: 20, Title: "The Last of Us", RecognizedTitle: "Одни из нас"}},
		Episodes: []Episode{
			{ID: 201, ShowID: 20, SourceURL: "s1e1", Season: 1, Episode: 1, Title: "Серия 1"},
			{ID: 202, ShowID: 20, SourceURL: "s1e2", Season: 1, Episode: 2, Title: "Серия 2"},
		},
		Progress: map[string]Progress{
			"s1e1": {SourceURL: "s1e1", PositionMS: 2300000, DurationMS: 2400000, Completed: 1, UpdatedAt: "2026-08-15T10:00:00Z"},
			"s1e2": {SourceURL: "s1e2", PositionMS: 420000, DurationMS: 2400000, Completed: 0, UpdatedAt: "2026-08-16T11:00:00Z"},
		},
	}

	items := continueItems(st)
	if len(items) != 1 || items[0]["source_url"] != "s1e2" {
		t.Fatalf("unexpected continue items: %#v", items)
	}
	if items[0]["position_ms"] != int64(420000) {
		t.Fatalf("position_ms=%v", items[0]["position_ms"])
	}
}

func TestRC317PreferredDisplayTitle(t *testing.T) {
	if got := preferredDisplayTitle("The Bear", "Медведь"); got != "Медведь" {
		t.Fatalf("localized title=%q", got)
	}
	if got := preferredDisplayTitle("The Bear", ""); got != "The Bear" {
		t.Fatalf("fallback title=%q", got)
	}
}

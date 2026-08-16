package app

import "testing"

func TestRC318LegacyContinueUsesHighestEpisodeProgress(t *testing.T) {
	st := State{
		Shows: []Show{{ID: 30, Title: "Show"}},
		Episodes: []Episode{
			{ID: 301, ShowID: 30, SourceURL: "e1", Season: 1, Episode: 1, Title: "Episode 1"},
			{ID: 302, ShowID: 30, SourceURL: "e2", Season: 1, Episode: 2, Title: "Episode 2"},
		},
		Progress: map[string]Progress{
			// Simulates RC3.17 failure: delayed save from episode 1 arrived later.
			"e1": {SourceURL: "e1", PositionMS: 600000, DurationMS: 2400000, UpdatedAt: "2026-08-16T12:00:10Z"},
			"e2": {SourceURL: "e2", PositionMS: 900000, DurationMS: 2400000, UpdatedAt: "2026-08-16T12:00:05Z"},
		},
	}

	items := continueItems(st)
	if len(items) != 1 || items[0]["source_url"] != "e2" {
		t.Fatalf("legacy continue=%#v want unfinished episode 2", items)
	}
	if items[0]["position_ms"] != int64(900000) {
		t.Fatalf("position=%v want 900000", items[0]["position_ms"])
	}
}

func TestRC318StartedAtBeatsDelayedSaveArrival(t *testing.T) {
	st := State{
		Shows: []Show{{ID: 31, Title: "Show"}},
		Episodes: []Episode{
			{ID: 311, ShowID: 31, SourceURL: "e1", Season: 1, Episode: 1, Title: "Episode 1"},
			{ID: 312, ShowID: 31, SourceURL: "e2", Season: 1, Episode: 2, Title: "Episode 2"},
		},
		Progress: map[string]Progress{
			"e1": {SourceURL: "e1", PositionMS: 700000, DurationMS: 2400000, StartedAtMS: 1000, UpdatedAt: "2026-08-16T12:00:10Z"},
			"e2": {SourceURL: "e2", PositionMS: 800000, DurationMS: 2400000, StartedAtMS: 2000, UpdatedAt: "2026-08-16T12:00:05Z"},
		},
	}

	items := continueItems(st)
	if len(items) != 1 || items[0]["source_url"] != "e2" {
		t.Fatalf("started-at continue=%#v want episode 2", items)
	}
}

func TestRC318ExplicitReplayCanReturnToEarlierEpisode(t *testing.T) {
	st := State{
		Shows: []Show{{ID: 32, Title: "Show"}},
		Episodes: []Episode{
			{ID: 321, ShowID: 32, SourceURL: "e1", Season: 1, Episode: 1, Title: "Episode 1"},
			{ID: 322, ShowID: 32, SourceURL: "e2", Season: 1, Episode: 2, Title: "Episode 2"},
		},
		Progress: map[string]Progress{
			"e1": {SourceURL: "e1", PositionMS: 300000, DurationMS: 2400000, StartedAtMS: 3000, UpdatedAt: "2026-08-16T12:10:00Z"},
			"e2": {SourceURL: "e2", PositionMS: 800000, DurationMS: 2400000, StartedAtMS: 2000, UpdatedAt: "2026-08-16T12:11:00Z"},
		},
	}

	items := continueItems(st)
	if len(items) != 1 || items[0]["source_url"] != "e1" {
		t.Fatalf("explicit replay continue=%#v want episode 1", items)
	}
}

func TestRC318CompletedLatestStartAdvancesToNextEpisode(t *testing.T) {
	st := State{
		Shows: []Show{{ID: 33, Title: "Show"}},
		Episodes: []Episode{
			{ID: 331, ShowID: 33, SourceURL: "e1", Season: 1, Episode: 1, Title: "Episode 1"},
			{ID: 332, ShowID: 33, SourceURL: "e2", Season: 1, Episode: 2, Title: "Episode 2"},
			{ID: 333, ShowID: 33, SourceURL: "e3", Season: 1, Episode: 3, Title: "Episode 3"},
		},
		Progress: map[string]Progress{
			"e1": {SourceURL: "e1", PositionMS: 500000, DurationMS: 2400000, StartedAtMS: 1000, UpdatedAt: "2026-08-16T12:00:00Z"},
			"e2": {SourceURL: "e2", PositionMS: 2400000, DurationMS: 2400000, Completed: 1, StartedAtMS: 2000, UpdatedAt: "2026-08-16T12:05:00Z"},
		},
	}

	items := continueItems(st)
	if len(items) != 1 || items[0]["source_url"] != "e3" {
		t.Fatalf("completed continue=%#v want episode 3", items)
	}
}

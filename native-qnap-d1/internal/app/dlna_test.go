package app

import (
	"net/http/httptest"
	"strings"
	"testing"
)

func testDLNAState() State {
	return State{
		Movies: []Movie{{ID: 1, Title: "Evil Dead Burn", Year: 2026, SourceURL: "http://192.168.0.101:8096/media/Evil.Dead.Burn.mkv"}},
		Shows:  []Show{{ID: 2, Title: "Pasha"}},
		Episodes: []Episode{
			{ID: 3, ShowID: 2, Season: 1, Episode: 1, Title: "Серия 1", SourceURL: "http://192.168.0.101:8096/media/Pasha.S01E01.mkv", ContentType: "episode"},
			{ID: 4, ShowID: 2, Season: 1, Episode: 9, Title: "Фильм о фильме", SourceURL: "http://192.168.0.101:8096/media/Pasha.Extra.mkv", ContentType: "extra"},
		},
	}
}

func testDLNAConfig() Config {
	return Config{DLNAName: "HOME CINEMA", DLNAAdvertiseIP: "192.168.0.101", DLNAUUID: "6a0a34d4-27dd-4e02-9e07-7ef386393010", MediaBaseURL: "http://192.168.0.101:8096/media/"}
}

func TestDLNATreeSeparatesExtras(t *testing.T) {
	st := testDLNAState()
	root, ok := children(st, "0")
	if !ok || len(root) != 2 || root[0].title != "Фильмы" || root[1].title != "Сериалы" {
		t.Fatalf("unexpected root: %#v", root)
	}
	show, ok := children(st, "show:2")
	if !ok || len(show) != 2 || show[0].title != "Сезон 1" || show[1].title != "Доп. материалы" {
		t.Fatalf("unexpected show tree: %#v", show)
	}
	extras, ok := children(st, "extras:2")
	if !ok || len(extras) != 1 || extras[0].title != "Фильм о фильме" {
		t.Fatalf("unexpected extras: %#v", extras)
	}
}

func TestDLNABrowseRootSOAP(t *testing.T) {
	s := &Server{cfg: testDLNAConfig(), store: &Store{state: testDLNAState()}}
	body := `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><u:Browse xmlns:u="urn:schemas-upnp-org:service:ContentDirectory:1"><ObjectID>0</ObjectID><BrowseFlag>BrowseDirectChildren</BrowseFlag><StartingIndex>0</StartingIndex><RequestedCount>0</RequestedCount></u:Browse></s:Body></s:Envelope>`
	r := httptest.NewRequest("POST", "/dlna/control/content", strings.NewReader(body))
	r.Header.Set("SOAPAction", `"urn:schemas-upnp-org:service:ContentDirectory:1#Browse"`)
	w := httptest.NewRecorder()
	s.dlnaCDControl(w, r)
	if w.Code != 200 {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
	out := w.Body.String()
	if !strings.Contains(out, "Фильмы") || !strings.Contains(out, "Сериалы") || !strings.Contains(out, "<NumberReturned>2</NumberReturned>") {
		t.Fatalf("unexpected browse response: %s", out)
	}
}

func TestDLNAMIME(t *testing.T) {
	if got := dlnaMIME("http://192.168.0.101:8096/media/Movie.MKV"); got != "video/x-matroska" {
		t.Fatalf("mkv MIME=%q", got)
	}
	if got := dlnaMIME("http://192.168.0.101:8096/media/Movie.mp4"); got != "video/mp4" {
		t.Fatalf("mp4 MIME=%q", got)
	}
}

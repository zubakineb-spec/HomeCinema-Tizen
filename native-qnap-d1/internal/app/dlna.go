package app

import (
	"encoding/xml"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"path"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	ssdpGroup = "239.255.255.250:1900"
	dlnaPI    = "DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000"
)

type dlnaRuntime struct {
	mu        sync.RWMutex
	listening bool
	lastError string
	started   string
}

func (d *dlnaRuntime) status(cfg Config) map[string]any {
	if d == nil {
		return map[string]any{"enabled": false, "name": cfg.DLNAName, "ssdp_listening": false}
	}
	d.mu.RLock()
	defer d.mu.RUnlock()
	return map[string]any{"enabled": cfg.DLNAEnabled, "name": cfg.DLNAName, "uuid": cfg.DLNAUUID, "advertise_ip": cfg.DLNAAdvertiseIP, "location": dlnaBase(cfg) + "/dlna/device.xml", "ssdp_listening": d.listening, "last_error": d.lastError, "started_at": d.started}
}
func (d *dlnaRuntime) state(ok bool, err error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.listening = ok
	if err != nil {
		d.lastError = err.Error()
	} else if ok {
		d.lastError = ""
	}
}

func dlnaBase(cfg Config) string {
	u, _ := url.Parse(cfg.MediaBaseURL)
	port := "8096"
	scheme := "http"
	if u != nil {
		if u.Port() != "" {
			port = u.Port()
		}
		if u.Scheme != "" {
			scheme = u.Scheme
		}
	}
	host := cfg.DLNAAdvertiseIP
	if host == "" && u != nil {
		host = u.Hostname()
	}
	if host == "" {
		host = "127.0.0.1"
	}
	return scheme + "://" + net.JoinHostPort(host, port)
}
func dlnaUDN(cfg Config) string { return "uuid:" + strings.TrimPrefix(cfg.DLNAUUID, "uuid:") }

type ssdpTarget struct{ st, usn string }

func ssdpTargets(cfg Config) []ssdpTarget {
	u := dlnaUDN(cfg)
	return []ssdpTarget{{"upnp:rootdevice", u + "::upnp:rootdevice"}, {u, u}, {"urn:schemas-upnp-org:device:MediaServer:1", u + "::urn:schemas-upnp-org:device:MediaServer:1"}, {"urn:schemas-upnp-org:service:ContentDirectory:1", u + "::urn:schemas-upnp-org:service:ContentDirectory:1"}, {"urn:schemas-upnp-org:service:ConnectionManager:1", u + "::urn:schemas-upnp-org:service:ConnectionManager:1"}}
}
func ssdpHeader(msg, name string) string {
	want := strings.ToLower(name)
	for _, ln := range strings.Split(msg, "\n") {
		ln = strings.TrimSpace(ln)
		if i := strings.IndexByte(ln, ':'); i > 0 && strings.ToLower(strings.TrimSpace(ln[:i])) == want {
			return strings.TrimSpace(ln[i+1:])
		}
	}
	return ""
}

func (s *Server) startDLNA() {
	if !s.cfg.DLNAEnabled {
		return
	}
	d := &dlnaRuntime{started: time.Now().UTC().Format(time.RFC3339)}
	s.dlna = d
	go d.run(s.cfg)
}
func (d *dlnaRuntime) run(cfg Config) {
	group, err := net.ResolveUDPAddr("udp4", ssdpGroup)
	if err != nil {
		d.state(false, err)
		return
	}
	targets := ssdpTargets(cfg)
	location := dlnaBase(cfg) + "/dlna/device.xml"
	notify := func() {
		c, e := net.DialUDP("udp4", nil, group)
		if e != nil {
			d.state(false, e)
			return
		}
		defer c.Close()
		for _, t := range targets {
			m := "NOTIFY * HTTP/1.1\r\nHOST: " + ssdpGroup + "\r\nCACHE-CONTROL: max-age=1800\r\nLOCATION: " + location + "\r\nNT: " + t.st + "\r\nNTS: ssdp:alive\r\nSERVER: Linux/3.10 UPnP/1.0 HomeCinema/" + Version + "\r\nUSN: " + t.usn + "\r\n\r\n"
			_, _ = c.Write([]byte(m))
		}
	}
	notify()
	time.Sleep(250 * time.Millisecond)
	notify()
	c, err := net.ListenMulticastUDP("udp4", nil, group)
	if err != nil {
		d.state(false, err)
		log.Printf("DLNA M-SEARCH listener unavailable; ssdp:alive continues: %v", err)
		for range time.NewTicker(10 * time.Minute).C {
			notify()
		}
		return
	}
	defer c.Close()
	_ = c.SetReadBuffer(64 * 1024)
	d.state(true, nil)
	log.Printf("DLNA ready: %s", location)
	go func() {
		for range time.NewTicker(10 * time.Minute).C {
			notify()
		}
	}()
	buf := make([]byte, 8192)
	for {
		n, peer, e := c.ReadFromUDP(buf)
		if e != nil {
			d.state(false, e)
			return
		}
		msg := string(buf[:n])
		if !strings.HasPrefix(strings.ToUpper(msg), "M-SEARCH ") {
			continue
		}
		st := ssdpHeader(msg, "ST")
		if st == "" {
			continue
		}
		for _, t := range targets {
			if !strings.EqualFold(st, "ssdp:all") && !strings.EqualFold(st, t.st) {
				continue
			}
			r := "HTTP/1.1 200 OK\r\nCACHE-CONTROL: max-age=1800\r\nDATE: " + time.Now().UTC().Format(http.TimeFormat) + "\r\nEXT:\r\nLOCATION: " + location + "\r\nSERVER: Linux/3.10 UPnP/1.0 HomeCinema/" + Version + "\r\nST: " + t.st + "\r\nUSN: " + t.usn + "\r\n\r\n"
			_, _ = c.WriteToUDP([]byte(r), peer)
		}
	}
}

func xesc(v string) string {
	var b strings.Builder
	_ = xml.EscapeText(&b, []byte(v))
	return b.String()
}
func xmlOut(w http.ResponseWriter, v string) {
	w.Header().Set("Content-Type", `text/xml; charset="utf-8"`)
	w.Header().Set("Cache-Control", "no-cache")
	_, _ = io.WriteString(w, v)
}

func (s *Server) dlnaDevice(w http.ResponseWriter, r *http.Request) {
	base := dlnaBase(s.cfg)
	body := `<?xml version="1.0" encoding="UTF-8"?><root xmlns="urn:schemas-upnp-org:device-1-0" xmlns:dlna="urn:schemas-dlna-org:device-1-0"><specVersion><major>1</major><minor>0</minor></specVersion><URLBase>` + xesc(base+"/") + `</URLBase><device><deviceType>urn:schemas-upnp-org:device:MediaServer:1</deviceType><friendlyName>` + xesc(s.cfg.DLNAName) + `</friendlyName><manufacturer>Home Cinema</manufacturer><modelDescription>Home Cinema media server for Samsung TV</modelDescription><modelName>Home Cinema D1</modelName><modelNumber>` + Version + `</modelNumber><serialNumber>HC-D1</serialNumber><UDN>` + xesc(dlnaUDN(s.cfg)) + `</UDN><dlna:X_DLNADOC>DMS-1.50</dlna:X_DLNADOC><serviceList><service><serviceType>urn:schemas-upnp-org:service:ContentDirectory:1</serviceType><serviceId>urn:upnp-org:serviceId:ContentDirectory</serviceId><SCPDURL>/dlna/ContentDirectory.xml</SCPDURL><controlURL>/dlna/control/content</controlURL><eventSubURL>/dlna/event/content</eventSubURL></service><service><serviceType>urn:schemas-upnp-org:service:ConnectionManager:1</serviceType><serviceId>urn:upnp-org:serviceId:ConnectionManager</serviceId><SCPDURL>/dlna/ConnectionManager.xml</SCPDURL><controlURL>/dlna/control/connection</controlURL><eventSubURL>/dlna/event/connection</eventSubURL></service></serviceList></device></root>`
	xmlOut(w, body)
}

const cdSCPD = `<?xml version="1.0"?><scpd xmlns="urn:schemas-upnp-org:service-1-0"><specVersion><major>1</major><minor>0</minor></specVersion><actionList><action><name>Browse</name></action><action><name>GetSearchCapabilities</name></action><action><name>GetSortCapabilities</name></action><action><name>GetSystemUpdateID</name></action></actionList><serviceStateTable><stateVariable sendEvents="yes"><name>SystemUpdateID</name><dataType>ui4</dataType></stateVariable></serviceStateTable></scpd>`
const cmSCPD = `<?xml version="1.0"?><scpd xmlns="urn:schemas-upnp-org:service-1-0"><specVersion><major>1</major><minor>0</minor></specVersion><actionList><action><name>GetProtocolInfo</name></action><action><name>GetCurrentConnectionIDs</name></action><action><name>GetCurrentConnectionInfo</name></action></actionList><serviceStateTable></serviceStateTable></scpd>`

func (s *Server) dlnaCDSCPD(w http.ResponseWriter, r *http.Request) { xmlOut(w, cdSCPD) }
func (s *Server) dlnaCMSCPD(w http.ResponseWriter, r *http.Request) { xmlOut(w, cmSCPD) }

type dnode struct {
	id, parent, title, class, url, mime, art string
	container                                bool
	children                                 int
}

func seasons(st State, show int) ([]int, int) {
	m := map[int]bool{}
	extras := 0
	for _, e := range st.Episodes {
		if e.ShowID != show {
			continue
		}
		if isExtra(e) {
			extras++
			continue
		}
		m[e.Season] = true
	}
	a := []int{}
	for n := range m {
		a = append(a, n)
	}
	sort.Ints(a)
	return a, extras
}
func children(st State, id string) ([]dnode, bool) {
	switch id {
	case "0":
		return []dnode{{id: "movies", parent: "0", title: "Фильмы", class: "object.container.storageFolder", container: true, children: len(st.Movies)}, {id: "shows", parent: "0", title: "Сериалы", class: "object.container.storageFolder", container: true, children: len(st.Shows)}}, true
	case "movies":
		a := []dnode{}
		for _, m := range st.Movies {
			t := m.Title
			if m.Year > 0 {
				t += fmt.Sprintf(" (%d)", m.Year)
			}
			a = append(a, dnode{id: fmt.Sprintf("movie:%d", m.ID), parent: "movies", title: t, class: "object.item.videoItem.movie", url: m.SourceURL, mime: dlnaMIME(m.SourceURL), art: m.PosterURL})
		}
		return a, true
	case "shows":
		a := []dnode{}
		for _, sh := range st.Shows {
			ss, x := seasons(st, sh.ID)
			n := len(ss)
			if x > 0 {
				n++
			}
			a = append(a, dnode{id: fmt.Sprintf("show:%d", sh.ID), parent: "shows", title: sh.Title, class: "object.container.album.videoAlbum", container: true, children: n, art: sh.PosterURL})
		}
		return a, true
	}
	if strings.HasPrefix(id, "show:") {
		sid, e := strconv.Atoi(strings.TrimPrefix(id, "show:"))
		if e != nil {
			return nil, false
		}
		ss, x := seasons(st, sid)
		a := []dnode{}
		for _, sn := range ss {
			n := 0
			for _, ep := range st.Episodes {
				if ep.ShowID == sid && !isExtra(ep) && ep.Season == sn {
					n++
				}
			a = append(a, dnode{id: fmt.Sprintf("season:%d:%d", sid, sn), parent: id, title: fmt.Sprintf("Сезон %d", sn), class: "object.container.storageFolder", container: true, children: n})
		}
		if x > 0 {
			a = append(a, dnode{id: fmt.Sprintf("extras:%d", sid), parent: id, title: "Доп. материалы", class: "object.container.storageFolder", container: true, children: x})
		}
		return a, true
	}
	if strings.HasPrefix(id, "season:") {
		p := strings.Split(id, ":")
		if len(p) != 3 {
			return nil, false
		}
		sid, e1 := strconv.Atoi(p[1])
		sn, e2 := strconv.Atoi(p[2])
		if e1 != nil || e2 != nil {
			return nil, false
		}
		a := []dnode{}
		for _, ep := range st.Episodes {
			if ep.ShowID == sid && !isExtra(ep) && ep.Season == sn {
				a = append(a, dnode{id: fmt.Sprintf("episode:%d", ep.ID), parent: id, title: fmt.Sprintf("S%02dE%02d — %s", ep.Season, ep.Episode, ep.Title), class: "object.item.videoItem", url: ep.SourceURL, mime: dlnaMIME(ep.SourceURL), art: ep.StillURL})
			}
		}
		sort.Slice(a, func(i, j int) bool { return a[i].title < a[j].title })
		return a, true
	}
	if strings.HasPrefix(id, "extras:") {
		sid, e := strconv.Atoi(strings.TrimPrefix(id, "extras:"))
		if e != nil {
			return nil, false
		}
		a := []dnode{}
		for _, ep := range st.Episodes {
			if ep.ShowID == sid && isExtra(ep) {
				a = append(a, dnode{id: fmt.Sprintf("episode:%d", ep.ID), parent: id, title: ep.Title, class: "object.item.videoItem", url: ep.SourceURL, mime: dlnaMIME(ep.SourceURL), art: ep.StillURL})
			}
		}
		return a, true
	}
	return nil, false
}
func node(st State, cfg Config, id string) (dnode, bool) {
	if id == "0" {
		return dnode{id: "0", parent: "-1", title: cfg.DLNAName, class: "object.container", container: true, children: 2}, true
	}
	if id == "movies" {
		return dnode{id: "movies", parent: "0", title: "Фильмы", class: "object.container.storageFolder", container: true, children: len(st.Movies)}, true
	}
	if id == "shows" {
		return dnode{id: "shows", parent: "0", title: "Сериалы", class: "object.container.storageFolder", container: true, children: len(st.Shows)}, true
	}
	if strings.HasPrefix(id, "movie:") {
		n, e := strconv.Atoi(strings.TrimPrefix(id, "movie:"))
		if e == nil {
			for _, m := range st.Movies {
				if m.ID == n {
					t := m.Title
					if m.Year > 0 {
						t += fmt.Sprintf(" (%d)", m.Year)
					}
					return dnode{id: id, parent: "movies", title: t, class: "object.item.videoItem.movie", url: m.SourceURL, mime: dlnaMIME(m.SourceURL), art: m.PosterURL}, true
				}
			}
		}
	}
	if strings.HasPrefix(id, "episode:") {
		n, e := strconv.Atoi(strings.TrimPrefix(id, "episode:"))
		if e == nil {
			for _, ep := range st.Episodes {
				if ep.ID == n {
					par := fmt.Sprintf("season:%d:%d", ep.ShowID, ep.Season)
					t := fmt.Sprintf("S%02dE%02d — %s", ep.Season, ep.Episode, ep.Title)
					if isExtra(ep) {
						par = fmt.Sprintf("extras:%d", ep.ShowID)
						t = ep.Title
					}
					return dnode{id: id, parent: par, title: t, class: "object.item.videoItem", url: ep.SourceURL, mime: dlnaMIME(ep.SourceURL), art: ep.StillURL}, true
				}
			}
		}
	}
	if strings.HasPrefix(id, "show:") {
		sid, e := strconv.Atoi(strings.TrimPrefix(id, "show:"))
		if e == nil {
			for _, sh := range st.Shows {
				if sh.ID == sid {
					ss, x := seasons(st, sid)
					n := len(ss)
					if x > 0 {
						n++
					}
					return dnode{id: id, parent: "shows", title: sh.Title, class: "object.container.album.videoAlbum", container: true, children: n, art: sh.PosterURL}, true
				}
			}
		}
	}
	if strings.HasPrefix(id, "season:") {
		p := strings.Split(id, ":")
		if len(p) == 3 {
			sid, e1 := strconv.Atoi(p[1])
			sn, e2 := strconv.Atoi(p[2])
			if e1 == nil && e2 == nil {
				n := 0
				for _, ep := range st.Episodes {
					if ep.ShowID == sid && !isExtra(ep) && ep.Season == sn {
						n++
					}
				}
				return dnode{id: id, parent: "show:" + p[1], title: "Сезон " + p[2], class: "object.container.storageFolder", container: true, children: n}, true
			}
		}
	}
	if strings.HasPrefix(id, "extras:") {
		sid, e := strconv.Atoi(strings.TrimPrefix(id, "extras:"))
		if e == nil {
			n := 0
			for _, ep := range st.Episodes {
				if ep.ShowID == sid && isExtra(ep) {
					n++
				}
			}
			return dnode{id: id, parent: fmt.Sprintf("show:%d", sid), title: "Доп. материалы", class: "object.container.storageFolder", container: true, children: n}, true
		}
	}
	return dnode{}, false
}
func didl(a []dnode) string {
	var b strings.Builder
	b.WriteString(`<?xml version="1.0" encoding="UTF-8"?><DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/">`)
	for _, n := range a {
		if n.container {
			b.WriteString(`<container id="` + xesc(n.id) + `" parentID="` + xesc(n.parent) + `" restricted="1" childCount="` + strconv.Itoa(n.children) + `">`)
		} else {
			b.WriteString(`<item id="` + xesc(n.id) + `" parentID="` + xesc(n.parent) + `" restricted="1">`)
		}
		b.WriteString(`<dc:title>` + xesc(n.title) + `</dc:title><upnp:class>` + xesc(n.class) + `</upnp:class>`)
		if n.art != "" {
			b.WriteString(`<upnp:albumArtURI>` + xesc(n.art) + `</upnp:albumArtURI>`)
		}
		if !n.container && n.url != "" {
			b.WriteString(`<res protocolInfo="http-get:*:` + xesc(n.mime) + `:` + dlnaPI + `">` + xesc(n.url) + `</res>`)
		}
		if n.container {
			b.WriteString(`</container>`)
		} else {
			b.WriteString(`</item>`)
		}
	}
	b.WriteString(`</DIDL-Lite>`)
	return b.String()
}

type browseEnvelope struct {
	Body struct {
		Browse struct {
			ObjectID       string `xml:"ObjectID"`
			BrowseFlag     string `xml:"BrowseFlag"`
			StartingIndex  int    `xml:"StartingIndex"`
			RequestedCount int    `xml:"RequestedCount"`
		} `xml:"Browse"`
	} `xml:"Body"`
}

func action(r *http.Request) string {
	v := strings.Trim(strings.TrimSpace(r.Header.Get("SOAPAction")), `"`)
	if i := strings.LastIndex(v, "#"); i >= 0 {
		return v[i+1:]
	}
	return v
}
func soap(service, a, inner string) string {
	return `<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><u:` + a + `Response xmlns:u="` + service + `">` + inner + `</u:` + a + `Response></s:Body></s:Envelope>`
}
func fault(w http.ResponseWriter, code int, msg string) {
	w.WriteHeader(500)
	xmlOut(w, `<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><s:Fault><faultcode>s:Client</faultcode><faultstring>UPnPError</faultstring><detail><UPnPError xmlns="urn:schemas-upnp-org:control-1-0"><errorCode>`+strconv.Itoa(code)+`</errorCode><errorDescription>`+xesc(msg)+`</errorDescription></UPnPError></detail></s:Fault></s:Body></s:Envelope>`)
}
func (s *Server) dlnaCDControl(w http.ResponseWriter, r *http.Request) {
	const service = "urn:schemas-upnp-org:service:ContentDirectory:1"
	a := action(r)
	switch a {
	case "Browse":
		var e browseEnvelope
		raw, er := io.ReadAll(io.LimitReader(r.Body, 1<<20))
		if er != nil || xml.Unmarshal(raw, &e) != nil {
			fault(w, 402, "Invalid Args")
			return
		}
		q := e.Body.Browse
		st := s.store.Snapshot()
		var list []dnode
		total := 0
		if strings.EqualFold(q.BrowseFlag, "BrowseMetadata") {
			n, ok := node(st, s.cfg, q.ObjectID)
			if !ok {
				fault(w, 701, "No such object")
				return
			}
			list = []dnode{n}
			total = 1
		} else {
			all, ok := children(st, q.ObjectID)
			if !ok {
				fault(w, 701, "No such object")
				return
			}
			total = len(all)
			start := q.StartingIndex
			if start < 0 {
				start = 0
			}
			if start > total {
				start = total
			}
			end := total
			if q.RequestedCount > 0 && start+q.RequestedCount < end {
				end = start + q.RequestedCount
			}
			list = all[start:end]
		}
		xmlOut(w, soap(service, a, `<Result>`+xesc(didl(list))+`</Result><NumberReturned>`+strconv.Itoa(len(list))+`</NumberReturned><TotalMatches>`+strconv.Itoa(total)+`</TotalMatches><UpdateID>1</UpdateID>`))
	case "GetSearchCapabilities":
		xmlOut(w, soap(service, a, `<SearchCaps></SearchCaps>`))
	case "GetSortCapabilities":
		xmlOut(w, soap(service, a, `<SortCaps>dc:title</SortCaps>`))
	case "GetSystemUpdateID":
		xmlOut(w, soap(service, a, `<Id>1</Id>`))
	default:
		fault(w, 401, "Invalid Action")
	}
}
func (s *Server) dlnaCMControl(w http.ResponseWriter, r *http.Request) {
	const service = "urn:schemas-upnp-org:service:ConnectionManager:1"
	a := action(r)
	switch a {
	case "GetProtocolInfo":
		src := strings.Join([]string{"http-get:*:video/x-matroska:" + dlnaPI, "http-get:*:video/mp4:" + dlnaPI, "http-get:*:video/x-msvideo:" + dlnaPI, "http-get:*:video/mp2t:" + dlnaPI, "http-get:*:video/webm:" + dlnaPI}, ",")
		xmlOut(w, soap(service, a, `<Source>`+xesc(src)+`</Source><Sink></Sink>`))
	case "GetCurrentConnectionIDs":
		xmlOut(w, soap(service, a, `<ConnectionIDs></ConnectionIDs>`))
	case "GetCurrentConnectionInfo":
		xmlOut(w, soap(service, a, `<RcsID>-1</RcsID><AVTransportID>-1</AVTransportID><ProtocolInfo></ProtocolInfo><PeerConnectionManager></PeerConnectionManager><PeerConnectionID>-1</PeerConnectionID><Direction>Output</Direction><Status>OK</Status>`))
	default:
		fault(w, 401, "Invalid Action")
	}
}

func dlnaMIME(raw string) string {
	u, e := url.Parse(raw)
	p := raw
	if e == nil && u.Path != "" {
		p = u.Path
	}
	switch strings.ToLower(path.Ext(p)) {
	case ".mkv":
		return "video/x-matroska"
	case ".mp4", ".m4v":
		return "video/mp4"
	case ".avi":
		return "video/x-msvideo"
	case ".ts", ".m2ts":
		return "video/mp2t"
	case ".mov":
		return "video/quicktime"
	case ".webm":
		return "video/webm"
	}
	return "application/octet-stream"
}
func (s *Server) mediaHTTPHandler() http.Handler {
	fs := http.StripPrefix("/media/", http.FileServer(http.Dir(s.cfg.MediaRoot)))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		m := dlnaMIME(r.URL.Path)
		if m != "application/octet-stream" {
			w.Header().Set("Content-Type", m)
		}
		w.Header().Set("transferMode.dlna.org", "Streaming")
		if r.Header.Get("getcontentFeatures.dlna.org") != "" {
			w.Header().Set("contentFeatures.dlna.org", dlnaPI)
		}
		fs.ServeHTTP(w, r)
	})
}
func (s *Server) dlnaStatusHTTP(w http.ResponseWriter, r *http.Request) {
	jsonOut(w, s.dlna.status(s.cfg))
}

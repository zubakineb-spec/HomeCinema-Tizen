package app

import (
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"time"
)

const rc332ImageTransportLog = "image-transport-error.log"

// recordTMDBImageTransportFailure writes the complete upstream error to a
// dedicated data-dir file. The target QNAP has shown that the process-standard
// logger can remain readable for startup messages while later transport lines
// are not observable through homecinema.log, so RC3.32 keeps an independent
// diagnostic trail without changing the public /api/image error response.
func (s *Server) recordTMDBImageTransportFailure(u *url.URL, transportErr error) {
	if s == nil || transportErr == nil {
		return
	}
	path := filepath.Join(s.cfg.DataDir, rc332ImageTransportLog)
	f, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0644)
	if err != nil {
		return
	}
	defer f.Close()

	host := ""
	requestPath := ""
	if u != nil {
		host = u.Hostname()
		requestPath = u.EscapedPath()
	}
	_, _ = fmt.Fprintf(f, "%s host=%s path=%s error=%v\n", time.Now().Format(time.RFC3339), host, requestPath, transportErr)
}

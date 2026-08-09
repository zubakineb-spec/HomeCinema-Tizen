package app

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestLibraryFingerprintChangesForVideo(t *testing.T) {
	root := t.TempDir()
	first, err := fingerprintLibrary(root)
	if err != nil { t.Fatal(err) }
	if first.Count != 0 { t.Fatalf("initial count=%d", first.Count) }

	p := filepath.Join(root, "Movie.2026.mkv")
	if err := os.WriteFile(p, []byte("abc"), 0644); err != nil { t.Fatal(err) }
	second, err := fingerprintLibrary(root)
	if err != nil { t.Fatal(err) }
	if second.Count != 1 || second.Bytes != 3 || second == first { t.Fatalf("unexpected fingerprint: %#v", second) }

	time.Sleep(time.Millisecond)
	if err := os.WriteFile(p, []byte("abcdef"), 0644); err != nil { t.Fatal(err) }
	third, err := fingerprintLibrary(root)
	if err != nil { t.Fatal(err) }
	if third.Bytes != 6 || third == second { t.Fatalf("fingerprint did not change: %#v", third) }
}

func TestLibraryFingerprintIgnoresQNAPServiceDirs(t *testing.T) {
	root := t.TempDir()
	d := filepath.Join(root, "@Recycle")
	if err := os.MkdirAll(d, 0755); err != nil { t.Fatal(err) }
	if err := os.WriteFile(filepath.Join(d, "Old.mkv"), []byte("x"), 0644); err != nil { t.Fatal(err) }
	fp, err := fingerprintLibrary(root)
	if err != nil { t.Fatal(err) }
	if fp.Count != 0 { t.Fatalf("service-dir media counted: %#v", fp) }
}

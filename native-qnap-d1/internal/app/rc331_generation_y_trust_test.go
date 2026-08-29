package app

import (
	"crypto/sha256"
	"crypto/x509"
	"encoding/hex"
	"encoding/pem"
	"strings"
	"testing"
)

func TestRC331GenerationYRootFingerprints(t *testing.T) {
	type expectedCert struct {
		cn        string
		sha256Hex string
	}
	expected := []expectedCert{
		{cn: "Root YR", sha256Hex: "E57B7E6F150C419102E8D5C055729FF967B9D1A829BF00CEC89CA604EBF4A86F"},
		{cn: "Root YE", sha256Hex: "E14FFCAD5B0025731006CAA43A121A22D8E9700F4FB9CF852F02A708AA5D5666"},
	}

	rest := []byte(tmdbGenerationYRootsPEM)
	var certs []*x509.Certificate
	for len(rest) > 0 {
		block, next := pem.Decode(rest)
		if block == nil {
			break
		}
		rest = next
		if block.Type != "CERTIFICATE" {
			continue
		}
		cert, err := x509.ParseCertificate(block.Bytes)
		if err != nil {
			t.Fatalf("parse embedded Generation Y certificate: %v", err)
		}
		certs = append(certs, cert)
	}
	if len(certs) != len(expected) {
		t.Fatalf("embedded Generation Y certificates=%d want=%d", len(certs), len(expected))
	}

	for i, want := range expected {
		cert := certs[i]
		if cert.Subject.CommonName != want.cn {
			t.Fatalf("cert[%d] CN=%q want=%q", i, cert.Subject.CommonName, want.cn)
		}
		sum := sha256.Sum256(cert.Raw)
		got := strings.ToUpper(hex.EncodeToString(sum[:]))
		if got != want.sha256Hex {
			t.Fatalf("%s fingerprint=%s want=%s", want.cn, got, want.sha256Hex)
		}
		if !cert.IsCA {
			t.Fatalf("%s is not marked as CA", want.cn)
		}
	}
}

func TestRC331TMDBImageTLSKeepsVerificationEnabled(t *testing.T) {
	cfg := tlsConfigForDirectHost(tmdbImageHost)
	if cfg == nil || cfg.RootCAs == nil {
		t.Fatal("TMDB image TLS root pool missing")
	}
	if cfg.InsecureSkipVerify {
		t.Fatal("TLS verification must remain enabled")
	}
}

func TestRC331GenerationYBundleAppends(t *testing.T) {
	pool := x509.NewCertPool()
	if !appendTMDBGenerationYRoots(pool) {
		t.Fatal("failed to append Generation Y roots")
	}
	if len(pool.Subjects()) != 2 {
		t.Fatalf("Generation Y root subjects=%d want=2", len(pool.Subjects()))
	}
}

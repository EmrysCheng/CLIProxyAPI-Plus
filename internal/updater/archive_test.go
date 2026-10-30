package updater

import (
	"archive/tar"
	"compress/gzip"
	"os"
)

func gzipWriter(f *os.File) *gzip.Writer { return gzip.NewWriter(f) }

func tarWriter(gz *gzip.Writer) *tar.Writer { return tar.NewWriter(gz) }

func tarHeader(name string, size int64) *tar.Header {
	return &tar.Header{Name: name, Mode: 0o755, Size: size, Typeflag: tar.TypeReg}
}

package buildinfo

import (
	"fmt"
	"io"
)

var (
	Version    = "dev"
	Commit     = "unknown"
	SourceHash = "unknown"
	BuiltAt    = "unknown"
)

type Info struct {
	BinaryName string
	Version    string
	Commit     string
	SourceHash string
	BuiltAt    string
}

func Current(binaryName string) Info {
	return Info{
		BinaryName: binaryName,
		Version:    Version,
		Commit:     Commit,
		SourceHash: SourceHash,
		BuiltAt:    BuiltAt,
	}
}

func WriteVersion(w io.Writer, binaryName string) error {
	info := Current(binaryName)
	_, err := fmt.Fprintf(
		w,
		"%s %s\ncommit=%s\nsource_hash=%s\nbuilt_at=%s\n",
		info.BinaryName,
		info.Version,
		info.Commit,
		info.SourceHash,
		info.BuiltAt,
	)
	return err
}

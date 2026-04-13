package logging

import (
	"log/slog"
	"os"
)

func Configure(levelName string) {
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{
		Level: parseLevel(levelName),
	})))
}

func parseLevel(levelName string) slog.Level {
	switch levelName {
	case "debug":
		return slog.LevelDebug
	case "warn":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}

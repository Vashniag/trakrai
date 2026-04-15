package cloudtransfer

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

type listFilter struct {
	Direction Direction
	Limit     int
	State     TransferState
}

type Store struct {
	db *sql.DB
}

func OpenStore(path string) (*Store, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, fmt.Errorf("create store dir: %w", err)
	}

	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)

	store := &Store{db: db}
	if err := store.init(); err != nil {
		_ = db.Close()
		return nil, err
	}
	return store, nil
}

func (s *Store) Close() error {
	return s.db.Close()
}

func (s *Store) init() error {
	statements := []string{
		`PRAGMA journal_mode = WAL;`,
		`PRAGMA busy_timeout = 5000;`,
		`CREATE TABLE IF NOT EXISTS transfers (
			id TEXT PRIMARY KEY,
			direction TEXT NOT NULL,
			device_id TEXT NOT NULL,
			remote_path TEXT NOT NULL,
			object_key TEXT NOT NULL DEFAULT '',
			local_path TEXT NOT NULL,
			content_type TEXT NOT NULL DEFAULT '',
			metadata_json TEXT NOT NULL DEFAULT '{}',
			state TEXT NOT NULL,
			attempts INTEGER NOT NULL DEFAULT 0,
			last_error TEXT NOT NULL DEFAULT '',
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL,
			next_attempt_at TEXT,
			started_at TEXT,
			completed_at TEXT,
			deadline_at TEXT
		);`,
		`CREATE INDEX IF NOT EXISTS idx_transfers_state_next_attempt_at ON transfers(state, next_attempt_at, created_at);`,
		`CREATE INDEX IF NOT EXISTS idx_transfers_direction_state ON transfers(direction, state);`,
	}
	for _, statement := range statements {
		if _, err := s.db.Exec(statement); err != nil {
			return fmt.Errorf("init sqlite store: %w", err)
		}
	}
	return nil
}

func (s *Store) Enqueue(ctx context.Context, transfer Transfer) (Transfer, error) {
	now := transfer.CreatedAt
	if transfer.UpdatedAt.IsZero() {
		transfer.UpdatedAt = now
	}
	if transfer.NextAttemptAt == nil {
		transfer.NextAttemptAt = &now
	}
	_, err := s.db.ExecContext(
		ctx,
		`INSERT INTO transfers (
			id, direction, device_id, remote_path, object_key, local_path, content_type,
			metadata_json, state, attempts, last_error, created_at, updated_at, next_attempt_at,
			started_at, completed_at, deadline_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		transfer.ID,
		string(transfer.Direction),
		transfer.DeviceID,
		transfer.RemotePath,
		transfer.ObjectKey,
		transfer.LocalPath,
		transfer.ContentType,
		encodeMetadata(transfer.Metadata),
		string(transfer.State),
		transfer.Attempts,
		transfer.LastError,
		formatTime(transfer.CreatedAt),
		formatTime(transfer.UpdatedAt),
		formatNullableTime(transfer.NextAttemptAt),
		formatNullableTime(transfer.StartedAt),
		formatNullableTime(transfer.CompletedAt),
		formatNullableTime(transfer.DeadlineAt),
	)
	if err != nil {
		return Transfer{}, fmt.Errorf("insert transfer: %w", err)
	}
	return transfer, nil
}

func (s *Store) GetTransfer(ctx context.Context, id string) (Transfer, error) {
	row := s.db.QueryRowContext(ctx, selectTransferSQL+` WHERE id = ?`, id)
	record, err := scanStoredTransfer(row)
	if err != nil {
		return Transfer{}, err
	}
	return record.public(), nil
}

func (s *Store) ListTransfers(ctx context.Context, filter listFilter) ([]Transfer, error) {
	clauses := []string{"1 = 1"}
	args := []interface{}{}
	if filter.Direction != "" {
		clauses = append(clauses, "direction = ?")
		args = append(args, string(filter.Direction))
	}
	if filter.State != "" {
		clauses = append(clauses, "state = ?")
		args = append(args, string(filter.State))
	}
	limit := filter.Limit
	if limit <= 0 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}
	args = append(args, limit)

	query := selectTransferSQL +
		` WHERE ` + strings.Join(clauses, " AND ") +
		` ORDER BY created_at DESC LIMIT ?`

	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("list transfers: %w", err)
	}
	defer rows.Close()

	items := make([]Transfer, 0)
	for rows.Next() {
		record, err := scanStoredTransfer(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, record.public())
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate transfers: %w", err)
	}
	return items, nil
}

func (s *Store) AcquireDueTransfer(ctx context.Context, now time.Time) (*Transfer, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("begin acquire: %w", err)
	}
	defer tx.Rollback()

	row := tx.QueryRowContext(
		ctx,
		selectTransferSQL+
			` WHERE state IN (?, ?) AND (next_attempt_at IS NULL OR next_attempt_at <= ?) ORDER BY COALESCE(next_attempt_at, created_at), created_at LIMIT 1`,
		string(StateQueued),
		string(StateRetryWait),
		formatTime(now),
	)
	record, err := scanStoredTransfer(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	record.State = StateRunning
	record.Attempts += 1
	record.StartedAt = &now
	record.UpdatedAt = now
	record.NextAttemptAt = nil

	_, err = tx.ExecContext(
		ctx,
		`UPDATE transfers
		 SET state = ?, attempts = ?, updated_at = ?, started_at = ?, next_attempt_at = NULL
		 WHERE id = ?`,
		string(record.State),
		record.Attempts,
		formatTime(record.UpdatedAt),
		formatNullableTime(record.StartedAt),
		record.ID,
	)
	if err != nil {
		return nil, fmt.Errorf("claim transfer: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("commit acquire: %w", err)
	}

	transfer := record.public()
	return &transfer, nil
}

func (s *Store) MarkCompleted(ctx context.Context, id string, objectKey string, completedAt time.Time) error {
	_, err := s.db.ExecContext(
		ctx,
		`UPDATE transfers
		 SET state = ?, object_key = ?, completed_at = ?, updated_at = ?, next_attempt_at = NULL, last_error = ''
		 WHERE id = ?`,
		string(StateCompleted),
		objectKey,
		formatTime(completedAt),
		formatTime(completedAt),
		id,
	)
	if err != nil {
		return fmt.Errorf("mark completed: %w", err)
	}
	return nil
}

func (s *Store) MarkRetry(ctx context.Context, id string, nextAttemptAt time.Time, message string, objectKey string, updatedAt time.Time) error {
	_, err := s.db.ExecContext(
		ctx,
		`UPDATE transfers
		 SET state = ?, next_attempt_at = ?, last_error = ?, updated_at = ?, object_key = ?
		 WHERE id = ?`,
		string(StateRetryWait),
		formatTime(nextAttemptAt),
		strings.TrimSpace(message),
		formatTime(updatedAt),
		objectKey,
		id,
	)
	if err != nil {
		return fmt.Errorf("mark retry: %w", err)
	}
	return nil
}

func (s *Store) MarkFailed(ctx context.Context, id string, message string, updatedAt time.Time) error {
	_, err := s.db.ExecContext(
		ctx,
		`UPDATE transfers
		 SET state = ?, last_error = ?, updated_at = ?, next_attempt_at = NULL
		 WHERE id = ?`,
		string(StateFailed),
		strings.TrimSpace(message),
		formatTime(updatedAt),
		id,
	)
	if err != nil {
		return fmt.Errorf("mark failed: %w", err)
	}
	return nil
}

func (s *Store) ResetRunningTransfers(ctx context.Context, now time.Time) error {
	_, err := s.db.ExecContext(
		ctx,
		`UPDATE transfers
		 SET state = ?, next_attempt_at = ?, updated_at = ?, last_error = CASE
			WHEN last_error = '' THEN ?
			ELSE last_error
		 END
		 WHERE state = ?`,
		string(StateRetryWait),
		formatTime(now),
		formatTime(now),
		"cloud-transfer restarted before prior attempt completed",
		string(StateRunning),
	)
	if err != nil {
		return fmt.Errorf("reset running transfers: %w", err)
	}
	return nil
}

func (s *Store) MarkExpired(ctx context.Context, now time.Time) error {
	_, err := s.db.ExecContext(
		ctx,
		`UPDATE transfers
		 SET state = ?, updated_at = ?, next_attempt_at = NULL, last_error = CASE
			WHEN last_error = '' THEN ?
			ELSE last_error
		 END
		 WHERE state IN (?, ?, ?) AND deadline_at IS NOT NULL AND deadline_at <= ?`,
		string(StateFailed),
		formatTime(now),
		"transfer deadline expired before completion",
		string(StateQueued),
		string(StateRetryWait),
		string(StateRunning),
		formatTime(now),
	)
	if err != nil {
		return fmt.Errorf("expire transfers: %w", err)
	}
	return nil
}

func (s *Store) Stats(ctx context.Context) (QueueStats, error) {
	stats := QueueStats{}

	rows, err := s.db.QueryContext(
		ctx,
		`SELECT direction, state, COUNT(*) FROM transfers GROUP BY direction, state`,
	)
	if err != nil {
		return stats, fmt.Errorf("query stats: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var direction string
		var state string
		var count int
		if err := rows.Scan(&direction, &state, &count); err != nil {
			return stats, fmt.Errorf("scan stats row: %w", err)
		}
		stats.Total += count
		switch TransferState(state) {
		case StateCompleted:
			stats.Completed += count
		case StateFailed:
			stats.Failed += count
		case StateRunning:
			stats.Running += count
		case StateQueued, StateRetryWait:
			stats.Pending += count
		}
		switch Direction(direction) {
		case DirectionUpload:
			switch TransferState(state) {
			case StateCompleted:
				stats.UploadsCompleted += count
			case StateFailed:
				stats.UploadsFailed += count
			case StateQueued, StateRetryWait:
				stats.UploadQueued += count
			}
		case DirectionDownload:
			switch TransferState(state) {
			case StateCompleted:
				stats.DownloadsCompleted += count
			case StateFailed:
				stats.DownloadsFailed += count
			case StateQueued, StateRetryWait:
				stats.DownloadQueued += count
			}
		}
	}
	if err := rows.Err(); err != nil {
		return stats, fmt.Errorf("iterate stats: %w", err)
	}

	var nextAttempt sql.NullString
	if err := s.db.QueryRowContext(
		ctx,
		`SELECT MIN(next_attempt_at) FROM transfers WHERE state IN (?, ?) AND next_attempt_at IS NOT NULL`,
		string(StateQueued),
		string(StateRetryWait),
	).Scan(&nextAttempt); err != nil {
		return stats, fmt.Errorf("query next attempt: %w", err)
	}
	if nextAttempt.Valid && strings.TrimSpace(nextAttempt.String) != "" {
		parsed, err := time.Parse(time.RFC3339Nano, nextAttempt.String)
		if err == nil {
			stats.NextAttemptAt = &parsed
		}
	}

	return stats, nil
}

const selectTransferSQL = `SELECT
	id,
	direction,
	device_id,
	remote_path,
	object_key,
	local_path,
	content_type,
	metadata_json,
	state,
	attempts,
	last_error,
	created_at,
	updated_at,
	next_attempt_at,
	started_at,
	completed_at,
	deadline_at
FROM transfers`

type rowScanner interface {
	Scan(dest ...interface{}) error
}

func scanStoredTransfer(scanner rowScanner) (storedTransfer, error) {
	var record storedTransfer
	var direction string
	var state string
	var createdAt string
	var updatedAt string
	var nextAttemptAt sql.NullString
	var startedAt sql.NullString
	var completedAt sql.NullString
	var deadlineAt sql.NullString

	err := scanner.Scan(
		&record.ID,
		&direction,
		&record.DeviceID,
		&record.RemotePath,
		&record.ObjectKey,
		&record.LocalPath,
		&record.ContentType,
		&record.MetadataJSON,
		&state,
		&record.Attempts,
		&record.LastError,
		&createdAt,
		&updatedAt,
		&nextAttemptAt,
		&startedAt,
		&completedAt,
		&deadlineAt,
	)
	if err != nil {
		return storedTransfer{}, err
	}

	parsedCreatedAt, err := time.Parse(time.RFC3339Nano, createdAt)
	if err != nil {
		return storedTransfer{}, fmt.Errorf("parse created_at: %w", err)
	}
	parsedUpdatedAt, err := time.Parse(time.RFC3339Nano, updatedAt)
	if err != nil {
		return storedTransfer{}, fmt.Errorf("parse updated_at: %w", err)
	}

	record.Direction = Direction(direction)
	record.State = TransferState(state)
	record.CreatedAt = parsedCreatedAt
	record.UpdatedAt = parsedUpdatedAt
	record.NextAttemptAt = parseNullableTime(nextAttemptAt)
	record.StartedAt = parseNullableTime(startedAt)
	record.CompletedAt = parseNullableTime(completedAt)
	record.DeadlineAt = parseNullableTime(deadlineAt)
	return record, nil
}

func parseNullableTime(value sql.NullString) *time.Time {
	if !value.Valid || strings.TrimSpace(value.String) == "" {
		return nil
	}
	parsed, err := time.Parse(time.RFC3339Nano, value.String)
	if err != nil {
		return nil
	}
	return &parsed
}

func formatTime(value time.Time) string {
	return value.UTC().Format(time.RFC3339Nano)
}

func formatNullableTime(value *time.Time) interface{} {
	if value == nil {
		return nil
	}
	return value.UTC().Format(time.RFC3339Nano)
}

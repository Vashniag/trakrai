package transfermanager

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"

	_ "modernc.org/sqlite"
)

type storedJob struct {
	AttemptCount int
	ID           string
	LastError    string
	NextAttempt  time.Time
	Payload      TransferRequest
	RetryUntil   time.Time
	Status       string
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
		return nil, err
	}
	db.SetMaxOpenConns(1)

	store := &Store{db: db}
	if err := store.migrate(); err != nil {
		_ = db.Close()
		return nil, err
	}
	return store, nil
}

func (s *Store) Close() error {
	return s.db.Close()
}

func (s *Store) migrate() error {
	const schema = `
create table if not exists transfer_jobs (
  id text primary key,
  payload_json text not null,
  status text not null,
  attempt_count integer not null default 0,
  next_attempt_at text not null,
  retry_until text not null,
  last_error text,
  created_at text not null,
  updated_at text not null
);
create index if not exists idx_transfer_jobs_due on transfer_jobs(status, next_attempt_at);
`
	_, err := s.db.Exec(schema)
	return err
}

func (s *Store) Enqueue(ctx context.Context, request TransferRequest) error {
	payloadJSON, err := json.Marshal(request)
	if err != nil {
		return fmt.Errorf("marshal transfer payload: %w", err)
	}

	retryUntil, err := request.Retry.RetryDeadline()
	if err != nil {
		return err
	}

	now := time.Now().UTC()
	_, err = s.db.ExecContext(
		ctx,
		`insert or replace into transfer_jobs
		 (id, payload_json, status, attempt_count, next_attempt_at, retry_until, created_at, updated_at)
		 values (?, ?, 'queued', 0, ?, ?, coalesce((select created_at from transfer_jobs where id = ?), ?), ?)`,
		request.TransferID,
		string(payloadJSON),
		now.Format(time.RFC3339Nano),
		retryUntil.Format(time.RFC3339Nano),
		request.TransferID,
		now.Format(time.RFC3339Nano),
		now.Format(time.RFC3339Nano),
	)
	return err
}

func (s *Store) TakeDueJobs(ctx context.Context, limit int) ([]storedJob, error) {
	rows, err := s.db.QueryContext(
		ctx,
		`select id, payload_json, status, attempt_count, next_attempt_at, retry_until, coalesce(last_error, '')
		 from transfer_jobs
		 where status in ('queued', 'retrying') and next_attempt_at <= ?
		 order by next_attempt_at asc
		 limit ?`,
		time.Now().UTC().Format(time.RFC3339Nano),
		limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var jobs []storedJob
	for rows.Next() {
		var (
			job          storedJob
			payloadJSON  string
			nextAttempt  string
			retryUntil   string
		)
		if err := rows.Scan(
			&job.ID,
			&payloadJSON,
			&job.Status,
			&job.AttemptCount,
			&nextAttempt,
			&retryUntil,
			&job.LastError,
		); err != nil {
			return nil, err
		}
		if err := json.Unmarshal([]byte(payloadJSON), &job.Payload); err != nil {
			return nil, fmt.Errorf("decode payload for %s: %w", job.ID, err)
		}
		if job.NextAttempt, err = time.Parse(time.RFC3339Nano, nextAttempt); err != nil {
			return nil, err
		}
		if job.RetryUntil, err = time.Parse(time.RFC3339Nano, retryUntil); err != nil {
			return nil, err
		}
		jobs = append(jobs, job)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	for _, job := range jobs {
		if _, err := s.db.ExecContext(
			ctx,
			`update transfer_jobs set status = 'processing', updated_at = ? where id = ?`,
			time.Now().UTC().Format(time.RFC3339Nano),
			job.ID,
		); err != nil {
			return nil, err
		}
	}

	return jobs, nil
}

func (s *Store) MarkSucceeded(ctx context.Context, id string) error {
	_, err := s.db.ExecContext(
		ctx,
		`update transfer_jobs set status = 'completed', last_error = null, updated_at = ? where id = ?`,
		time.Now().UTC().Format(time.RFC3339Nano),
		id,
	)
	return err
}

func (s *Store) MarkRetry(ctx context.Context, id string, attemptCount int, nextAttempt time.Time, lastError string) error {
	_, err := s.db.ExecContext(
		ctx,
		`update transfer_jobs
		 set status = 'retrying', attempt_count = ?, next_attempt_at = ?, last_error = ?, updated_at = ?
		 where id = ?`,
		attemptCount,
		nextAttempt.UTC().Format(time.RFC3339Nano),
		lastError,
		time.Now().UTC().Format(time.RFC3339Nano),
		id,
	)
	return err
}

func (s *Store) MarkFailed(ctx context.Context, id string, attemptCount int, lastError string) error {
	_, err := s.db.ExecContext(
		ctx,
		`update transfer_jobs
		 set status = 'failed', attempt_count = ?, last_error = ?, updated_at = ?
		 where id = ?`,
		attemptCount,
		lastError,
		time.Now().UTC().Format(time.RFC3339Nano),
		id,
	)
	return err
}

func (s *Store) Counts(ctx context.Context) (map[string]int, error) {
	rows, err := s.db.QueryContext(
		ctx,
		`select status, count(*) from transfer_jobs group by status`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	counts := map[string]int{
		"completed": 0,
		"failed":    0,
		"processing": 0,
		"queued":    0,
		"retrying":  0,
	}
	for rows.Next() {
		var status string
		var count int
		if err := rows.Scan(&status, &count); err != nil {
			return nil, err
		}
		counts[status] = count
	}
	return counts, rows.Err()
}


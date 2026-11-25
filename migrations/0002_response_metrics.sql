ALTER TABLE supplement_responses RENAME TO supplement_responses_pre_metrics;

CREATE TABLE supplement_responses (
  response_id TEXT PRIMARY KEY NOT NULL,
  ip_key TEXT NOT NULL UNIQUE,
  submitted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  sl1 INTEGER NOT NULL CHECK (sl1 BETWEEN 0 AND 3),
  p_a6 TEXT NOT NULL,
  duration_seconds INTEGER CHECK (duration_seconds >= 0),
  practice_retry_count INTEGER CHECK (practice_retry_count BETWEEN 0 AND 4)
);

-- 已通过控制台添加的指标按原值迁移。早期版本缺少的指标留空。
-- SQLite 从左到右命名子查询的同名列，已有列优先于末尾的 NULL。
INSERT INTO supplement_responses
  (response_id, ip_key, submitted_at, sl1, p_a6, duration_seconds, practice_retry_count)
SELECT response_id, ip_key, submitted_at, sl1, p_a6, duration_seconds, practice_retry_count
FROM (
  SELECT *, NULL AS duration_seconds, NULL AS practice_retry_count
  FROM supplement_responses_pre_metrics
);

CREATE TABLE public.classroom_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_issuer text NOT NULL CHECK (char_length(provider_issuer) BETWEEN 1 AND 512),
  provider_subject text NOT NULL CHECK (char_length(provider_subject) BETWEEN 1 AND 255),
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 120),
  verified_email text CHECK (char_length(verified_email) BETWEEN 1 AND 254),
  account_status text NOT NULL DEFAULT 'active' CHECK (account_status IN ('active', 'disabled')),
  entitlement text NOT NULL DEFAULT 'unknown'
    CHECK (entitlement IN ('active', 'trial', 'expired', 'suspended', 'unknown')),
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  UNIQUE (provider_issuer, provider_subject)
);

CREATE TABLE public.classroom_sessions (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  user_id uuid NOT NULL REFERENCES public.classroom_users(id) ON DELETE CASCADE,
  csrf_token text NOT NULL CHECK (csrf_token ~ '^[A-Za-z0-9_-]{43}$'),
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  expires_at timestamptz NOT NULL CHECK (expires_at > created_at),
  revoked_at timestamptz CHECK (revoked_at >= created_at)
);
CREATE INDEX classroom_sessions_user ON public.classroom_sessions (user_id);
CREATE INDEX classroom_sessions_expiry ON public.classroom_sessions (expires_at);

CREATE TABLE public.classroom_oauth_attempts (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  oauth_state text NOT NULL CHECK (oauth_state ~ '^[A-Za-z0-9_-]{43}$'),
  nonce text NOT NULL CHECK (nonce ~ '^[A-Za-z0-9_-]{43}$'),
  verifier text NOT NULL CHECK (verifier ~ '^[A-Za-z0-9._~-]{43,128}$'),
  expires_at timestamptz NOT NULL
);
CREATE INDEX classroom_oauth_attempts_expiry ON public.classroom_oauth_attempts (expires_at);

CREATE TABLE public.classroom_participant_sessions (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  room_id uuid NOT NULL,
  participant_id uuid NOT NULL,
  csrf_token text NOT NULL CHECK (csrf_token ~ '^[A-Za-z0-9_-]{43}$'),
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  expires_at timestamptz NOT NULL CHECK (expires_at > created_at),
  revoked_at timestamptz CHECK (revoked_at >= created_at)
);
-- The room migration adds the composite participant foreign key.
CREATE INDEX classroom_participant_sessions_participant
  ON public.classroom_participant_sessions (room_id, participant_id);
CREATE INDEX classroom_participant_sessions_expiry
  ON public.classroom_participant_sessions (expires_at);

REVOKE ALL ON public.classroom_users, public.classroom_sessions,
  public.classroom_oauth_attempts, public.classroom_participant_sessions FROM PUBLIC;

GRANT SELECT ON public.classroom_users TO lessonboard_app;
GRANT INSERT (provider_issuer, provider_subject, display_name, verified_email),
  UPDATE (display_name, verified_email, updated_at) ON public.classroom_users TO lessonboard_app;
GRANT SELECT ON public.classroom_sessions, public.classroom_participant_sessions TO lessonboard_app;
GRANT INSERT (token_hash, user_id, csrf_token, expires_at), UPDATE (revoked_at)
  ON public.classroom_sessions TO lessonboard_app;
GRANT INSERT (token_hash, room_id, participant_id, csrf_token, expires_at), UPDATE (revoked_at)
  ON public.classroom_participant_sessions TO lessonboard_app;
GRANT SELECT, INSERT, DELETE ON public.classroom_oauth_attempts TO lessonboard_app;

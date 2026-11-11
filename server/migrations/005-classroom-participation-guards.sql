CREATE OR REPLACE FUNCTION public.classroom_s10_capture(target uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog
  AS $$
    SELECT public.classroom_scope('actor') = 'capture'
       AND target = public.classroom_scope('room_id')::uuid
       AND EXISTS (
         SELECT 1 FROM public.classroom_capture_sessions s
         JOIN public.classroom_capture_grants g ON g.room_id=s.room_id AND g.id=s.grant_id
         JOIN public.classroom_rooms r ON r.id=s.room_id
         WHERE s.room_id=target AND s.id=public.classroom_scope('actor_id')::uuid
           AND g.id=public.classroom_scope('capture_grant_id')::uuid
           AND s.expires_at > statement_timestamp()
           AND g.expires_at > statement_timestamp() AND g.revoked_at IS NULL
           AND r.state IN ('open','locked')
       )
  $$;

CREATE OR REPLACE FUNCTION public.classroom_s10_media_usage(target uuid)
  RETURNS TABLE(objects integer, reserved_bytes bigint)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog
  AS $$
    SELECT count(*)::integer, coalesce(sum(greatest(expected_bytes,coalesce(image_bytes+thumbnail_bytes,2100000))),0)
    FROM public.classroom_media
    WHERE room_id=target AND state <> 'deleted' AND (state <> 'rejected' OR object_key IS NOT NULL)
      AND target=public.classroom_scope('room_id')::uuid
      AND (
        (public.classroom_scope('actor')='teacher' AND EXISTS (
          SELECT 1 FROM public.classroom_rooms WHERE id=target AND owner_id=public.classroom_scope('actor_id')::uuid
        )) OR public.classroom_s10_participant(target) OR public.classroom_s10_capture(target)
      )
  $$;

CREATE FUNCTION public.classroom_s10_limit(target uuid, resource text, maximum integer) RETURNS boolean
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog
  AS $$
  BEGIN
    IF target IS DISTINCT FROM public.classroom_scope('room_id')::uuid THEN RETURN false; END IF;
    IF resource='products' AND public.classroom_s10_participant(target) THEN
      RETURN (SELECT count(*) < maximum FROM public.classroom_products WHERE room_id=target);
    ELSIF resource='help' AND public.classroom_s10_participant(target) THEN
      RETURN (SELECT count(*) < maximum FROM public.classroom_help_requests WHERE room_id=target);
    ELSIF resource='captures' AND public.classroom_s10_capture(target) THEN
      RETURN (SELECT count(*) < maximum FROM public.classroom_captures WHERE room_id=target);
    END IF;
    RETURN false;
  END
  $$;

CREATE FUNCTION public.classroom_s10_redeem_capture(code text, session_id uuid, token text, csrf text)
  RETURNS SETOF public.classroom_capture_grants
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
  AS $$
  DECLARE grant_row public.classroom_capture_grants%ROWTYPE;
  BEGIN
    IF public.classroom_scope('actor') IS DISTINCT FROM 'capture-redeem'
      OR public.classroom_scope('capture_hash') IS DISTINCT FROM code THEN RETURN; END IF;
    SELECT * INTO grant_row FROM public.classroom_capture_grants WHERE code_hash=code;
    IF NOT FOUND THEN RETURN; END IF;
    PERFORM 1 FROM public.classroom_rooms WHERE id=grant_row.room_id AND state IN ('open','locked') FOR UPDATE;
    IF NOT FOUND THEN RETURN; END IF;
    SELECT * INTO grant_row FROM public.classroom_capture_grants
      WHERE code_hash=code AND revoked_at IS NULL AND expires_at > clock_timestamp();
    IF NOT FOUND THEN RETURN; END IF;
    IF (SELECT count(*) FROM public.classroom_capture_sessions
      WHERE room_id=grant_row.room_id AND grant_id=grant_row.id) >= 20 THEN RETURN; END IF;
    INSERT INTO public.classroom_capture_sessions(room_id,id,grant_id,token_hash,csrf_token,expires_at)
      VALUES(grant_row.room_id,session_id,grant_row.id,token,csrf,grant_row.expires_at);
    RETURN NEXT grant_row;
  END
  $$;

REVOKE INSERT ON public.classroom_capture_sessions FROM lessonboard_app;
DROP POLICY classroom_s10_session_create ON public.classroom_capture_sessions;
DROP POLICY classroom_s10_grant_redeem ON public.classroom_capture_grants;
REVOKE ALL ON FUNCTION public.classroom_s10_limit(uuid,text,integer),
  public.classroom_s10_redeem_capture(text,uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.classroom_s10_limit(uuid,text,integer),
  public.classroom_s10_redeem_capture(text,uuid,text,text) TO lessonboard_app;
GRANT UPDATE (lesson_id,surface,page_id) ON public.classroom_board_insertions TO lessonboard_app;

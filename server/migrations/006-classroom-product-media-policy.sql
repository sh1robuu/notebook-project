CREATE FUNCTION public.classroom_s10_read_product_media(target uuid, media uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog
  AS $$
    SELECT public.classroom_s10_participant(target) AND EXISTS (
      SELECT 1
      FROM public.classroom_product_media m
      JOIN public.classroom_products p ON p.room_id=m.room_id AND p.id=m.product_id
      WHERE m.room_id=target AND m.media_id=media AND p.removed_at IS NULL
        AND (p.published OR public.classroom_scope('actor_id')::uuid=ANY(p.audience))
    )
  $$;
REVOKE ALL ON FUNCTION public.classroom_s10_read_product_media(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.classroom_s10_read_product_media(uuid,uuid) TO lessonboard_app;
ALTER POLICY classroom_s10_media_products ON public.classroom_media
  USING (attached_at IS NOT NULL AND public.classroom_s10_read_product_media(room_id,id));

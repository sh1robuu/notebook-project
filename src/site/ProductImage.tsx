export function ProductImage({
  name,
  alt,
  hero = false,
}: {
  name: string;
  alt: string;
  hero?: boolean;
}) {
  return (
    <img
      src={`/product/${name}.webp`}
      srcSet={`/product/${name}-960.webp 960w, /product/${name}.webp 1440w`}
      sizes={
        hero
          ? "(max-width: 1280px) 94vw, 1200px"
          : "(max-width: 760px) 92vw, 760px"
      }
      alt={alt}
      width="1440"
      height="900"
      loading={hero ? "eager" : "lazy"}
      decoding="async"
      fetchPriority={hero ? "high" : undefined}
      data-testid={hero ? "product-hero" : undefined}
    />
  );
}

/**
 * Daylight, not film grain. A soft bloom at the top of the page and a
 * whisper of paper tooth. `.scene` is where a photographic plate lands if
 * one is dropped into web/public/assets/scene/; without it the page is
 * still complete, because the gradients live on body.
 */
export function Atmosphere() {
  return (
    <>
      <div className="scene" aria-hidden="true" />
      <div className="bloom" aria-hidden="true" />
      <div className="grain" aria-hidden="true" />
    </>
  );
}

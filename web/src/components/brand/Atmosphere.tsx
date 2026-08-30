/** Film grain and a soft vignette. Purely decorative, never interactive. */
export function Atmosphere() {
  return (
    <>
      <div className="grain" aria-hidden="true" />
      <div className="vignette" aria-hidden="true" />
    </>
  );
}

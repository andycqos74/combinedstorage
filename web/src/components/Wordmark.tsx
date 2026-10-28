/**
 * The Luggage logo: the tide-line mark plus the "LUGGAGE" wordmark in Quadrillion 200. `size`
 * scales the whole lock-up (1 = 64px tall), matching the design system's Logo component.
 */
export function Wordmark({ size = 1 }: { size?: number }) {
  return (
    <div className="logo" style={{ ['--logo-scale' as string]: size }}>
      <img className="logo-mark" src="/brand/luggage-light.svg" alt="" />
      <span className="logo-word">LUGGAGE</span>
    </div>
  );
}

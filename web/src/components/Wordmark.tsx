/**
 * The Luggage wordmark: a fixed 504x166 composition (icon plate, Caslon lettering and an animated
 * connector trace) that callers scale via CSS. It is laid out at full size and scaled with a
 * transform so nothing is ever clipped.
 */
const TRACE_PATH =
  'M -46 40 H 55 l 4 -3 l 4 6 l 4 -3 H 110 l 5 -2 l 3 4 l 4 -2 H 162 l 6 0 l 5 5 l 6 -21 l 6 29 l 5 -13 l 5 0 H 255 l 4 -3 l 3 5 l 4 -2 H 344';

export function Wordmark() {
  return (
    <div className="brand-mark">
      <img src="/brand/luggage-icon-square.png" alt="" />
      <div className="brand-word">LUGGAGE</div>
      <svg
        className="brand-trace"
        width="273"
        height="61"
        viewBox="0 0 334 74"
        fill="none"
        aria-hidden="true"
      >
        <path d={TRACE_PATH} stroke="#2A86F5" strokeWidth="2.4" />
        <path
          className="trace-live"
          d={TRACE_PATH}
          stroke="#9FD0FF"
          strokeWidth="3"
          pathLength="1000"
          strokeDasharray="90 910"
        />
      </svg>
    </div>
  );
}

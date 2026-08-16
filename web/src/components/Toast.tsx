import { useEffect } from 'react';

/** Brief confirmation for actions that succeeded; failures still surface inline or via alert. */
export function Toast({
  message,
  onDone,
  duration = 2400,
}: {
  message: string;
  onDone: () => void;
  duration?: number;
}) {
  useEffect(() => {
    const timer = setTimeout(onDone, duration);
    return () => clearTimeout(timer);
  }, [message, duration, onDone]);

  return (
    <div className="toast" role="status">
      {message}
    </div>
  );
}

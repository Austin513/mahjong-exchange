import { useEffect, useMemo, useState } from "react";

/** Seconds left until a server-clock deadline, corrected for client/server clock skew. */
export function useCountdown(deadline: number | null, serverNow: number): number | null {
  // Offset is measured when a new server timestamp arrives (render follows receipt closely).
  const offset = useMemo(() => Date.now() - serverNow, [serverNow]);
  const [, setTick] = useState(0);
  useEffect(() => {
    if (deadline === null) return;
    const id = setInterval(() => setTick((t) => t + 1), 500);
    return () => clearInterval(id);
  }, [deadline]);
  if (deadline === null) return null;
  return Math.max(0, Math.ceil((deadline + offset - Date.now()) / 1000));
}

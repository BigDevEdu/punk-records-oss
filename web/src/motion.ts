import { useLayoutEffect, useRef } from "react";
import { useAnimator } from "@astryxdesign/core/hooks";

type AnimatorValues = Partial<Record<"x" | "y" | "scale" | "rotate" | "opacity", number>>;
const REST = { x: 0, y: 0, scale: 1, opacity: 1 };

// Entrada curta com a mola dos componentes do Astryx (que já respeita "reduzir movimento"):
// a cada mudança de `key`, o elemento parte de `from` e assenta no lugar. Antes da pintura, sem piscar.
export function useEnter<T extends HTMLElement>(from: AnimatorValues, key: unknown = null) {
  const ref = useRef<T>(null);
  const animator = useAnimator(ref);
  useLayoutEffect(() => {
    animator.set(from);
    void animator.animate(REST);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return ref;
}

export const RISE = { y: 8, opacity: 0 };
export const SLIDE_IN = { x: 16, opacity: 0 };
export const DROP = { y: -6, opacity: 0 };
export const POP = { scale: 0.96, opacity: 0 };

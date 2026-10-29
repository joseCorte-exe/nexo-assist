"use client";

import { type ReactNode, useRef } from "react";
import { useWholePixelWidth } from "@/lib/use-whole-pixel-width";

/**
 * A span whose width is rounded up to a whole pixel, as nexo.pen lays out text that hugs its content. For text
 * aligned against a right edge, where a fractional width would leave it a fraction of a pixel off the design.
 */
export function WholePixel({ className, text, children }: { className?: string; text: string; children: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);
  useWholePixelWidth(ref, text);
  return (
    <span ref={ref} className={className}>
      {children}
    </span>
  );
}

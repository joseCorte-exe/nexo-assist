"use client";

import { type RefObject, useLayoutEffect, useRef } from "react";

/**
 * An element that hugs its text gets a fractional width, and nexo.pen lays it out on whole pixels: the employee
 * bubble against the right edge would put its text between two pixels, and a row of chips would come out a pixel
 * short each. Rounding the width up to a whole pixel keeps both on the grid without changing how the text wraps.
 */
export function useWholePixelWidth(ref: RefObject<HTMLElement | null>, content: string) {
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const snap = () => {
      element.style.width = "";
      element.style.width = `${Math.ceil(element.getBoundingClientRect().width)}px`;
    };
    snap();
    // The width depends on the font and the window: measure again once the font is in and on every resize.
    void document.fonts.ready.then(snap);
    window.addEventListener("resize", snap);
    return () => window.removeEventListener("resize", snap);
  }, [ref, content]);
}

/**
 * A ref for an element that hugs its text, rounded up to a whole pixel as nexo.pen lays it out: buttons, pills and chips
 * that sit against another element, whose fraction of a pixel would push it off the design.
 */
export function useWholePixelRef<T extends HTMLElement>(content: string) {
  const ref = useRef<T>(null);
  useWholePixelWidth(ref, content);
  return ref;
}

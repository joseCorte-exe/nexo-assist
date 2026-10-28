import type { ComponentProps } from "react";

/** The white surface of nexo.pen: 16 px corners, a hairline and a soft two-layer shadow. */
export const cardSurface = "rounded-2xl bg-white shadow-card outline-1 -outline-offset-[0.5px] outline-card-line";

export function Card({
  as: Tag = "div",
  className = "",
  ...props
}: { as?: "div" | "section" } & ComponentProps<"div">) {
  return <Tag {...props} className={`${cardSurface} ${className}`} />;
}

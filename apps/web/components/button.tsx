import type { ComponentProps } from "react";

const variants = {
  primary: "h-11 w-full justify-center gap-2 bg-cta text-15.5 font-semibold text-white shadow-cta hover:bg-cta-hover",
  // Horizontal padding comes from the caller: a leading icon asks for less on the left.
  secondary:
    "h-9 shrink-0 gap-[7px] bg-white text-13.5 font-medium whitespace-nowrap text-ink-2 shadow-control outline-1 -outline-offset-[0.5px] outline-field hover:bg-desk",
} as const;

/** The two buttons of nexo.pen. Both scale a little on press. */
export function Button({
  variant,
  className = "",
  type = "button",
  ...props
}: { variant: keyof typeof variants } & ComponentProps<"button">) {
  return (
    <button
      {...props}
      type={type}
      className={`flex items-center rounded-lg transition-[background-color,scale] duration-150 ease-out active:scale-[0.96] aria-disabled:cursor-progress ${variants[variant]} ${className}`}
    />
  );
}

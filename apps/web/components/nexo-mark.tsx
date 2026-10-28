// The Nexo "N". Drawn exactly as nexo.pen draws it: the path keeps its size and sits in a square frame
// that clips its right edge, so a smaller frame shows less of the right leg.
export function NexoMark({ size, color }: { size: number; color: string }) {
  return (
    <span aria-hidden className="relative shrink-0 overflow-hidden" style={{ width: size, height: size }}>
      <svg
        viewBox="8.344650268554688e-7 0.000003725290298461914 24.387999653816223 20.638622373342514"
        preserveAspectRatio="none"
        className="absolute overflow-visible"
        style={{ left: 1.806, top: 3.682, width: 24.388, height: 20.639 }}
      >
        <path
          fill={color}
          d="M21.763 0.24493l-3.374 1.687c-0.623 0.308-0.973 0.903-0.973 1.631l0 6.293-11.193-9.429c-0.623-0.469-1.372-0.553-2.03-0.245l-3.185 1.631c-0.651 0.322-1.008 0.924-1.008 1.673l0 15.218c0 1.477 1.526 2.289 2.716 1.785l3.073-1.617c0.693-0.322 1.057-0.952 1.057-1.722l0-7.7 11.732 10.591c0.602 0.546 1.421 0.679 2.086 0.364l2.786-1.505c0.602-0.315 0.938-0.931 0.938-1.68l0-15.288c0-1.463-1.505-2.275-2.625-1.687z"
        />
      </svg>
    </span>
  );
}

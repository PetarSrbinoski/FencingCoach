/** Abstract wire studies inspired by the reference; these are not data plots. */
export function SignalForm({ variant }: { variant: number }) {
  return (
    <svg className="signal-form" viewBox="0 0 240 200" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <g fill="none" stroke="white" strokeWidth=".8">
        {variant === 0 && Array.from({ length: 16 }, (_, index) => (
          <ellipse key={index} cx="120" cy={25 + index * 10}
            rx={12 + Math.abs(Math.cos(index / 15 * Math.PI)) * 70} ry="18" opacity={.3 + index / 32} />
        ))}
        {variant === 1 && Array.from({ length: 5 }, (_, index) => {
          const path = Array.from({ length: 81 }, (_, step) => {
            const t = step / 80;
            const y = 108 + Math.sin(t * Math.PI * (2 + index * .5)) * Math.sin(t * Math.PI) * (25 + index * 8);
            return `${step ? "L" : "M"}${20 + t * 200},${y}`;
          }).join(" ");
          return <path key={index} d={path} opacity={.45 + index * .1} />;
        })}
        {variant === 2 && Array.from({ length: 5 }, (_, index) => (
          <path key={index} d={`M25 157 C${30 + index * 8} ${100 - index * 21},${90 + index * 22} ${86 - index * 24},${115 + index * 23} 157`} opacity={.45 + index * .1} />
        ))}
        {variant === 3 && Array.from({ length: 10 }, (_, index) => (
          <ellipse key={index} cx="120" cy={48 + index * 11} rx={75 - index * 6.5} ry={13 - index * .8} opacity={.35 + index * .06} />
        ))}
        {variant === 4 && Array.from({ length: 8 }, (_, index) => (
          <ellipse key={index} cx="120" cy="106" rx={22 + index * 6} ry={65 - index * 2} transform={`rotate(${index * 15 - 52} 120 106)`} opacity={.4 + index * .07} />
        ))}
      </g>
      <circle cx={variant === 1 ? 220 : variant === 2 ? 25 : 120}
        cy={variant === 1 ? 108 : variant === 2 ? 157 : variant === 3 ? 160 : 103}
        r="3.5" className="signal-point" />
    </svg>
  );
}

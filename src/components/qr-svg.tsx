import { encode } from 'uqr';

// Runs of dark modules keep the path compact.
export function QrSvg({
  value,
  label,
  className,
  testId,
}: {
  value: string;
  label: string;
  className?: string;
  testId?: string;
}) {
  const { data } = encode(value, { ecc: 'M', border: 4 });
  const size = data.length;
  const runs: string[] = [];
  data.forEach((row, y) => {
    let x = 0;
    while (x < size) {
      if (!row[x]) {
        x += 1;
        continue;
      }
      let length = 1;
      while (x + length < size && row[x + length]) length += 1;
      runs.push(`M${x} ${y}h${length}v1h-${length}z`);
      x += length;
    }
  });
  return (
    <svg
      className={className}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
      data-testid={testId}
    >
      <rect width={size} height={size} fill="#ffffff" />
      <path d={runs.join('')} fill="#000000" />
    </svg>
  );
}

/** Hand-drawn inline SVG icons (no icon font, no third-party art). 24-unit grid, currentColor. */
import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { title?: string };

function Svg({ title, children, ...rest }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      {...rest}
    >
      {title && <title>{title}</title>}
      {children}
    </svg>
  );
}

export const XIcon = (p: IconProps) => (
  <Svg strokeWidth={3} {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Svg>
);

export const GearIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3.2" />
    <path d="M12 2.8v2.6M12 18.6v2.6M2.8 12h2.6M18.6 12h2.6M5.5 5.5l1.8 1.8M16.7 16.7l1.8 1.8M5.5 18.5l1.8-1.8M16.7 7.3l1.8-1.8" />
  </Svg>
);

export const QuestionIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9.5" />
    <path d="M9.2 9.3a2.9 2.9 0 1 1 4.2 2.6c-1 .5-1.4 1.1-1.4 2.1" />
    <circle cx="12" cy="17.2" r="0.6" fill="currentColor" />
  </Svg>
);

export const InfoIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9.5" />
    <path d="M12 11v6" />
    <circle cx="12" cy="7.6" r="0.6" fill="currentColor" />
  </Svg>
);

export const CheckIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9.5" />
    <path d="M7.5 12.3l3 3 6-6.5" />
  </Svg>
);

export const WarningIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3.5L21.5 20h-19z" />
    <path d="M12 9.5v5" />
    <circle cx="12" cy="17.3" r="0.6" fill="currentColor" />
  </Svg>
);

export const AlertIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 3h8l5 5v8l-5 5H8l-5-5V8z" />
    <path d="M12 8v5" />
    <circle cx="12" cy="16.3" r="0.6" fill="currentColor" />
  </Svg>
);

export const ElevatorIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="4" y="3" width="16" height="18" rx="2" />
    <path d="M12 3v18M8 10l1.5-2 1.5 2M8 14l1.5 2 1.5-2" />
  </Svg>
);

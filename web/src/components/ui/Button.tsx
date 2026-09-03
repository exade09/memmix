import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";
import { Link, type LinkProps } from "react-router-dom";

export type ButtonVariant = "primary" | "secondary" | "outline" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

function classes(variant: ButtonVariant, size: ButtonSize, extra: string, block?: boolean) {
  return ["btn", variant, size === "md" ? "" : size, block ? "block" : "", extra]
    .filter(Boolean)
    .join(" ");
}

export function ArrowGlyph() {
  return (
    <span className="btn-arrow" aria-hidden="true">
      <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2.5 6h7M6.5 3l3 3-3 3" />
      </svg>
    </span>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  arrow?: boolean;
};

export function Button({
  variant = "secondary",
  size = "md",
  block,
  arrow,
  className = "",
  children,
  ...props
}: ButtonProps) {
  return (
    <button className={classes(variant, size, className, block)} {...props}>
      <span className="btn-label">{children}</span>
      {arrow ? <ArrowGlyph /> : null}
    </button>
  );
}

type ButtonLinkProps = LinkProps & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  arrow?: boolean;
};

export function ButtonLink({
  variant = "secondary",
  size = "md",
  block,
  arrow,
  className = "",
  children,
  ...props
}: ButtonLinkProps) {
  return (
    <Link className={classes(variant, size, className, block)} {...props}>
      <span className="btn-label">{children}</span>
      {arrow ? <ArrowGlyph /> : null}
    </Link>
  );
}

type ExternalButtonProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  arrow?: boolean;
};

export function ButtonAnchor({
  variant = "secondary",
  size = "md",
  block,
  arrow,
  className = "",
  children,
  ...props
}: ExternalButtonProps) {
  return (
    <a className={classes(variant, size, className, block)} {...props}>
      <span className="btn-label">{children}</span>
      {arrow ? <ArrowGlyph /> : null}
    </a>
  );
}

/** A file input dressed as a button, so uploads match every other action. */
export function FileButton({
  children,
  accept = "image/png,image/jpeg,image/webp",
  disabled,
  variant = "outline",
  size = "md",
  className = "",
  onFile,
}: {
  children: ReactNode;
  accept?: string;
  disabled?: boolean;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  onFile: (file: File) => void;
}) {
  return (
    <label className={`${classes(variant, size, className)} btn-file${disabled ? " is-disabled" : ""}`}>
      <span className="btn-label">{children}</span>
      <input
        type="file"
        accept={accept}
        disabled={disabled}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) onFile(file);
        }}
      />
    </label>
  );
}

import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';

type Props = {
  /** 點擊導向（預設 /ops） */
  to?: string;
  className?: string;
  style?: CSSProperties;
  /** 地圖浮層等較大字級 */
  large?: boolean;
};

export function BihLogo({ to = '/ops', className, style, large }: Props) {
  const content = (
    <span
      className={`bih-logo bih-logo-text-only${large ? ' bih-logo-large' : ''}${className ? ` ${className}` : ''}`}
      style={style}
    >
      <span className="bih-logo-wordmark">BIH</span>
    </span>
  );

  if (to) {
    return (
      <Link to={to} className="bih-logo-link" aria-label="Beacon Intelligence Hub">
        {content}
      </Link>
    );
  }

  return content;
}

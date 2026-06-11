import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';

type Props = {
  /** 圖示高度（px） */
  size?: number;
  /** 顯示 BIH 字樣 */
  showWordmark?: boolean;
  /** 點擊導向（預設 /ops） */
  to?: string;
  className?: string;
  style?: CSSProperties;
};

export function BihLogo({
  size = 32,
  showWordmark = true,
  to = '/ops',
  className,
  style,
}: Props) {
  const content = (
    <span className={`bih-logo${className ? ` ${className}` : ''}`} style={style}>
      <img
        src="/bih-logo.svg"
        alt=""
        width={size}
        height={size}
        className="bih-logo-mark"
        aria-hidden
      />
      {showWordmark && <span className="bih-logo-wordmark">BIH</span>}
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

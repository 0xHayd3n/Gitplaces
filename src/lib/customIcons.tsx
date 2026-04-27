import { useId, type CSSProperties } from 'react'

interface IconProps {
  size?: number
  color?: string
  style?: CSSProperties
}

/** Roc — official logo from roc-lang/design-assets (UPL-1.0). Multi-color, ignores `color` prop. */
export function IconRoc({ size = 16, style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 50.5 53" fill="none" xmlns="http://www.w3.org/2000/svg" style={style}>
      <path d="M23.6751 22.7086L17.655 53L27.4527 45.2132L26.4673 39.3424L23.6751 22.7086Z" fill="#612bde" />
      <path d="M37.2438 19.0101L44.0315 26.3689L45 22L45.9665 16.6324L37.2438 19.0101Z" fill="#8257e5" />
      <path d="M23.8834 3.21052L0 0L23.6751 22.7086L23.8834 3.21052Z" fill="#8257e5" />
      <path d="M44.0315 26.3689L23.6751 22.7086L26.4673 39.3424L44.0315 26.3689Z" fill="#8257e5" />
      <path d="M50.5 22L45.9665 16.6324L45 22H50.5Z" fill="#612bde" />
      <path d="M23.6751 22.7086L44.0315 26.3689L37.2438 19.0101L23.8834 3.21052L23.6751 22.7086Z" fill="#612bde" />
    </svg>
  )
}

/** Pkl — official mascot from apple/pkl (Apache 2.0). Multi-color flower, ignores `color` prop. */
export function IconPkl({ size = 16, style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 100.58 98.63" xmlns="http://www.w3.org/2000/svg" style={style}>
      <path d="m75.57,19.78l2.43-13.25c-3.69-2.46-7.7-4.42-11.91-5.83l-8.97,10.05c-4.37-.8-8.85-.83-13.23-.08L35.03.5c-4.23,1.35-8.26,3.26-11.99,5.68l2.26,13.28c-3.35,2.92-6.17,6.4-8.32,10.3l-13.46.58c-1.58,4.15-2.6,8.49-3.03,12.91l11.8,6.51c.19,4.44,1.16,8.81,2.86,12.92l-7.94,10.89c2.26,3.82,5.02,7.33,8.2,10.42l12.45-5.16c3.59,2.62,7.62,4.59,11.89,5.82l3.56,13c4.4.62,8.86.64,13.26.08l3.72-12.95c4.29-1.17,8.34-3.09,11.96-5.67l12.38,5.32c3.22-3.05,6.03-6.52,8.33-10.32l-7.8-10.99c1.75-4.08,2.78-8.45,3.03-12.88l11.88-6.36c-.38-4.42-1.34-8.78-2.87-12.95l-13.45-.75c-2.1-3.92-4.87-7.44-8.19-10.4Z" fill="#6b9543" />
      <circle cx="51.05" cy="47.72" r="31.49" fill="#e9f4ca" />
      <g>
        <path d="m28.79,62.54c8.22,14.22,24.82,18.97,20.85-10.47h0c-.31-2.29-1.56-4.35-3.45-5.68-24.66-17.36-26.37.64-17.4,16.15Zm15.42-8.25h0c.7-.17,1.24.13,1.49.83,3.27,9.16-2.6,12.49-6.71,10.44-3.77-1.88-3.77-9.01,5.22-11.27Zm-2.14-5.45c.48.57.47,1.19-.03,1.7h0c-6.44,6.67-12.62,3.1-12.37-1.09.27-4.58,6.09-8.01,12.4-.61Z" fill="#c8d987" />
        <ellipse cx="38.62" cy="55.01" rx="7.64" ry="14.03" transform="translate(-22.33 26.68) rotate(-30)" fill="#c8d987" />
      </g>
      <g>
        <path d="m49.34,21.03c-16.42.01-28.84,12.01-1.36,23.29h0c2.14.88,4.54.82,6.64-.15,27.37-12.67,12.63-23.16-5.29-23.15Zm-.56,17.48h0c-.2.69-.73,1.01-1.46.88-9.57-1.75-9.52-8.5-5.69-11.03,3.51-2.32,9.69,1.24,7.15,10.16Zm5.79.87c-.73.13-1.27-.18-1.46-.88h0c-2.56-8.91,3.62-12.48,7.13-10.17,3.83,2.53,3.9,9.28-5.67,11.04Z" fill="#c8d987" />
        <ellipse cx="50.94" cy="33.31" rx="14.03" ry="7.64" fill="#c8d987" />
      </g>
      <g>
        <path d="m75.02,59.59c8.2-14.23,4.02-30.98-19.5-12.82h0c-1.83,1.41-2.99,3.52-3.19,5.83-2.71,30.04,13.74,22.52,22.69,7Zm-14.86-9.23h0c-.5-.52-.51-1.14-.03-1.7,6.3-7.41,12.12-3.99,12.4.59.26,4.2-5.92,7.77-12.37,1.11Zm-3.65,4.58c.25-.7.79-1,1.49-.83h0c8.99,2.24,9,9.38,5.24,11.26-4.1,2.05-9.98-1.26-6.73-10.43Z" fill="#c8d987" />
        <ellipse cx="63.58" cy="54.83" rx="14.03" ry="7.64" transform="translate(-15.7 82.48) rotate(-60)" fill="#c8d987" />
      </g>
    </svg>
  )
}

/** LIGO — favicon from ligolang.org (Tezos / Marigold). Mono — recolors via `color` prop (currentColor). */
export function IconLigo({ size = 16, color, style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 59.4 59.4" xmlns="http://www.w3.org/2000/svg" style={{ color: color ?? '#0E74FF', ...style }}>
      <path fill="currentColor" d="M58.8,29.7c0-3.8-0.8-7.5-2.2-11.1l0,0c-2.9-7.1-8.8-13-16.1-15.9C37,1.4,33.4,0.6,29.7,0.6c-3.1,0-6.3,0.5-9.2,1.5C8.7,6.1,0.6,17.2,0.6,29.7c0,16.1,13,29.1,29.1,29.1c12.6,0,23.7-8,27.7-20.1l0,0C58.3,35.8,58.8,32.7,58.8,29.7z M41.4,6c5.1,2.5,9.2,6.7,11.7,11.6H41.4V6z M40.7,20.4h13.8c1.1,2.9,1.7,6.1,1.7,9.2c0,2.4-0.4,4.9-1,7.2h-31l8.2-8.2L40.7,20.4z M38.7,4.8v13.6L22.2,35V4.3C27.6,2.8,33.4,3,38.7,4.8z M29.7,56C15.1,56,3.3,44.2,3.3,29.6c0-10.7,6.5-20.3,16.3-24.4v33c0,0.2,0,0.4,0.1,0.5l0,0l0,0c0.1,0.3,0.4,0.6,0.7,0.7l0,0l0,0c0.2,0.1,0.3,0.1,0.5,0.1h33.3C50.1,49.6,40.5,56,29.7,56z" />
    </svg>
  )
}

/** Move — symbol-only variant from move-language/move (icon is wide oval). Multi-color with gradients;
 * useId() makes gradient IDs unique per render so multiple instances on the same page don't collide. */
export function IconMove({ size = 16, style }: IconProps) {
  const uid = useId().replace(/:/g, '')
  const g1 = `move-g1-${uid}`
  const g2 = `move-g2-${uid}`
  return (
    <svg width={size} height={size} viewBox="0 0 259 166" xmlns="http://www.w3.org/2000/svg" style={style}>
      <defs>
        <linearGradient id={g1} gradientUnits="userSpaceOnUse" x1="9.2368" y1="84.1764" x2="209.7086" y2="84.1764">
          <stop offset="0.2383" stopColor="#113BD9" />
          <stop offset="0.7404" stopColor="#1676EA" />
          <stop offset="1" stopColor="#188FF1" />
        </linearGradient>
        <linearGradient id={g2} gradientUnits="userSpaceOnUse" x1="111.3756" y1="83.1338" x2="251.2005" y2="83.1338">
          <stop offset="0" stopColor="#23C6F5" />
          <stop offset="0.4286" stopColor="#25CFF5" />
          <stop offset="0.9956" stopColor="#28E3F5" />
        </linearGradient>
      </defs>
      <path fill={`url(#${g1})`} d="M177,50.79H41.94c-18.06,0-32.71,14.64-32.71,32.71v1.37c0,18.06,14.64,32.71,32.71,32.71H177c18.06,0,32.71-14.64,32.71-32.71v-1.37C209.71,65.43,195.07,50.79,177,50.79z" />
      <path opacity="0.1" d="M176.31,50.77h-61.18c-5.06,9.68-7.93,20.69-7.93,32.36c0,12.52,3.29,24.27,9.05,34.43l60.05,0c18.45,0,33.4-14.95,33.4-33.4v0C209.71,65.72,194.76,50.77,176.31,50.77z" />
      <circle opacity="0.85" fill={`url(#${g2})`} cx="181.29" cy="83.13" r="69.91" />
    </svg>
  )
}

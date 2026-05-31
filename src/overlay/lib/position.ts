/**
 * Compute the popup's document-coords top/left given the anchor rect
 * and the popup's measured size. Below-anchor by default; flips above
 * when below would clip the viewport. Clamps horizontally to keep the
 * popup fully on-screen.
 *
 * Ported from content.js positionPopup (pre-Task-6 lines 442-470).
 */
export interface AnchorRect {
  top: number;
  left: number;
  bottom: number;
  right: number;
  width: number;
  height: number;
}

export interface PopupSize {
  width: number;
  height: number;
}

export interface Position {
  top: number;
  left: number;
}

const GAP = 8;
const EDGE = 8;

export function computePosition(anchor: AnchorRect, size: PopupSize): Position {
  // Viewport scroll offsets — anchor is in document coords, the viewport
  // edge calculation needs them.
  const sx = window.scrollX || window.pageXOffset || 0;
  const sy = window.scrollY || window.pageYOffset || 0;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // Preferred placement: below the anchor, left-aligned.
  let top = anchor.bottom + GAP;
  let left = anchor.left;

  // Flip above when below would clip the viewport bottom.
  const fitsBelow = (anchor.bottom + GAP + size.height) <= (sy + vh - EDGE);
  if (!fitsBelow) {
    const fitsAbove = (anchor.top - GAP - size.height) >= (sy + EDGE);
    if (fitsAbove) {
      top = anchor.top - GAP - size.height;
    } else {
      // Neither fits — pick the side with more room.
      const roomBelow = (sy + vh) - anchor.bottom;
      const roomAbove = anchor.top - sy;
      if (roomAbove > roomBelow) {
        top = Math.max(sy + EDGE, anchor.top - GAP - size.height);
      } else {
        top = anchor.bottom + GAP;
      }
    }
  }

  // Horizontal clamp: keep the popup fully on-screen.
  const minLeft = sx + EDGE;
  const maxLeft = sx + vw - size.width - EDGE;
  if (left < minLeft) left = minLeft;
  if (left > maxLeft) left = Math.max(minLeft, maxLeft);

  return { top, left };
}

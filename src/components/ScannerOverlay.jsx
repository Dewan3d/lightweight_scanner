import { useState, useEffect } from 'react';

export default function ScannerOverlay({ isWide = false, scanMode = 'single', activeSlot = 'serial' }) {
  const [windowWidth, setWindowWidth] = useState(
    typeof window !== 'undefined' ? window.innerWidth : 360
  );

  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // For 17-character serial barcodes, allow up to 92% of the screen width (max 440px)
  const width = isWide ? Math.min(Math.floor(windowWidth * 0.92), 440) : 260;
  const height = isWide ? 130 : 260;
  const xTranslate = -width / 2;
  const yTranslate = -height / 2;

  let guideText = 'Align barcode within frame';
  if (scanMode === 'single') {
    guideText = 'Align 17-digit Serial Barcode (starts with P-...)';
  } else if (scanMode === 'dual') {
    guideText = activeSlot === 'serial'
      ? 'Step 1: Align Serial Barcode (e.g. P-...)'
      : 'Step 2: Align PayGo Barcode (9 digits)';
  }

  return (
    <div className="scanner-overlay">
      {/* Semi-transparent mask with a clear cutout in the center */}
      <svg
        width="100%"
        height="100%"
        style={{ position: 'absolute', inset: 0 }}
      >
        <defs>
          <mask id="scanner-mask">
            {/* White = visible (dark overlay), black = transparent (cutout) */}
            <rect width="100%" height="100%" fill="white" />
            <rect
              x="50%"
              y="50%"
              width={width}
              height={height}
              rx="16"
              ry="16"
              fill="black"
              transform={`translate(${xTranslate}, ${yTranslate})`}
            />
          </mask>
        </defs>
        <rect
          width="100%"
          height="100%"
          fill="rgba(0,0,0,0.6)"
          mask="url(#scanner-mask)"
        />
      </svg>

      {/* Corner brackets for the cutout */}
      <div
        className="scanner-cutout"
        style={{
          width: width,
          height: height,
          border: '3px solid rgba(255, 255, 255, 0.3)', /* soft border, corners highlight */
        }}
      >
        {/* Top-left corner */}
        <div
          style={{
            position: 'absolute',
            top: -2,
            left: -2,
            width: 24,
            height: 24,
            borderTop: '4px solid #fff',
            borderLeft: '4px solid #fff',
            borderTopLeftRadius: 12,
          }}
        />
        {/* Top-right corner */}
        <div
          style={{
            position: 'absolute',
            top: -2,
            right: -2,
            width: 24,
            height: 24,
            borderTop: '4px solid #fff',
            borderRight: '4px solid #fff',
            borderTopRightRadius: 12,
          }}
        />
        {/* Bottom-left corner */}
        <div
          style={{
            position: 'absolute',
            bottom: -2,
            left: -2,
            width: 24,
            height: 24,
            borderBottom: '4px solid #fff',
            borderLeft: '4px solid #fff',
            borderBottomLeftRadius: 12,
          }}
        />
        {/* Bottom-right corner */}
        <div
          style={{
            position: 'absolute',
            bottom: -2,
            right: -2,
            width: 24,
            height: 24,
            borderBottom: '4px solid #fff',
            borderRight: '4px solid #fff',
            borderBottomRightRadius: 12,
          }}
        />
      </div>

      {/* Instruction text */}
      <div
        style={{
          position: 'absolute',
          bottom: '22%',
          left: 0,
          right: 0,
          textAlign: 'center',
          color: 'rgba(255,255,255,0.9)',
          fontSize: '0.875rem',
          fontWeight: 600,
          textShadow: '0 2px 4px rgba(0,0,0,0.8)',
        }}
      >
        {guideText}
      </div>
    </div>
  );
}

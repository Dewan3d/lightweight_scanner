import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import ScannerOverlay from '../components/ScannerOverlay';
import { ArrowLeft, ScanLine, Layers, RefreshCw, CheckCircle2 } from 'lucide-react';
import { isPaygoBarcode, isSerialBarcode, classifyBarcode } from '../utils/barcodeClassifier';

export default function ScannerPage() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const html5QrcodeRef = useRef(null);
  const lastScannedRef = useRef('');
  const cooldownRef = useRef(false);

  // UI States
  const [showFlash, setShowFlash] = useState(false);
  const [isStarting, setIsStarting] = useState(true);
  const [isWide, setIsWide] = useState(true); // Default to Wide (horizontal) for long barcodes/serial numbers
  const [scanMode, setScanMode] = useState('single'); // Default to 'single' (Serial Number only) as requested
  const [activeSlot, setActiveSlot] = useState('serial'); // 'serial' or 'paygo'

  // Dual Scan values
  const [serialValue, setSerialValue] = useState('');
  const [paygoValue, setPaygoValue] = useState('');

  // Audio feedback fallback (synthesized beep)
  const playBeep = () => {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.value = 800; // Hz
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      osc.start();
      osc.stop(ctx.currentTime + 0.15); // beep duration 150ms
    } catch (e) {
      console.warn('Audio feedback not supported or blocked:', e);
    }
  };

  // Check if an error is a duplicate key violation (Postgres 23505)
  const isDuplicateError = useCallback((err) => {
    if (!err) return false;
    // Supabase surfaces the Postgres error code in the error object
    if (err.code === '23505') return true;
    // Fallback: check the message for unique constraint text
    const msg = (err.message || '').toLowerCase();
    return msg.includes('unique') || msg.includes('duplicate') || msg.includes('23505');
  }, []);

  // Handle scans rate limiting and general DB insert errors
  const handleScanError = useCallback((err) => {
    // Silently ignore duplicate barcode errors — the user sees normal beep + flash
    if (isDuplicateError(err)) {
      console.log('Duplicate barcode ignored (already exists in this branch).');
      return;
    }
    console.error('Scan save error:', err);
    if (err && err.message && err.message.includes('Rate limit exceeded')) {
      toast.error('Scanning too fast! Please wait a moment.', {
        position: 'bottom-center',
        duration: 4000,
        style: {
          background: 'var(--color-error)',
          color: '#fff',
          fontWeight: 600,
        },
      });
    } else {
      toast.error(err?.message || 'Failed to save scan', { position: 'bottom-center' });
    }
  }, [isDuplicateError]);

  // Main callback when a barcode is decoded
  const handleScanSuccess = useCallback(
    async (decodedText) => {
      // Debounce: ignore repeated identical scans within cooldown
      if (cooldownRef.current || decodedText === lastScannedRef.current) return;

      const isPaygo = isPaygoBarcode(decodedText);
      const isSerial = isSerialBarcode(decodedText);

      // SINGLE SCAN MODE: Exclusively capture the 17-character Serial Number
      if (scanMode === 'single') {
        if (isPaygo) {
          // Temporarily remember this scan to avoid toast spam
          lastScannedRef.current = decodedText;
          setTimeout(() => {
            if (lastScannedRef.current === decodedText) {
              lastScannedRef.current = '';
            }
          }, 800);

          // Alert user that PayGo was detected and skipped
          toast.error(`Ignored PayGo (${decodedText}). Please aim at the 17-digit Serial number (e.g. P-...).`, {
            id: 'paygo-ignored',
            duration: 2500,
            position: 'bottom-center',
            style: {
              background: '#854d0e',
              color: '#fff',
              fontWeight: 600,
              fontSize: '0.85rem',
            },
          });
          return;
        }

        // It is a valid serial number (or non-paygo barcode)
        cooldownRef.current = true;
        lastScannedRef.current = decodedText;

        playBeep();
        setShowFlash(true);
        setTimeout(() => setShowFlash(false), 400);

        toast.success(`Scanned Serial: ${decodedText}`, {
          duration: 2000,
          position: 'bottom-center',
        });

        try {
          const { error } = await supabase.from('scans').insert({
            barcode: decodedText,
            scanned_by: user.id,
            branch_id: profile.branch_id,
          });
          if (error) throw error;
        } catch (err) {
          handleScanError(err);
        }
      } else {
        // DUAL SCAN MODE: Smart auto-routing based on barcode pattern
        cooldownRef.current = true;
        lastScannedRef.current = decodedText;

        playBeep();
        setShowFlash(true);
        setTimeout(() => setShowFlash(false), 400);

        if (isSerial || (!isPaygo && activeSlot === 'serial')) {
          setSerialValue(decodedText);
          toast.success(`Serial captured: ${decodedText}`, { position: 'bottom-center' });
          if (!paygoValue) {
            setActiveSlot('paygo');
          }
        } else if (isPaygo || activeSlot === 'paygo') {
          setPaygoValue(decodedText);
          toast.success(`PayGo captured: ${decodedText}`, { position: 'bottom-center' });
          if (!serialValue) {
            setActiveSlot('serial');
          }
        }
      }

      // Reset debounce cooldown
      setTimeout(() => {
        cooldownRef.current = false;
        lastScannedRef.current = '';
      }, 1500);
    },
    [user, profile, scanMode, activeSlot, serialValue, paygoValue, handleScanError]
  );

  // Triggered when both values in Dual Mode are filled
  useEffect(() => {
    if (scanMode === 'dual' && serialValue && paygoValue) {
      async function saveDualScan() {
        toast.loading('Saving complete record...', { id: 'save-loader', position: 'bottom-center' });
        try {
          const { error } = await supabase.from('scans').insert({
            barcode: serialValue,
            paygo: paygoValue,
            scanned_by: user.id,
            branch_id: profile.branch_id,
          });

          if (error) throw error;

          toast.dismiss('save-loader');
          toast.success(`Saved: SN + Paygo successfully linked!`, {
            duration: 3000,
            position: 'bottom-center',
            style: {
              background: 'var(--color-success)',
              color: '#fff',
              fontWeight: 600,
            },
          });

          // Reset slots for next box
          setSerialValue('');
          setPaygoValue('');
          setActiveSlot('serial');
        } catch (err) {
          toast.dismiss('save-loader');
          handleScanError(err);
        }
      }

      saveDualScan();
    }
  }, [serialValue, paygoValue, scanMode, user, profile, handleScanError]);

  // Restart camera when isWide changes (so qrbox shape updates dynamically)
  useEffect(() => {
    let html5Qrcode = null;
    setIsStarting(true);

    async function startScanner() {
      html5Qrcode = new Html5Qrcode('scanner-reader');
      html5QrcodeRef.current = html5Qrcode;

      try {
        let cameraSelector = { facingMode: 'environment' };

        try {
          const devices = await Html5Qrcode.getCameras();
          if (devices && devices.length > 0) {
            const backCamera = devices.find((device) => {
              const label = device.label.toLowerCase();
              return (
                label.includes('back') ||
                label.includes('environment') ||
                label.includes('rear') ||
                label.includes('out')
              );
            });
            cameraSelector = backCamera ? { deviceId: backCamera.id } : { deviceId: devices[0].id };
          }
        } catch (e) {
          console.warn('Failed to query cameras, falling back to facingMode:', e);
        }

        // Configure qrbox dynamically so long 17-character barcodes fit without getting clipped
        const qrboxConfig = isWide
          ? (viewfinderWidth, viewfinderHeight) => {
              const width = Math.min(Math.floor(viewfinderWidth * 0.92), 480);
              const height = Math.min(Math.floor(viewfinderHeight * 0.32), 160);
              return { width: Math.max(width, 280), height: Math.max(height, 100) };
            }
          : (viewfinderWidth, viewfinderHeight) => {
              const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
              const size = Math.floor(minEdge * 0.72);
              return { width: size, height: size };
            };

        await html5Qrcode.start(
          cameraSelector,
          {
            fps: 20,
            qrbox: qrboxConfig,
            videoConstraints: {
              width: { min: 1280, ideal: 1920, max: 2560 },
              height: { min: 720, ideal: 1080, max: 1440 },
              facingMode: 'environment',
              advanced: [{ focusMode: 'continuous' }],
            },
            formatsToSupport: [
              Html5QrcodeSupportedFormats.CODE_128,
              Html5QrcodeSupportedFormats.CODE_39,
              Html5QrcodeSupportedFormats.CODE_93,
              Html5QrcodeSupportedFormats.QR_CODE,
              Html5QrcodeSupportedFormats.DATA_MATRIX,
              Html5QrcodeSupportedFormats.UPC_A,
              Html5QrcodeSupportedFormats.UPC_E,
              Html5QrcodeSupportedFormats.EAN_13,
              Html5QrcodeSupportedFormats.EAN_8,
            ],
            useBarCodeDetectorIfSupported: true,
          },
          handleScanSuccess,
          () => {} /* ignore frame decode failures */
        );
        setIsStarting(false);
      } catch (err) {
        console.error('Camera startup error:', err);
        setIsStarting(false);
        toast.error('Could not access camera. Check device permissions.', {
          position: 'bottom-center',
          duration: 4000,
        });
      }
    }

    startScanner();

    return () => {
      if (html5Qrcode) {
        if (html5Qrcode.isScanning) {
          html5Qrcode.stop().catch(console.error);
        }
      }
    };
  }, [isWide, handleScanSuccess]);

  const resetSlots = () => {
    setSerialValue('');
    setPaygoValue('');
    setActiveSlot('serial');
    toast.success('Slots cleared');
  };

  return (
    <div className="scanner-container flex flex-col">
      {/* Top Header Panel (Controls) */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 55,
          background: 'linear-gradient(to bottom, rgba(0,0,0,0.85) 70%, transparent)',
          padding: '1rem 1rem 2rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.75rem',
        }}
      >
        {/* Navigation & Shape Controls */}
        <div className="flex items-center justify-between">
          <button
            onClick={() => navigate('/dashboard')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.375rem',
              background: 'rgba(255,255,255,0.15)',
              color: '#fff',
              border: 'none',
              padding: '0.5rem 0.75rem',
              borderRadius: '0.5rem',
              fontSize: '0.875rem',
              cursor: 'pointer',
              minHeight: 40,
            }}
          >
            <ArrowLeft size={16} />
            Dashboard
          </button>

          <div className="flex gap-2">
            {/* Viewfinder Shape Toggle */}
            <button
              onClick={() => setIsWide(!isWide)}
              title="Toggle Viewfinder Frame"
              style={{
                background: isWide ? 'var(--color-primary)' : 'rgba(255,255,255,0.15)',
                color: '#fff',
                border: 'none',
                padding: '0.5rem',
                borderRadius: '0.5rem',
                minHeight: 40,
                width: 40,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
              }}
            >
              <ScanLine size={18} />
            </button>

            {/* Scan Mode Toggle */}
            <button
              onClick={() => {
                const nextMode = scanMode === 'single' ? 'dual' : 'single';
                setScanMode(nextMode);
                resetSlots();
              }}
              title="Toggle Scan Mode"
              style={{
                background: scanMode === 'dual' ? 'var(--color-primary)' : 'rgba(255,255,255,0.15)',
                color: '#fff',
                border: 'none',
                padding: '0.5rem 0.75rem',
                borderRadius: '0.5rem',
                minHeight: 40,
                display: 'flex',
                alignItems: 'center',
                gap: '0.375rem',
                fontSize: '0.875rem',
                cursor: 'pointer',
              }}
            >
              <Layers size={16} />
              {scanMode === 'dual' ? 'Dual Scan' : 'Serial Only'}
            </button>
          </div>
        </div>

        {/* Single Mode Status Badge */}
        {scanMode === 'single' && (
          <div
            className="flex items-center justify-between"
            style={{
              background: 'rgba(37, 99, 235, 0.2)',
              border: '1px solid rgba(59, 130, 246, 0.4)',
              borderRadius: '0.5rem',
              padding: '0.4rem 0.75rem',
              color: '#93c5fd',
              fontSize: '0.75rem',
              fontWeight: 600,
            }}
          >
            <div className="flex items-center gap-1.5">
              <CheckCircle2 size={14} style={{ color: '#60a5fa' }} />
              <span>Target: Serial (starts with P-...)</span>
            </div>
            <span style={{ color: '#fbbf24', fontSize: '0.7rem' }}>9-Digit PayGo Ignored</span>
          </div>
        )}

        {/* Dynamic Dual Scan Slots */}
        {scanMode === 'dual' && (
          <div
            className="flex w-full"
            style={{
              gap: '0.5rem',
              background: 'rgba(255,255,255,0.08)',
              padding: '0.5rem',
              borderRadius: '0.75rem',
              border: '1px solid rgba(255,255,255,0.1)',
              alignItems: 'center',
            }}
          >
            {/* Serial Number Slot */}
            <button
              onClick={() => setActiveSlot('serial')}
              style={{
                flex: 1,
                background: activeSlot === 'serial' ? 'rgba(37, 99, 235, 0.4)' : 'transparent',
                border: activeSlot === 'serial' ? '1.5px solid var(--color-primary)' : '1.5px solid transparent',
                borderRadius: '0.5rem',
                padding: '0.5rem',
                color: '#fff',
                textAlign: 'left',
                cursor: 'pointer',
              }}
            >
              <div style={{ fontSize: '0.75rem', opacity: 0.8, fontWeight: 600 }}>Serial Number</div>
              <div style={{ fontSize: '0.875rem', fontWeight: 700, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: '0.125rem' }}>
                {serialValue || 'Tap to Scan...'}
              </div>
            </button>

            {/* Paygo Code Slot */}
            <button
              onClick={() => { if (serialValue) setActiveSlot('paygo'); else toast.error('Scan Serial Number first!', { position: 'bottom-center' }); }}
              style={{
                flex: 1,
                background: activeSlot === 'paygo' ? 'rgba(37, 99, 235, 0.4)' : 'transparent',
                border: activeSlot === 'paygo' ? '1.5px solid var(--color-primary)' : '1.5px solid transparent',
                borderRadius: '0.5rem',
                padding: '0.5rem',
                color: '#fff',
                textAlign: 'left',
                cursor: serialValue ? 'pointer' : 'not-allowed',
                opacity: serialValue ? 1 : 0.5,
              }}
            >
              <div style={{ fontSize: '0.75rem', opacity: 0.8, fontWeight: 600 }}>Paygo Code</div>
              <div style={{ fontSize: '0.875rem', fontWeight: 700, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: '0.125rem' }}>
                {paygoValue || (serialValue ? 'Tap to Scan...' : 'Scan Serial first')}
              </div>
            </button>

            {/* Actions Panel */}
            <div className="flex gap-1">
              {/* Prompt to scan Paygo when serial is captured but paygo is missing */}
              {serialValue && !paygoValue && (
                <div
                  style={{
                    background: 'rgba(245, 158, 11, 0.15)',
                    border: '1.5px solid #f59e0b',
                    borderRadius: '0.5rem',
                    padding: '0.5rem 0.75rem',
                    color: '#fbbf24',
                    fontWeight: 700,
                    fontSize: '0.75rem',
                    display: 'flex',
                    alignItems: 'center',
                    minHeight: 40,
                    whiteSpace: 'nowrap',
                  }}
                >
                  Scan Paygo ▸
                </div>
              )}

              {/* Clear Button */}
              {(serialValue || paygoValue) && (
                <button
                  onClick={resetSlots}
                  style={{
                    background: 'rgba(239, 68, 68, 0.25)',
                    border: '1.5px solid var(--color-error)',
                    borderRadius: '0.5rem',
                    padding: '0.5rem',
                    color: '#fff',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 40,
                    minHeight: 40,
                  }}
                  title="Clear Slots"
                >
                  <RefreshCw size={16} />
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Viewfinder Element */}
      <div
        id="scanner-reader"
        style={{
          width: '100%',
          height: '100%',
          flex: 1,
        }}
      />

      {/* Frame overlay */}
      <ScannerOverlay isWide={isWide} scanMode={scanMode} activeSlot={activeSlot} />

      {/* Green screen flash */}
      {showFlash && <div className="scanner-flash" />}

      {/* Loading Spinner */}
      {isStarting && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 54,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0,0,0,0.85)',
          }}
        >
          <div className="flex flex-col items-center gap-4">
            <div className="spinner" style={{ width: 44, height: 44, borderWidth: 3 }} />
            <p style={{ color: '#fff', fontSize: '0.875rem' }}>Initializing HD camera...</p>
          </div>
        </div>
      )}
    </div>
  );
}

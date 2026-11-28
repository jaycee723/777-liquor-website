import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader, IScannerControls } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';
import {
  Camera,
  Flashlight,
  ImagePlus,
  Keyboard,
  RefreshCw,
  ScanBarcode,
  SwitchCamera,
  X,
  AlertTriangle,
} from 'lucide-react';
import { apiConfig } from '../services/apiClient';
import { normalizeScannedBarcode } from '../utils/barcodeScanner';

interface BarcodeScannerModalProps {
  open: boolean;
  title?: string;
  subtitle?: string;
  onDetected: (barcode: string) => void;
  onClose: () => void;
}

type CameraStatus = 'starting' | 'active' | 'permission-denied' | 'no-camera' | 'error';

const SAMPLE_BARCODES = [
  { label: 'Kona Big Wave 6pk', code: '079603011001' },
  { label: 'Maui Big Swell IPA', code: '085296800113' },
  { label: 'Kona Longboard 12pk', code: '079603012121' },
];

function createBarcodeReader(): BrowserMultiFormatReader {
  const hints = new Map<DecodeHintType, unknown>();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [
    BarcodeFormat.UPC_A,
    BarcodeFormat.UPC_E,
    BarcodeFormat.EAN_13,
    BarcodeFormat.EAN_8,
    BarcodeFormat.CODE_128,
    BarcodeFormat.CODE_39,
    BarcodeFormat.ITF,
    BarcodeFormat.QR_CODE,
  ]);
  return new BrowserMultiFormatReader(hints, {
    delayBetweenScanAttempts: 250,
    delayBetweenScanSuccess: 600,
  });
}

export function BarcodeScannerModal({
  open,
  title = 'Scan Product Barcode',
  subtitle = 'Point your phone or tablet rear camera at a bottle or case UPC, or use a USB/Bluetooth scanner.',
  onDetected,
  onClose,
}: BarcodeScannerModalProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const manualInputRef = useRef<HTMLInputElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const detectedLockRef = useRef(false);

  const [cameraStatus, setCameraStatus] = useState<CameraStatus>('starting');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [scanWarning, setScanWarning] = useState<string | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [activeDeviceId, setActiveDeviceId] = useState<string | null>(null);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [manualCode, setManualCode] = useState('');
  const [photoBusy, setPhotoBusy] = useState(false);

  const stopCamera = useCallback(() => {
    try {
      controlsRef.current?.stop();
    } catch {
      // Ignore cleanup errors on already-stopped controls
    }
    controlsRef.current = null;

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          // Ignore track stop errors
        }
      });
      streamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setTorchOn(false);
    setTorchSupported(false);
  }, []);

  const handleDecodedValue = useCallback(
    (rawValue: string): boolean => {
      const normalized = normalizeScannedBarcode(rawValue);
      if (!normalized.valid) {
        setScanWarning(normalized.warning ?? 'Unable to read barcode. Try again.');
        return false;
      }

      if (detectedLockRef.current) return true;
      detectedLockRef.current = true;
      setScanWarning(null);
      stopCamera();

      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        try {
          navigator.vibrate(45);
        } catch {
          // Ignore vibration restriction
        }
      }

      onDetected(normalized.code);
      return true;
    },
    [onDetected, stopCamera]
  );

  const startCamera = useCallback(
    async (requestedDeviceId?: string | null) => {
      stopCamera();
      detectedLockRef.current = false;
      setCameraStatus('starting');
      setCameraError(null);
      setScanWarning(null);

      if (
        typeof navigator === 'undefined' ||
        !navigator.mediaDevices ||
        typeof navigator.mediaDevices.getUserMedia !== 'function'
      ) {
        setCameraStatus('no-camera');
        setCameraError(
          'Live camera preview requires HTTPS and camera access. Use Photo Scan or USB/Manual UPC entry below.'
        );
        return;
      }

      const preferredConstraints: MediaStreamConstraints = {
        audio: false,
        video: requestedDeviceId
          ? {
              deviceId: { exact: requestedDeviceId },
              width: { ideal: 1280 },
              height: { ideal: 720 },
            }
          : {
              facingMode: { ideal: 'environment' },
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
      };

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia(preferredConstraints);
      } catch (primaryErr) {
        const errName = primaryErr instanceof Error ? primaryErr.name : '';
        if (errName === 'NotAllowedError' || errName === 'PermissionDeniedError') {
          setCameraStatus('permission-denied');
          setCameraError(
            'Camera access was blocked. Allow camera permission in Safari/Chrome settings, or scan from a photo or USB scanner below.'
          );
          return;
        }
        if (errName === 'NotFoundError' || errName === 'DevicesNotFoundError') {
          setCameraStatus('no-camera');
          setCameraError(
            'No camera was detected on this device. Use a USB/Bluetooth barcode scanner, Photo Scan, or enter the UPC below.'
          );
          return;
        }

        // Retry with minimal constraints for older iOS / Android browsers
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
        } catch (fallbackErr) {
          const fallbackName = fallbackErr instanceof Error ? fallbackErr.name : '';
          if (fallbackName === 'NotAllowedError' || fallbackName === 'PermissionDeniedError') {
            setCameraStatus('permission-denied');
            setCameraError(
              'Camera access was blocked. Allow camera permission in your browser settings, or use Photo Scan below.'
            );
          } else if (fallbackName === 'NotFoundError' || fallbackName === 'DevicesNotFoundError') {
            setCameraStatus('no-camera');
            setCameraError(
              'No camera was detected on this device. Use a USB/Bluetooth scanner or enter the UPC below.'
            );
          } else {
            setCameraStatus('error');
            setCameraError(
              'Could not start camera stream. Use Photo Scan or enter the UPC manually below.'
            );
          }
          return;
        }
      }

      if (!videoRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      streamRef.current = stream;

      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        const settings = videoTrack.getSettings?.();
        if (settings?.deviceId) {
          setActiveDeviceId(settings.deviceId);
        }
        try {
          const capabilities = videoTrack.getCapabilities?.() as
            | (MediaTrackCapabilities & { torch?: boolean })
            | undefined;
          setTorchSupported(Boolean(capabilities?.torch));
        } catch {
          setTorchSupported(false);
        }
      }

      try {
        const allDevices = await navigator.mediaDevices.enumerateDevices();
        setDevices(allDevices.filter((d) => d.kind === 'videoinput'));
      } catch {
        setDevices([]);
      }

      try {
        const reader = createBarcodeReader();
        const controls = await reader.decodeFromStream(stream, videoRef.current, (result) => {
          if (result && !detectedLockRef.current) {
            handleDecodedValue(result.getText());
          }
        });
        controlsRef.current = controls;
        setCameraStatus('active');
      } catch {
        stopCamera();
        setCameraStatus('error');
        setCameraError(
          'Live video barcode reader could not initialize. Use Photo Scan or type the UPC below.'
        );
      }
    },
    [handleDecodedValue, stopCamera]
  );

  useEffect(() => {
    if (!open) {
      stopCamera();
      setManualCode('');
      setScanWarning(null);
      return;
    }

    void startCamera(null);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        stopCamera();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      stopCamera();
    };
  }, [open, onClose, startCamera, stopCamera]);

  const handleToggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({
        advanced: [{ torch: next } as MediaTrackConstraintSet],
      });
      setTorchOn(next);
    } catch {
      setTorchSupported(false);
    }
  };

  const handleSwitchCamera = () => {
    if (devices.length < 2) return;
    const currentIdx = devices.findIndex((d) => d.deviceId === activeDeviceId);
    const nextDevice = devices[(currentIdx + 1) % devices.length];
    if (nextDevice?.deviceId) {
      void startCamera(nextDevice.deviceId);
    }
  };

  const handlePhotoCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setPhotoBusy(true);
    setScanWarning(null);
    const objectUrl = URL.createObjectURL(file);
    try {
      const reader = createBarcodeReader();
      const result = await reader.decodeFromImageUrl(objectUrl);
      handleDecodedValue(result.getText());
    } catch {
      setScanWarning(
        'No readable UPC barcode was found in that photo. Try a closer, well-lit shot without glare.'
      );
    } finally {
      URL.revokeObjectURL(objectUrl);
      setPhotoBusy(false);
    }
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleDecodedValue(manualCode);
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/60"
      role="dialog"
      aria-modal="true"
      aria-labelledby="barcode-scanner-title"
    >
      <div
        className="fixed inset-0"
        onClick={() => {
          stopCamera();
          onClose();
        }}
        aria-hidden="true"
      />

      <div className="relative z-10 w-full max-w-lg max-h-[92vh] overflow-y-auto rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl flex flex-col">
        {/* Header */}
        <div className="px-4 sm:px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-start justify-between gap-3">
          <div className="flex items-start gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-md bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-900 flex items-center justify-center shrink-0 mt-0.5">
              <ScanBarcode className="w-4 h-4 text-blue-700 dark:text-blue-400" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h2
                id="barcode-scanner-title"
                className="text-sm sm:text-base font-display font-bold text-slate-900 dark:text-slate-100"
              >
                {title}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{subtitle}</p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              stopCamera();
              onClose();
            }}
            aria-label="Close barcode scanner"
            className="p-1.5 rounded-md text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {/* Camera Viewport */}
        <div className="p-4 sm:p-5 space-y-4">
          <div className="relative w-full aspect-[16/10] sm:aspect-[16/9] rounded-md overflow-hidden bg-slate-950 border border-slate-800 flex items-center justify-center">
            <video
              ref={videoRef}
              playsInline
              muted
              autoPlay
              className={`w-full h-full object-cover ${
                cameraStatus === 'active' ? 'opacity-100' : 'opacity-0'
              }`}
            />

            {/* Reticle guide when camera is active */}
            {cameraStatus === 'active' && (
              <div
                className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center p-6"
                aria-hidden="true"
              >
                <div className="w-full max-w-[280px] h-24 sm:h-28 relative border border-white/40 rounded">
                  <span className="absolute -top-0.5 -left-0.5 w-5 h-5 border-t-2 border-l-2 border-blue-400" />
                  <span className="absolute -top-0.5 -right-0.5 w-5 h-5 border-t-2 border-r-2 border-blue-400" />
                  <span className="absolute -bottom-0.5 -left-0.5 w-5 h-5 border-b-2 border-l-2 border-blue-400" />
                  <span className="absolute -bottom-0.5 -right-0.5 w-5 h-5 border-b-2 border-r-2 border-blue-400" />
                  <div className="absolute left-2 right-2 top-1/2 -translate-y-1/2 h-px bg-blue-400/90" />
                </div>
                <span className="mt-2.5 px-2.5 py-0.5 text-[11px] font-medium text-white bg-slate-950/75 rounded">
                  Align UPC / EAN bars inside the frame
                </span>
              </div>
            )}

            {/* Starting state */}
            {cameraStatus === 'starting' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-slate-300 px-4 text-center">
                <Camera className="w-6 h-6 text-slate-400" aria-hidden="true" />
                <span className="text-xs font-medium">Requesting rear camera access...</span>
              </div>
            )}

            {/* Unavailable / Permission denied state */}
            {(cameraStatus === 'permission-denied' ||
              cameraStatus === 'no-camera' ||
              cameraStatus === 'error') && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 px-5 text-center">
                <Camera className="w-6 h-6 text-slate-400" aria-hidden="true" />
                <p className="text-xs text-slate-200 max-w-sm leading-relaxed">{cameraError}</p>
                <button
                  type="button"
                  onClick={() => void startCamera(activeDeviceId)}
                  className="h-8 px-3 inline-flex items-center gap-1.5 text-xs font-medium rounded border border-slate-600 bg-slate-800 text-slate-100 hover:bg-slate-700 transition-colors cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Retry Camera</span>
                </button>
              </div>
            )}
          </div>

          {/* Camera Hardware Controls & Native Mobile Photo Fallback */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={photoBusy}
                className="h-9 px-3 inline-flex items-center gap-1.5 text-xs font-medium rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors cursor-pointer disabled:opacity-60"
              >
                <ImagePlus className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{photoBusy ? 'Reading photo...' : 'Scan from Photo / Camera'}</span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handlePhotoCapture}
                className="sr-only"
                aria-label="Take a photo or choose an image of a barcode"
              />

              {torchSupported && cameraStatus === 'active' && (
                <button
                  type="button"
                  onClick={handleToggleTorch}
                  aria-pressed={torchOn}
                  className={`h-9 px-3 inline-flex items-center gap-1.5 text-xs font-medium rounded-md border transition-colors cursor-pointer ${
                    torchOn
                      ? 'border-amber-500 bg-amber-50 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300'
                      : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700'
                  }`}
                >
                  <Flashlight className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>{torchOn ? 'Flash On' : 'Flash'}</span>
                </button>
              )}

              {devices.length > 1 && cameraStatus === 'active' && (
                <button
                  type="button"
                  onClick={handleSwitchCamera}
                  className="h-9 px-3 inline-flex items-center gap-1.5 text-xs font-medium rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                >
                  <SwitchCamera className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Switch Lens</span>
                </button>
              )}
            </div>

            <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
              UPC-A · EAN-13 · Code 128
            </span>
          </div>

          {scanWarning && (
            <div
              role="alert"
              className="px-3 py-2 text-xs font-medium rounded-md border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/60 text-amber-900 dark:text-amber-200 flex items-center gap-2"
            >
              <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>{scanWarning}</span>
            </div>
          )}

          {/* USB/Bluetooth Handheld Scanner or Manual Entry */}
          <form
            onSubmit={handleManualSubmit}
            className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-2"
          >
            <label
              htmlFor="manual-barcode-input"
              className="flex items-center gap-1.5 text-xs font-medium text-slate-700 dark:text-slate-300"
            >
              <Keyboard className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
              <span>USB / Bluetooth Scanner or Manual UPC</span>
            </label>
            <div className="flex items-center gap-2">
              <input
                ref={manualInputRef}
                id="manual-barcode-input"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                value={manualCode}
                onChange={(e) => {
                  setManualCode(e.target.value);
                  if (scanWarning) setScanWarning(null);
                }}
                placeholder="Scan with handheld or type UPC (e.g. 079603011001)"
                className="flex-1 min-w-0 h-10 px-3 text-sm font-mono tabular-nums rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:font-sans placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
              <button
                type="submit"
                className="h-10 px-4 text-xs font-semibold rounded-md bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Use Code
              </button>
            </div>
          </form>

          {/* Quick-Test Sample Barcodes (Mock Mode Only) */}
          {apiConfig.useMockApi && (
            <div className="pt-2.5 border-t border-slate-200 dark:border-slate-800 space-y-1.5">
              <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                Mock mode quick-test barcodes
              </div>
              <div className="flex flex-wrap gap-1.5">
                {SAMPLE_BARCODES.map((sample) => (
                  <button
                    key={sample.code}
                    type="button"
                    onClick={() => handleDecodedValue(sample.code)}
                    className="h-7 px-2.5 text-[11px] font-medium rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                  >
                    <span>{sample.label}</span>
                    <span className="ml-1.5 font-mono text-slate-500 dark:text-slate-400">
                      {sample.code}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

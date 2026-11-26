import { useEffect, useRef, useState } from 'react'
import { Camera } from 'lucide-react'
import { Sheet } from './ui'

type Detector = { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> }

/** Phone camera barcode reader. A USB / Bluetooth scanner needs none of this: it types into the search box and presses Enter. */
export function CameraScan({ onCode, onClose }: { onCode: (code: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    let stream: MediaStream | undefined; let timer = 0; let stopped = false; let done = false
    ;(async () => {
      try {
        const Native = (window as unknown as { BarcodeDetector?: new (o?: object) => Detector }).BarcodeDetector
        const Ctor = (Native ?? (await import('barcode-detector/ponyfill')).BarcodeDetector) as new (o?: object) => Detector
        const det = new Ctor({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'qr_code', 'data_matrix'] })
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
        if (stopped || !video.current) return
        video.current.srcObject = stream
        await video.current.play()
        const tick = async () => {
          if (stopped || !video.current) return
          try {
            const codes = await det.detect(video.current)
            const raw = codes[0]?.rawValue?.trim()
            if (raw && !done) {
              done = true; navigator.vibrate?.(60)
              // GS1 DataMatrix on packs: pull the GTIN (01) out if present
              const gtin = raw.match(/^\(?01\)?(\d{14})/)?.[1]
              onCode(gtin ? gtin.replace(/^0/, '') : raw)
              return
            }
          } catch { /* frame not ready */ }
          timer = window.setTimeout(tick, 220)
        }
        tick()
      } catch (e) {
        setErr((e as Error).name === 'NotAllowedError'
          ? 'Camera permission was turned off. Allow it in your browser settings, or type the code.'
          : 'No camera here. Type the code, or use a barcode scanner.')
      }
    })()
    return () => { stopped = true; clearTimeout(timer); stream?.getTracks().forEach((t) => t.stop()) }
  }, [onCode])
  return (
    <Sheet open onClose={onClose} title={<span className="row"><Camera size={20} /> Point at the barcode</span>}>
      {err ? <p className="note amber">{err}</p> : (
        <div style={{ position: 'relative', borderRadius: 16, overflow: 'hidden', background: '#000', aspectRatio: '4 / 3' }}>
          <video ref={video} playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          <div style={{ position: 'absolute', inset: '30% 12%', border: '3px solid var(--lime)', borderRadius: 12 }} />
        </div>
      )}
      <p className="small muted" style={{ marginTop: 12 }}>Hold the pack still, about a hand away. It beeps when it reads.</p>
    </Sheet>
  )
}

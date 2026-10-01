import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, formatMacros, macrosFromPer100g } from '../api'
import type { Product } from '../types'

export function ScanPage() {
  const [mode, setMode] = useState<'barcode' | 'label'>('barcode')
  const [manualCode, setManualCode] = useState('')
  const [product, setProduct] = useState<Product | null>(null)
  const [amount, setAmount] = useState(100)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)
  const scannerRef = useRef<{ stop: () => Promise<void>; clear: () => void; isScanning: boolean } | null>(null)
  const lastCodeRef = useRef<string>('')

  useEffect(() => {
    return () => {
      void stopScanner()
    }
  }, [])

  async function stopScanner() {
    const scanner = scannerRef.current
    scannerRef.current = null
    setScanning(false)
    if (!scanner) return
    try {
      if (scanner.isScanning) await scanner.stop()
      scanner.clear()
    } catch {
      /* ignore */
    }
  }

  async function lookup(code: string) {
    const trimmed = code.trim()
    if (!trimmed || trimmed === lastCodeRef.current) return
    lastCodeRef.current = trimmed
    setBusy(true)
    setError(null)
    setInfo(null)
    try {
      const result = await api.lookupBarcode(trimmed)
      setProduct(result)
      setInfo(`Fundet via ${result.source}`)
      await stopScanner()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Produkt ikke fundet')
      lastCodeRef.current = ''
    } finally {
      setBusy(false)
    }
  }

  async function startScanner() {
    setError(null)
    setProduct(null)
    lastCodeRef.current = ''
    await stopScanner()
    const { Html5Qrcode } = await import('html5-qrcode')
    const scanner = new Html5Qrcode('barcode-reader')
    scannerRef.current = scanner
    setScanning(true)
    try {
      await scanner.start(
        { facingMode: 'environment' },
        { fps: 8, qrbox: { width: 260, height: 140 } },
        (decoded) => {
          void lookup(decoded)
        },
        () => undefined,
      )
    } catch (e) {
      setScanning(false)
      setError(e instanceof Error ? e.message : 'Kamera kunne ikke startes')
    }
  }

  async function onLabelFile(file: File | null) {
    if (!file) return
    setPreview(URL.createObjectURL(file))
    setBusy(true)
    setError(null)
    setInfo(null)
    setProduct(null)
    try {
      const result = await api.scanLabel(file)
      setProduct(result)
      setInfo('Label læst med AI')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'AI-scan fejlede')
    } finally {
      setBusy(false)
    }
  }

  const portionMacros = product ? macrosFromPer100g(amount, product) : null

  return (
    <section className="stack">
      <div className="panel">
        <h2>Scan</h2>
        <p className="muted">Stregkode via Open Food Facts, eller foto af indholdslabel via AI.</p>
        <div className="row">
          <button
            className={`btn ${mode === 'barcode' ? '' : 'secondary'}`}
            type="button"
            onClick={() => {
              setMode('barcode')
              void stopScanner()
            }}
          >
            Stregkode
          </button>
          <button
            className={`btn ${mode === 'label' ? '' : 'secondary'}`}
            type="button"
            onClick={() => {
              setMode('label')
              void stopScanner()
            }}
          >
            Label-foto
          </button>
        </div>
      </div>

      {error && <div className="error">{error}</div>}
      {info && <div className="success">{info}</div>}

      {mode === 'barcode' && (
        <div className="panel stack">
          <div id="barcode-reader" className="scanner" />
          <div className="row">
            {!scanning ? (
              <button className="btn accent" type="button" onClick={() => void startScanner()}>
                Start kamera
              </button>
            ) : (
              <button className="btn secondary" type="button" onClick={() => void stopScanner()}>
                Stop kamera
              </button>
            )}
          </div>
          <div className="row">
            <div className="field">
              <label>Eller indtast stregkode</label>
              <input
                value={manualCode}
                onChange={(e) => setManualCode(e.target.value)}
                placeholder="Fx 5700000000000"
              />
            </div>
            <button className="btn" type="button" disabled={busy} onClick={() => void lookup(manualCode)}>
              Hent
            </button>
          </div>
        </div>
      )}

      {mode === 'label' && (
        <div className="panel stack">
          <div className="field">
            <label>Tag eller vælg billede af næringsdeklaration</label>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(e) => void onLabelFile(e.target.files?.[0] ?? null)}
            />
          </div>
          {preview && <img className="preview-img" src={preview} alt="Valgt label" />}
          {busy && <p className="muted">AI analyserer…</p>}
        </div>
      )}

      {product && (
        <div className="panel stack">
          <h3>{product.name}</h3>
          {product.brand && <p className="muted">{product.brand}</p>}
          <div className="macros">
            Pr. 100 g:{' '}
            {formatMacros({
              kcal: product.kcalPer100g,
              protein: product.proteinPer100g,
              carbs: product.carbsPer100g,
              fat: product.fatPer100g,
            })}
          </div>
          <div className="row">
            <div className="field" style={{ maxWidth: 140 }}>
              <label>Mængde (g)</label>
              <input type="number" value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
            </div>
            {portionMacros && <div className="chip">For mængde: {formatMacros(portionMacros)}</div>}
          </div>
          <p className="muted">
            Produktet er gemt. Åbn <Link to="/retter/ny">Ny ret</Link> og vælg det under ingredienser.
          </p>
        </div>
      )}
    </section>
  )
}

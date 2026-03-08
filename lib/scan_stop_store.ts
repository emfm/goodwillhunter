// lib/scan-stop-store.ts
// Simple module-level flag that the scan route sets and the scanner checks.
// Lives in lib/ so both app/api/scan/stop/route.ts and lib/scanner.ts can import it.

let _stopRequested = false

export function isStopRequested(): boolean { return _stopRequested }
export function resetStopFlag(): void { _stopRequested = false }
export function requestStop(): void { _stopRequested = true }

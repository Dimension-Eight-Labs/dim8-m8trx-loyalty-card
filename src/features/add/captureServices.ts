/**
 * Capture services used by the add-card flow.
 *
 * The flow depends on this interface, not on canvas, camera, or decoder
 * implementations, so tests can inject fakes (jsdom has neither a camera nor
 * a canvas) and the browser adapters can change without touching the UI.
 * `defaultCaptureServices` wires the real implementations.
 */
import { startCameraScan, type CameraScanOptions, type CameraSession, type FoundResult, type ScanDiagnostics } from '../barcodes/camera.ts'
import { probeCanvasReadback, type CanvasReadback } from '../barcodes/canvasProbe.ts'
import type { DecodeResult } from '../barcodes/decode.ts'
import type { BarcodeFormat } from '../barcodes/formats.ts'
import { cropImage, decodeImage, loadImage, type LoadedImage, type PixelArea } from '../barcodes/imageSource.ts'
import { verifyRoundTrip, type VerifyResult } from '../barcodes/verify.ts'

export type { CameraScanOptions, CameraSession, CanvasReadback, DecodeResult, FoundResult, LoadedImage, PixelArea, ScanDiagnostics, VerifyResult }

export interface CaptureServices {
  /**
   * Starts the camera and scans until one confirmed result, which is
   * delivered at most once (the session has already stopped by then).
   */
  startCamera(video: HTMLVideoElement, onResult: (result: FoundResult) => void, options?: CameraScanOptions): Promise<CameraSession>
  loadImage(file: Blob): Promise<LoadedImage>
  decodeImage(image: LoadedImage, area?: PixelArea): Promise<DecodeResult>
  cropImage(image: LoadedImage, area: PixelArea): Promise<Blob>
  verify(format: BarcodeFormat, value: string): VerifyResult
  /** Optional: whether this browser alters canvas pixel reads (used to explain failures). */
  canvasReadback?(): CanvasReadback
}

export const defaultCaptureServices: CaptureServices = {
  startCamera: startCameraScan,
  loadImage,
  decodeImage,
  cropImage,
  verify: verifyRoundTrip,
  canvasReadback: probeCanvasReadback,
}

/**
 * Minimal OpenCV.js surface used by garment segmentation.
 * Verified against @techstark/opencv-js@4.10.0-release.1 at runtime.
 */

export type OpenCvMat = {
  rows: number
  cols: number
  data: Uint8Array
  data32F?: Float32Array
  data64F?: Float64Array
  delete: () => void
  clone: () => OpenCvMat
  copyTo: (dst: OpenCvMat) => void
  setTo: (value: { r?: number; g?: number; b?: number } | number) => void
}

export type OpenCvRuntime = {
  Mat: new (rows?: number, cols?: number, type?: number) => OpenCvMat
  matFromImageData: (imageData: {
    width: number
    height: number
    data: Uint8ClampedArray | Uint8Array
  }) => OpenCvMat
  matFromArray: (
    rows: number,
    cols: number,
    type: number,
    array: ArrayLike<number>,
  ) => OpenCvMat
  Size: new (width: number, height: number) => { width: number; height: number }
  Rect: new (
    x: number,
    y: number,
    width: number,
    height: number,
  ) => { x: number; y: number; width: number; height: number }
  cvtColor: (src: OpenCvMat, dst: OpenCvMat, code: number) => void
  resize: (
    src: OpenCvMat,
    dst: OpenCvMat,
    dsize: { width: number; height: number },
    fx?: number,
    fy?: number,
    interpolation?: number,
  ) => void
  grabCut: (
    img: OpenCvMat,
    mask: OpenCvMat,
    rect: { x: number; y: number; width: number; height: number },
    bgdModel: OpenCvMat,
    fgdModel: OpenCvMat,
    iterCount: number,
    mode?: number,
  ) => void
  connectedComponentsWithStats: (
    image: OpenCvMat,
    labels: OpenCvMat,
    stats: OpenCvMat,
    centroids: OpenCvMat,
    connectivity?: number,
    ltype?: number,
  ) => number
  Canny: (
    image: OpenCvMat,
    edges: OpenCvMat,
    threshold1: number,
    threshold2: number,
    apertureSize?: number,
    L2gradient?: boolean,
  ) => void
  GaussianBlur: (
    src: OpenCvMat,
    dst: OpenCvMat,
    ksize: { width: number; height: number },
    sigmaX: number,
    sigmaY?: number,
  ) => void
  morphologyEx: (
    src: OpenCvMat,
    dst: OpenCvMat,
    op: number,
    kernel: OpenCvMat,
    anchor?: { x: number; y: number },
    iterations?: number,
  ) => void
  getStructuringElement: (
    shape: number,
    ksize: { width: number; height: number },
  ) => OpenCvMat
  erode: (
    src: OpenCvMat,
    dst: OpenCvMat,
    kernel: OpenCvMat,
    anchor?: { x: number; y: number },
    iterations?: number,
  ) => void
  dilate: (
    src: OpenCvMat,
    dst: OpenCvMat,
    kernel: OpenCvMat,
    anchor?: { x: number; y: number },
    iterations?: number,
  ) => void
  threshold: (
    src: OpenCvMat,
    dst: OpenCvMat,
    thresh: number,
    maxval: number,
    type: number,
  ) => number
  distanceTransform: (
    src: OpenCvMat,
    dst: OpenCvMat,
    distanceType: number,
    maskSize: number,
  ) => void
  CV_8UC1: number
  CV_8UC3: number
  CV_8UC4: number
  CV_32FC1: number
  CV_32SC1: number
  CV_64FC1: number
  GC_BGD: number
  GC_FGD: number
  GC_PR_BGD: number
  GC_PR_FGD: number
  GC_INIT_WITH_MASK: number
  GC_INIT_WITH_RECT: number
  COLOR_RGBA2RGB: number
  COLOR_RGB2Lab: number
  COLOR_BGR2Lab: number
  COLOR_RGBA2BGR: number
  COLOR_RGB2GRAY: number
  COLOR_RGBA2GRAY: number
  INTER_LINEAR: number
  INTER_NEAREST: number
  MORPH_ELLIPSE: number
  MORPH_CLOSE: number
  MORPH_OPEN: number
  DIST_L2: number
  THRESH_BINARY: number
}

export function hasGrabCut(cv: OpenCvRuntime): boolean {
  return typeof (cv as { grabCut?: unknown }).grabCut === 'function'
}

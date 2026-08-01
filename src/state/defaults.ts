import type { PatternSettings } from '../types'

/**
 * Starting settings.
 *
 * These are chosen for the commonest job — checking a media server's outputs on
 * site — rather than for a broadcast bench. Hence `full` range by default (see
 * the note on LevelRange), a grid pitch of 100px, and the burn-in enabled: a
 * folder of test patterns with no names on them is a puzzle by the time it
 * reaches the person plugging in cables.
 */
export const DEFAULT_SETTINGS: PatternSettings = {
  kind: 'smpte-rp219',
  levels: 'full',

  grid: {
    mode: 'spacing',
    spacingPx: 100,
    divisionsX: 16,
    divisionsY: 9,
    lineWidthPx: 1,
    majorEvery: 5,
    majorLineWidthPx: 3,
    colour: '#3d7dff',
    majorColour: '#ffffff',
    background: '#000000',
    labelCells: false,
    diagonals: true,
    centreMarks: true,
    originCentre: false,
  },

  alignment: {
    edgeBorder: true,
    cornerMarkers: true,
    cornerSizePx: 100,
    centreTarget: true,
    safeAreas: [10, 20],
    pixelPatches: true,
    diagonals: true,
    background: '#000000',
    colour: '#ffffff',
  },

  led: {
    source: 'uniform',
    tileWidthPx: 168,
    tileHeightPx: 168,
    originXPx: 0,
    originYPx: 0,
    checker: true,
    checkerColourA: '#101010',
    checkerColourB: '#2a2a2a',
    borderColour: '#ffffff',
    borderWidthPx: 1,
    labelTiles: true,
    labelOrder: false,
    colourByGroup: false,
  },

  solid: { field: 'white', custom: '#ffffff', levelPct: 100 },

  greyscale: { steps: 11, vertical: false, perChannel: false },

  pixelCheck: { cellPx: 1, lineBursts: true },

  overlay: {
    enabled: true,
    showName: true,
    showResolution: true,
    showPattern: false,
    customText: '',
    fontSizePx: 0,
    colour: '#ffffff',
    plate: true,
    position: 'top-left',
  },

  regionOverlay: {
    enabled: false,
    outlines: true,
    labels: true,
    colour: '#ffcc00',
    lineWidthPx: 2,
  },
}

/** Common rasters, offered when adding an output by hand. */
export const RASTER_PRESETS: { label: string; width: number; height: number }[] = [
  { label: 'HD 1920 x 1080', width: 1920, height: 1080 },
  { label: 'UHD 3840 x 2160', width: 3840, height: 2160 },
  { label: 'DCI 2K 2048 x 1080', width: 2048, height: 1080 },
  { label: 'DCI 4K 4096 x 2160', width: 4096, height: 2160 },
  { label: 'WUXGA 1920 x 1200', width: 1920, height: 1200 },
  { label: 'WQXGA 2560 x 1600', width: 2560, height: 1600 },
  { label: '720p 1280 x 720', width: 1280, height: 720 },
  { label: '1600 x 1200', width: 1600, height: 1200 },
]
